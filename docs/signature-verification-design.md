# Signature verification in frame transactions

How should 8141 verify signatures? There are four active proposals, they make different tradeoffs, and EIP-8164 (native key delegation) cuts across all of them. This doc lays out the options.

## Context

8141 frame transactions have VERIFY frames that prove a sender or payer authorized the transaction. The original spec uses "default code" with a `signature_type` byte in `frame.data` to pick between ECDSA and P256. Every active proposal removes this byte and replaces it with something else.

EIP-8164 is a separate spec that does something related but different: it permanently replaces an EOA's ECDSA key with Ed25519 by writing an `0xef0101` code designator. It changes what key an account *has*, not how transactions work. Both specs currently claim transaction type `0x06`.

## What we're balancing

### ECDSA backwards compatibility

Most Ethereum accounts are ECDSA EOAs. A plain EOA -- no code, no delegation, no storage -- needs to be able to send a frame transaction with just an ECDSA signature. Same for an EOA acting as a paymaster. Any design that requires existing accounts to do something onchain before they can use frame transactions won't get adopted.

### Forwards compatibility

Adding a new signature scheme shouldn't require changes to 8141 itself. There needs to be an extension point -- a scheme enum, a precompile table, a designator prefix, something -- where companion EIPs plug in new verifiers without touching frame logic, opcodes, or the transaction format.

This extends to aggregation. PQ signatures can be tens of kilobytes. If every transaction carries a full PQ signature in the body with no path to batching them, bandwidth and verification costs will dominate at scale. The design should either support block-level aggregation or at least not prevent it: signatures need to be structured so a future aggregation layer can replace individual entries without breaking the transaction format.

### Key migration and delegation

Accounts need to move from ECDSA to new schemes. Two aspects:

- Migration: swapping an account's authentication root (ECDSA to Ed25519, Ed25519 to PQ, etc.). Must be atomic. No window where two keys are both valid.
- Delegation: the broader concept. EIP-7702 delegates code execution. EIP-8164 delegates authentication. Frame transactions need to work with whatever key an account has, however it got there.

The question for 8141: does the transaction format need to know about key delegation, or does it just verify whatever key the account presents?

### Post-quantum readiness

Beyond the forwards compat point above:

- Existing accounts need to swap their ECDSA keys for PQ keys without losing assets. The migration mechanism needs to be deployed and tested before PQ is urgent.
- New accounts should ideally be created under a PQ scheme directly, without touching ECDSA. This needs either onchain key registration (designator or storage slot) or a convention for deriving Ethereum addresses from PQ public keys.

## The proposals

### A: designator-driven default code

*Discussed but not yet written into the spec. Extends EIP-8164's native key delegation transaction to work with frame transactions -- the `0xef01XX` designators set by 8164's authorization list become the dispatch mechanism for default code in [eip-8141-proposed.md](./eip-8141-proposed.md).*

Default code dispatches on the account's code prefix. No code means ECDSA. An `0xef01XX` designator (set via EIP-8164's native key authorization list) means the scheme identified by that prefix byte. Each new scheme adds a default code branch, activated alongside the companion EIP that defines the designator.

```
no code / 0xef0100 -> empty    =>  ECDSA (ecrecover)
0xef0101 || pubkey             =>  Ed25519
0xef0102 || pubkey             =>  future scheme
...
```

VERIFY frame data is just the raw signature. The account state determines the verifier.

Simple, but adding a new scheme means a consensus change to default code (though the new designator itself is already a consensus change). No aggregation path -- signatures live in frame.data, invisible to the protocol.

### B: signatures list on outer transaction

*[ethereum/EIPs#11481](https://github.com/ethereum/EIPs/pull/11481) by lightclient.*

A new top-level field on the frame transaction: `signatures = [[scheme, signer, msg, signature], ...]`. The protocol validates all signatures before any frame runs. Default code for VERIFY frames just checks that a matching entry exists for the signer. Raw signature bytes are hidden from the EVM.

New schemes get a new enum value -- no changes to frame logic. Signatures are opaque protocol-level objects, so a future block-level aggregated witness can replace individual entries. The signatures list also carries public key material (P256 includes qx/qy), so non-ECDSA accounts can work without onchain setup if there's an address derivation convention.

The cost is ~54 bytes overhead per signature entry on a simple ECDSA transaction, plus new TXPARAM opcodes (0x18-0x1B) and gas accounting for verification.

### C: signature precompile verification

*[ethereum/EIPs#11482](https://github.com/ethereum/EIPs/pull/11482) by Derek Chiang.*

A mode flag (bit 12) on VERIFY frames triggers protocol-level verification via a named precompile (ECRECOVER, P256VERIFY, etc.). Replaces default code entirely. Also introduces a key commitment in storage slot 0 via `keccak256(SIGNER_KEY_MAGIC || key_material)` for key rotation.

New schemes get a new precompile. Precompile deployment is already a consensus change, so no additional 8141 change needed. ECDSA works without onchain setup (EOA fallback when slot 0 is empty). Everything else needs slot 0 or a designator.

No aggregation path -- signatures are in frame.data with a 2-byte precompile prefix.

### EIP-8164: native key delegation

*[EIP-8164](https://eips.ethereum.org/EIPS/eip-8164) by Gregory Markou and James Prestwich.*

Not a frame verification mechanism. A migration primitive. Replaces an account's ECDSA key with Ed25519 by setting account code to `0xef0101 || pubkey`. Permanent, irreversible. Includes Ed25519-to-Ed25519 key rotation and rootless account creation (crafted-signature method where no ECDSA key ever existed).

On its own, 8164 creates accounts that can't participate in frame transactions at all. It needs A, B, or C to bridge the gap. The `0xef01XX` prefix space extends to future schemes, so the framework generalizes beyond Ed25519.

## How these compose

### 8164 + A (designator-driven default code)

Tightest coupling. The designator drives verification dispatch, the authorization list handles migration. One source of truth for the account's key. But no aggregation, and every new scheme is a default code change.

### 8164 + B (signatures list)

8164 handles migration (what key the account has). The signatures list handles verification (proving the key signed this transaction). The designator tells you which scheme to expect; the signatures list is where the actual signature lives. Aggregation works because signatures are protocol-level objects. The most future-proof combination, but also the most machinery.

### 8164 + C (signature precompiles)

Works, but creates redundancy. Both 8164 designators and slot 0 commitments store key material. Both 8164 authorization tuples and slot 0 overwrites rotate keys. Two key management mechanisms for the same purpose. The interaction between them needs careful definition.

### B + C (no 8164)

The signatures list handles known schemes. Precompiles handle bespoke in-EVM verification. But there's no protocol-level mechanism for changing an account's authentication root. Key migration falls to the application layer.

## Comparison matrix

|  | A: designator | B: signatures list | C: precompiles | 8164 alone |
|--|--|--|--|--|
| **Backwards compat** | | | | |
| ECDSA EOA, no onchain setup | yes | yes | yes | n/a |
| ECDSA EOA as paymaster, no setup | yes | yes | yes | n/a |
| **Forwards compat** | | | | |
| New scheme without 8141 changes | no | yes | yes | n/a |
| Aggregation path | no | yes | no | no |
| Signatures removable from tx body | no | yes | no | n/a |
| **Key management** | | | | |
| Non-ECDSA without onchain setup | no | yes | no | no |
| Key migration | via 8164 | not addressed | via slot 0 | core feature |
| Key rotation | via 8164 | not addressed | via slot 0 | via auth tuples |
| **Cost** | | | | |
| Bytes overhead (simple ECDSA tx) | 0 | ~54 | +2 | n/a |
| EVM can read raw signatures | yes | no (metadata only) | yes | n/a |

## Open questions

1. **Is aggregation a day-one requirement?** PQ signatures at scale will need it. The question is whether "at scale" is close enough that the aggregation path needs to be baked in now, or whether it can be layered on later. A and C work fine today but can't be retrofitted for aggregation without changing the transaction format. B carries that cost upfront.

2. **Do non-ECDSA accounts need to work without onchain setup?** Only B supports this. A and C need an onchain action first. For existing accounts migrating to PQ, you need to register the new key onchain regardless. The real question is new accounts born under a PQ scheme -- B lets them create and transact in one step, A and C require a setup transaction first. How much does that matter?

3. **One key management mechanism or two?** 8164 has designators and authorization lists. PR #11482 has slot 0 and `SIGNER_KEY_MAGIC`. Shipping both means two independent ways to store and rotate keys. One source of truth is better.

4. **Transaction type 0x06.** Both 8141 and 8164 claim it. If they compose, 8164's authorization list could become a field on the frame transaction. Otherwise one of them moves.

5. **Address derivation for non-recovery schemes.** ECDSA derives addresses via ecrecover. Ed25519 and PQ schemes can't recover keys from signatures. Using these without onchain state (approach B) requires a convention like `address = keccak256(pubkey)[12:]`. Whatever convention gets picked becomes permanent.
