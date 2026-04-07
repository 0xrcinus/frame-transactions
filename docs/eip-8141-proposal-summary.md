# Proposed Changes to EIP-8141

Summary of changes in [eip-8141-proposed.md](./eip-8141-proposed.md), based on building an SDK and testing against the live ethrex testnet. See [spec-feedback.md](./spec-feedback.md) for the implementation observations behind each change.

## Changes

### 1. Add `value` to the frame structure

`[mode, target, gas_limit, data]` → `[mode, target, value, gas_limit, data]`

Makes ETH transfers a first-class frame operation. Unifies EOA and smart account behavior — EOAs no longer need RLP-encoded subcalls to express value, and smart accounts don't need custom `execute(target, value, data)` methods.

### 2. Two frame modes instead of three

DEFAULT (0), VERIFY (1), SENDER (2) → VERIFY (0), EXECUTE (1)

The caller is inferred from approval state: EXECUTE before sender approval uses ENTRY_POINT (deploy context), EXECUTE after uses tx.sender. No use case requires a third mode.

### 3. Restrict APPROVE to VERIFY frames

APPROVE reverts if called from an EXECUTE frame. Makes the validation/execution separation a protocol invariant, not a convention.

### 4. Remove approval scope bits — use caller identity

APPROVE takes no scope operand. Sender calling APPROVE approves execution and sets payer. Non-sender calling APPROVE sets payer only — subsequent non-sender APPROVEs overwrite the payer, so the last VERIFY frame determines who pays. Nonce increment and gas deduction happen after the last VERIFY frame completes. Eliminates the scope enum, bit packing, ordering validation, and the ANY=0 footgun.

### 5. Group IDs instead of atomic batch flags

The batch flag (a forward reference to the next frame) is replaced by a group ID in bits 8-15 of the mode field. Contiguous EXECUTE frames with the same non-zero group ID are atomic. Group 0 means independent. Simpler to construct and validate.

### 6. Wallet signing note

EOA default code correctly uses raw `ecrecover` (no EIP-191 prefix) for domain separation. Wallets will need to support `signTransaction` for type 0x06, same as they did for EIP-1559 and EIP-4844.

## Combined mode field

```
# Before: 3 concerns, complex interactions
bits 0-7:  execution mode (DEFAULT=0, VERIFY=1, SENDER=2)
bits 8-9:  approval scope (ANY=0, EXECUTION=1, PAYMENT=2, BOTH=3)
bit 10:    atomic batch flag

# After: 2 concerns, orthogonal
bit 0:     mode (VERIFY=0, EXECUTE=1)
bits 1-7:  reserved
bits 8-15: group ID (0 = independent)
```
