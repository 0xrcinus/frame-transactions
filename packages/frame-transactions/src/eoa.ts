/**
 * EOA helpers for EIP-8141 frame transactions.
 *
 * EOAs with no deployed code get "default code" behavior:
 * - VERIFY mode: reads signature_type byte, then verifies (0x00 = ECDSA, 0x01 = P256)
 * - SENDER mode: reads frame.data as RLP-encoded [[target, value, data], ...]
 */

import {
    type Hex,
    type Address,
    concatHex,
    toRlp,
    numberToHex,
} from "viem";
import { sign } from "viem/accounts";
import type { FrameTransaction } from "./types/frame.js";
import { FrameMode, getExecutionMode } from "./types/frame.js";
import { InvalidFrameError } from "./errors/index.js";
import { computeFrameSigHash } from "./utils/sigHash.js";

/**
 * Encode an ECDSA signature for an EOA VERIFY frame.
 * Format: 0x00 (signature_type) + v (1 byte) + r (32 bytes) + s (32 bytes) = 66 bytes
 */
export function encodeEcdsaVerifyData(signature: {
    v: bigint;
    r: Hex;
    s: Hex;
}): Hex {
    const vByte = numberToHex(signature.v, { size: 1 });
    return concatHex(["0x00", vByte, signature.r, signature.s]);
}

/**
 * Encode calls for an EOA SENDER frame using default code.
 * Format: RLP([[target, value, data], ...])
 */
export function encodeEoaSenderData(
    calls: { target: Address; value: bigint; data: Hex }[],
): Hex {
    const encoded = calls.map((call) => [
        call.target as Hex,
        call.value === 0n ? ("0x" as Hex) : numberToHex(call.value),
        call.data,
    ]);
    return toRlp(encoded as Hex[][]);
}

/**
 * Sign a frame transaction's VERIFY frame with an ECDSA private key.
 *
 * Computes the sig hash (with VERIFY data elided), signs it with raw ECDSA
 * (no EIP-191 prefix — EOA default code uses raw ecrecover), and inserts the
 * encoded signature into the specified VERIFY frame.
 *
 * @param tx - The frame transaction (VERIFY frame data can be empty placeholder)
 * @param privateKey - The ECDSA private key
 * @param verifyFrameIndex - Index of the VERIFY frame to sign (default: 0)
 * @returns A new frame transaction with the VERIFY frame data filled in
 */
export async function signEoaVerifyFrame(
    tx: FrameTransaction,
    privateKey: Hex,
    verifyFrameIndex: number = 0,
): Promise<FrameTransaction> {
    if (verifyFrameIndex < 0 || verifyFrameIndex >= tx.frames.length) {
        throw new InvalidFrameError(
            `Frame index ${verifyFrameIndex} is out of bounds (transaction has ${tx.frames.length} frames)`,
        );
    }

    const frame = tx.frames[verifyFrameIndex]!;
    if (getExecutionMode(frame.mode) !== FrameMode.VERIFY) {
        throw new InvalidFrameError(
            `Frame ${verifyFrameIndex} is not a VERIFY frame (mode=${frame.mode & 0xff})`,
        );
    }

    const sigHash = computeFrameSigHash(tx);
    const sig = await sign({ hash: sigHash, privateKey });

    const verifyData = encodeEcdsaVerifyData({
        v: sig.v ?? 27n,
        r: sig.r,
        s: sig.s,
    });

    const newFrames = [...tx.frames];
    newFrames[verifyFrameIndex] = {
        ...newFrames[verifyFrameIndex]!,
        data: verifyData,
    };

    return { ...tx, frames: newFrames };
}
