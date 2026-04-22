# Proposed Changes to EIP-8141

Summary of changes in [eip-8141-proposed.md](./eip-8141-proposed.md), based on building an SDK and testing against the live ethrex testnet. See [spec-feedback.md](./spec-feedback.md) for the implementation observations behind each change.

Measured against the current upstream EIP-8141, which now includes a frame-level `value` field. Item #1 below reflects that overlap.

## Changes

### 1. Drop `flags`; align with upstream's `value` field

Upstream has adopted a frame-level `value` field, resolving most of the EOA/smart-account divergence we originally flagged. This proposal keeps upstream's `value` placement and removes `flags` — its scope and batching roles are handled differently below:

`[mode, flags, target, gas_limit, value, data]` (upstream) → `[mode, target, gas_limit, value, data]`

Both account types use the same `(target, value, data)` semantics for EXECUTE frames, without RLP subcall wrappers or custom `execute()` methods.

### 2. Two frame modes instead of three

DEFAULT (0), VERIFY (1), SENDER (2) → VERIFY (0), EXECUTE (1)

The caller of an EXECUTE frame is derived from approval state — ENTRY_POINT before sender approval (deploy context), tx.sender after.

The principle-of-least-privilege case for keeping a third mode is that post-op and assertion frames (e.g., EIP-7906) don't need sender authority, so they shouldn't run with `msg.sender = tx.sender`. But the signature hash covers each frame's `mode` and `target` (only VERIFY `data` is elided), so the user signing `target = X, mode = EXECUTE` is already the explicit authority decision: X is being called with the sender as `msg.sender`, and the user has signed off on that.

The sender-authority exposure is also naturally confined by standard call semantics to the first level of the call — any onward calls X makes go out with X as `msg.sender`, not tx.sender. For a post-op whose target is a paymaster contract, only the paymaster's entry function sees tx.sender, and the paymaster is trusted by design. Paymasters distinguish protocol-level post-op calls from user calls via function selector rather than caller identity. Mempool subclassifications (`self_verify`, `only_verify`, `pay`, `user_op`, `post_op`) carry the legibility that upstream achieves through a third mode.

### 3. Restrict APPROVE to VERIFY frames

APPROVE reverts if called from an EXECUTE frame. Upstream describes VERIFY as "STATICCALL for user code" with APPROVE as the sole exception, but the opcode itself only checks `ADDRESS == resolved_target`, not the frame's mode. Our rewrite enforces the validation/execution separation at the opcode level rather than relying on convention.

Beyond cleanliness, this lets a mempool determine the validation prefix structurally without simulating EXECUTE frames. Once the last VERIFY frame has completed, no later frame can mutate approval state — so the validation prefix is a well-defined static property of the frame list. If APPROVE could fire from any mode, nodes would have to simulate every frame to be sure no late approval happens, and "validation prefix" loses meaning.

### 4. Remove approval scope bits — use caller identity

APPROVE takes no scope operand. Sender calling APPROVE approves execution and sets payer. Non-sender calling APPROVE sets payer only; subsequent non-sender APPROVEs overwrite the payer, so the last VERIFY frame determines who pays. Nonce increment and gas deduction happen after the last VERIFY frame completes. The scope constants (`APPROVE_PAYMENT`, `APPROVE_EXECUTION`, `APPROVE_PAYMENT_AND_EXECUTION`), allowed_scope validation, and the `APPROVE_SCOPE_NONE = 0` footgun all go away.

A sender is never left on the hook for gas in a sponsored flow that fails. If the sponsor's VERIFY frame exits without calling APPROVE, the whole transaction is invalid per the upstream rule that every VERIFY frame must APPROVE — so no gas is collected from anyone. Because gas collection is deferred to after the last VERIFY frame, the interim state where `payer = tx.sender` is never externally observed. And because the sig hash covers each VERIFY frame's `target` (only `data` is elided), a relayer can't strip or swap the sponsor's VERIFY frame to redirect payment back to the sender.

### 5. Group IDs instead of atomic batch flags

The batch flag (bit 2 of `flags`, a forward reference to the next frame) is replaced by a group ID in bits 8-15 of the mode field. Contiguous EXECUTE frames with the same group ID are atomic. A frame whose group ID does not match either adjacent EXECUTE frame is a single-frame group and executes independently.

This is primarily a construction-ergonomics win rather than a new capability. The concrete multi-group case is a sponsored flow where the send-to-sponsor frame, user operation, and post-op each need to succeed or fail independently: three independent frames in a row. Under atomic batch flags, this is expressible (clear the flag on each) but fragile — any forward-referencing bug is silent, and the spec has to enforce "atomic flag only valid if next frame is also SENDER". Under group IDs, each frame just carries a distinct label and the invariant becomes "frames with the same group ID must be adjacent" — a local property, not a look-ahead.

Group ID `0` is not special — it is a label like any other. A sequence of EXECUTE frames that all carry the default group ID `0` is a single atomic group; users who want independent frames opt in by assigning distinct group IDs. This makes atomicity the safer default: a caller who serializes multiple EXECUTE frames without thinking about grouping gets all-or-nothing behavior rather than silently-independent frames.

### 6. Explicit continuation after revert

The spec says a reverted frame's "state changes are discarded" but doesn't explicitly state that execution continues to the next frame. Our rewrite makes it explicit: a reverted independent frame has its state discarded and execution moves to the next frame. A reverted atomic group has the whole group reverted and execution continues after the group. Only a VERIFY frame failing to APPROVE halts the transaction.

### 7. ECDSA-only default code

Remove P256 as a built-in signature type. Default code handles only ECDSA (with high-s rejection and zero-address check) — the one scheme existing EOAs need. Signature types `0x01`–`0xff` are reserved for companion EIPs to define additional schemes (delegation, P256, post-quantum, etc.) without changes to this spec.

### 8. Default code applies to empty 7702 delegations

The spec explicitly excludes 7702-delegated accounts from default code, even when the delegation target has no code. This leaves those accounts stuck. Our rewrite applies default code when the account has a 7702 delegation whose target has empty code, giving them a path to validate frame transactions.

### 9. Wallet signing note

EOA default code correctly uses raw `ecrecover` (no EIP-191 prefix) for domain separation. The signature hash is computed as `keccak(bytes([0x06]) + rlp(tx_copy))` (matching upstream), so the transaction type byte is mixed into the digest. Wallets that add `signTransaction` support for type 0x06 can sign the raw digest directly, the same way they already sign EIP-1559 and EIP-4844 digests — no EIP-191 prefix, no typed-data wrapper.

### 10. Expose `finalizes_payer` via FRAMEPARAM

`FRAMEPARAM(0x07, frameIndex)` returns `1` if the frame is the last `VERIFY` frame in the transaction, else `0`. Because `payer` is determined by the last VERIFY frame, a paymaster that calls APPROVE without checking its position can be silently overwritten by a tail-appended VERIFY frame. Guarding `APPROVE` with `FRAMEPARAM(0x07, TXPARAM(0x0A)) == 1` lets a paymaster refuse to sponsor any transaction where another VERIFY frame could still replace the payer.

## Frame structure comparison

```
# Current spec (upstream)
mode:      uint8 (DEFAULT=0, VERIFY=1, SENDER=2)
flags:     uint8
  bits 0-1:  approval scope (NONE=0, PAYMENT=1, EXECUTION=2, BOTH=3)
  bit 2:     atomic batch flag
  bits 3-7:  reserved
target:    address or null
gas_limit: uint64
value:     uint256
data:      bytes

# Our proposal
mode:      uint16
  bit 0:     frame type (VERIFY=0, EXECUTE=1)
  bits 1-7:  reserved
  bits 8-15: group ID (same ID = atomic group)
target:    address or null
gas_limit: uint64
value:     uint256
data:      bytes
```
