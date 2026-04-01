---
eip: 8141
title: Frame Transaction
description: Add frame abstraction for transaction validation, execution, and gas payment
author: Vitalik Buterin (@vbuterin), lightclient (@lightclient), Felix Lange (@fjl), Yoav Weiss (@yoavw), Alex Forshtat (@forshtat), Dror Tirosh (@drortirosh), Shahaf Nacson (@shahafn), Derek Chiang (@derekchiang)
discussions-to: https://ethereum-magicians.org/t/frame-transaction/27617
status: Draft
type: Standards Track
category: Core
created: 2026-01-29
requires: 2718, 4844
---

## Abstract

Add a new transaction whose validity and gas payment can be defined abstractly. Instead of relying solely on a single ECDSA signature, accounts may freely define and interpret their signature scheme using any cryptographic system.

## Motivation

This new transaction provides a native off-ramp from the elliptic curve based cryptographic system used to authenticate transactions today, to post-quantum (PQ) secure systems.

In doing so, it realizes the original vision of account abstraction: unlinking accounts from a prescribed ECDSA key and support alternative fee payment schemes. The assumption of an account simply becomes an address with code. It leverages the EVM to support arbitrary *user-defined* definitions of validation and gas payment.

## Specification

### Constants

| Name                      | Value           |
|---------------------------|-----------------|
| `FRAME_TX_TYPE`           | `0x06`          |
| `FRAME_TX_INTRINSIC_COST` | `15000`         |
| `ENTRY_POINT`             | `address(0xaa)` |
| `MAX_FRAMES`              | `10^3`          |

### Opcodes

| Name            | Value  |
|-----------------|--------|
| `APPROVE`       | `0xaa` |
| `TXPARAM`       | `0xb0` |
| `FRAMEDATALOAD` | `0xb1` |
| `FRAMEDATACOPY` | `0xb2` |

### New Transaction Type

A new [EIP-2718](./eip-2718.md) transaction with type `FRAME_TX_TYPE` is introduced. Transactions of this type are referred to as "Frame transactions".

The payload is defined as the RLP serialization of the following:

```
[chain_id, nonce, sender, frames, max_priority_fee_per_gas, max_fee_per_gas, max_fee_per_blob_gas, blob_versioned_hashes]

frames = [[mode, target, value, gas_limit, data], ...]
```

If no blobs are included, `blob_versioned_hashes` must be an empty list and `max_fee_per_blob_gas` must be `0`.

#### Frame Structure

Each frame has five fields:

| Field     | Type             | Description |
|-----------|------------------|-------------|
| `mode`    | uint16           | Execution mode (bit 0) and group ID (bits 8-15) |
| `target`  | address or null  | Target address. Null defaults to `tx.sender` |
| `value`   | uint256          | ETH value to forward with the call |
| `gas_limit` | uint64         | Gas allocated to this frame |
| `data`    | bytes            | Calldata |

#### Frame Modes

The `mode` of each frame sets the context of execution. It allows the protocol to identify the purpose of the frame within the execution loop.

The execution mode of a frame is identified by bit 0 of the `mode` field.

| `mode & 0x1` | Name          | Summary                                    |
|---------------|---------------|--------------------------------------------|
| 0             | `VERIFY` mode | Frame identifies as transaction validation |
| 1             | `EXECUTE` mode | Execute frame in the appropriate context  |

##### `VERIFY` Mode

Identifies the frame as a validation frame. Its purpose is to *verify* that a sender and/or payer authorized the transaction. It must call `APPROVE` during execution. Failure to do so will result in the whole transaction being invalid.

The execution behaves the same as `STATICCALL`, state cannot be modified. VERIFY frames must have `value = 0`.

Frames in this mode will have their data elided from signature hash calculation and from introspection by other frames.

##### `EXECUTE` Mode

Frame executes as a regular call. The caller depends on the current approval state:

- Before `sender_approved == true`: caller is `ENTRY_POINT`. This is the deployment context — used for account creation before the account can authorize itself.
- After `sender_approved == true`: caller is `tx.sender`. This mode effectively acts on behalf of the transaction sender and can only be used after explicitly approved.

The `value` field is forwarded as `msg.value` to the target. The protocol handles the balance transfer.

##### Mode Flags

The upper bits (> 0) of `mode` configure the execution environment.

| Mode bits | Meaning          | Valid with    |
|-----------|------------------|---------------|
| 1-7       | Reserved         | Must be zero  |
| 8-15      | Group ID         | EXECUTE mode  |

Group IDs are used for atomic batching (see below). A group ID of 0 means the frame is independent (not part of an atomic group).

#### Constraints

Some validity constraints can be determined statically. They are outlined below:

```python
assert tx.chain_id < 2**256
assert tx.nonce < 2**64
assert len(tx.frames) > 0 and len(tx.frames) <= MAX_FRAMES
assert len(tx.sender) == 20
assert (tx.frames[n].mode & 0x1) < 2
assert (tx.frames[n].mode >> 1) & 0x7F == 0          # bits 1-7 reserved
assert len(tx.frames[n].target) == 20 or tx.frames[n].target is None

# VERIFY frames must have value = 0
for frame in tx.frames:
    if (frame.mode & 0x1) == 0:  # VERIFY
        assert frame.value == 0

# Group IDs only valid on EXECUTE frames
for frame in tx.frames:
    group_id = (frame.mode >> 8) & 0xFF
    if group_id != 0:
        assert (frame.mode & 0x1) == 1  # must be EXECUTE

# Non-zero group IDs must appear on at least two EXECUTE frames
from collections import Counter
group_counts = Counter((f.mode >> 8) & 0xFF for f in tx.frames if (f.mode & 0x1) == 1)
for group_id, count in group_counts.items():
    if group_id != 0:
        assert count >= 2
```

#### Receipt

The `ReceiptPayload` is defined as:

```
[cumulative_gas_used, payer, [frame_receipt, ...]]
frame_receipt = [status, gas_used, logs]
```

`payer` is the address of the account that paid the fees for the transaction. `status` is the return code of the top-level call.

#### Signature Hash

With the frame transaction, the signature may be at an arbitrary location in the frame list. In the canonical signature hash any frame with mode `VERIFY` will have its data elided:

```python
def compute_sig_hash(tx: FrameTx) -> Hash:
    for i, frame in enumerate(tx.frames):
        if (frame.mode & 0x1) == 0:  # VERIFY
            tx.frames[i].data = Bytes()
    return keccak(rlp(tx))
```

### New Opcodes

#### `APPROVE` opcode (`0xaa`)

The `APPROVE` opcode is like `RETURN (0xf3)`. It exits the current context successfully and updates the transaction-scoped approval context.

APPROVE may only be called during a `VERIFY` frame. Calling APPROVE from an `EXECUTE` frame results in an exceptional halt.

If the currently executing account is not `frame.target` (i.e. if `ADDRESS != frame.target`), `APPROVE` reverts.

##### Stack

| Stack      | Value        |
| ---------- | ------------ |
| `top - 0`  | `offset`     |
| `top - 1`  | `length`     |

##### Behavior

The behavior of `APPROVE` depends on the caller's identity:

- If `ADDRESS == tx.sender`:
    - Set `sender_approved = true`.
    - If `sender_approved` was already set, revert the frame.
    - Set `payer = tx.sender`.
- If `ADDRESS != tx.sender`:
    - If `sender_approved == false`, revert the frame.
    - Set `payer = ADDRESS`.

Subsequent APPROVE calls from non-sender addresses overwrite `payer`. This allows the last VERIFY frame to determine who pays for gas.

After the last VERIFY frame in the transaction completes, the protocol increments the sender's nonce and collects the total gas cost from `payer`. If `payer` has insufficient balance, the transaction is invalid.

#### `TXPARAM` opcode

This opcode gives access to information from the transaction header and/or frames. The gas cost of this operation is `2`.

It takes two values from the stack, `param` and `in2` (in this order). The `param` is the field to be extracted from the transaction. `in2` names a frame index.

| `param` | `in2`       | Return value                                                                |
|---------|-------------|-----------------------------------------------------------------------------|
| 0x00    | must be 0   | current transaction type                                                    |
| 0x01    | must be 0   | `nonce`                                                                     |
| 0x02    | must be 0   | `sender`                                                                    |
| 0x03    | must be 0   | `max_priority_fee_per_gas`                                                  |
| 0x04    | must be 0   | `max_fee_per_gas`                                                           |
| 0x05    | must be 0   | `max_fee_per_blob_gas`                                                      |
| 0x06    | must be 0   | max cost (basefee=max, all gas used, includes blob cost and intrinsic cost) |
| 0x07    | must be 0   | `len(blob_versioned_hashes)`                                                |
| 0x08    | must be 0   | `compute_sig_hash(tx)`                                                      |
| 0x09    | must be 0   | `len(frames)` (can be zero)                                                 |
| 0x10    | must be 0   | currently executing frame index                                             |
| 0x11    | frame index | `target`                                                                    |
| 0x12    | frame index | `gas_limit`                                                                 |
| 0x13    | frame index | `mode` (bit 0 of `frame.mode`: 0=VERIFY, 1=EXECUTE)                        |
| 0x14    | frame index | `len(data)`                                                                 |
| 0x15    | frame index | `status` (exceptional halt if current/future)                               |
| 0x16    | frame index | `group_id` (bits 8-15 of `frame.mode`)                                      |
| 0x17    | frame index | `value`                                                                     |

Notes:

- `0x01` has a possible future extension to allow indices for multidimensional nonces.
- `0x03` and `0x04` have a possible future extension to allow indices for multidimensional gas.
- The `status` field (0x15) returns `0` for failure or `1` for success.
- Invalid `param` values (not defined in the table above) result in an exceptional halt.
- Out-of-bounds access for frame index (`>= len(frames)`) results in an exceptional halt.
- Attempting to access the return `status` of the current frame or a subsequent frame results in an exceptional halt.
- `len(data)` field (0x14) returns size 0 value when called on a frame with `VERIFY` set.

#### `FRAMEDATALOAD` opcode

This opcode loads one 32-byte word of data from frame input. Gas cost: 3 (matches CALLDATALOAD).

It takes two values from the stack, an `offset` and `frameIndex`.
It places the retrieved data on the stack.

When the `frameIndex` is out-of-bounds, an exceptional halt occurs.

The operation semantics match CALLDATALOAD, returning a word of data from the chosen frame's `data`, starting at the given byte `offset`. When targeting a frame in `VERIFY` mode, the returned data is always zero.

#### `FRAMEDATACOPY` opcode

This opcode copies data frame input into the contract's memory. The gas cost matches CALLDATACOPY, i.e. the operation has a fixed cost of 3 and a variable cost that accounts for the memory expansion and copying.

It takes four values from the stack: `memOffset`, `dataOffset`, `length` and `frameIndex`.
No stack output value is produced.

When the `frameIndex` is out-of-bounds, an exceptional halt occurs.

The operation semantics match CALLDATACOPY, copying `length` bytes from the chosen frame's `data`, starting at the given byte `dataOffset`, into a memory region starting at `memOffset`. When targeting a frame in `VERIFY` mode, no data is copied.

### Behavior

When processing a frame transaction, perform the following steps.

Perform stateful validation check:

- Ensure `tx.nonce == state[tx.sender].nonce`

Initialize with transaction-scoped variables:

- `sender_approved = false`
- `payer = tx.sender`

Then for each call frame:

2. Execute a call with the specified `mode`, `target`, `value`, `gas_limit`, and `data`.
   - If `target` is null, set the call target to `tx.sender`.
   - If mode is `EXECUTE` and `sender_approved == true`:
       - Set `caller` as `tx.sender`.
       - Forward `frame.value` as `msg.value` to the target. Transfer `frame.value` from `tx.sender` to `frame.target`.
   - If mode is `EXECUTE` and `sender_approved == false`:
       - Set the `caller` to `ENTRY_POINT`.
       - Forward `frame.value` as `msg.value` to the target. Transfer `frame.value` from `tx.sender` to `frame.target`.
   - If mode is `VERIFY`:
       - Set the `caller` to `ENTRY_POINT`.
       - Assert `frame.value == 0`.
   - If `frame.target` has no code, execute the logic described in [default code](#default-code).
   - The `ORIGIN` opcode returns frame `caller` throughout all call depths.
   - If a frame's execution reverts, its state changes are discarded. Additionally, if this frame has a non-zero group ID, handle according to the atomic group rules below.
3. If frame has mode `VERIFY` and the frame did not successfully call `APPROVE`, the transaction is invalid.

After the last VERIFY frame completes, increment the sender's nonce and collect the total gas cost from `payer`. If `payer` has insufficient balance, the transaction is invalid.

#### Atomic Groups

EXECUTE frames with the same non-zero group ID form an **atomic group**. Within a group, if any frame reverts, all preceding frames in the group are also reverted and all subsequent frames in the group are skipped.

More precisely, execution of an atomic group proceeds as follows:

1. Take a snapshot of the state before executing the first frame in the group.
2. Execute each frame in the group sequentially.
3. If a frame reverts:
   - Restore the state to the snapshot taken before the group.
   - Mark all remaining frames in the group as skipped.

Frames with group ID 0 are independent — they execute and revert individually.

For example, given frames:

| Frame | Mode    | Group ID |
|-------|---------|----------|
| 0     | EXECUTE | 1        |
| 1     | EXECUTE | 1        |
| 2     | EXECUTE | 2        |
| 3     | EXECUTE | 2        |
| 4     | EXECUTE | 0        |

Frames 0-1 form one atomic group and frames 2-3 form another. Frame 4 is independent. If frame 3 reverts, the state changes from frames 2 and 3 are discarded. Frames 0-1 and frame 4 are unaffected.

Unlike the atomic batch flag approach, groups need not be contiguous:

| Frame | Mode    | Group ID |
|-------|---------|----------|
| 0     | EXECUTE | 1        |
| 1     | EXECUTE | 2        |
| 2     | EXECUTE | 1        |

Frames 0 and 2 form an atomic group. If frame 2 reverts, frame 0 is also reverted. Frame 1 is unaffected.

After executing all frames, verify that `sender_approved == true` and `payer` has sufficient balance. If not, the whole transaction is invalid. Refund any unused gas to `payer`.

Note:

- It is implied by the handling that the sender must approve the transaction *before* a non-sender payer can approve, and that once `sender_approved` becomes `true` it cannot be reverted.

#### Default code

When using frame transactions with EOAs (accounts with no code), they are treated as if they have a "default code." This spec describes only the behavior of the default code; clients are free to implement the default code however they want, so long as they correspond to the behavior specified here.

- Retrieve the `mode` with `TXPARAMLOAD`.
- If `mode` is `VERIFY`:
  - If `frame.target != tx.sender`, revert.
  - Read the first byte of `frame.data` as `signature_type`.
  - If `signature_type` is:
    - `0x0`:
      - Read the rest of `frame.data` as `(v, r, s)`.
      - If `frame.target != ecrecover(sig_hash, v, r, s)`, where `sig_hash = compute_sig_hash(tx)`, revert.
    - `0x1`:
      - Read the rest of `frame.data` as `(r, s, qx, qy)`.
      - If `frame.target != keccak256(qx|qy)[12:]`, revert.
      - If `P256VERIFY(sig_hash, r, s, qx, qy) != true`, where `sig_hash = compute_sig_hash(tx)`, revert.
    - Otherwise revert.
  - Call `APPROVE`.
- If `mode` is `EXECUTE`:
  - Execute the call normally: `call(target=frame.target, value=frame.value, data=frame.data)` with `msg.sender = tx.sender` (if sender approved) or `msg.sender = ENTRY_POINT` (if not).
  - This is identical to the smart account behavior — no special encoding is needed.

Notes:

- It's implied that for the P256 (r1) signature type, the sender address must be `keccak256(qx|qy)[12:]`.
- EOA EXECUTE frames use the same semantics as smart account EXECUTE frames. The `value` field on the frame handles ETH transfers at the protocol level. No RLP subcall encoding is required.

Here's the logic above implemented in Python:

```python
VERIFY  = 0
EXECUTE = 1

SECP256K1 = 0x0
P256      = 0x1

def default_code(frame, tx):
    mode = frame.mode & 0x1

    if mode == VERIFY:
        signature_type = frame.data[0]
        sig_hash       = compute_sig_hash(tx)

        if signature_type == SECP256K1:
            if len(frame.data) != 66:
                revert()
            v = frame.data[1]
            r = frame.data[2:34]
            s = frame.data[34:66]
            if frame.target != ecrecover(sig_hash, v, r, s):
                revert()

        elif signature_type == P256:
            if len(frame.data) != 129:
                revert()
            r  = frame.data[1:33]
            s  = frame.data[33:65]
            qx = frame.data[65:97]
            qy = frame.data[97:129]
            if frame.target != keccak256(qx + qy)[12:]:
                revert()
            if not P256VERIFY(sig_hash, r, s, qx, qy):
                revert()

        else:
            revert()

        APPROVE()

    elif mode == EXECUTE:
        # Default execution: call target with value and data.
        # This is the same as smart account behavior.
        result = evm_call(
            caller=tx.sender if sender_approved else ENTRY_POINT,
            to=frame.target,
            value=frame.value,
            data=frame.data
        )
        if result.reverted:
            revert()

    else:
        revert()
```

#### Frame interactions

A few cross-frame interactions to note:

- For the purposes of gas accounting of warm / cold state status, the journal of such touches is shared across frames.
- Discard the `TSTORE` and `TLOAD` transient storage between frames.

#### Gas Accounting

The total gas limit of the transaction is:

```
tx_gas_limit = FRAME_TX_INTRINSIC_COST + calldata_cost(rlp(tx.frames)) + sum(frame.gas_limit for all frames)
```

Where `calldata_cost` is calculated per standard EVM rules (4 gas per zero byte, 16 gas per non-zero byte).

The total fee is defined as:

```
tx_fee = tx_gas_limit * effective_gas_price + blob_fees
blob_fees = len(blob_versioned_hashes) * GAS_PER_BLOB * blob_base_fee
```

The `effective_gas_price` is calculated per EIP-1559 and `blob_fees` is calculated as per EIP-4844.

Each frame has its own `gas_limit` allocation. Unused gas from a frame is **not** available to subsequent frames. After all frames execute, the gas refund is calculated as:

```
refund = sum(frame.gas_limit for all frames) - total_gas_used
```

This refund is returned to `payer` (the last address that called `APPROVE` from a non-sender VERIFY frame, or `tx.sender` if only the sender approved) and added back to the block gas pool. *Note: This refund mechanism is separate from EIP-3529 storage refunds.*

### Mempool

The transaction mempool must carefully handle frame transactions, as a naive implementation could introduce denial-of-service vulnerabilities. The fundamental goal of the public mempool rules is to avoid allowing an arbitrary number of transactions to be invalidated by a single environmental change or state modification. Beyond this, the rules also aim to minimize the amount of work needed to complete the initial validation phase of a transaction before an acceptance decision can be made.

This policy is inspired by [ERC-7562](./eip-7562.md), but removes staking and reputation entirely. Any behavior that ERC-7562 would admit only for a staked or reputable third party is rejected here for the public mempool. Transactions outside these rules may be accepted into a local or private mempool, but must not be propagated through the public mempool.

#### Constants

| Name  | Value  | Description  |
|---|---|---|
| `MAX_VERIFY_GAS`   | `100_000`  | Maximum amount of gas a node should expend simulating the validation prefix |
| `MAX_PENDING_TXS_USING_NON_CANONICAL_PAYMASTER`   | `1`  | Maximum amount of pending transactions that can be using any given non-canonical paymaster |

#### Validation Prefix

The **validation prefix** of a frame transaction is the shortest prefix of frames whose successful execution causes `payer` to be set (via APPROVE from a non-sender, or the sender approving as both sender and payer).

Public mempool rules apply only to the validation prefix. Once the validation prefix completes, subsequent frames are outside public mempool validation and may be arbitrary.

#### Policy Summary

A frame transaction is eligible for public mempool propagation only if its validation prefix depends exclusively on:

1. transaction fields, including the canonical signature hash,
2. the sender's nonce, code, and storage,
3. a known deterministic deployer contract, if a deployment frame is present,
4. if a paymaster frame is present, either a canonical paymaster instance together with explicit paymaster balance reservation, or a non-canonical paymaster being used by less than `MAX_PENDING_TXS_USING_NON_CANONICAL_PAYMASTER` pending transactions,
5. the code of any other existing non-delegated contracts reached during validation via `CALL*` or `EXTCODE*`, provided the resulting trace does not access disallowed mutable state.

Any dependency on third-party mutable state outside these categories must result in rejection by the public mempool.

#### Mode Subclassifications

While the frames are designed to be generic, we refine some frame modes for the purpose of specifying public mempool handling clearly.

| Name  | Mode  | Description  |
|---|---|---|
| `self_verify`   | VERIFY  | Validates the transaction; sender calls APPROVE (approves execution + payment) |
| `deploy`  | EXECUTE | Deploys a new smart account using a known deterministic deployer (before sender approval) |
| `only_verify`  | VERIFY  | Validates the transaction; sender calls APPROVE (execution only, expects separate payer) |
| `pay`  | VERIFY | Non-sender calls APPROVE (approves payment) |
| `user_op` | EXECUTE | Executes the intended user operation (after sender approval) |
| `post_op` | EXECUTE | Executes an optional post-op action (after sender approval) |

#### Public Mempool-recognized Validation Prefixes

The public mempool recognizes four validation prefixes. Structural rules are enforced only up to and including the frame that completes the validation.

##### Self Relay

###### Basic Transaction

```
+-------------+
| self_verify |
+-------------+
```

###### Deploy New Account

```
+--------+-------------+
| deploy | self_verify |
+--------+-------------+
```

##### Canonical Paymaster

###### Basic Transaction

```
+-------------+-----+
| only_verify | pay |
+-------------+-----+
```

###### Deploy New Account

```
+--------+-------------+-----+
| deploy | only_verify | pay |
+--------+-------------+-----+
```

Frames after these prefixes are outside public mempool validation. For example, a transaction may continue with any number of `user_op`s and/or `post_op`s.

#### Structural Rules

To be accepted into the public mempool, a frame transaction must satisfy the following:

1. Its validation prefix must match one of the four recognized prefixes above.
2. If present, `deploy` must be the first frame. This implies there can be at most one `deploy` frame in the validation prefix. A `deploy` frame is an EXECUTE frame before sender approval, so its caller is ENTRY_POINT.
3. `self_verify` and `only_verify` must execute in `VERIFY` mode, target `tx.sender` (either explicitly or via a null target), and must successfully call `APPROVE`.
4. `pay` must execute in `VERIFY` mode and successfully call `APPROVE`.
5. The sum of `gas_limit` values across the validation prefix must not exceed `MAX_VERIFY_GAS`.
6. Nodes should stop simulation immediately once the validation prefix completes.

#### Canonical Paymaster Exception

The generic validation trace and opcode rules below apply to all frames in the validation prefix except a `pay` frame whose target runtime code exactly matches the canonical paymaster implementation. The canonical paymaster implementation is explicitly designed to be safe for public mempool use and is therefore admitted by code match, successful `APPROVE`, and the paymaster accounting rules in this section, rather than by requiring it to satisfy each generic validation rule individually.

#### Validation Trace Rules

A public mempool node must simulate the validation prefix and reject the transaction if any of the following occurs before the validation prefix completes:

- a frame in the validation prefix reverts
- a `VERIFY` frame in the validation prefix exits without the required `APPROVE`
- execution exceeds `MAX_VERIFY_GAS`
- execution uses a banned opcode
- execution performs a state write, except deterministic deployment performed by the first `deploy` frame through a known deployer
- execution reads storage outside `tx.sender`
- execution performs `CALL*` or `EXTCODE*` to an address that is neither an existing contract nor a precompile, or to an address that uses an EIP-7702 delegation, except for `tx.sender` default-code behavior
- if a `deploy` frame is present, its execution does not result in non-empty, non-delegated code being installed at `tx.sender`

##### Banned Opcodes

The following opcodes are banned during the validation prefix, with a few caveats:

- ORIGIN (0x32)
- GASPRICE (0x3A)
- BLOCKHASH (0x40)
- COINBASE (0x41)
- TIMESTAMP (0x42)
- NUMBER (0x43)
- PREVRANDAO/DIFFICULTY (0x44)
- GASLIMIT (0x45)
- BASEFEE (0x48)
- BLOBHASH (0x49)
- BLOBBASEFEE (0x4A)
- GAS (0x5A)
    - Except when followed immediately by a `*CALL` instruction. This is the standard method of passing gas to a child call and does not create an additional public mempool dependency.
- CREATE (0xF0)
- CREATE2 (0xF5)
    - Except inside the first `deploy` frame when targeting a known deterministic deployer.
- INVALID (0xFE)
- SELFDESTRUCT (0xFF)
- BALANCE (0x31)
- SELFBALANCE (0x47)
- SSTORE (0x55)
- TLOAD (0x5C)
- TSTORE (0x5D)

`SLOAD` can be used only to access `tx.sender` storage, including when reached transitively via `CALL*` or `DELEGATECALL`.

`CALL*` and `EXTCODE*` may target any existing contract or precompile, provided the resulting trace still satisfies the storage, opcode, and EIP-7702 restrictions above. This permits helper contracts and libraries during validation, including via `DELEGATECALL`, so long as they do not introduce additional mutable-state dependencies.

#### Paymasters

A paymaster can choose to sponsor a transaction's gas. Generally the relationship is one paymaster to many transaction senders, however, this is in direct conflict with the goal of not predicating the validity of many transactions on the value of one account or storage element.

We address this conflict in two ways:

1. If a paymaster sponsors gas for a large number of accounts simultaneously, it must be a safe, standardized paymaster contract. It is designed such that ether which enters it cannot leave except:
  a. in the form of payment for a transaction, or
  b. after a delay period.
2. If a paymaster sponsors gas for a small number of accounts simultaneously (no more than `MAX_PENDING_TXS_USING_NON_CANONICAL_PAYMASTER`), it may be any paymaster contract.

##### Canonical paymaster

The canonical paymaster is not a singleton deployment. Many instances may be deployed. For public mempool purposes, a paymaster instance is considered canonical if and only if the runtime code at the `pay` frame target exactly matches the canonical paymaster implementation.

Because the canonical paymaster implementation is explicitly standardized to be safe for public mempool use, nodes do not need to apply the generic validation trace and opcode rules to that `pay` frame. Instead, they identify it by runtime code match and apply the paymaster-specific accounting and revalidation rules in this section.

A transaction using a paymaster is eligible for public mempool propagation only if the `pay` frame targets a canonical paymaster instance and the node can reserve the maximum transaction cost against that paymaster.

For public mempool purposes, each node maintains a local accounting value `reserved_pending_cost(paymaster)` and computes:

```python
available_paymaster_balance = state.balance(paymaster) - reserved_pending_cost(paymaster) - pending_withdrawal_amount(paymaster)
```

Where `pending_withdrawal_amount(paymaster)` is the currently pending delayed withdrawal amount of the canonical paymaster instance, or zero if no delayed withdrawal is pending.

A node must reject a paymaster transaction if `available_paymaster_balance` is less than the transaction's maximum cost (`TXPARAM(0x06, 0)`).

On admission, the node increments `reserved_pending_cost(paymaster)` by the transaction's maximum cost (`TXPARAM(0x06, 0)`). On eviction, replacement, inclusion, or reorg removal, the node decrements it accordingly.

##### Non-canonical paymaster

For non-canonical paymasters, `pending_withdrawal_amount` is not meaningful since they may not support timelocked withdrawals. Instead, we keep the mempool safe by enforcing that each non-canonical paymaster can only be used with no more than `MAX_PENDING_TXS_USING_NON_CANONICAL_PAYMASTER` pending transactions.

Therefore we perform two checks:

- For balance, `available_paymaster_balance` must not be less than the transaction cost, where:

```python
available_paymaster_balance = state.balance(paymaster) - reserved_pending_cost(paymaster)
```

- The number of pending transactions in the mempool that uses this paymaster must be less than `MAX_PENDING_TXS_USING_NON_CANONICAL_PAYMASTER`.

#### Acceptance Algorithm

1. A transaction is received over the wire and the node decides whether to accept or reject it.
2. The node analyzes the frame structure and determines the validation prefix. If the prefix is not one of the recognized prefixes, reject.
3. The node simulates the validation prefix and enforces the structural and trace rules above, except that a `pay` frame whose target runtime code exactly matches the canonical paymaster implementation is handled via the canonical paymaster exception and the paymaster-specific rules below.
4. The node records the sender storage slots read during validation. Calls into helper contracts do not create additional mutable-state dependencies unless they cause disallowed storage access under the trace rules above.
5. If a canonical paymaster instance is used, the node verifies paymaster solvency using the reservation rule above.
6. A node should keep at most one pending frame transaction per sender in the public mempool. A new transaction from the same sender MAY replace the existing one only if it uses the same nonce and satisfies the node's fee bump rules.
7. If all checks pass, the transaction may be accepted into the public mempool and propagated to peers.

#### Revalidation

When a new canonical block is accepted, the node removes any included frame transactions from the public mempool, updates paymaster reservations accordingly, and identifies the remaining pending transactions whose tracked dependencies were touched by the block. This includes at least transactions for the same sender, transactions whose recorded sender storage slots changed, and transactions that reference a canonical paymaster instance whose balance, code, or delayed-withdrawal state changed. The node then re-simulates the validation prefix of only those affected transactions against the new head and evicts any transaction that no longer satisfies the public mempool rules.

## Rationale

### Canonical signature hash

The canonical signature hash is provided in `TXPARAMLOAD` to simplify the development of smart accounts.

Computing the signature hash in EVM is complicated and expensive. While using the canonical signature hash is not mandatory, it is strongly recommended. Creating a bespoke signature requires precise commitment to the underlying transaction data. Without this, it's possible that some elements can be manipulated in-the-air while the transaction is pending and have unexpected effects. This is known as transaction malleability. Using the canonical signature hash avoids malleability of the frames other than `VERIFY`.

The `frame.data` of `VERIFY` frames is elided from the signature hash. This is done for two reasons:

1. It contains the signature so by definition it cannot be part of the signature hash.
2. In the future it may be desired to aggregate the cryptographic operations for data and compute efficiency reasons. If the data was introspectable, it would not be possible to aggregate the verify frames in the future.
3. For gas sponsoring workflows, we also recommend using a `VERIFY` frame to approve the gas payment. Here, the input data to the sponsor is intentionally left malleable so it can be added onto the transaction after the `sender` has made its signature. Notably, the `frame.target` of `VERIFY` frames is covered by the signature hash, i.e. the `sender` chooses the sponsor address explicitly.

### `APPROVE` calling convention

`APPROVE` terminates the executing frame successfully like `RETURN`, but it actually updates the transaction scoped approval state during execution. It is still required that only the sender can toggle the `sender_approved` to `true`. Only the `frame.target` can call `APPROVE` generally, because it allows the transaction pool and other frames to better reason about `VERIFY` mode frames.

APPROVE takes no scope operand. The caller's identity determines the semantics: if the sender calls APPROVE, it approves both execution and payment. If a non-sender calls APPROVE, it approves payment (overwriting the payer). This eliminates the need for scope bits in the mode field and removes the ordering footguns of the explicit scope approach, while producing the same result for all practical use cases (self-pay and sponsored transactions).

APPROVE is restricted to VERIFY frames. This makes the validation/execution separation a protocol invariant rather than a convention. VERIFY frames validate, EXECUTE frames execute.

### Two modes instead of three

DEFAULT and SENDER both mean "execute code" with different callers (ENTRY_POINT vs tx.sender). The caller can be inferred from the approval state: EXECUTE frames before sender approval have ENTRY_POINT as caller, EXECUTE frames after have tx.sender. This eliminates the need for a third mode and simplifies the mental model to "are you validating or executing?"

### Value in frame

ETH transfers are the most basic Ethereum operation. Without a frame-level value field, smart accounts must implement their own `execute(target, value, data)` methods to forward ETH to payable functions, and EOAs need RLP-encoded subcall lists to express value. Adding value to the frame structure makes ETH transfers a first-class operation at the protocol level, unifies behavior across account types, and eliminates the need for EOA default code to define its own subcall encoding.

### Atomic groups instead of batch flags

The atomic batch flag is a forward-reference ("I'm atomic with the next frame") that requires careful placement and only supports contiguous sequences. Group IDs are a label — simpler to construct, simpler to validate, and they support non-contiguous atomicity. For example, an ERC-20 paymaster pattern with three independent atomic groups (DAI transfer, approve+swap, refund) is naturally expressed with group IDs but requires careful flag choreography with batch flags.

### EOA default code simplification

With a frame-level value field, EOA EXECUTE frames use the same semantics as smart account EXECUTE frames: `target` is the call target, `value` is the ETH amount, `data` is calldata. No RLP subcall encoding is needed. The only remaining EOA-specific behavior is the VERIFY frame signature format (ECDSA or P256).

### Payer in receipt

The payer cannot be determined statically from a frame transaction and is relevant to users. The only way to provide this information safely and efficiently over the JSON-RPC is to record this data in the receipt object.

### No authorization list

The EIP-7702 authorization list heavily relies on ECDSA cryptography to determine the authority of accounts to delegate code. While delegations could be used in other manners later, it does not satisfy the PQ goals of the frame transaction.

### No access list

The access list was introduced to address a particular backwards compatibility issue that was caused by EIP-2929. The risk-reward of using an access list successfully is high. A single miss, paying to warm a storage slot that does not end up getting used, causes the overall transaction cost to be greater than had it not been included at all.

Future optimizations based on pre-announcing state elements a transaction will touch will be covered by block level access lists.

### Examples

#### Example 1: Simple Transaction

| Frame | Caller         | Target        | Value | Data      | Mode    |
| ----- | -------------- | ------------- | ----- | --------- | ------- |
| 0     | ENTRY_POINT    | Null (sender) | 0     | Signature | VERIFY  |
| 1     | Sender         | Target        | 0     | Call data | EXECUTE |

Frame 0 verifies the signature and calls `APPROVE` to approve execution and payment. Frame 1 executes and exits normally via `RETURN`.

#### Example 1a: Simple ETH transfer

| Frame | Caller         | Target        | Value  | Data      | Mode    |
| ----- | -------------- | ------------- | ------ | --------- | ------- |
| 0     | ENTRY_POINT    | Null (sender) | 0      | Signature | VERIFY  |
| 1     | Sender         | Recipient     | 1 ETH  | (empty)   | EXECUTE |

An ETH transfer is performed directly via the frame's `value` field. No calldata is needed, and the behavior is identical for EOAs and smart accounts.

#### Example 1b: Simple account deployment

| Frame | Caller       | Target        | Value | Data               | Mode    |
| ----- | ------------ | ------------- | ----- | ------------------ | ------- |
| 0     | ENTRY_POINT  | Deployer      | 0     | Initcode, Salt     | EXECUTE |
| 1     | ENTRY_POINT  | Null (sender) | 0     | Signature          | VERIFY  |
| 2     | Sender       | Recipient     | 1 ETH | (empty)            | EXECUTE |

This example illustrates the initial deployment flow for a smart account at the `sender` address. Since the address needs to have code in order to validate the transaction, the transaction must deploy the code before verification.

The first frame is an EXECUTE frame before sender approval, so its caller is ENTRY_POINT. It calls a deployer contract, like EIP-7997. The deployer determines the address in a deterministic way, such as by hashing the initcode and salt.

#### Example 2: Atomic Approve + Swap

| Frame | Caller      | Target        | Value | Data                  | Mode    | Group |
| ----- | ----------- | ------------- | ----- | --------------------- | ------- | ----- |
| 0     | ENTRY_POINT | Null (sender) | 0     | Signature             | VERIFY  | -     |
| 1     | Sender      | ERC-20        | 0     | approve(DEX, amount)  | EXECUTE | 1     |
| 2     | Sender      | DEX           | 0     | swap(...)             | EXECUTE | 1     |

Frame 0 verifies the signature and calls `APPROVE`. Frames 1 and 2 are in group 1: if the swap in frame 2 reverts, the ERC-20 approval from frame 1 is also reverted, preventing the account from being left with a dangling approval.

#### Example 3: Sponsored Transaction (Fee Payment in ERC-20)

| Frame | Caller      | Target        | Value | Data                   | Mode    |
| ----- | ----------- | ------------- | ----- | ---------------------- | ------- |
| 0     | ENTRY_POINT | Null (sender) | 0     | Signature              | VERIFY  |
| 1     | ENTRY_POINT | Sponsor       | 0     | Sponsor data           | VERIFY  |
| 2     | Sender      | ERC-20        | 0     | transfer(Sponsor,fees) | EXECUTE |
| 3     | Sender      | Target addr   | 0     | Call data              | EXECUTE |
| 4     | Sender      | Sponsor       | 0     | Post op call           | EXECUTE |

- Frame 0: Verifies signature and calls `APPROVE` — sender is the caller, so this approves execution and sets `payer = sender`.
- Frame 1: Sponsor checks that the user has enough ERC-20 tokens and calls `APPROVE` — non-sender caller, so this sets `payer = sponsor`. Nonce incremented, gas collected from sponsor.
- Frame 2: Sends tokens to sponsor.
- Frame 3: User's intended call.
- Frame 4 (optional): Check unpaid gas, refund tokens, possibly convert tokens to ETH on an AMM.

#### Example 4: EOA paying gas in ERC-20s

| Frame | Caller      | Target        | Value | Data                   | Mode    |
| ----- | ----------- | ------------- | ----- | ---------------------- | ------- |
| 0     | ENTRY_POINT | Null(sender)  | 0     | (0, v, r, s)          | VERIFY  |
| 1     | ENTRY_POINT | Sponsor       | 0     | Sponsor signature      | VERIFY  |
| 2     | Sender      | ERC-20        | 0     | transfer(Sponsor,fees) | EXECUTE |
| 3     | Sender      | Target addr   | 0     | Call data              | EXECUTE |

- Frame 0: EOA default code verifies ECDSA signature and calls `APPROVE` — approves execution, sets `payer = sender`.
- Frame 1: Sponsor calls `APPROVE` — sets `payer = sponsor`.
- Frame 2: Sends tokens to sponsor.
- Frame 3: User's intended call.

### Data Efficiency

**Basic transaction sending ETH from a smart account:**

| Field                             | Bytes |
| --------------------------------- | ----- |
| Tx wrapper                        | 1     |
| Chain ID                          | 1     |
| Nonce                             | 2     |
| Sender                            | 20    |
| Max priority fee                  | 5     |
| Max fee                           | 5     |
| Max fee per blob gas              | 1     |
| Blob versioned hashes (empty)     | 1     |
| Frames wrapper                    | 1     |
| Sender validation frame: target   | 1     |
| Sender validation frame: value    | 1     |
| Sender validation frame: gas      | 2     |
| Sender validation frame: data     | 65    |
| Sender validation frame: mode     | 1     |
| Execution frame: target           | 20    |
| Execution frame: value            | 5     |
| Execution frame: gas              | 1     |
| Execution frame: data             | 0     |
| Execution frame: mode             | 1     |
| **Total**                         | 134   |

Notes: Nonce assumes < 65536 prior sends. Fees assume < 1099 gwei. Validation frame target is 1 byte because target is `tx.sender`. Validation frame value is 1 byte (0). Validation gas assumes <= 65,536 gas. Validation data is 65 bytes for ECDSA signature. Execution frame target is full 20-byte address. Execution frame value is 5 bytes for ETH amount. Blob fields assume no blobs (empty list, zero max fee).

The value field adds 1 byte per frame for zero-value calls (the common case — RLP encodes 0 as a single byte). For ETH transfers, this replaces the calldata that would otherwise encode the value, so there is no net overhead.

**First transaction from an account (add deployment frame):**

| Field                      | Bytes |
| -------------------------- | ----- |
| Deployment frame: target   | 20    |
| Deployment frame: value    | 1     |
| Deployment frame: gas      | 3     |
| Deployment frame: data     | 100   |
| Deployment frame: mode     | 1     |
| **Total additional**       | 125   |

Notes: Gas assumes cost < 2^24. Calldata assumes small proxy. Value is 1 byte (0).

**Trustless pay-with-ERC-20 sponsor (add these frames):**

| Field                                | Bytes |
| ------------------------------------ | ----- |
| Sponsor validation frame: target   | 20    |
| Sponsor validation frame: value    | 1     |
| Sponsor validation frame: gas      | 3     |
| Sponsor validation frame: calldata | 0     |
| Sponsor validation frame: mode     | 1     |
| Send to sponsor frame: target      | 20    |
| Send to sponsor frame: value       | 1     |
| Send to sponsor frame: gas         | 3     |
| Send to sponsor frame: calldata    | 68    |
| Send to sponsor frame: mode        | 1     |
| Sponsor post op frame: target      | 20    |
| Sponsor post op frame: value       | 1     |
| Sponsor post op frame: gas         | 3     |
| Sponsor post op frame: calldata    | 0     |
| Sponsor post op frame: mode        | 2     |
| **Total additional**               | 145   |

Notes: Sponsor can read info from other fields. ERC-20 transfer call is 68 bytes.

There is some inefficiency in the sponsor case, because the same sponsor address must appear in three places (sponsor validation, send to sponsor inside ERC-20 calldata, post op frame), and the ABI is inefficient (~12 + 24 bytes wasted on zeroes). This is difficult to mitigate in a "clean" way, because one of the duplicates is inside the ERC-20 call, "opaque" to the protocol. However, it is much less inefficient than ERC-4337, because not all of the data takes the hit of the 32-byte-per-field ABI overhead.


## Backwards Compatibility

The `ORIGIN` opcode behavior changes for frame transactions, returning the frame's caller rather than the traditional transaction origin. This is consistent with the precedent set by EIP-7702, which already modified `ORIGIN` semantics. Contracts that rely on `ORIGIN = CALLER` for security checks (a discouraged pattern) may behave differently under frame transactions.

## Security Considerations

### Transaction Propagation

Frame transactions introduce new denial-of-service vectors for transaction pools that node operators must mitigate. Because validation logic is arbitrary EVM code, attackers can craft transactions that appear valid during initial validation but become invalid later. Without any additional policies, an attacker could submit many transactions whose validity depends on some shared state, then submit one transaction that modifies that state, and cause all other transactions to become invalid simultaneously. This wastes the computational resources nodes spent validating and storing these transactions.

#### Example Attack

A simple example is transactions that check `block.timestamp`:

```solidity
function validateTransaction() external {
    require(block.timestamp < SOME_DEADLINE, "expired");
    // ... rest of validation
    APPROVE();
}
```

Such transactions are valid when submitted but become invalid once the deadline passes, without any on-chain action required from the attacker.

##### Mitigations

Node implementations should consider restricting which opcodes and storage slots validation frames can access, similar to ERC-7562. This isolates transactions from each other and limits mass invalidation vectors.

It's recommended that to *validate* the transaction, a specific frame structure is enforced and the amount of gas that is expended executing the validation phase must be limited. Once the validation prefix completes, the transaction can be included in the mempool and propagated to peers safely.

For deployment of the sender account in the first frame, the mempool must only allow specific and known deployer factory contracts to be used as `frame.target`, to ensure deployment is deterministic and independent of chain state.

In general, it can be assumed that handling of frame transactions imposes similar restrictions as EIP-7702 on mempool relay, i.e. only a single transaction can be pending for an account that uses frame transactions.

## Copyright

Copyright and related rights waived via [CC0](../LICENSE.md).
