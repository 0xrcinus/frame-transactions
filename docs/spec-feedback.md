# EIP-8141 Spec Feedback — From Implementation

Notes on the spec based on building an SDK + demo against the live ethrex testnet.

## What works well

### Sig hash elision is clean
VERIFY frame data gets zeroed before hashing, so both sender and paymaster compute the same sig hash regardless of signing order. No coordination needed. Easy to implement and easy to reason about.

### Validation prefix is composable
The VERIFY + SENDER frame pattern is flexible. Self-pay (1 VERIFY), sponsored (2 VERIFY), deploy (DEFAULT + VERIFY) all compose naturally. Adding a paymaster is just prepending another VERIFY frame with a different approval scope. The approval scope bits (execution, payment, both) are a nice mechanism.

### Typed transaction envelope
`0x06 || rlp(...)` follows EIP-2718 cleanly. Serialize once, use everywhere (sig hash, tx hash, RPC submission).

## Where the spec creates friction

### 1. EOA default code is a parallel spec hiding inside the main spec

This is the biggest issue. The spec defines frame modes (VERIFY, SENDER, DEFAULT) generically, but EOA "default code" gives them completely different data semantics:

| | Smart Account | EOA Default Code |
|---|---|---|
| VERIFY data | Whatever the contract expects | `0x00 + v + r + s` (66 bytes, raw ECDSA) |
| SENDER target | Call target address | `null` (sender — triggers default code) |
| SENDER data | Calldata for target | `RLP([[target, value, data], ...])` |
| Signing | `signMessage` / EIP-712 / custom | Raw `ecrecover` (no prefix) |

The encoding, signing, and target semantics are different enough that these are really two protocols sharing a frame structure. Anyone building tooling has to support both paths, but the spec doesn't separate them clearly. It reads like one transaction format when it's actually two.

**Suggestion:** The spec should explicitly name these as two sub-protocols (or at minimum, have a dedicated "Default Code Behavior" section that's clearly separated from the smart account flow). Implementers shouldn't have to discover the EOA/SA split by reading the default code pseudocode.

### 2. No `value` field in the frame structure

Frames have `[mode, target, gas_limit, data]`, four fields. There's no `value` field.

This matters for both account types:
- **EOAs** have to smuggle value inside RLP-encoded sender data (`[[target, value, data], ...]`). A simple "send 1 ETH to Alice" can't be expressed at the frame level.
- **Smart accounts** calling payable functions (WETH deposits, NFT mints with price, liquidity provision) need to forward ETH. Without a frame-level value, every smart account contract must implement its own `execute(target, value, data)` method to handle value forwarding. That's execution logic that should live at the protocol level, not duplicated across every smart account implementation. Frames are supposed to move execution semantics out of account contracts and into the transaction format, but omitting value forces the most basic execution semantic (sending ETH) right back into account code.

Every other Ethereum transaction type has a value field (legacy, EIP-1559, EIP-4844). Frames are the unit of execution in 8141, analogous to a transaction's call. Omitting value makes the most basic Ethereum operation (sending ETH) require account-type-specific workarounds.

This is also the root cause of issue #3 below (SENDER data overloading). If frames had a value field, EOA SENDER frames wouldn't need to pack `[[target, value, data]]` into the data field. Value would be at the frame level where it belongs, and data would mean the same thing for both account types.

**Suggestion:** Add a `value` field to the frame structure: `[mode, target, value, gas_limit, data]`. This makes ETH transfers explicit at the wire format level, unifies behavior across account types, and removes the need for EOA default code to define its own subcall encoding just to express value.

### 3. SENDER frame data is semantically overloaded

For smart accounts: `frame.data` is calldata passed to `frame.target`.
For EOAs: `frame.data` is an RLP-encoded list of subcalls, and `frame.target` is null.

Same field, different meanings. You can't look at a serialized frame transaction and know what the SENDER frame data means without knowing the account type. This makes debugging, indexing, and block explorers harder because they need to resolve the account type before they can decode SENDER frames.

### 4. Batch semantics are underspecified for EOAs

Two valid patterns for "send ETH to Alice and Bob":

**Pattern A: One SENDER frame, multiple subcalls in RLP**
```
VERIFY + SENDER(data=RLP([[alice, 1eth, 0x], [bob, 2eth, 0x]]))
```

**Pattern B: Multiple SENDER frames, one subcall each**
```
VERIFY + SENDER(data=RLP([[alice, 1eth, 0x]])) + SENDER(data=RLP([[bob, 2eth, 0x]]))
```

Pattern B is needed for atomic batch flags (per-frame granularity). Pattern A is more gas-efficient. The spec doesn't say which is preferred or when to use which. For smart accounts this isn't a problem (one call = one frame, always), but for EOAs the subcall-list-in-data creates ambiguity.

### 5. EOA default code chose raw ecrecover, which breaks the standard signing abstraction

The sig hash is computed the same way for both account types, which is good. But the *signing method* diverges with practical consequences for tooling:

- **Smart accounts** verify signatures however their contract wants, typically EIP-191 (`"\x19Ethereum Signed Message:\n32" + hash`) or EIP-712. Wallets produce these via `signMessage` or `signTypedData`, which are standard operations on every wallet/account abstraction.
- **EOA default code** calls raw `ecrecover(sigHash, v, r, s)` with no prefix. The signer must sign the bare hash.

This matters because the dominant wallet library (viem) doesn't expose prefix-free signing on its general `Account` interface. `account.signMessage()` always applies the EIP-191 prefix. Raw ECDSA signing (`sign({ hash })`) is only available on `LocalAccount` types (`privateKeyToAccount`, `mnemonicToAccount`), not on JSON-RPC accounts, WalletConnect accounts, or the abstract `Account` interface that viem clients use.

This means a viem client decorator like `client.sendFrameTransaction()` can sign for smart accounts (via `signMessage`) but **cannot sign for EOAs** without breaking the abstraction. Our SDK works around this by exporting `signEoaVerifyFrame(tx, privateKey)` as a standalone function, but this requires the raw private key, which defeats the purpose of the account abstraction.

The root cause is the choice of raw ecrecover in EOA default code. If default code instead expected EIP-191-prefixed signatures (i.e., `ecrecover(keccak256("\x19Ethereum Signed Message:\n32" + sigHash), v, r, s)`), then `signMessage({ message: { raw: sigHash } })` would produce valid signatures for both EOAs and smart accounts. Tooling wouldn't need to branch on account type.

This is a practical problem, not a theoretical one. It's the reason our demo can't use the viem decorator for EOAs, and the blocker for reducing the demo from ~80 lines to ~20. Any wallet integrating EIP-8141 will hit the same issue: the signing path forks based on account type, and the EOA path requires capabilities that most account abstractions don't expose.

**The fix is probably upstream in viem, not in the spec.** Raw ecrecover is the right choice for domain separation; EOA frame transaction signatures shouldn't be confusable with EIP-191 message signatures. The issue is that viem's `Account` interface has `signMessage` (EIP-191) and `signTransaction` (for EIP-1559, EIP-4844, etc.) but doesn't know about type 0x06 yet. The natural fix is extending `signTransaction` to handle frame transactions: compute the sig hash with VERIFY elision, sign the raw digest, return `{ v, r, s }`. That's how every other transaction type works in viem. `signTransaction` knows the hashing scheme; the account doesn't use `signMessage` for it. Once viem supports type 0x06 in `signTransaction`, the decorator just works and EOA signing stops being a special case.

### 6. VERIFY approval scope bits — compact but subtle

The mode field packs three concerns into one integer:
- Bits 0-7: execution mode (DEFAULT=0, VERIFY=1, SENDER=2)
- Bits 8-9: approval scope (ANY=0, EXECUTION=1, PAYMENT=2, BOTH=3)
- Bit 10: atomic batch flag

This is compact but creates some design tension:

**APPROVE is not restricted to VERIFY frames.** This was the most surprising finding. The spec does not restrict the APPROVE opcode to VERIFY mode; it's callable from SENDER and DEFAULT frames too. This means the VERIFY/SENDER separation is a convention, not an invariant. A SENDER frame can call APPROVE as a side effect of execution. A DEFAULT frame can approve during deployment. Approval state can be mutated at any point in the frame sequence.

This has several consequences:

- The scope bits on VERIFY frames only constrain APPROVE in that frame. A SENDER frame calling APPROVE has no scope constraint from the mode field (or does it? the spec is unclear). If SENDER frames can approve without scope bits, the scoping mechanism has a hole.
- "Validation happens first, then execution" is a convention that builders follow, not something the protocol enforces. A transaction could put SENDER frames before VERIFY frames and have the SENDER frame call APPROVE.
- Static analysis of approval flow (which frame approved what?) requires tracing all frame execution, not just VERIFY frames. Block explorers and indexers can't determine approval structure from the transaction layout alone.

If the intent is that APPROVE is a general-purpose opcode any frame can use, the spec should say so clearly and explain why scope bits only appear on VERIFY mode. If the intent is that validation is separate from execution, APPROVE should be restricted to VERIFY frames at the EVM level.

**Scope bits only matter for VERIFY, atomic batch only matters for SENDER.** They share a mode field but apply to different frame types. The spec doesn't enforce this: you can set scope bits on a SENDER frame or an atomic batch flag on a VERIFY frame. Our validation rejects atomic-on-VERIFY but silently ignores scope-on-SENDER. The spec should say whether non-applicable bits must be zero or are just ignored. Given that APPROVE isn't restricted to VERIFY, it's unclear whether scope bits on a SENDER frame would constrain an APPROVE call from that frame.

**ANY (0) means "unrestricted", not "none".** The zero value being the most permissive option is counterintuitive. Most permission systems default to least-privilege, where zero means no access. Here, `scope=0` means APPROVE can set any combination of flags. A VERIFY frame with scope ANY can approve execution, payment, or both. In practice nobody should use ANY in production, but it's the default if you forget to set the bits. Combined with APPROVE being callable from non-VERIFY frames (where scope bits may not apply), this further weakens the scoping mechanism.

**The scope constrains APPROVE, not the outcome.** The scope bits cap what the APPROVE opcode is allowed to do, but they don't guarantee APPROVE is called at all. A VERIFY frame can run code and return without calling APPROVE; it just consumes gas and does nothing useful. The spec relies on the builder to construct sensible frame sequences. Static validation can check that scope bits are set, but can't verify that the code will actually approve.

**Ordering is load-bearing but only enforced at runtime.** `APPROVE(0x2)` (payment) requires that `sender_approved` is already true, so a PAYMENT VERIFY frame must come after an EXECUTION or BOTH VERIFY frame. This ordering constraint isn't enforced at the transaction level; it's a runtime check. A transaction with PAYMENT before EXECUTION is structurally valid but will always revert. The spec could define a static ordering rule: scope 0x1 or 0x3 must precede scope 0x2.

**No room for extension.** 2 bits, 4 values, all used. If a future use case needs a third approval dimension (e.g., storage access, cross-chain relay), the scope field has to grow. Not a problem today, but the tight packing means the mode field layout would need to change.

**The scope bitmask works well.** EXECUTION=1, PAYMENT=2, BOTH=3. That's `BOTH = EXECUTION | PAYMENT` as a bitmask. The runtime can check `(approved_flags & required_scope) == required_scope`. Simple, no branching. This is good.

**Suggestion:** Either restrict APPROVE to VERIFY frames at the opcode level (making the validation/execution separation an invariant), or document that any frame can approve and explain the interaction with scope bits. Also define a static validation rule that VERIFY frames with scope PAYMENT (0x2) must be preceded by a VERIFY frame with scope EXECUTION (0x1) or BOTH (0x3). Clarify whether non-applicable mode bits (scope on SENDER, atomic batch on VERIFY) must be zero.

## Simplification proposals

The issues above (especially #6) point toward a simpler design. As [proposed on Ethereum Magicians](https://ethereum-magicians.org/t/eip-8141-frame-transaction/27617/104), three simplifications would address most of the friction we hit.

### Two modes, not three

**Current:** DEFAULT (0), VERIFY (1), SENDER (2). Three modes where DEFAULT and SENDER are both "execute code" but with different callers (ENTRY_POINT vs sender).

**Proposed:** VERIFY and EXECUTE only. An EXECUTE frame before the sender is approved has ENTRY_POINT as caller (current DEFAULT behavior). An EXECUTE frame after approval has sender as caller (current SENDER behavior). The caller is inferred from position relative to approval, not from a mode value.

**How this would have helped us:** Our SDK's `buildFrameTransaction` has to construct DEFAULT frames for deploys, VERIFY frames for signatures, and SENDER frames for calls. That's three different frame creation paths. With two modes, deploy frames and call frames are both EXECUTE; the only question is whether they come before or after VERIFY. The builder gets simpler and the mode enum is cleaner: "are you validating or executing?"

We don't see a use case for ENTRY_POINT-caller frames *after* sender approval. If one exists, the spec should document it. Otherwise, two modes is strictly better.

### APPROVE doesn't need scope bits

**Current:** APPROVE takes a scope operand (EXECUTION=1, PAYMENT=2, BOTH=3), constrained by 2 bits in the mode field. Ordering rules: PAYMENT requires sender already approved. Four enum values, complex interactions, and no room for extension.

**Proposed:** APPROVE has no scope operand. Instead:
- If the sender calls APPROVE → approves execution and sets payer to sender
- If a non-sender contract calls APPROVE → can only approve payment (updates payer)
- Subsequent APPROVEs overwrite the payer until the last VERIFY frame
- Nonce increment and gas deduction happen after the last VERIFY frame
- APPROVE is restricted to VERIFY frames (acts like a return statement for validation)

**How this would have helped us:** Our SDK has `ApprovalScope` with 4 values, `buildMode()` packing scope bits into the mode field, `getApprovalScope()` extracting them, validation that scope ordering is correct, and builder logic that assigns scope BOTH for self-pay, scope EXECUTION for sender in sponsored flow, and scope PAYMENT for paymaster. All of that goes away.

The identity of the caller determines the semantics. Sender approves → execution + payment. Non-sender approves → payment only. This is the pattern we see in practice: you only ever have one or two VERIFY frames (sender and optionally payer). The scope bits add complexity to handle cases that don't arise in real usage.

The current spec also has the problem that `ANY (0)` is the most permissive scope, the default if you forget to set the bits. The proposed design has no such footgun.

### Atomicity via groups, not batch flags

**Current:** A per-frame atomic batch flag (bit 10 of mode) chains the current frame to the next. Both must be SENDER mode. The next frame must exist. You set the flag on all frames in the batch except the last.

**Proposed:** Frames carry a group ID. All frames in the same group are atomic (execute or revert together). VERIFY frames aren't part of groups. Group IDs go in the upper mode bits where scope bits currently live.

**How this would have helped us:** Our current atomic batch handling is fiddly:
- The flag means "I'm atomic *with the next frame*", which is a forward reference
- Validation has to check: is the next frame SENDER? does the next frame exist?
- Builders have to set the flag on all-but-last, which is an off-by-one trap
- Contiguous-only: you can't have group A, then group B, then more of group A

The group approach handles the ERC20 paymaster case naturally:

```
transfer DAI to paymaster  | group 0
approve DAI for Uniswap    | group 1
swap DAI on Uniswap        | group 1
refund remaining DAI       | group 2
```

With batch flags, this requires careful ordering and correct flag placement on each frame. With groups, you just label each frame. The SDK builder becomes simpler, validation becomes simpler, and non-contiguous atomicity is possible.

### Combined impact on our implementation

If all three simplifications were adopted, here's what we could delete from the SDK:

| Current | With simplifications |
|---|---|
| `FrameMode` enum (3 values) | 2 values |
| `ApprovalScope` enum (4 values) | Deleted entirely |
| `buildMode()` (3 params: mode, scope, atomic) | 2 params: mode, group |
| `getApprovalScope()` | Deleted |
| Scope validation in builder | Deleted |
| Atomic batch flag validation (next frame checks) | Group ID validation (simpler) |
| Builder branching for self-pay vs sponsored scope | Deleted (identity determines semantics) |

The mode field goes from "3 concerns packed into bits" to "2 concerns packed into bits" (mode + group). The APPROVE opcode goes from "parameterized with scope, callable anywhere" to "no params, VERIFY-only, identity-determined". The atomicity model goes from "forward-linking chain" to "labeling".

## ethrex implementation bug: SENDER default code value transfers

During live testing against the ethrex demo node, we confirmed that **value transfers in EOA SENDER frames silently fail**. The frame receipt shows `status: 0x1` (success) and gas is consumed, but ETH never arrives at the recipient. The sender balance doesn't decrease either.

**Root cause** (in `crates/vm/levm/src/opcode_handlers/frame_tx.rs`): The `execute_default_sender` function creates a `CallFrame` with `should_transfer_value = !call.value.is_zero()` (line 639) and `msg_value = call.value` (line 634), then calls `vm.run_execution()` directly. But `run_execution()` just enters the opcode loop and never checks `should_transfer_value` or calls `self.transfer()`.

The `should_transfer_value` flag is only read by `generic_call` in `system.rs` (line 977), which is the normal CALL opcode handler. The SENDER default code bypasses `generic_call` entirely by constructing a `CallFrame` and running it directly.

**Fix**: `execute_default_sender` needs to call `vm.transfer(sender, call.target, call.value)` before `vm.run_execution()` for each subcall where value is non-zero, mirroring what `generic_call` does at `system.rs:976-978`. If the subcall reverts, the transfer should be reverted along with it (which is already handled by the substate backup/revert at lines 651-668).

## Minor notes

- The `signature_type` byte in EOA VERIFY data (0x00 = ECDSA, 0x01 = P256) is forward-looking and good. But it's only defined for default code; smart accounts don't use it. Two signature format conventions in one spec.
- `maxFeePerBlobGas` and `blobVersionedHashes` are always present in the RLP even when not using blobs. Minor wire overhead but keeps the format fixed-width, which is probably the right tradeoff.

## Summary

The core frame transaction design is sound. Composable validation, sig hash elision, and typed transaction envelopes all work well. The main friction points are:

1. **EOA default code is a parallel protocol** hiding inside the main spec, forcing every implementation layer to branch on account type.
2. **Approval scope bits add complexity without proportional value.** Caller identity can determine semantics more simply.
3. **APPROVE being unrestricted to VERIFY frames** undermines the validation/execution separation that the spec is built around.
4. **Atomic batch flags are a fragile forward-linking mechanism.** Group IDs would be cleaner.

The simplifications proposed on Ethereum Magicians (two modes, no scope bits, group-based atomicity) would have eliminated a lot of implementation complexity in our SDK.
