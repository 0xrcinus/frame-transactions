import { describe, it, expect } from "vitest";
import type { Hex, Address } from "viem";
import { validateFrameTransaction } from "../../src/utils/validation.js";
import { FrameMode, ApprovalScope, buildMode, MAX_FRAMES } from "../../src/types/frame.js";
import type { Frame, FrameTransaction } from "../../src/types/frame.js";

const sender = "0x1111111111111111111111111111111111111111" as Address;
const target = "0x2222222222222222222222222222222222222222" as Address;

function makeTx(frames: Frame[], overrides?: Partial<FrameTransaction>): FrameTransaction {
    return {
        chainId: 1n,
        nonce: 0n,
        sender,
        frames,
        maxPriorityFeePerGas: 0n,
        maxFeePerGas: 0n,
        maxFeePerBlobGas: 0n,
        blobVersionedHashes: [],
        ...overrides,
    };
}

function makeFrame(mode: number, frameTarget: Address | null = target): Frame {
    return { mode, target: frameTarget, gasLimit: 100000n, data: "0x" as Hex };
}

describe("EIP-8141 frame validation (static constraints)", () => {
    // Spec: assert len(tx.frames) > 0 and len(tx.frames) <= MAX_FRAMES
    describe("frame count", () => {
        it("should reject empty frames", () => {
            expect(() => validateFrameTransaction(makeTx([]))).toThrow(
                "Frame count must be between 1",
            );
        });

        it("should accept 1 frame", () => {
            expect(() =>
                validateFrameTransaction(makeTx([makeFrame(buildMode(FrameMode.VERIFY))])),
            ).not.toThrow();
        });

        it("should accept MAX_FRAMES frames", () => {
            const frames = Array.from({ length: MAX_FRAMES }, () =>
                makeFrame(buildMode(FrameMode.SENDER)),
            );
            expect(() => validateFrameTransaction(makeTx(frames))).not.toThrow();
        });

        it("should reject more than MAX_FRAMES frames", () => {
            const frames = Array.from({ length: MAX_FRAMES + 1 }, () =>
                makeFrame(buildMode(FrameMode.SENDER)),
            );
            expect(() => validateFrameTransaction(makeTx(frames))).toThrow(
                "Frame count must be between 1",
            );
        });
    });

    // Spec: assert tx.nonce < 2**64
    describe("nonce", () => {
        it("should accept nonce < 2^64", () => {
            expect(() =>
                validateFrameTransaction(
                    makeTx([makeFrame(buildMode(FrameMode.VERIFY))], { nonce: 2n ** 64n - 1n }),
                ),
            ).not.toThrow();
        });

        it("should reject nonce >= 2^64", () => {
            expect(() =>
                validateFrameTransaction(
                    makeTx([makeFrame(buildMode(FrameMode.VERIFY))], { nonce: 2n ** 64n }),
                ),
            ).toThrow("Nonce must be less than 2^64");
        });
    });

    // Spec: assert (tx.frames[n].mode & 0xFF) < 3
    describe("execution mode", () => {
        it("should accept DEFAULT mode (0)", () => {
            expect(() =>
                validateFrameTransaction(makeTx([makeFrame(buildMode(FrameMode.DEFAULT))])),
            ).not.toThrow();
        });

        it("should accept VERIFY mode (1)", () => {
            expect(() =>
                validateFrameTransaction(makeTx([makeFrame(buildMode(FrameMode.VERIFY))])),
            ).not.toThrow();
        });

        it("should accept SENDER mode (2)", () => {
            expect(() =>
                validateFrameTransaction(makeTx([makeFrame(buildMode(FrameMode.SENDER))])),
            ).not.toThrow();
        });

        it("should reject mode >= 3", () => {
            expect(() =>
                validateFrameTransaction(makeTx([makeFrame(3)])),
            ).toThrow("invalid execution mode");
        });
    });

    // Spec: atomic batch flag (bit 11) is only valid with SENDER mode,
    // and next frame must also be SENDER
    describe("atomic batch flag", () => {
        it("should accept atomic batch on SENDER followed by SENDER", () => {
            const frames = [
                makeFrame(buildMode(FrameMode.SENDER, ApprovalScope.ANY, true)),
                makeFrame(buildMode(FrameMode.SENDER)),
            ];
            expect(() => validateFrameTransaction(makeTx(frames))).not.toThrow();
        });

        it("should reject atomic batch on non-SENDER mode", () => {
            // Atomic batch on VERIFY mode
            const mode = buildMode(FrameMode.VERIFY, ApprovalScope.ANY, true);
            const frames = [makeFrame(mode), makeFrame(buildMode(FrameMode.SENDER))];
            expect(() => validateFrameTransaction(makeTx(frames))).toThrow(
                "atomic batch flag (bit 11) is only valid with SENDER mode",
            );
        });

        it("should reject atomic batch on last frame", () => {
            const frames = [makeFrame(buildMode(FrameMode.SENDER, ApprovalScope.ANY, true))];
            expect(() => validateFrameTransaction(makeTx(frames))).toThrow(
                "atomic batch flag set but this is the last frame",
            );
        });

        it("should reject atomic batch when next frame is not SENDER", () => {
            const frames = [
                makeFrame(buildMode(FrameMode.SENDER, ApprovalScope.ANY, true)),
                makeFrame(buildMode(FrameMode.DEFAULT)),
            ];
            expect(() => validateFrameTransaction(makeTx(frames))).toThrow(
                "next frame is not SENDER mode",
            );
        });

        it("should accept chained atomic batches", () => {
            // Frames 0-1 form one batch, frames 2-3 form another
            const frames = [
                makeFrame(buildMode(FrameMode.SENDER, ApprovalScope.ANY, true)),
                makeFrame(buildMode(FrameMode.SENDER)),
                makeFrame(buildMode(FrameMode.SENDER, ApprovalScope.ANY, true)),
                makeFrame(buildMode(FrameMode.SENDER, ApprovalScope.ANY, true)),
                makeFrame(buildMode(FrameMode.SENDER)),
            ];
            expect(() => validateFrameTransaction(makeTx(frames))).not.toThrow();
        });
    });
});
