# Frame Transactions (EIP-8141)

TypeScript SDK and demo apps for [EIP-8141 Frame Transactions](https://eips.ethereum.org/EIPS/eip-8141), tested against the live [ethrex](https://github.com/lambdaclass/ethrex) testnet.

## Packages

| Package | Description |
|---------|-------------|
| [`@wonderland/frame-transactions`](./packages/frame-transactions) | SDK — build, sign, serialize frame transactions for viem |
| [`frame-transactions-demo`](./apps/demo) | Demo scripts against the ethrex EIP-8141 testnet |

## What is EIP-8141?

A new transaction type (`0x06`) that replaces the single ECDSA signature with an ordered list of **frames**. Each frame has a mode (VERIFY or EXECUTE/SENDER), a target, a value, gas limit, and data. This enables:

- Pluggable authentication (ECDSA, P256, smart account logic)
- Gas sponsorship (separate sender and payer)
- Atomic batching (all-or-nothing frame groups)
- Account deployment in the same transaction
- Native support for both EOAs and smart accounts

## Quick Start

```
pnpm install
pnpm test          # 107 tests
pnpm build
```

### Run demos against the ethrex testnet

```
pnpm --filter frame-transactions-demo run simple-send
pnpm --filter frame-transactions-demo run batch-send
pnpm --filter frame-transactions-demo run sponsored-send
```

### Use the SDK

```typescript
import { createWalletClient, http, parseEther, parseGwei } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { frameActions } from "@wonderland/frame-transactions";

const client = createWalletClient({ chain, transport: http(RPC_URL), account })
    .extend(frameActions());

const hash = await client.sendFrameTransaction({
    calls: [{ target: recipient, value: parseEther("0.001"), data: "0x", gasLimit: 100_000n }],
    maxPriorityFeePerGas: parseGwei("1"),
    maxFeePerGas: parseGwei("3"),
    accountType: "eoa",
});
```

See the [SDK README](./packages/frame-transactions/README.md) for full API documentation.

## Demo Results

Tested against `https://demo.eip-8141.ethrex.xyz/rpc` (chain 1729):

| Demo | Frames | Gas | Status |
|------|--------|-----|--------|
| Simple send | VERIFY + SENDER | 22,484 | SUCCESS |
| Batch send | VERIFY + 3 SENDER (atomic) | 28,988 | SUCCESS |
| Sponsored send | 2 VERIFY + SENDER | 27,052 | SUCCESS |

## Structure

```
├── packages/frame-transactions/   # SDK
│   ├── src/
│   │   ├── actions/               # buildFrameTransaction, sendFrameTransaction, etc.
│   │   ├── decorator/             # viem client extension (frameActions)
│   │   ├── types/                 # Frame, FrameTransaction, FrameCall, AccountType
│   │   ├── utils/                 # sigHash, encoding, validation, computeTxHash
│   │   ├── eoa.ts                 # EOA helpers (ECDSA signing, RLP encoding)
│   │   └── external.ts            # public API
│   └── test/                      # 107 tests
├── apps/demo/                     # Demo scripts
│   └── src/
│       ├── simple-send.ts
│       ├── batch-send.ts
│       └── sponsored-send.ts
└── 8141-proposal.md               # EIP-8141 spec reference and notes
```

## References

- [EIP-8141: Frame Transaction](https://eips.ethereum.org/EIPS/eip-8141)
- [ethrex](https://github.com/lambdaclass/ethrex) — Ethereum client with EIP-8141 support
- [Ethereum Magicians discussion](https://ethereum-magicians.org/t/frame-transaction/27617)
