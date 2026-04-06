import {
    type Hex,
    type Address,
    toRlp,
    fromRlp,
    numberToHex,
    hexToBigInt,
    concatHex,
    keccak256,
} from "viem";
import type { Frame, FrameTransaction } from "../types/frame.js";
import { FRAME_TX_TYPE } from "../types/frame.js";
import { SerializationError } from "../errors/index.js";

/** Recursive array type matching viem's toRlp input */
type RlpInput = Hex | readonly RlpInput[];

/** Encode a bigint for RLP: 0n becomes "0x" (empty bytes), nonzero uses numberToHex */
function rlpBigInt(value: bigint): Hex {
    return value === 0n ? ("0x" as Hex) : numberToHex(value);
}

/** Decode an RLP hex value to bigint: "0x" (empty) → 0n */
function rlpToBigInt(hex: Hex): bigint {
    if (!hex || hex === "0x") return 0n;
    return hexToBigInt(hex);
}

/**
 * Encodes a single frame as an RLP-compatible tuple.
 * Frame: [mode, target, gas_limit, data]
 */
function encodeFrame(frame: Frame): Hex[] {
    return [
        rlpBigInt(BigInt(frame.mode)),
        // null target encodes as "0x" (empty bytes) in RLP, representing
        // "default to tx.sender". Decoded back to null in deserializeFrameTransaction.
        frame.target ?? "0x",
        rlpBigInt(frame.gasLimit),
        frame.data,
    ];
}

/**
 * Encodes a frame transaction to its RLP payload (without the type prefix).
 *
 * Payload: [chain_id, nonce, sender, frames, max_priority_fee_per_gas,
 *           max_fee_per_gas, max_fee_per_blob_gas, blob_versioned_hashes]
 */
export function encodeFrameTransactionPayload(tx: FrameTransaction): Hex {
    const encodedFrames = tx.frames.map(encodeFrame);

    const fields: RlpInput[] = [
        rlpBigInt(tx.chainId),
        rlpBigInt(tx.nonce),
        tx.sender,
        encodedFrames,
        rlpBigInt(tx.maxPriorityFeePerGas),
        rlpBigInt(tx.maxFeePerGas),
        rlpBigInt(tx.maxFeePerBlobGas),
        tx.blobVersionedHashes,
    ];

    return toRlp(fields);
}

/**
 * Serializes a frame transaction with the type 0x06 prefix.
 * Result: 0x06 || rlp([...])
 */
export function serializeFrameTransactionRlp(tx: FrameTransaction): Hex {
    const payload = encodeFrameTransactionPayload(tx);
    return concatHex([numberToHex(FRAME_TX_TYPE, { size: 1 }), payload]);
}

/**
 * Computes the transaction hash: keccak256(0x06 || rlp([...])).
 */
export function computeTxHash(tx: FrameTransaction): Hex {
    return keccak256(serializeFrameTransactionRlp(tx));
}

/**
 * Decodes a serialized frame transaction.
 * Expects: 0x06 || rlp([...])
 */
export function deserializeFrameTransaction(serialized: Hex): FrameTransaction {
    if (!serialized.startsWith("0x06")) {
        throw new SerializationError(
            `Expected frame transaction type 0x06, got 0x${serialized.slice(2, 4)}`,
        );
    }

    const rlpPayload = `0x${serialized.slice(4)}` as Hex;
    const decoded = fromRlp(rlpPayload, "hex");

    if (!Array.isArray(decoded) || decoded.length !== 8) {
        throw new SerializationError(
            `Expected 8 fields in frame transaction, got ${Array.isArray(decoded) ? decoded.length : "non-array"}`,
        );
    }

    const [
        chainIdHex,
        nonceHex,
        senderHex,
        framesRlp,
        maxPriorityFeePerGasHex,
        maxFeePerGasHex,
        maxFeePerBlobGasHex,
        blobVersionedHashesRlp,
    ] = decoded as [Hex, Hex, Hex, Hex[][], Hex, Hex, Hex, Hex[]];

    if (!Array.isArray(framesRlp)) {
        throw new SerializationError("Expected frames to be an array");
    }

    const frames: Frame[] = framesRlp.map((frameFields, i) => {
        if (!Array.isArray(frameFields) || frameFields.length !== 4) {
            throw new SerializationError(
                `Expected 4 fields in frame ${i}, got ${Array.isArray(frameFields) ? frameFields.length : "non-array"}`,
            );
        }
        const [modeHex, targetHex, gasLimitHex, data] = frameFields as [Hex, Hex, Hex, Hex];
        return {
            mode: Number(rlpToBigInt(modeHex)),
            target: targetHex === "0x" ? null : (targetHex as Address),
            gasLimit: rlpToBigInt(gasLimitHex),
            data: data || "0x",
        };
    });

    return {
        chainId: rlpToBigInt(chainIdHex),
        nonce: rlpToBigInt(nonceHex),
        sender: senderHex as Address,
        frames,
        maxPriorityFeePerGas: rlpToBigInt(maxPriorityFeePerGasHex),
        maxFeePerGas: rlpToBigInt(maxFeePerGasHex),
        maxFeePerBlobGas: rlpToBigInt(maxFeePerBlobGasHex),
        blobVersionedHashes: Array.isArray(blobVersionedHashesRlp)
            ? blobVersionedHashesRlp
            : [],
    };
}
