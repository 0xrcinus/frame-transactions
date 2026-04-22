# EIP-8141 Spec Feedback — From Implementation

Observations from building an SDK and demo against the live ethrex testnet. These informed the changes in our proposed rewrite.

## What works well

Sig hash elision is clean. VERIFY frame data gets zeroed before hashing, so both sender and paymaster compute the same sig hash regardless of signing order. No coordination needed.

The validation prefix is composable. Self-pay (1 VERIFY), sponsored (2 VERIFY), deploy (DEFAULT + VERIFY) all compose without special casing.

The typed transaction envelope (`0x06 || rlp(...)`) follows EIP-2718 cleanly. Serialize once, use everywhere.

## Friction points

### EOA and smart account semantics diverge more than the spec suggests

The spec defines frame modes generically, but EOA "default code" gives them completely different data semantics:

| | Smart Account | EOA Default Code |
|---|---|---|
| VERIFY data | Whatever the contract expects | `0x00 + v + r + s` (66 bytes, ECDSA) or `0x01 + r + s + qx + qy` (129 bytes, P256) |
| SENDER target | Call target address | `null` (triggers default code) |
| SENDER data | Calldata for target | `RLP([[target, value, data], ...])` |

Anyone building tooling has to support both paths. The spec reads like one transaction format when it's actually two. We had to branch on account type at every layer: frame construction, signing, serialization.

Adding a `value` field to the frame structure resolves most of this. EOA EXECUTE frames can use the same `(target, value, data)` semantics as smart accounts, and the RLP subcall encoding goes away. The spec rationale explicitly rejects this ("No value in frame: It is not required because the account code can send value"), but the cost is borne entirely by tooling authors and EOA users, not by the protocol. Our proposed rewrite takes this approach.

### EOA default code uses raw ecrecover

The sig hash is computed the same way for both account types, but EOA default code calls raw `ecrecover(sigHash, v, r, s)` with no prefix (plus high-s rejection and zero-address check). Smart accounts typically verify via `signMessage` (EIP-191) or `signTypedData` (EIP-712).

This is the right choice for domain separation (EOA frame transaction signatures shouldn't be confusable with EIP-191 message signatures). But it means wallets need to learn about type 0x06 transactions, the same way they learned EIP-1559 and EIP-4844. Until then, tooling has to work around it. Our SDK exports a standalone `signEoaVerifyFrame(tx, privateKey)` because viem's `Account` interface doesn't expose prefix-free signing on non-local account types.

Once wallets support `signTransaction` for type 0x06, this stops being a special case. The wallet computes the sig hash, signs the raw digest, returns `{ v, r, s }`, same as every other transaction type.

### Approval scope bits aren't worth the complexity

The `flags` field carries approval scope (bits 0-1) and an atomic batch flag (bit 2). The scope bits constrain what APPROVE can do: PAYMENT (0x1), EXECUTION (0x2), or both (0x3). In practice, scope is always determined by caller identity: the sender approves execution, a non-sender approves payment. The scope bits formalize cases that don't come up in real usage.

APPROVE_SCOPE_NONE (0x0) is the zero default, which the spec mitigates with a static constraint requiring VERIFY frames to have a non-zero scope. The spec also documents `allowed_scope` as "caller-supplied policy input" that verification logic SHOULD authenticate — acknowledging the trust issue without eliminating the complexity.

Our rewrite removes scope bits entirely. APPROVE's behavior is determined by whether the caller is the sender or not.

### APPROVE is not restricted to VERIFY frames

VERIFY mode is described as "STATICCALL for user code" with APPROVE as the sole exception, which clarifies intent. But the APPROVE opcode itself doesn't check the frame's mode — it checks `ADDRESS == resolved_target`, not `mode == VERIFY`. A SENDER or DEFAULT frame targeting the right address could still invoke APPROVE. Code reached via DELEGATECALL from the resolved target can also execute APPROVE, since DELEGATECALL preserves ADDRESS.

The VERIFY/execution separation is a convention, not something the protocol enforces. You can't statically determine the approval flow without tracing every frame's execution.

Our rewrite restricts APPROVE to VERIFY frames at the opcode level.

### Atomic batch flags are fragile

The per-frame atomic batch flag (bit 2 of `flags`) means "I'm atomic with the next frame", which is a forward reference that's easy to get wrong. Builders must set the flag on all-but-last (off-by-one trap), validation must check the next frame exists and is SENDER mode, and only contiguous sequences are supported.

Group IDs are a label rather than a forward reference. Simpler to construct, simpler to validate.

### P256 in default code enshrines a specific curve

The spec includes P256 as a second signature type (`0x01`) in EOA default code alongside ECDSA. The motivation is passkey/secure enclave support (WebAuthn, Apple/Android hardware), and P256VERIFY is already available as a precompile via RIP-7212.

But enshrining P256 in default code is a stronger commitment than making a precompile available. It means the protocol is picking this one curve as a built-in EOA signing scheme. Every additional curve (Ed25519, BLS, post-quantum) would require another hard fork to extend default code's `signature_type` switch.

There's also a practical problem: both signature types verify directly against the account address (`ecrecover → address` for ECDSA, `keccak(0x01|qx|qy)[12:] → address` for P256). The domain prefix prevents address collisions between the two schemes, but an existing EOA still can never use P256 because its address is derived from a secp256k1 key. There's no key rotation or migration path built into default code.

Our rewrite keeps only ECDSA in default code (the one scheme existing EOAs actually use) and reserves `signature_type` `0x01`–`0xff` for companion EIPs to define delegation, P256, post-quantum schemes, or other signing approaches.

### Revert behavior for non-VERIFY frames isn't explicit

The spec says a reverted frame's "state changes are discarded" but doesn't say whether execution continues to the next frame. Reading the spec closely, continuation is implied (the receipt has per-frame status, `FRAMEPARAM 0x05` returns status of prior frames, and the execution loop has no break condition on revert). But it should be stated directly.

This is somewhat counterintuitive — in most contexts a revert halts everything. Here, the default is continuation and you opt into coupled failure via atomic batches. An independent frame reverting is more like a try/catch that swallows the error. This matters for paymaster post-op frames that need to run regardless of whether the user's call succeeded.

Our rewrite makes this explicit: a reverted EXECUTE frame never halts the transaction, execution always proceeds. Only a VERIFY frame failing to call APPROVE makes the transaction invalid.

### Default code doesn't cover empty EIP-7702 delegations

Default code applies to accounts "that have neither code nor an EIP-7702 delegation indicator." Accounts with a 7702 delegation follow EIP-7702's delegated-code semantics regardless of whether the delegation target has code.

This means an account delegated to an empty target is stuck: the delegation indicator means "has code" so default code doesn't run, but 7702 delegation semantics resolve to empty code so there's nothing to execute. The account can't validate frame transactions. The only recovery path is clearing the delegation with a legacy transaction.

Default code should also apply when the account has a 7702 delegation whose target has empty code. Our rewrite makes this explicit.

## Minor notes

- `maxFeePerBlobGas` and `blobVersionedHashes` are always present even when not using blobs. Minor wire overhead but keeps the format fixed-width — probably the right tradeoff.
