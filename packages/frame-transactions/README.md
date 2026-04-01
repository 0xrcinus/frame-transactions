# @wonderland/frame-transactions

A TypeScript library for building, signing, and serializing Frame Transactions ([EIP-8141](https://eips.ethereum.org/EIPS/eip-8141)).

Frame transactions (tx type `0x06`) replace the single ECDSA signature with an array of **frames**, enabling arbitrary validation logic, gas sponsorship, and post-quantum signing schemes.

## Installation

```
pnpm add @wonderland/frame-transactions
```

## Quick Start

### App Developer: Send calls as a frame transaction

```typescript
import { createWalletClient, http } from "viem";
import { mainnet } from "viem/chains";
import { frameActions } from "@wonderland/frame-transactions";

const client = createWalletClient({
    chain: mainnet,
    transport: http(),
    account,
}).extend(frameActions());

// Self-pay: wallet handles VERIFY frames automatically
const hash = await client.sendFrameTransaction({
    calls: [
        { target: erc20, data: approveCalldata, gasLimit: 50000n, atomicBatch: true },
        { target: dex, data: swapCalldata, gasLimit: 200000n },
    ],
    maxPriorityFeePerGas: 1000000000n,
    maxFeePerGas: 2000000000n,
});
```

### App Developer: Sponsored transaction (with paymaster)

```typescript
import { frameActions } from "@wonderland/frame-transactions";

const client = createWalletClient({ ... }).extend(frameActions());

// 1. Prepare: resolves chainId, sender, nonce from client automatically
const prepared = await client.prepareFrameTransaction({
    calls: [{ target: erc20, data: transferCalldata, gasLimit: 50000n }],
    paymaster: sponsorAddr,
    maxPriorityFeePerGas: 1000000000n,
    maxFeePerGas: 2000000000n,
});

// 2. Get paymaster to sign the sig hash
const payerSignature = await paymaster.sign(prepared.sigHash);

// 3. Send — wallet signs the sender VERIFY frame automatically
const hash = await client.sendPreparedFrameTransaction({
    ...prepared,
    payerVerifyData: payerSignature,
});
```

### Wallet Developer: Full pipeline

```typescript
import {
    buildFrameTransaction,
    computeFrameSigHash,
    insertVerifyData,
    serializeFrameTransaction,
} from "@wonderland/frame-transactions";

// 1. Build: auto-generates VERIFY prefix from SENDER calls
const frameTx = buildFrameTransaction({
    chainId: 1n,
    nonce: 0n,
    sender: senderAddr,
    calls: [
        { target: erc20, data: approveCalldata, gasLimit: 50000n, atomicBatch: true },
        { target: dex, data: swapCalldata, gasLimit: 200000n },
    ],
    maxPriorityFeePerGas: 1000000000n,
    maxFeePerGas: 2000000000n,
});

// 2. Compute sig hash (VERIFY frame data is elided)
const sigHash = computeFrameSigHash(frameTx);

// 3. Sign externally (pluggable — ECDSA, P256, smart account, etc.)
const signature = await signer.sign(sigHash);

// 4. Insert signature into VERIFY frame
const signedTx = insertVerifyData(frameTx, { frameIndex: 0, data: signature });

// 5. Serialize as type 0x06
const serialized = serializeFrameTransaction(signedTx);

// 6. Submit
await client.sendRawTransaction({ serializedTransaction: serialized });
```

## EIP-8141 Background

A frame transaction contains an ordered array of frames, each with a `mode`, `target`, `gas_limit`, and `data`:

| Mode | Purpose |
|------|---------|
| `DEFAULT` | Execute as `ENTRY_POINT` (e.g. deploy account) |
| `VERIFY` | Validation frame — must call `APPROVE` (signature lives here) |
| `SENDER` | Execute on behalf of sender (the actual user calls) |

### Approval flow

Approval is two-phase: `sender_approved` must be set before `payer_approved`.

- **Self-pay**: single VERIFY frame calls `APPROVE(0x3)` — approves both sender and payer
- **Sponsored**: VERIFY frame calls `APPROVE(0x1)` for sender, separate VERIFY frame calls `APPROVE(0x2)` for paymaster

### Validation prefixes (mempool-recognized)

| Pattern | Frame ordering |
|---------|---------------|
| Self-relay | `verify(scope=0x3)` → sender frames |
| Self-relay + deploy | `deploy` → `verify(scope=0x3)` → sender frames |
| Paymaster | `verify(scope=0x1)` → `pay(scope=0x2)` → sender frames |
| Paymaster + deploy | `deploy` → `verify(scope=0x1)` → `pay(scope=0x2)` → sender frames |

`buildFrameTransaction` automatically generates the correct validation prefix based on whether a `paymaster` and/or `deploy` option is provided.

## API Reference

### Actions

| Function | Description |
|----------|-------------|
| `buildFrameTransaction(params)` | Build a frame tx from SENDER calls. Auto-generates VERIFY prefix. |
| `insertVerifyData(tx, { frameIndex, data })` | Insert signature into a VERIFY frame. Returns new tx (immutable). |
| `serializeFrameTransaction(tx)` | Validate and RLP-serialize as type `0x06`. |
| `prepareFrameTransaction(client, params)` | Build frame tx + compute sig hash. Resolves chainId/sender/nonce from client. |
| `sendFrameTransaction(client, params)` | Self-pay one-shot: build, sign, serialize, send. Resolves chainId/sender/nonce from client. |
| `sendPreparedFrameTransaction(client, params)` | Send a prepared tx with sender + payer signatures. |

### Utils

| Function | Description |
|----------|-------------|
| `computeFrameSigHash(tx)` | Compute keccak256(rlp(tx)) with VERIFY data elided. |
| `validateFrameTransaction(tx)` | Validate against EIP-8141 static constraints. |
| `deserializeFrameTransaction(hex)` | Decode a serialized type `0x06` transaction. |

### Types

| Type | Description |
|------|-------------|
| `Frame` | A single frame: `{ mode, target, gasLimit, data }` |
| `FrameTransaction` | Full tx: `{ chainId, nonce, sender, frames, ...gas }` |
| `FrameCall` | User-facing call: `{ target, data, gasLimit, atomicBatch? }` |
| `FrameMode` | Enum: `DEFAULT (0)`, `VERIFY (1)`, `SENDER (2)` |
| `ApprovalScope` | Enum: `ANY (0)`, `EXECUTION (1)`, `PAYMENT (2)`, `BOTH (3)` |

### Decorator

```typescript
import { frameActions } from "@wonderland/frame-transactions";

const client = createWalletClient({ ... }).extend(frameActions());
await client.sendFrameTransaction({ ... });
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

1. Install dependencies: `pnpm install`

| Script | Description |
|--------|-------------|
| `build` | Build library using tsc |
| `check-types` | Check types using tsc |
| `clean` | Remove `dist` folder |
| `test` | Run tests using vitest |
| `test:cov` | Run tests with coverage report |
| `lint` | Run ESLint |
| `format` | Check formatting with Prettier |

## References

- [EIP-8141: Frame Transaction](https://eips.ethereum.org/EIPS/eip-8141)
- [viem](https://viem.sh)
