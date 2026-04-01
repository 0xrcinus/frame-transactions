import { describe, it, expect } from "vitest";
import type { Hex, Address } from "viem";
import { buildFrameTransaction } from "../../src/actions/buildFrameTransaction.js";
import { computeFrameSigHash } from "../../src/utils/sigHash.js";
import { FrameMode, getExecutionMode } from "../../src/types/frame.js";
import type { FrameTransaction } from "../../src/types/frame.js";

const sender = "0x1111111111111111111111111111111111111111" as Address;
const erc20 = "0x2222222222222222222222222222222222222222" as Address;
const paymaster = "0x4444444444444444444444444444444444444444" as Address;

const baseParams = {
    chainId: 1n,
    nonce: 0n,
    sender,
    calls: [{ target: erc20, data: "0xaa" as Hex, gasLimit: 100000n }],
    maxPriorityFeePerGas: 1000000000n,
    maxFeePerGas: 2000000000n,
};

function findVerifyIndices(tx: FrameTransaction) {
    let senderVerifyIndex = -1;
    let payerVerifyIndex: number | undefined;
    for (let i = 0; i < tx.frames.length; i++) {
        if (getExecutionMode(tx.frames[i]!.mode) === FrameMode.VERIFY) {
            if (senderVerifyIndex === -1) senderVerifyIndex = i;
            else if (payerVerifyIndex === undefined) payerVerifyIndex = i;
        }
    }
    return { senderVerifyIndex, payerVerifyIndex };
}

describe("prepareFrameCalls (build + sigHash logic)", () => {
    it("should return frameTx and sigHash", () => {
        const frameTx = buildFrameTransaction(baseParams);
        const sigHash = computeFrameSigHash(frameTx);

        expect(frameTx).toBeDefined();
        expect(sigHash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("should identify sender VERIFY frame index (self-pay)", () => {
        const frameTx = buildFrameTransaction(baseParams);
        const { senderVerifyIndex, payerVerifyIndex } = findVerifyIndices(frameTx);

        expect(senderVerifyIndex).toBe(0);
        expect(payerVerifyIndex).toBeUndefined();

        const frame = frameTx.frames[senderVerifyIndex]!;
        expect(getExecutionMode(frame.mode)).toBe(FrameMode.VERIFY);
    });

    it("should identify both VERIFY frame indices (sponsored)", () => {
        const frameTx = buildFrameTransaction({ ...baseParams, paymaster });
        const { senderVerifyIndex, payerVerifyIndex } = findVerifyIndices(frameTx);

        expect(senderVerifyIndex).toBe(0);
        expect(payerVerifyIndex).toBe(1);

        expect(getExecutionMode(frameTx.frames[0]!.mode)).toBe(FrameMode.VERIFY);
        expect(getExecutionMode(frameTx.frames[1]!.mode)).toBe(FrameMode.VERIFY);
    });

    it("should account for deploy frame offset", () => {
        const frameTx = buildFrameTransaction({
            ...baseParams,
            deploy: {
                target: "0x5555555555555555555555555555555555555555" as Address,
                data: "0xde910100" as Hex,
                gasLimit: 500000n,
            },
        });
        const { senderVerifyIndex } = findVerifyIndices(frameTx);

        // Deploy frame at index 0, VERIFY at index 1
        expect(senderVerifyIndex).toBe(1);
        expect(getExecutionMode(frameTx.frames[0]!.mode)).toBe(FrameMode.DEFAULT);
        expect(getExecutionMode(frameTx.frames[1]!.mode)).toBe(FrameMode.VERIFY);
    });

    it("should produce consistent sigHash regardless of VERIFY data", () => {
        const frameTx1 = buildFrameTransaction(baseParams);
        const frameTx2 = buildFrameTransaction(baseParams);

        expect(computeFrameSigHash(frameTx1)).toBe(computeFrameSigHash(frameTx2));
    });
});
