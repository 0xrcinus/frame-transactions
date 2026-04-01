import { describe, it, expect } from "vitest";
import type { Hex, Address } from "viem";
import { buildFrameTransaction } from "../../src/actions/buildFrameTransaction.js";
import {
    FrameMode,
    ApprovalScope,
    getExecutionMode,
    getApprovalScope,
    hasAtomicBatchFlag,
} from "../../src/types/frame.js";

const sender = "0x1111111111111111111111111111111111111111" as Address;
const erc20 = "0x2222222222222222222222222222222222222222" as Address;
const dex = "0x3333333333333333333333333333333333333333" as Address;
const paymaster = "0x4444444444444444444444444444444444444444" as Address;
const deployer = "0x5555555555555555555555555555555555555555" as Address;

const baseCalls = [
    { target: erc20, data: "0xaa" as Hex, gasLimit: 100000n },
    { target: dex, data: "0xbb" as Hex, gasLimit: 200000n },
];

const baseParams = {
    chainId: 1n,
    nonce: 0n,
    sender,
    calls: baseCalls,
    maxPriorityFeePerGas: 1000000000n,
    maxFeePerGas: 2000000000n,
};

describe("buildFrameTransaction", () => {
    describe("self-pay (no paymaster)", () => {
        it("should prepend a single VERIFY frame with scope BOTH", () => {
            const tx = buildFrameTransaction(baseParams);

            expect(tx.frames.length).toBe(3); // 1 VERIFY + 2 SENDER
            const verifyFrame = tx.frames[0]!;
            expect(getExecutionMode(verifyFrame.mode)).toBe(FrameMode.VERIFY);
            expect(getApprovalScope(verifyFrame.mode)).toBe(ApprovalScope.BOTH);
        });

        it("should set VERIFY frame target to null (defaults to sender)", () => {
            const tx = buildFrameTransaction(baseParams);
            expect(tx.frames[0]!.target).toBeNull();
        });

        it("should create SENDER frames from calls", () => {
            const tx = buildFrameTransaction(baseParams);

            expect(getExecutionMode(tx.frames[1]!.mode)).toBe(FrameMode.SENDER);
            expect(tx.frames[1]!.target).toBe(erc20);
            expect(tx.frames[1]!.data).toBe("0xaa");

            expect(getExecutionMode(tx.frames[2]!.mode)).toBe(FrameMode.SENDER);
            expect(tx.frames[2]!.target).toBe(dex);
            expect(tx.frames[2]!.data).toBe("0xbb");
        });

        it("should set VERIFY frame data to empty placeholder", () => {
            const tx = buildFrameTransaction(baseParams);
            expect(tx.frames[0]!.data).toBe("0x");
        });
    });

    describe("sponsored (with paymaster)", () => {
        it("should prepend two VERIFY frames", () => {
            const tx = buildFrameTransaction({ ...baseParams, paymaster });

            expect(tx.frames.length).toBe(4); // 2 VERIFY + 2 SENDER
        });

        it("should set first VERIFY frame scope to EXECUTION", () => {
            const tx = buildFrameTransaction({ ...baseParams, paymaster });
            const senderVerify = tx.frames[0]!;

            expect(getExecutionMode(senderVerify.mode)).toBe(FrameMode.VERIFY);
            expect(getApprovalScope(senderVerify.mode)).toBe(ApprovalScope.EXECUTION);
            expect(senderVerify.target).toBeNull();
        });

        it("should set second VERIFY frame scope to PAYMENT with paymaster target", () => {
            const tx = buildFrameTransaction({ ...baseParams, paymaster });
            const payerVerify = tx.frames[1]!;

            expect(getExecutionMode(payerVerify.mode)).toBe(FrameMode.VERIFY);
            expect(getApprovalScope(payerVerify.mode)).toBe(ApprovalScope.PAYMENT);
            expect(payerVerify.target).toBe(paymaster);
        });
    });

    describe("with deploy frame", () => {
        it("should prepend DEFAULT deploy frame before VERIFY", () => {
            const tx = buildFrameTransaction({
                ...baseParams,
                deploy: { target: deployer, data: "0xde9101" as Hex, gasLimit: 500000n },
            });

            expect(tx.frames.length).toBe(4); // 1 DEFAULT + 1 VERIFY + 2 SENDER
            expect(getExecutionMode(tx.frames[0]!.mode)).toBe(FrameMode.DEFAULT);
            expect(tx.frames[0]!.target).toBe(deployer);
            expect(getExecutionMode(tx.frames[1]!.mode)).toBe(FrameMode.VERIFY);
        });

        it("should prepend DEFAULT before both VERIFY frames with paymaster", () => {
            const tx = buildFrameTransaction({
                ...baseParams,
                paymaster,
                deploy: { target: deployer, data: "0xde9101" as Hex, gasLimit: 500000n },
            });

            expect(tx.frames.length).toBe(5); // 1 DEFAULT + 2 VERIFY + 2 SENDER
            expect(getExecutionMode(tx.frames[0]!.mode)).toBe(FrameMode.DEFAULT);
            expect(getExecutionMode(tx.frames[1]!.mode)).toBe(FrameMode.VERIFY);
            expect(getExecutionMode(tx.frames[2]!.mode)).toBe(FrameMode.VERIFY);
        });
    });

    describe("atomic batching", () => {
        it("should set atomic batch flag on calls with atomicBatch: true", () => {
            const tx = buildFrameTransaction({
                ...baseParams,
                calls: [
                    { target: erc20, data: "0xaa" as Hex, gasLimit: 100000n, atomicBatch: true },
                    { target: dex, data: "0xbb" as Hex, gasLimit: 200000n },
                ],
            });

            // frames[0] is VERIFY, frames[1] and [2] are SENDER
            expect(hasAtomicBatchFlag(tx.frames[1]!.mode)).toBe(true);
            expect(hasAtomicBatchFlag(tx.frames[2]!.mode)).toBe(false);
        });
    });

    describe("transaction fields", () => {
        it("should pass through gas parameters", () => {
            const tx = buildFrameTransaction(baseParams);
            expect(tx.maxPriorityFeePerGas).toBe(1000000000n);
            expect(tx.maxFeePerGas).toBe(2000000000n);
            expect(tx.maxFeePerBlobGas).toBe(0n);
            expect(tx.blobVersionedHashes).toEqual([]);
        });

        it("should pass through chain ID and nonce", () => {
            const tx = buildFrameTransaction(baseParams);
            expect(tx.chainId).toBe(1n);
            expect(tx.nonce).toBe(0n);
        });
    });
});
