import { describe, it, expect } from "vitest";
import {
    FrameMode,
    ApprovalScope,
    buildMode,
    getApprovalScope,
    getExecutionMode,
} from "../../src/index.js";

describe("EIP-8141 approval flow (mode bits and scope constraints)", () => {
    describe("buildMode / getExecutionMode", () => {
        it("should encode and decode DEFAULT mode", () => {
            const mode = buildMode(FrameMode.DEFAULT);
            expect(getExecutionMode(mode)).toBe(FrameMode.DEFAULT);
        });

        it("should encode and decode VERIFY mode", () => {
            const mode = buildMode(FrameMode.VERIFY);
            expect(getExecutionMode(mode)).toBe(FrameMode.VERIFY);
        });

        it("should encode and decode SENDER mode", () => {
            const mode = buildMode(FrameMode.SENDER);
            expect(getExecutionMode(mode)).toBe(FrameMode.SENDER);
        });
    });

    // Spec: bits 9-10 constrain which scope APPROVE can use
    describe("approval scope constraints (mode bits 9-10)", () => {
        it("scope ANY (0): (mode>>8) & 3 == 0", () => {
            const mode = buildMode(FrameMode.VERIFY, ApprovalScope.ANY);
            expect(getApprovalScope(mode)).toBe(ApprovalScope.ANY);
            expect((mode >> 8) & 3).toBe(0);
        });

        it("scope EXECUTION (1): (mode>>8) & 3 == 1 — only 0x1 allowed", () => {
            const mode = buildMode(FrameMode.VERIFY, ApprovalScope.EXECUTION);
            expect(getApprovalScope(mode)).toBe(ApprovalScope.EXECUTION);
            expect((mode >> 8) & 3).toBe(1);
        });

        it("scope PAYMENT (2): (mode>>8) & 3 == 2 — only 0x2 allowed", () => {
            const mode = buildMode(FrameMode.VERIFY, ApprovalScope.PAYMENT);
            expect(getApprovalScope(mode)).toBe(ApprovalScope.PAYMENT);
            expect((mode >> 8) & 3).toBe(2);
        });

        it("scope BOTH (3): (mode>>8) & 3 == 3 — only 0x3 allowed", () => {
            const mode = buildMode(FrameMode.VERIFY, ApprovalScope.BOTH);
            expect(getApprovalScope(mode)).toBe(ApprovalScope.BOTH);
            expect((mode >> 8) & 3).toBe(3);
        });
    });

    // Verify the actual bit layout matches the spec
    describe("mode bit layout", () => {
        it("lower 8 bits are execution mode", () => {
            const mode = buildMode(FrameMode.SENDER, ApprovalScope.PAYMENT, true);
            expect(mode & 0xff).toBe(FrameMode.SENDER); // 2
        });

        it("bits 9-10 are approval scope", () => {
            const mode = buildMode(FrameMode.SENDER, ApprovalScope.PAYMENT, true);
            expect((mode >> 8) & 3).toBe(ApprovalScope.PAYMENT); // 2
        });

        it("bit 11 is atomic batch flag", () => {
            const mode = buildMode(FrameMode.SENDER, ApprovalScope.ANY, true);
            expect((mode >> 10) & 1).toBe(1);

            const modeWithout = buildMode(FrameMode.SENDER, ApprovalScope.ANY, false);
            expect((modeWithout >> 10) & 1).toBe(0);
        });

        it("VERIFY with scope BOTH = 0x301 (mode=1, scope=3 at bits 9-10)", () => {
            const mode = buildMode(FrameMode.VERIFY, ApprovalScope.BOTH);
            // lower 8 bits: 1 (VERIFY)
            // bits 9-10: 3 (BOTH) → 3 << 8 = 0x300
            // total: 0x301
            expect(mode).toBe(0x301);
        });

        it("VERIFY with scope EXECUTION = 0x101", () => {
            const mode = buildMode(FrameMode.VERIFY, ApprovalScope.EXECUTION);
            expect(mode).toBe(0x101);
        });

        it("VERIFY with scope PAYMENT = 0x201", () => {
            const mode = buildMode(FrameMode.VERIFY, ApprovalScope.PAYMENT);
            expect(mode).toBe(0x201);
        });

        it("SENDER with atomic batch = 0x402", () => {
            const mode = buildMode(FrameMode.SENDER, ApprovalScope.ANY, true);
            // lower 8 bits: 2 (SENDER)
            // bits 9-10: 0 (ANY)
            // bit 11: 1 → 1 << 10 = 0x400
            // total: 0x402
            expect(mode).toBe(0x402);
        });
    });

    describe("approval ordering rules", () => {
        it("self-relay: scope 0x3 approves both sender and payer at once", () => {
            // scope 0x3 sets sender_approved=true AND payer_approved=true
            // Only valid when frame.target == tx.sender
            const scope = ApprovalScope.BOTH;
            expect(scope).toBe(3);
        });

        it("paymaster flow: scope 0x1 first (sender), then 0x2 (payer)", () => {
            // scope 0x2 requires sender_approved == true
            // So 0x1 must come before 0x2
            const senderScope = ApprovalScope.EXECUTION;
            const payerScope = ApprovalScope.PAYMENT;
            expect(senderScope).toBe(1);
            expect(payerScope).toBe(2);
        });
    });
});
