import { isAddress } from "viem";
import type { Frame, FrameTransaction } from "../types/frame.js";
import {
    FrameMode,
    MAX_FRAMES,
    getExecutionMode,
    hasAtomicBatchFlag,
} from "../types/frame.js";
import { InvalidFrameError } from "../errors/index.js";

/**
 * Validates a frame transaction against EIP-8141 static constraints.
 *
 * Checks:
 * - chain_id < 2^256
 * - nonce < 2^64
 * - frame count between 1 and MAX_FRAMES
 * - sender is 20 bytes
 * - mode is valid (0, 1, or 2)
 * - target is 20 bytes or null
 * - atomic batch flag only valid with SENDER mode, and next frame must also be SENDER
 *
 * @param tx - The frame transaction to validate
 * @throws InvalidFrameError if validation fails
 */
export function validateFrameTransaction(tx: FrameTransaction): void {
    if (tx.nonce >= 2n ** 64n) {
        throw new InvalidFrameError(`Nonce must be less than 2^64, got ${tx.nonce}`);
    }

    if (tx.chainId >= 2n ** 256n) {
        throw new InvalidFrameError(`Chain ID must be less than 2^256, got ${tx.chainId}`);
    }

    if (tx.frames.length === 0 || tx.frames.length > MAX_FRAMES) {
        throw new InvalidFrameError(
            `Frame count must be between 1 and ${MAX_FRAMES}, got ${tx.frames.length}`,
        );
    }

    for (let i = 0; i < tx.frames.length; i++) {
        const frame = tx.frames[i]!;
        validateFrame(frame, i, tx.frames);
    }
}

function validateFrame(frame: Frame, index: number, allFrames: Frame[]): void {
    const executionMode = getExecutionMode(frame.mode);

    if (executionMode > FrameMode.SENDER) {
        throw new InvalidFrameError(
            `Frame ${index}: invalid execution mode ${executionMode}, must be 0 (DEFAULT), 1 (VERIFY), or 2 (SENDER)`,
        );
    }

    if (frame.target !== null && !isAddress(frame.target)) {
        throw new InvalidFrameError(`Frame ${index}: target must be a valid address or null`, {
            details: `Got "${frame.target}"`,
        });
    }

    if (hasAtomicBatchFlag(frame.mode)) {
        if (executionMode !== FrameMode.SENDER) {
            throw new InvalidFrameError(
                `Frame ${index}: atomic batch flag (bit 11) is only valid with SENDER mode`,
            );
        }
        if (index + 1 >= allFrames.length) {
            throw new InvalidFrameError(
                `Frame ${index}: atomic batch flag set but this is the last frame`,
            );
        }
        const nextMode = getExecutionMode(allFrames[index + 1]!.mode);
        if (nextMode !== FrameMode.SENDER) {
            throw new InvalidFrameError(
                `Frame ${index}: atomic batch flag set but next frame is not SENDER mode`,
            );
        }
    }
}
