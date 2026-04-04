import { describe, it, expect } from "vitest";
import type { Hex, Address } from "viem";
import {
    buildFrameTransaction,
    FrameMode,
    ApprovalScope,
    getExecutionMode,
    getApprovalScope,
} from "../../src/index.js";

const sender = "0x1111111111111111111111111111111111111111" as Address;
const target = "0x2222222222222222222222222222222222222222" as Address;
const paymaster = "0x3333333333333333333333333333333333333333" as Address;
const deployer = "0x4444444444444444444444444444444444444444" as Address;

const baseCall = { target, data: "0xaa" as Hex, gasLimit: 100000n };
const baseGas = {
    maxPriorityFeePerGas: 1000000000n,
    maxFeePerGas: 2000000000n,
};

describe("EIP-8141 validation prefixes", () => {
    // Spec: Self-relay = verify(scope=0x3) → sender frames
    describe("self-relay", () => {
        it("should produce [verify(scope=0x3), sender(...)]", () => {
            const tx = buildFrameTransaction({
                chainId: 1n,
                nonce: 0n,
                sender,
                calls: [baseCall],
                ...baseGas,
            });

            expect(tx.frames.length).toBe(2);

            // Frame 0: verify with scope BOTH
            expect(getExecutionMode(tx.frames[0]!.mode)).toBe(FrameMode.VERIFY);
            expect(getApprovalScope(tx.frames[0]!.mode)).toBe(ApprovalScope.BOTH);
            expect(tx.frames[0]!.target).toBeNull(); // null = sender

            // Frame 1: sender
            expect(getExecutionMode(tx.frames[1]!.mode)).toBe(FrameMode.SENDER);
        });
    });

    // Spec: Self-relay + deploy = deploy → verify(scope=0x3) → sender frames
    describe("self-relay + deploy", () => {
        it("should produce [deploy, verify(scope=0x3), sender(...)]", () => {
            const tx = buildFrameTransaction({
                chainId: 1n,
                nonce: 0n,
                sender,
                calls: [baseCall],
                deploy: { target: deployer, data: "0xde9101" as Hex, gasLimit: 500000n },
                ...baseGas,
            });

            expect(tx.frames.length).toBe(3);

            // Frame 0: deploy (DEFAULT)
            expect(getExecutionMode(tx.frames[0]!.mode)).toBe(FrameMode.DEFAULT);
            expect(tx.frames[0]!.target).toBe(deployer);

            // Frame 1: verify with scope BOTH
            expect(getExecutionMode(tx.frames[1]!.mode)).toBe(FrameMode.VERIFY);
            expect(getApprovalScope(tx.frames[1]!.mode)).toBe(ApprovalScope.BOTH);

            // Frame 2: sender
            expect(getExecutionMode(tx.frames[2]!.mode)).toBe(FrameMode.SENDER);
        });
    });

    // Spec: Paymaster = verify(scope=0x1) → pay(scope=0x2) → sender frames
    describe("paymaster", () => {
        it("should produce [verify(scope=0x1), pay(scope=0x2), sender(...)]", () => {
            const tx = buildFrameTransaction({
                chainId: 1n,
                nonce: 0n,
                sender,
                calls: [baseCall],
                paymaster,
                ...baseGas,
            });

            expect(tx.frames.length).toBe(3);

            // Frame 0: sender verify (execution only)
            expect(getExecutionMode(tx.frames[0]!.mode)).toBe(FrameMode.VERIFY);
            expect(getApprovalScope(tx.frames[0]!.mode)).toBe(ApprovalScope.EXECUTION);
            expect(tx.frames[0]!.target).toBeNull(); // null = sender

            // Frame 1: payer verify (payment only)
            expect(getExecutionMode(tx.frames[1]!.mode)).toBe(FrameMode.VERIFY);
            expect(getApprovalScope(tx.frames[1]!.mode)).toBe(ApprovalScope.PAYMENT);
            expect(tx.frames[1]!.target).toBe(paymaster);

            // Frame 2: sender
            expect(getExecutionMode(tx.frames[2]!.mode)).toBe(FrameMode.SENDER);
        });
    });

    // Spec: Paymaster + deploy = deploy → verify(scope=0x1) → pay(scope=0x2) → sender frames
    describe("paymaster + deploy", () => {
        it("should produce [deploy, verify(scope=0x1), pay(scope=0x2), sender(...)]", () => {
            const tx = buildFrameTransaction({
                chainId: 1n,
                nonce: 0n,
                sender,
                calls: [baseCall],
                paymaster,
                deploy: { target: deployer, data: "0xde9101" as Hex, gasLimit: 500000n },
                ...baseGas,
            });

            expect(tx.frames.length).toBe(4);

            // Frame 0: deploy (DEFAULT)
            expect(getExecutionMode(tx.frames[0]!.mode)).toBe(FrameMode.DEFAULT);

            // Frame 1: sender verify (execution only)
            expect(getExecutionMode(tx.frames[1]!.mode)).toBe(FrameMode.VERIFY);
            expect(getApprovalScope(tx.frames[1]!.mode)).toBe(ApprovalScope.EXECUTION);

            // Frame 2: payer verify (payment only)
            expect(getExecutionMode(tx.frames[2]!.mode)).toBe(FrameMode.VERIFY);
            expect(getApprovalScope(tx.frames[2]!.mode)).toBe(ApprovalScope.PAYMENT);

            // Frame 3: sender
            expect(getExecutionMode(tx.frames[3]!.mode)).toBe(FrameMode.SENDER);
        });
    });
});
