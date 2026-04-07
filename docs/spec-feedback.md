# EIP-8141 Spec Feedback — From Implementation

Observations from building an SDK and demo against the live ethrex testnet. These informed the changes in our proposed rewrite.

## What works well

**Sig hash elision is clean.** VERIFY frame data gets zeroed before hashing, so both sender and paymaster compute the same sig hash regardless of signing order. No coordination needed.

**Validation prefix is composable.** The VERIFY + execution frame pattern is flexible. Self-pay (1 VERIFY), sponsored (2 VERIFY), deploy (EXECUTE + VERIFY) all compose naturally.

**Typed transaction envelope.** `0x06 || rlp(...)` follows EIP-2718 cleanly. Serialize once, use everywhere.

## Friction points

### EOA and smart account semantics diverge more than the spec suggests

The spec defines frame modes generically, but EOA "default code" gives them completely different data semantics:

| | Smart Account | EOA Default Code |
|---|---|---|
| VERIFY data | Whatever the contract expects | `0x00 + v + r + s` (66 bytes, raw ECDSA) |
| SENDER target | Call target address | `null` (triggers default code) |
| SENDER data | Calldata for target | `RLP([[target, value, data], ...])` |

Anyone building tooling has to support both paths. The spec reads like one transaction format when it's actually two. We had to branch on account type at every layer: frame construction, signing, serialization.

Adding a `value` field to the frame structure resolves most of this divergence — EOA EXECUTE frames can use the same `(target, value, data)` semantics as smart accounts, eliminating the RLP subcall encoding entirely. Our proposed rewrite takes this approach.

### EOA default code uses raw ecrecover

The sig hash is computed the same way for both account types, but EOA default code calls raw `ecrecover(sigHash, v, r, s)` with no prefix. Smart accounts typically verify via `signMessage` (EIP-191) or `signTypedData` (EIP-712).

This is the right choice for domain separation — EOA frame transaction signatures shouldn't be confusable with EIP-191 message signatures. But it means wallets need to learn about type 0x06 transactions, the same way they learned EIP-1559 and EIP-4844. Until then, tooling has to work around it. Our SDK exports a standalone `signEoaVerifyFrame(tx, privateKey)` because viem's `Account` interface doesn't expose prefix-free signing on non-local account types.

Once wallets support `signTransaction` for type 0x06, this stops being a special case — the wallet computes the sig hash, signs the raw digest, returns `{ v, r, s }`, same as every other transaction type.

### Approval scope bits add complexity without proportional value

The mode field packs three concerns: execution mode, approval scope (4 values), and atomic batch flag. In practice, scope is always determined by caller identity — the sender approves execution, a non-sender approves payment. The scope bits formalize cases that don't arise in real usage while creating footguns (ANY=0 being the most permissive default).

Our rewrite removes scope bits entirely. APPROVE's behavior is determined by whether the caller is the sender or not.

### APPROVE is not restricted to VERIFY frames

The spec allows APPROVE from any frame mode. This means the VERIFY/execution separation is a convention, not an invariant. A SENDER frame can call APPROVE as a side effect. Static analysis of approval flow requires tracing all frame execution, not just VERIFY frames.

Our rewrite restricts APPROVE to VERIFY frames at the opcode level.

### Atomic batch flags are fragile

The per-frame atomic batch flag means "I'm atomic with the next frame" — a forward reference that's easy to get wrong. Builders must set the flag on all-but-last (off-by-one trap), validation must check the next frame exists and is SENDER mode, and only contiguous sequences are supported.

Group IDs are a label rather than a forward reference. Simpler to construct, simpler to validate, and they support non-contiguous atomicity (e.g., an ERC-20 paymaster pattern with interleaved groups).

## Minor notes

- The `signature_type` byte in EOA VERIFY data (0x00 = ECDSA, 0x01 = P256) is forward-looking and good.
- `maxFeePerBlobGas` and `blobVersionedHashes` are always present even when not using blobs. Minor wire overhead but keeps the format fixed-width — probably the right tradeoff.
