import type { Hex } from "viem";
import type { FrameTransaction } from "../types/frame.js";
import { FrameMode, getExecutionMode } from "../types/frame.js";
import { InvalidFrameError } from "../errors/index.js";

/** Parameters for inserting data into a VERIFY frame */
export type InsertVerifyDataParameters = {
    /** Index of the VERIFY frame to update */
    frameIndex: number;
    /** The signature or verification data to insert */
    data: Hex;
};

/**
 * Inserts signature/verification data into a VERIFY frame.
 *
 * Returns a new frame transaction with the specified VERIFY frame's data
 * replaced. Does not mutate the original transaction.
 *
 * @param tx - The frame transaction
 * @param params - The frame index and data to insert
 * @returns A new frame transaction with the VERIFY data inserted
 */
export function insertVerifyData(
    tx: FrameTransaction,
    params: InsertVerifyDataParameters,
): FrameTransaction {
    const { frameIndex, data } = params;

    if (frameIndex < 0 || frameIndex >= tx.frames.length) {
        throw new InvalidFrameError(
            `Frame index ${frameIndex} is out of bounds (transaction has ${tx.frames.length} frames)`,
        );
    }

    const frame = tx.frames[frameIndex]!;
    if (getExecutionMode(frame.mode) !== FrameMode.VERIFY) {
        throw new InvalidFrameError(
            `Frame ${frameIndex} is not a VERIFY frame (mode=${frame.mode & 0xff})`,
        );
    }

    const newFrames = [...tx.frames];
    newFrames[frameIndex] = { ...frame, data };

    return { ...tx, frames: newFrames };
}
