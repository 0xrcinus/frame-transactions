# Proposed Improvements to EIP-8141

Based on building an SDK, demo apps, and testing against the live ethrex testnet. These are concrete proposals backed by implementation experience, not theoretical concerns.

See FEEDBACK.md for the full analysis behind each proposal.

---

## 1. Add `value` to the frame structure

**Current frame:** `[mode, target, gas_limit, data]`

**Proposed frame:** `[mode, target, value, gas_limit, data]`

### Why

Every other Ethereum transaction type has a value field. Frames are the unit of execution in 8141, and omitting value makes ETH transfers a second-class operation that requires workarounds on both sides:

- **Smart accounts** must implement their own `execute(target, value, data)` method in contract code just to forward ETH to payable functions. The whole point of frames is to enshrine execution semantics at the protocol level, but omitting value pushes the most basic one back into account contracts.
- **EOAs** have to pack value inside RLP-encoded subcalls in the data field (`[[target, value, data], ...]`), which means SENDER frame data has completely different semantics depending on account type.

Adding value to the frame structure eliminates both problems. For smart accounts, the protocol handles value forwarding (no custom execute method needed). For EOAs, the data field can mean the same thing as for smart accounts, which eliminates the semantic overloading and simplifies tooling, indexers, and block explorers.

### Wire format change

```
# Current
frame = [mode, target, gas_limit, data]

# Proposed
frame = [mode, target, value, gas_limit, data]
```

Default `value = 0` (empty bytes in RLP) for non-value-bearing frames. No additional gas cost for existing use cases.

---

## 2. Reduce to two frame modes: VERIFY and EXECUTE

**Current:** DEFAULT (0), VERIFY (1), SENDER (2). Three modes.

**Proposed:** VERIFY (0) and EXECUTE (1). Two modes.

### Why

DEFAULT and SENDER both mean "execute code." The only difference is the caller: DEFAULT uses ENTRY_POINT, SENDER uses the transaction sender. But this distinction can be inferred from whether the sender has been approved yet:

- EXECUTE frame **before** sender approval: caller is ENTRY_POINT (deploy, setup)
- EXECUTE frame **after** sender approval: caller is tx.sender (the actual calls)

This is how builders already think about it. Our SDK constructs DEFAULT frames for deploys (before VERIFY) and SENDER frames for calls (after VERIFY). The mode value is redundant with the position in the frame sequence.

Two modes reduces it to one question: "are you validating or executing?" No use case we've encountered needs ENTRY_POINT-caller frames after sender approval. If one exists, it should be documented to justify the third mode.

### Impact

The mode field's lower bits go from 3 values to 2. Frame construction becomes simpler: builders don't need to choose between DEFAULT and SENDER, they just use EXECUTE and the protocol determines the caller from context.

---

## 3. Restrict APPROVE to VERIFY frames

**Current:** APPROVE is callable from any frame mode (VERIFY, SENDER, or DEFAULT).

**Proposed:** APPROVE is only callable from VERIFY frames. Revert if called from EXECUTE.

### Why

The entire VERIFY/EXECUTE separation exists to distinguish validation from execution. If APPROVE is callable everywhere, that separation is a convention, not an invariant. A SENDER frame can approve execution as a side effect. A DEFAULT frame can approve during deployment. Approval state can be mutated at any point in the frame sequence.

This has real consequences for tooling:
- Block explorers can't determine which frame approved what by looking at the transaction layout. They have to trace execution of every frame.
- Static analysis of approval flow is impossible.
- The scope bits on VERIFY frames only constrain APPROVE in that frame, but other frames can approve without any constraint.

Restricting APPROVE to VERIFY frames at the opcode level makes the validation/execution boundary a protocol guarantee, not a suggestion. VERIFY frames validate, EXECUTE frames execute.

This also makes APPROVE analogous to a return statement for validation: "I verified successfully, here's what I'm approving." VERIFY frames become STATICCALL-like: they check conditions and approve, but can't modify execution state.

---

## 4. Remove approval scope bits — use caller identity instead

**Current:** APPROVE takes a scope operand (1=execution, 2=payment, 3=both), constrained by 2 bits in the mode field. Ordering rules: payment scope requires sender already approved.

**Proposed:** APPROVE takes no operand. The caller's identity determines the semantics:
- If `msg.sender == tx.sender` calls APPROVE: approves execution and sets payer to sender
- If `msg.sender != tx.sender` calls APPROVE: approves payment only (updates payer)
- Subsequent APPROVEs overwrite the payer until the last VERIFY frame
- Nonce increment and gas deduction happen after the last VERIFY frame

### Why

In practice, you only ever see two patterns:
1. **Self-pay:** sender approves both execution and payment (one VERIFY frame)
2. **Sponsored:** sender approves execution, paymaster approves payment (two VERIFY frames)

The scope bits add machinery to handle combinations that don't arise in real usage. Our SDK has an `ApprovalScope` enum (4 values), bit packing/unpacking helpers, scope validation, and builder branching for self-pay vs sponsored, all to express what the caller's identity already tells you.

Additional problems with scope bits:
- `ANY (0)` is the most permissive scope, which is also the default if you forget to set the bits. Zero being maximally permissive is counterintuitive and a footgun.
- 2 bits, 4 values, all used. No room for extension.
- Ordering constraints (payment requires sender already approved) are enforced at runtime, not statically. A transaction with payment-before-execution is structurally valid but always reverts.

With identity-based semantics, all of this goes away. The mode field loses 2 bits of complexity. Builders don't need to choose scopes. Validation doesn't need to check ordering. The right thing happens automatically.

---

## 5. Replace atomic batch flags with group IDs

**Current:** Bit 10 of the mode field is an "atomic batch" flag that chains the current frame to the next frame. Both must be SENDER mode. The flag means "if the next frame reverts, I revert too."

**Proposed:** Each EXECUTE frame carries a group ID (small integer). All frames in the same group are atomic: they execute or revert together. VERIFY frames are not part of groups.

### Why

The current batch flag has several problems:
- It's a forward reference ("I'm atomic with the *next* frame"), which is an off-by-one trap for builders
- Validation must check: does the next frame exist? Is it SENDER mode?
- Only supports contiguous sequences. You can't have group A, group B, then more of group A.
- Builders have to set the flag on all-but-last in a batch, which is error-prone

Group IDs are simpler and more expressive:

```
# ERC20 paymaster example (three atomic groups)
transfer DAI to paymaster  | group 0
approve DAI for Uniswap    | group 1
swap DAI on Uniswap        | group 1
refund remaining DAI       | group 2
```

With batch flags, this requires careful flag placement on specific frames. With groups, you just label each frame. Validation is simpler (just check group IDs are valid). Non-contiguous atomicity is possible.

### Mode field encoding

Group IDs can go in the upper bits of the mode field where scope bits currently live (freed up by proposal #4):

```
# Current mode field
bits 0-7:  execution mode (3 values)
bits 8-9:  approval scope (4 values)
bit 10:    atomic batch flag

# Proposed mode field
bit 0:     execution mode (VERIFY=0, EXECUTE=1)
bits 1-7:  reserved (must be zero)
bits 8-15: group ID (0-255, where 0 = default/solo group)
```

This gives up to 255 distinct atomic groups per transaction, which is more than enough.

---

## 6. Clarify EOA default code as a distinct section

Not a protocol change, but a spec structure improvement.

### Why

EOA default code defines completely different data semantics for the same frame structure:

| | Smart Account | EOA Default Code |
|---|---|---|
| VERIFY data | Contract-defined | `0x00 + v + r + s` (ECDSA) or `0x01 + r + s + qx + qy` (P256) |
| EXECUTE data | Calldata for target | RLP subcalls (if value proposal is rejected) |
| EXECUTE target | Call target | `null` (triggers default code) |
| Signing | EIP-191 / EIP-712 / custom | Raw `ecrecover` (no prefix) |

Implementers currently have to discover this divergence by reading the default code pseudocode. The spec should have a dedicated "Default Code Behavior" section that clearly describes both the VERIFY and EXECUTE paths for EOAs, separate from the smart account flow.

If proposal #1 (frame value field) is accepted, EOA EXECUTE frames become much simpler: `target` is the call target, `value` is the ETH amount, `data` is calldata, same as smart accounts. The only remaining EOA-specific behavior is the VERIFY frame signature format.

---

## 7. Raw ecrecover is correct — tooling needs `signTransaction` for type 0x06

This is not a spec change proposal, but a note for the ecosystem.

EOA default code uses raw `ecrecover(sigHash, v, r, s)` without an EIP-191 prefix. This is correct for domain separation (frame transaction signatures shouldn't be confusable with message signatures).

However, viem only exposes `signMessage` (which adds EIP-191 prefix) on its general `Account` interface. Raw signing is only available on `LocalAccount` types. This means wallet integrations can't sign EOA frame transactions through the standard account abstraction.

The fix is for viem to add type 0x06 support to `signTransaction`, which already handles EIP-1559 and EIP-4844 transaction signing with the correct hashing scheme and raw ECDSA. This is the natural home for frame transaction signing. Until then, our SDK provides `signEoaVerifyFrame(tx, privateKey)` as a stopgap for local accounts, and detects local accounts at runtime in the viem decorator to use `account.sign()` directly.

---

## Summary of changes

| # | Change | Type | Complexity |
|---|--------|------|------------|
| 1 | Add `value` to frame structure | Wire format | Low — one new RLP field |
| 2 | Two modes (VERIFY + EXECUTE) | Protocol | Medium — remove DEFAULT, infer caller from context |
| 3 | Restrict APPROVE to VERIFY | Opcode | Low — one check in APPROVE handler |
| 4 | Remove scope bits | Protocol + opcode | Medium — remove scope from APPROVE, use identity |
| 5 | Group IDs instead of batch flags | Wire format + protocol | Medium — new semantics, simpler validation |
| 6 | Separate EOA default code section | Spec text | None — documentation only |
| 7 | viem `signTransaction` for 0x06 | Ecosystem | None — upstream tooling |

Proposals 1-5 are mutually compatible and can be adopted independently, though 2+3+4 together give the largest simplification (they collectively eliminate the scope mechanism and clean up the mode field). Proposal 1 has the best impact-to-complexity ratio: it unifies EOA and smart account behavior for the most common operation (ETH transfers) with minimal wire format change.

### Combined mode field (proposals 2+4+5)

```
# Before: 3 concerns, complex interactions
bits 0-7:  execution mode (DEFAULT=0, VERIFY=1, SENDER=2)
bits 8-9:  approval scope (ANY=0, EXECUTION=1, PAYMENT=2, BOTH=3)
bit 10:    atomic batch flag

# After: 2 concerns, orthogonal
bit 0:     mode (VERIFY=0, EXECUTE=1)
bits 1-7:  reserved
bits 8-15: group ID (0 = default)
```

Extensible, no cross-concern interactions.
