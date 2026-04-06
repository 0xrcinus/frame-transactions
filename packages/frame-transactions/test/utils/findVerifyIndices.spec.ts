import { describe, it, expect } from "vitest";
import { findVerifyIndices } from "../../src/utils/findVerifyIndices.js";
import { FrameMode, ApprovalScope, buildMode } from "../../src/types/frame.js";

describe("findVerifyIndices", () => {
    it("should find single VERIFY frame (self-pay)", () => {
        const frames = [
            { mode: buildMode(FrameMode.VERIFY, ApprovalScope.BOTH) },
            { mode: buildMode(FrameMode.SENDER) },
        ];
        const result = findVerifyIndices(frames);
        expect(result.senderVerifyIndex).toBe(0);
        expect(result.payerVerifyIndex).toBeUndefined();
    });

    it("should find both VERIFY frames (sponsored)", () => {
        const frames = [
            { mode: buildMode(FrameMode.VERIFY, ApprovalScope.EXECUTION) },
            { mode: buildMode(FrameMode.VERIFY, ApprovalScope.PAYMENT) },
            { mode: buildMode(FrameMode.SENDER) },
        ];
        const result = findVerifyIndices(frames);
        expect(result.senderVerifyIndex).toBe(0);
        expect(result.payerVerifyIndex).toBe(1);
    });

    it("should account for deploy frame offset", () => {
        const frames = [
            { mode: buildMode(FrameMode.DEFAULT) },
            { mode: buildMode(FrameMode.VERIFY, ApprovalScope.BOTH) },
            { mode: buildMode(FrameMode.SENDER) },
        ];
        const result = findVerifyIndices(frames);
        expect(result.senderVerifyIndex).toBe(1);
        expect(result.payerVerifyIndex).toBeUndefined();
    });

    it("should return -1 for senderVerifyIndex when no VERIFY frames exist", () => {
        const frames = [
            { mode: buildMode(FrameMode.SENDER) },
            { mode: buildMode(FrameMode.SENDER) },
        ];
        const result = findVerifyIndices(frames);
        expect(result.senderVerifyIndex).toBe(-1);
        expect(result.payerVerifyIndex).toBeUndefined();
    });

    it("should handle empty frames array", () => {
        const result = findVerifyIndices([]);
        expect(result.senderVerifyIndex).toBe(-1);
        expect(result.payerVerifyIndex).toBeUndefined();
    });

    it("should only return first two VERIFY indices", () => {
        const frames = [
            { mode: buildMode(FrameMode.VERIFY) },
            { mode: buildMode(FrameMode.VERIFY) },
            { mode: buildMode(FrameMode.VERIFY) },
        ];
        const result = findVerifyIndices(frames);
        expect(result.senderVerifyIndex).toBe(0);
        expect(result.payerVerifyIndex).toBe(1);
        // Third VERIFY is ignored — only sender + payer are tracked
    });
});
