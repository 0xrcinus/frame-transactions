import { describe, it, expect } from "vitest";
import type { Hex, Address } from "viem";
import { computeFrameSigHash } from "../../src/utils/sigHash.js";
import { FrameMode, ApprovalScope, buildMode } from "../../src/types/frame.js";
import type { FrameTransaction } from "../../src/types/frame.js";

function makeSimpleTx(): FrameTransaction {
    return {
        chainId: 1n,
        nonce: 0n,
        sender: "0x1111111111111111111111111111111111111111" as Address,
        frames: [
            {
                mode: buildMode(FrameMode.VERIFY, ApprovalScope.BOTH),
                target: null,
                gasLimit: 100000n,
                data: "0xdeadbeef" as Hex,
            },
            {
                mode: buildMode(FrameMode.SENDER),
                target: "0x2222222222222222222222222222222222222222" as Address,
                gasLimit: 200000n,
                data: "0xcafebabe" as Hex,
            },
        ],
        maxPriorityFeePerGas: 1000000000n,
        maxFeePerGas: 2000000000n,
        maxFeePerBlobGas: 0n,
        blobVersionedHashes: [],
    };
}

describe("computeFrameSigHash", () => {
    it("should return a 32-byte hex hash", () => {
        const tx = makeSimpleTx();
        const sigHash = computeFrameSigHash(tx);
        expect(sigHash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("should elide VERIFY frame data from hash", () => {
        const tx = makeSimpleTx();
        const sigHash1 = computeFrameSigHash(tx);

        // Change the VERIFY frame's data — sig hash should be the same
        const tx2 = {
            ...tx,
            frames: [
                { ...tx.frames[0]!, data: "0xffffffff" as Hex },
                tx.frames[1]!,
            ],
        };
        const sigHash2 = computeFrameSigHash(tx2);

        expect(sigHash1).toBe(sigHash2);
    });

    it("should NOT elide SENDER frame data from hash", () => {
        const tx = makeSimpleTx();
        const sigHash1 = computeFrameSigHash(tx);

        // Change the SENDER frame's data — sig hash should differ
        const tx2 = {
            ...tx,
            frames: [
                tx.frames[0]!,
                { ...tx.frames[1]!, data: "0xffffffff" as Hex },
            ],
        };
        const sigHash2 = computeFrameSigHash(tx2);

        expect(sigHash1).not.toBe(sigHash2);
    });

    it("should produce different hashes for different chain IDs", () => {
        const tx1 = makeSimpleTx();
        const tx2 = { ...tx1, chainId: 42n };

        expect(computeFrameSigHash(tx1)).not.toBe(computeFrameSigHash(tx2));
    });

    it("should produce different hashes for different nonces", () => {
        const tx1 = makeSimpleTx();
        const tx2 = { ...tx1, nonce: 1n };

        expect(computeFrameSigHash(tx1)).not.toBe(computeFrameSigHash(tx2));
    });

    it("should elide all VERIFY frames when multiple exist", () => {
        const tx: FrameTransaction = {
            ...makeSimpleTx(),
            frames: [
                {
                    mode: buildMode(FrameMode.VERIFY, ApprovalScope.EXECUTION),
                    target: null,
                    gasLimit: 100000n,
                    data: "0xaaaa" as Hex,
                },
                {
                    mode: buildMode(FrameMode.VERIFY, ApprovalScope.PAYMENT),
                    target: "0x3333333333333333333333333333333333333333" as Address,
                    gasLimit: 100000n,
                    data: "0xbbbb" as Hex,
                },
                {
                    mode: buildMode(FrameMode.SENDER),
                    target: "0x2222222222222222222222222222222222222222" as Address,
                    gasLimit: 200000n,
                    data: "0xcafebabe" as Hex,
                },
            ],
        };

        const sigHash1 = computeFrameSigHash(tx);

        // Change both VERIFY frames' data
        const tx2: FrameTransaction = {
            ...tx,
            frames: [
                { ...tx.frames[0]!, data: "0x1111" as Hex },
                { ...tx.frames[1]!, data: "0x2222" as Hex },
                tx.frames[2]!,
            ],
        };

        expect(computeFrameSigHash(tx2)).toBe(sigHash1);
    });
});
