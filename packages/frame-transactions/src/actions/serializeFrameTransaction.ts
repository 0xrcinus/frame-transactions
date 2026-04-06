import type { FrameTransaction } from "../types/frame.js";
import type { SerializedFrameTransaction } from "../types/transaction.js";
import { validateFrameTransaction } from "../utils/validation.js";
import { serializeFrameTransactionRlp } from "../utils/encoding.js";

/**
 * Serializes a frame transaction as a type 0x06 envelope.
 *
 * Result: `0x06 || rlp([chain_id, nonce, sender, frames, ...])`
 *
 * Validates the transaction before serialization.
 *
 * @param tx - The frame transaction to serialize
 * @returns The serialized transaction as a hex string
 *
 * @example
 * import { serializeFrameTransaction } from '@wonderland/frame-transactions'
 *
 * const serialized = serializeFrameTransaction(signedTx)
 * // serialized starts with '0x06' (EIP-8141 type prefix)
 */
export function serializeFrameTransaction(tx: FrameTransaction): SerializedFrameTransaction {
    validateFrameTransaction(tx);
    return serializeFrameTransactionRlp(tx);
}
