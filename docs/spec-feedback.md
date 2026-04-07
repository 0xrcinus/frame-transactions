# EIP-8141 Spec Feedback — From Implementation

Observations from building an SDK and demo against the live ethrex testnet. These informed the changes in our proposed rewrite.

## What works well

Sig hash elision is clean. VERIFY frame data gets zeroed before hashing, so both sender and paymaster compute the same sig hash regardless of signing order. No coordination needed.

The validation prefix is composable. Self-pay (1 VERIFY), sponsored (2 VERIFY), deploy (EXECUTE + VERIFY) all compose without special casing.

The typed transaction envelope (`0x06 || rlp(...)`) follows EIP-2718 cleanly. Serialize once, use everywhere.

## Friction points

### EOA and smart account semantics diverge more than the spec suggests

The spec defines frame modes generically, but EOA "default code" gives them completely different data semantics:

| | Smart Account | EOA Default Code |
|---|---|---|
| VERIFY data | Whatever the contract expects | `0x00 + v + r + s` (66 bytes, raw ECDSA) |
| SENDER target | Call target address | `null` (triggers default code) |
| SENDER data | Calldata for target | `RLP([[target, value, data], ...])` |

Anyone building tooling has to support both paths. The spec reads like one transaction format when it's actually two. We had to branch on account type at every layer: frame construction, signing, serialization.

Adding a `value` field to the frame structure resolves most of this. EOA EXECUTE frames can use the same `(target, value, data)` semantics as smart accounts, and the RLP subcall encoding goes away. Our proposed rewrite takes this approach.

### EOA default code uses raw ecrecover

The sig hash is computed the same way for both account types, but EOA default code calls raw `ecrecover(sigHash, v, r, s)` with no prefix. Smart accounts typically verify via `signMessage` (EIP-191) or `signTypedData` (EIP-712).

This is the right choice for domain separation (EOA frame transaction signatures shouldn't be confusable with EIP-191 message signatures). But it means wallets need to learn about type 0x06 transactions, the same way they learned EIP-1559 and EIP-4844. Until then, tooling has to work around it. Our SDK exports a standalone `signEoaVerifyFrame(tx, privateKey)` because viem's `Account` interface doesn't expose prefix-free signing on non-local account types.

Once wallets support `signTransaction` for type 0x06, this stops being a special case. The wallet computes the sig hash, signs the raw digest, returns `{ v, r, s }`, same as every other transaction type.

### Approval scope bits aren't worth the complexity

The mode field packs three concerns: execution mode, approval scope (4 values), and atomic batch flag. In practice, scope is always determined by caller identity: the sender approves execution, a non-sender approves payment. The scope bits formalize cases that don't come up in real usage, and ANY=0 being the most permissive default is a footgun.

Our rewrite removes scope bits entirely. APPROVE's behavior is determined by whether the caller is the sender or not.

### APPROVE is not restricted to VERIFY frames

The spec allows APPROVE from any frame mode, so the VERIFY/execution separation is a convention, not something the protocol enforces. A SENDER frame can call APPROVE as a side effect. You can't statically determine the approval flow without tracing every frame's execution.

Our rewrite restricts APPROVE to VERIFY frames at the opcode level.

### Atomic batch flags are fragile

The per-frame atomic batch flag means "I'm atomic with the next frame", which is a forward reference that's easy to get wrong. Builders must set the flag on all-but-last (off-by-one trap), validation must check the next frame exists and is SENDER mode, and only contiguous sequences are supported.

Group IDs are a label rather than a forward reference. Simpler to construct, simpler to validate.

### P256 in default code enshrines a specific curve

The spec includes P256 as a second signature type (`0x01`) in EOA default code alongside ECDSA. The motivation is passkey/secure enclave support (WebAuthn, Apple/Android hardware), and P256VERIFY is already available as a precompile via RIP-7212.

But enshrining P256 in default code is a stronger commitment than making a precompile available. It means the protocol is picking this one curve as a built-in EOA signing scheme. Every additional curve (Ed25519, BLS, post-quantum) would require another hard fork to extend default code's `signature_type` switch.

There's also a practical problem: both signature types verify directly against the account address (`ecrecover → address` for ECDSA, `keccak256(qx|qy)[12:] → address` for P256). An existing EOA can never use P256 because its address is derived from a secp256k1 key. There's no key rotation or migration path built into default code.

Our rewrite keeps only ECDSA in default code (the one scheme existing EOAs actually use) and reserves `signature_type` `0x01`–`0xff` for companion EIPs to define delegation, P256, post-quantum schemes, or other signing approaches.

### Default code needs to account for EIP-7702 delegation states

The spec says default code applies to "accounts with no code," but doesn't address EIP-7702 delegation. An account can have a 7702 delegation indicator (`0xef0100 || address`) where the target has no code. In that state the account technically has code (23 bytes of indicator), but the resolved code is empty. If default code only checks for "no code," these accounts are stuck: the delegation indicator means default code doesn't run, but there's nothing at the delegation target either.

Default code should also apply when the account has a 7702 delegation whose target has empty code. Our rewrite makes this explicit.

## Minor notes

- `maxFeePerBlobGas` and `blobVersionedHashes` are always present even when not using blobs. Minor wire overhead but keeps the format fixed-width — probably the right tradeoff.
