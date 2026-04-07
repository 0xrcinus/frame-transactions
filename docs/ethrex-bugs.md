# ethrex Implementation Bugs

Bugs found while testing against the ethrex demo node.

## SENDER default code value transfers silently fail

Value transfers in EOA SENDER frames silently fail. The frame receipt shows `status: 0x1` (success) and gas is consumed, but ETH never arrives at the recipient. The sender balance doesn't decrease either.

**Root cause** (in `crates/vm/levm/src/opcode_handlers/frame_tx.rs`): `execute_default_sender` creates a `CallFrame` with `should_transfer_value = !call.value.is_zero()` (line 639) and `msg_value = call.value` (line 634), then calls `vm.run_execution()` directly. But `run_execution()` just enters the opcode loop and never checks `should_transfer_value` or calls `self.transfer()`.

The `should_transfer_value` flag is only read by `generic_call` in `system.rs` (line 977), which is the normal CALL opcode handler. The SENDER default code bypasses `generic_call` entirely by constructing a `CallFrame` and running it directly.

**Fix**: `execute_default_sender` needs to call `vm.transfer(sender, call.target, call.value)` before `vm.run_execution()` for each subcall where value is non-zero, mirroring what `generic_call` does at `system.rs:976-978`. If the subcall reverts, the transfer should be reverted along with it (already handled by the substate backup/revert at lines 651-668).
