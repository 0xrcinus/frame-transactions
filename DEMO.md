# Demo — EIP-8141 Frame Transactions on ethrex

Three working demos against the live ethrex testnet (`https://demo.eip-8141.ethrex.xyz/rpc`, chain 1729).

## Results

| Demo | Frames | Gas | Status |
|------|--------|-----|--------|
| Simple send | VERIFY + SENDER | 22,484 | SUCCESS |
| Batch send | VERIFY + 3 SENDER (atomic) | 28,988 | SUCCESS |
| Sponsored send | 2 VERIFY + SENDER | 27,052 | SUCCESS |

All three demos import directly from the SDK — no workarounds or parallel implementations needed.

## How the demos use the SDK

```ts
import {
    buildFrameTransaction,
    serializeFrameTransaction,
    signEoaVerifyFrame,
    computeTxHash,
} from "@wonderland/frame-transactions";
```

Build with `accountType: 'eoa'`:
```ts
const frameTx = buildFrameTransaction({
    chainId, nonce, sender: account.address,
    calls: [{ target: RECIPIENT, value: SEND_AMOUNT, data: "0x", gasLimit: 100_000n }],
    accountType: "eoa",
    maxPriorityFeePerGas,
    maxFeePerGas,
});
```

Sign, serialize, send:
```ts
const signedTx = await signEoaVerifyFrame(frameTx, privateKey);
const serialized = serializeFrameTransaction(signedTx);
const txHash = computeTxHash(signedTx);
```

RPC reads use a viem `publicClient` (11 lines in `rpc.ts`).

## Previously fixed bugs

Found and fixed during initial demo development:

1. **RLP zero encoding** — `0n` must encode as empty bytes (`0x`), not `0x0`. Fixed in SDK `encoding.ts`.
2. **Sig hash missing type prefix** — should be `keccak256(0x06 || rlp(...))` per EIP-2718. Fixed in SDK `sigHash.ts`.
3. **ECDSA v value** — EOA default code expects `v = 27/28`, not recovery id `0/1`. Fixed in SDK `eoa.ts`.

## Known issue: value transfers on ethrex testnet

ETH value transfers in SENDER frames execute successfully (status 0x1, gas consumed) but the value doesn't land — recipient balance stays 0. This is a confirmed bug in ethrex's `execute_default_sender` where the `should_transfer_value` flag is set on the CallFrame but never acted on. See FEEDBACK.md for details.

## What's left for a ~20 line demo

The demos are now ~80 lines each (including logging). Reaching the ~20 line goal requires the SDK to handle EOA signing via the viem decorator so that `client.sendFrameTransaction()` works end-to-end for EOAs (currently only works for smart accounts via `signMessage`). The blocker is that EOA default code uses raw `ecrecover` (no EIP-191 prefix), which isn't available on all viem account types.
