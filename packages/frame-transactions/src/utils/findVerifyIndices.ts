import { FrameMode, getExecutionMode } from "../types/frame.js";

/**
 * Finds the indices of VERIFY frames in a frame list.
 *
 * Returns the first VERIFY frame index as `senderVerifyIndex` and the second
 * (if present) as `payerVerifyIndex`. Useful for inspecting deserialized
 * transactions or for test assertions.
 *
 * @param frames - Array of frames (or any objects with a `mode` field)
 * @returns The sender and optional payer VERIFY frame indices
 */
export function findVerifyIndices(frames: readonly { mode: number }[]): {
    senderVerifyIndex: number;
    payerVerifyIndex: number | undefined;
} {
    let senderVerifyIndex = -1;
    let payerVerifyIndex: number | undefined;

    for (let i = 0; i < frames.length; i++) {
        if (getExecutionMode(frames[i]!.mode) === FrameMode.VERIFY) {
            if (senderVerifyIndex === -1) {
                senderVerifyIndex = i;
            } else if (payerVerifyIndex === undefined) {
                payerVerifyIndex = i;
            }
        }
    }

    return { senderVerifyIndex, payerVerifyIndex };
}
