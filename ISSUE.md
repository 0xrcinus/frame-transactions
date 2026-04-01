# Frame Transactions Package (EIP-8141 POC)

**Spec:** https://eips.ethereum.org/EIPS/eip-8141
**Repo:** `frame-transactions` (standalone monorepo)
**Package:** `packages/frame-transactions`

## Goal

A viem-familiar package for Frame Transactions (tx type `0x06`). Structured so it could eventually land upstream in viem.

Two audiences:
- **App devs** — use `sendFrameTransaction` / `prepareFrameTransaction` to send frame transactions
- **Wallet devs** — build, sign, serialize, and submit frame transactions with pluggable signing

## Background (EIP-8141)

A frame transaction replaces the single ECDSA signature with an array of **frames**, each with a `mode`, `target`, `gas_limit`, and `data`:

| Mode      | Purpose                                          |
|-----------|--------------------------------------------------|
| `DEFAULT` | Execute as `ENTRY_POINT` (e.g. deploy account)   |
| `VERIFY`  | Validate tx, must call `APPROVE` (signature lives here) |
| `SENDER`  | Execute on behalf of sender (the actual calls)   |

Transaction payload: `[chain_id, nonce, sender, frames, max_priority_fee_per_gas, max_fee_per_gas, max_fee_per_blob_gas, blob_versioned_hashes]`

Key nuances:
- Signature goes *inside* a VERIFY frame's data — not a top-level tx field
- Sig hash is computed with VERIFY frame data elided
- Signing scheme is arbitrary (ECDSA, P256, custom smart account logic)
- Multiple signers possible (sender verify + paymaster verify)
- SENDER frames support atomic batching (all-or-nothing via mode flag)
- EOAs get "default code" behavior (ECDSA or P256 verification built-in)

### Approval Flow (sender/payer)

Approval is two-phase with transaction-scoped flags: `sender_approved` and `payer_approved`.

VERIFY frames call `APPROVE(scope)` where scope is:
- `0x1` — approve execution only (sets `sender_approved = true`)
- `0x2` — approve payment only (sets `payer_approved = true`, **requires `sender_approved` already true**)
- `0x3` — approve both at once (self-relay: sender = payer)

Mode bits 9-10 constrain which scope a VERIFY frame is allowed to use:
- `(mode>>8) & 3 == 0` → any scope
- `(mode>>8) & 3 == 1` → only `0x1` (execution)
- `(mode>>8) & 3 == 2` → only `0x2` (payment)
- `(mode>>8) & 3 == 3` → only `0x3` (both)

### Mempool-recognized Validation Prefixes

The protocol only allows specific frame orderings in the public mempool:

| Pattern | Frames (validation prefix) |
|---------|---------------------------|
| Self-relay | `verify(scope=0x3)` → sender frames |
| Self-relay + deploy | `deploy` → `verify(scope=0x3)` → sender frames |
| Paymaster | `verify(scope=0x1)` → `pay(scope=0x2)` → sender frames |
| Paymaster + deploy | `deploy` → `verify(scope=0x1)` → `pay(scope=0x2)` → sender frames |

**Wallet responsibility:** The wallet always auto-generates the sender VERIFY frame. For payment:
- **Self-pay** (no payer frame from app): prepend one VERIFY frame with scope `0x3`, target = sender
- **Sponsored** (app provides payer VERIFY frame): prepend VERIFY frame (scope `0x1`, target = sender) + use the app-provided payer VERIFY frame (scope `0x2`, target = paymaster)
- **Deploy**: optionally prepend a DEFAULT frame for account deployment before VERIFY frame(s)

## API Design

### App Dev: `sendFrameTransaction`

App devs provide their intent as SENDER frames. The wallet auto-generates the sender VERIFY frame, but the app can optionally provide a payer VERIFY frame (e.g. if the app wants to sponsor the transaction):

```ts
// Simple case: app just describes calls, wallet handles all VERIFY frames
// chainId, sender, nonce resolved from client automatically
const id = await client.sendFrameTransaction({
  calls: [
    { target: erc20, data: approveCalldata, gasLimit: 50000n, atomicBatch: true },
    { target: dex, data: swapCalldata, gasLimit: 200000n },
  ],
  maxPriorityFeePerGas: 1000000000n,
  maxFeePerGas: 2000000000n,
})

// Sponsored case: app needs the sig hash so the paymaster can sign it
// Step 1: prepare — resolves chainId/sender/nonce from client, returns sig hash
const prepared = await client.prepareFrameTransaction({
  calls: [
    { target: erc20, data: approveCalldata, gasLimit: 50000n, atomicBatch: true },
    { target: dex, data: swapCalldata, gasLimit: 200000n },
  ],
  paymaster: sponsorAddr,
  maxPriorityFeePerGas: 1000000000n,
  maxFeePerGas: 2000000000n,
})
// prepared.sigHash, prepared.frameTx (with VERIFY placeholders)

// Step 2: get the paymaster to sign
const payerSignature = await paymaster.sign(prepared.sigHash)

// Step 3: send — wallet signs the sender VERIFY frame automatically
const id = await client.sendPreparedFrameTransaction({
  ...prepared,
  payerVerifyData: payerSignature,
})
```

For the simple (self-pay) case, the wallet auto-generates the sender VERIFY frame with scope `0x3` and handles everything in one call. `chainId`, `sender`, and `nonce` are resolved from the client (all overridable via params). For sponsored txs, the app needs the prepare → paymaster sign → send roundtrip because the paymaster needs the sig hash before it can sign.

### Wallet Dev: build → sign → serialize → send

Each step is separable. The wallet generates VERIFY frames from the app's SENDER-only intent:

```ts
// 1. Build: take SENDER frames, generate full frame tx with VERIFY prefix
//    accountType controls SENDER frame encoding (EOA vs smart account)
const frameTx = buildFrameTransaction({
  chainId, nonce, sender,
  calls: [
    { target: erc20, value: 0n, data: approveCalldata, gasLimit: 50000n, atomicBatch: true },
    { target: dex, value: 0n, data: swapCalldata, gasLimit: 200000n },
  ],
  accountType: 'eoa', // or 'smart-account' (default)
  maxFeePerGas, maxPriorityFeePerGas,
  // Optional: paymaster for sponsored txs
  // paymaster: paymasterAddr
})
// Self-pay result:  [verify(sender, scope=0x3), sender(null, rlp), sender(null, rlp)]
// Paymaster result: [verify(sender, scope=0x1), verify(paymaster, scope=0x2), sender(...), ...]

// 2. Sign VERIFY frame — for EOAs, use raw ECDSA signing
const signedTx = await signEoaVerifyFrame(frameTx, privateKey)

// 2b. For smart accounts, use pluggable signing:
// const sigHash = computeFrameSigHash(frameTx)
// const sig = await signer.sign(sigHash)
// const signedTx = insertVerifyData(frameTx, { frameIndex: 0, data: sig })

// 3. Serialize: RLP encode as type 0x06
const serialized = serializeFrameTransaction(signedTx)

// 4. Compute tx hash
const txHash = computeTxHash(signedTx)

// 5. Submit
await client.sendRawTransaction({ serializedTransaction: serialized })
```

## Package Structure

```
packages/frame-transactions/
├── src/
│   ├── index.ts              # re-exports external.ts
│   ├── external.ts           # public API surface
│   ├── internal.ts           # all exports (for tests)
│   ├── eoa.ts                # EOA helpers: ECDSA signing, RLP subcall encoding
│   ├── actions/
│   │   ├── sendFrameTransaction.ts         # app-dev: send frame tx (self-pay, smart account)
│   │   ├── prepareFrameTransaction.ts      # app-dev: prepare for sponsored txs (returns sigHash)
│   │   ├── sendPreparedFrameTransaction.ts # app-dev: send after paymaster signs
│   │   ├── buildFrameTransaction.ts  # wallet-dev: construct frame tx (EOA or smart account)
│   │   ├── insertVerifyData.ts       # wallet-dev: insert signature into VERIFY frame
│   │   ├── serializeFrameTransaction.ts # wallet-dev: RLP encode type 0x06
│   │   └── index.ts
│   ├── decorator/
│   │   └── frameActions.ts           # client.extend(frameActions()) pattern
│   ├── types/
│   │   ├── frame.ts                  # Frame, FrameMode, FrameTransaction
│   │   ├── transaction.ts            # FrameCall (with value), AccountType, serialized types
│   │   └── index.ts
│   ├── errors/
│   │   └── index.ts
│   └── utils/
│       ├── sigHash.ts                # computeFrameSigHash (elide VERIFY data)
│       ├── encoding.ts               # RLP encode/decode, computeTxHash
│       ├── validation.ts             # static frame validation
│       └── index.ts
├── test/
│   ├── eoa.spec.ts                    # EOA encoding, signing, end-to-end tests (19 tests)
│   ├── actions/
│   │   ├── buildFrameTransaction.spec.ts
│   │   ├── prepareFrameCalls.spec.ts
│   │   └── serializeFrameTransaction.spec.ts
│   ├── utils/
│   │   ├── sigHash.spec.ts
│   │   └── encoding.spec.ts
│   └── spec/                          # EIP-8141 spec conformance tests
│       ├── frameValidation.spec.ts
│       ├── approvalFlow.spec.ts
│       ├── validationPrefixes.spec.ts
│       ├── sigHash.spec.ts
│       ├── serialization.spec.ts
│       └── examples.spec.ts
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
└── .npmrc
```

## Current Status

**107 tests passing, builds clean, demos verified against live testnet.**

### Completed

1. Core SDK: types, actions, utils, decorator, validation (steps 1-6 below)
2. EOA support: `buildFrameTransaction` with `accountType: 'eoa'`, `signEoaVerifyFrame`, `encodeEoaSenderData`, `encodeEcdsaVerifyData`
3. `FrameCall` has `value` field for ETH transfers
4. `computeTxHash` exported from utils
5. Demo app rewritten to use SDK directly (deleted parallel `eoa.ts`, replaced raw `rpc.ts` with viem `publicClient`)
6. Spec feedback written in FEEDBACK.md

### Remaining

- **viem decorator for EOAs** — `client.sendFrameTransaction()` currently only works for smart accounts (uses `signMessage` which adds EIP-191 prefix). EOAs need raw ECDSA signing, which requires `PrivateKeyAccount` or similar. This would get the demo to ~20 lines.
- **ethrex value transfer bug** — confirmed with the ethrex team. ETH value in SENDER frames doesn't transfer despite success status. Tracked in FEEDBACK.md.

## Original Steps

1. **Scaffold the package** — DONE

2. **Define types** — DONE. `Frame`, `FrameMode`, `FrameTransaction`, `FrameCall` (with `value`), `AccountType`

3. **Implement utils** — DONE. `computeFrameSigHash`, `computeTxHash`, RLP encoding/decoding, validation

4. **Implement wallet-dev actions** — DONE. `buildFrameTransaction` (EOA + smart account), `insertVerifyData`, `serializeFrameTransaction`

5. **Implement app-dev actions** — DONE. `sendFrameTransaction`, `prepareFrameTransaction`, `sendPreparedFrameTransaction`

6. **Build decorator** — DONE. `frameActions()` for `client.extend(frameActions())`

7. **EOA support** — DONE. `signEoaVerifyFrame`, `encodeEcdsaVerifyData`, `encodeEoaSenderData`

8. **Write tests** — DONE (107 tests)

## Design Decisions

- **viem as a regular npm dep** — reference source at `../viem` for study only, not a workspace package
- **Clear naming** — `sendFrameTransaction`, `prepareFrameTransaction`, `sendPreparedFrameTransaction`
- **Separable wallet pipeline** — build/insert/serialize/send are independent steps, not one monolithic function
- **Signing is external** — we provide `computeFrameSigHash` and `insertVerifyData`, the caller owns the actual signing (ECDSA, P256, smart account, etc.)
- **Action signatures match viem** — `(client, parameters) => Promise<ReturnType>` for eventual upstream
- **Decorator pattern via `.extend()`** — same as viem's EIP-5792 experimental extension
- **No class-based design** — pure functions + types, matching viem philosophy
- **Follow interop-sdk conventions** — `external.ts`/`internal.ts` split, same build/test tooling
