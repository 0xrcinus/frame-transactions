# Frame Transactions (EIP-8141)

> **Experimental proof-of-concept.** This project exists to further discussion and development of [EIP-8141](https://eips.ethereum.org/EIPS/eip-8141). The SDK is not published on npm and APIs may change without notice.

TypeScript SDK, spec proposals, and demo apps for [EIP-8141 Frame Transactions](https://eips.ethereum.org/EIPS/eip-8141), tested against the live [ethrex](https://github.com/lambdaclass/ethrex) testnet.

## What is EIP-8141?

A new transaction type (`0x06`) that replaces the single ECDSA signature with an ordered list of **frames**. Each frame has a mode (VERIFY or EXECUTE), a target, a value, gas limit, and data. This enables:

- Pluggable authentication (ECDSA, smart account logic, with extensibility for delegation and PQ schemes)
- Gas sponsorship (separate sender and payer)
- Atomic batching (all-or-nothing frame groups)
- Account deployment in the same transaction
- Native support for both EOAs and smart accounts

## Repository

| Directory | Description |
|-----------|-------------|
| [`packages/frame-transactions`](./packages/frame-transactions) | SDK for building, signing, and serializing frame transactions with viem |
| [`apps/demo`](./apps/demo) | Demo scripts against the ethrex EIP-8141 testnet |
| [`docs/`](./docs) | Spec proposals and implementation feedback |

### Docs

| Document | Description |
|----------|-------------|
| [eip-8141.md](./docs/eip-8141.md) | Upstream EIP-8141 spec (reference copy) |
| [eip-8141-proposed.md](./docs/eip-8141-proposed.md) | Our proposed rewrite of the spec |
| [eip-8141-proposal-summary.md](./docs/eip-8141-proposal-summary.md) | Short summary of what we changed and why |
| [spec-feedback.md](./docs/spec-feedback.md) | Observations from implementing the SDK |
| [ethrex-bugs.md](./docs/ethrex-bugs.md) | Bugs found in the ethrex implementation |

## Quick start

```
pnpm install
pnpm test
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
import { frameActions } from "frame-transactions";

const client = createWalletClient({ chain, transport: http(RPC_URL), account })
    .extend(frameActions());

const hash = await client.sendFrameTransaction({
    calls: [{ target: recipient, value: parseEther("0.001"), data: "0x", gasLimit: 100_000n }],
    maxPriorityFeePerGas: parseGwei("1"),
    maxFeePerGas: parseGwei("3"),
    accountType: "eoa",
});
```

See the [SDK README](./packages/frame-transactions/README.md) for full API docs.

## Demo results

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
│   └── test/
├── apps/demo/                     # Demo scripts
│   └── src/
│       ├── simple-send.ts
│       ├── batch-send.ts
│       └── sponsored-send.ts
└── docs/                          # Spec proposals and feedback
    ├── eip-8141.md                # Upstream spec
    ├── eip-8141-proposed.md       # Proposed rewrite
    ├── eip-8141-proposal-summary.md
    ├── spec-feedback.md
    └── ethrex-bugs.md
```

## References

- [EIP-8141: Frame Transaction](https://eips.ethereum.org/EIPS/eip-8141)
- [ethrex](https://github.com/lambdaclass/ethrex) — Ethereum client with EIP-8141 support
- [Ethereum Magicians discussion](https://ethereum-magicians.org/t/frame-transaction/27617)
