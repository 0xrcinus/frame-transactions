import type { Hex } from "viem";
import { keccak256, concatHex, numberToHex } from "viem";
import type { FrameTransaction } from "../types/frame.js";
import { FrameMode, FRAME_TX_TYPE, getExecutionMode } from "../types/frame.js";
import { encodeFrameTransactionPayload } from "./encoding.js";

/**
 * Computes the canonical signature hash for a frame transaction.
 *
 * Per EIP-8141/EIP-2718, VERIFY frame data is elided (set to empty bytes)
 * before computing keccak256(0x06 || rlp(tx)).
 *
 * @param tx - The frame transaction
 * @returns The signature hash
 */
export function computeFrameSigHash(tx: FrameTransaction): Hex {
    const elided: FrameTransaction = {
        ...tx,
        frames: tx.frames.map((frame) => {
            if (getExecutionMode(frame.mode) === FrameMode.VERIFY) {
                return { ...frame, data: "0x" as Hex };
            }
            return frame;
        }),
    };

    const rlpPayload = encodeFrameTransactionPayload(elided);
    return keccak256(concatHex([numberToHex(FRAME_TX_TYPE, { size: 1 }), rlpPayload]));
}
