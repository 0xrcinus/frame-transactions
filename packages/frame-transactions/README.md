# @wonderland/frame-transactions

A TypeScript library for building, signing, and serializing Frame Transactions ([EIP-8141](https://eips.ethereum.org/EIPS/eip-8141)).

Frame transactions (tx type `0x06`) replace the single ECDSA signature with an array of **frames**, enabling arbitrary validation logic, gas sponsorship, and post-quantum signing schemes.

## Installation

```
pnpm add @wonderland/frame-transactions
```

## Quick Start

### EOA: Send ETH via the viem decorator

```typescript
import { createWalletClient, createPublicClient, http, parseEther, parseGwei } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { frameActions } from "@wonderland/frame-transactions";

const account = privateKeyToAccount(PRIVATE_KEY);

const client = createWalletClient({ chain, transport: http(RPC_URL), account })
    .extend(frameActions());

const hash = await client.sendFrameTransaction({
    calls: [{ target: recipient, value: parseEther("0.001"), data: "0x", gasLimit: 100_000n }],
    maxPriorityFeePerGas: parseGwei("1"),
    maxFeePerGas: parseGwei("3"),
    accountType: "eoa",
});
```

### Smart Account: Send calls as a frame transaction

```typescript
const client = createWalletClient({ chain, transport: http(), account })
    .extend(frameActions());

const hash = await client.sendFrameTransaction({
    calls: [
        { target: erc20, data: approveCalldata, gasLimit: 50000n, atomicBatch: true },
        { target: dex, data: swapCalldata, gasLimit: 200000n },
    ],
    maxPriorityFeePerGas: 1000000000n,
    maxFeePerGas: 2000000000n,
});
```

### Sponsored transaction (with paymaster)

```typescript
const client = createWalletClient({ ... }).extend(frameActions());

// 1. Prepare: resolves chainId, sender, nonce from client automatically
const prepared = await client.prepareFrameTransaction({
    calls: [{ target: erc20, data: transferCalldata, gasLimit: 50000n }],
    paymaster: sponsorAddr,
    maxPriorityFeePerGas: 1000000000n,
    maxFeePerGas: 2000000000n,
    accountType: "eoa", // or omit for smart account
});

// 2. Get paymaster to sign the sig hash
const payerSignature = await paymaster.sign(prepared.sigHash);

// 3. Send — wallet signs the sender VERIFY frame automatically
const hash = await client.sendPreparedFrameTransaction({
    ...prepared,
    payerVerifyData: payerSignature,
    accountType: "eoa",
});
```

### Wallet Developer: Full pipeline

```typescript
import {
    buildFrameTransaction,
    computeFrameSigHash,
    serializeFrameTransaction,
    computeTxHash,
    signEoaVerifyFrame,   // for EOAs
    insertVerifyData,      // for smart accounts
} from "@wonderland/frame-transactions";

// 1. Build: auto-generates VERIFY prefix from calls
const frameTx = buildFrameTransaction({
    chainId: 1n, nonce: 0n, sender: senderAddr,
    calls: [
        { target: recipient, value: parseEther("1"), data: "0x", gasLimit: 100_000n },
    ],
    accountType: "eoa", // or "smart-account" (default)
    maxPriorityFeePerGas: 1000000000n,
    maxFeePerGas: 2000000000n,
});

// 2. Sign — EOA (raw ECDSA) or smart account (pluggable)
const signedTx = await signEoaVerifyFrame(frameTx, privateKey);
// OR for smart accounts:
// const sigHash = computeFrameSigHash(frameTx);
// const sig = await signer.sign(sigHash);
// const signedTx = insertVerifyData(frameTx, { frameIndex: 0, data: sig });

// 3. Serialize as type 0x06
const serialized = serializeFrameTransaction(signedTx);

// 4. Compute tx hash
const txHash = computeTxHash(signedTx);
```

## Account Types

The SDK supports both EOA and smart account patterns via the `accountType` parameter:

| | `accountType: "smart-account"` (default) | `accountType: "eoa"` |
|---|---|---|
| SENDER frame target | `call.target` | `null` (triggers default code) |
| SENDER frame data | `call.data` (calldata) | RLP-encoded `[[target, value, data]]` |
| Signing | `signMessage` (EIP-191) | Raw ECDSA via `signEoaVerifyFrame` |
| VERIFY data format | Contract-defined | `0x00 + v + r + s` (66 bytes) |

The viem decorator (`sendFrameTransaction`) auto-detects local accounts and uses raw ECDSA signing for EOA mode.

## API Reference

### Actions

| Function | Description |
|----------|-------------|
| `buildFrameTransaction(params)` | Build a frame tx from calls. Auto-generates VERIFY prefix. Supports `accountType`. |
| `insertVerifyData(tx, { frameIndex, data })` | Insert signature into a VERIFY frame. Returns new tx (immutable). |
| `serializeFrameTransaction(tx)` | Validate and RLP-serialize as type `0x06`. |
| `prepareFrameTransaction(client, params)` | Build + compute sig hash. Resolves chainId/sender/nonce from client. |
| `sendFrameTransaction(client, params)` | One-shot: build, sign, serialize, send. |
| `sendPreparedFrameTransaction(client, params)` | Send a prepared tx with sender + payer signatures. |

### EOA Helpers

| Function | Description |
|----------|-------------|
| `signEoaVerifyFrame(tx, privateKey, index?)` | Sign a VERIFY frame with raw ECDSA (no EIP-191 prefix). |
| `encodeEcdsaVerifyData({ v, r, s })` | Encode ECDSA signature as `0x00 + v + r + s` (66 bytes). |
| `encodeEoaSenderData(calls)` | RLP-encode calls as `[[target, value, data], ...]` for EOA SENDER frames. |

### Utils

| Function | Description |
|----------|-------------|
| `computeFrameSigHash(tx)` | Compute `keccak256(0x06 \|\| rlp(tx))` with VERIFY data elided. |
| `computeTxHash(tx)` | Compute `keccak256(0x06 \|\| rlp(tx))` — the transaction hash. |
| `validateFrameTransaction(tx)` | Validate against EIP-8141 static constraints. |
| `deserializeFrameTransaction(hex)` | Decode a serialized type `0x06` transaction. |

### Types

| Type | Description |
|------|-------------|
| `Frame` | A single frame: `{ mode, target, gasLimit, data }` |
| `FrameTransaction` | Full tx: `{ chainId, nonce, sender, frames, ...gas }` |
| `FrameCall` | User-facing call: `{ target, value?, data, gasLimit, atomicBatch? }` |
| `FrameMode` | Enum: `DEFAULT (0)`, `VERIFY (1)`, `SENDER (2)` |
| `ApprovalScope` | Enum: `ANY (0)`, `EXECUTION (1)`, `PAYMENT (2)`, `BOTH (3)` |
| `AccountType` | `"eoa" \| "smart-account"` |

### Decorator

```typescript
import { frameActions } from "@wonderland/frame-transactions";

const client = createWalletClient({ ... }).extend(frameActions());
await client.sendFrameTransaction({ calls: [...], accountType: "eoa" });
await client.prepareFrameTransaction({ ... });
await client.sendPreparedFrameTransaction({ ... });
```

### Constants

| Constant | Value |
|----------|-------|
| `FRAME_TX_TYPE` | `0x06` |
| `FRAME_TX_INTRINSIC_COST` | `15000n` |
| `ENTRY_POINT` | `0x00...aa` |
| `MAX_FRAMES` | `1000` |

## Local Development

```
pnpm install
pnpm test        # 107 tests
pnpm build
```

## References

- [EIP-8141: Frame Transaction](https://eips.ethereum.org/EIPS/eip-8141)
- [viem](https://viem.sh)
