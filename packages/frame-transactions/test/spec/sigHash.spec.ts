import { describe, it, expect } from "vitest";
import type { Hex, Address } from "viem";
import { computeFrameSigHash } from "../../src/utils/sigHash.js";
import { FrameMode, ApprovalScope, buildMode } from "../../src/types/frame.js";
import type { FrameTransaction } from "../../src/types/frame.js";

const sender = "0x1111111111111111111111111111111111111111" as Address;
const target = "0x2222222222222222222222222222222222222222" as Address;
const paymaster = "0x3333333333333333333333333333333333333333" as Address;

describe("EIP-8141 signature hash computation", () => {
    // Spec: For the canonical signature hash, any frame with mode VERIFY
    // will have its data elided (set to empty bytes)
    describe("VERIFY data elision", () => {
        it("should elide VERIFY frame data in self-relay tx", () => {
            const tx: FrameTransaction = {
                chainId: 1n,
                nonce: 0n,
                sender,
                frames: [
                    {
                        mode: buildMode(FrameMode.VERIFY, ApprovalScope.BOTH),
                        target: null,
                        gasLimit: 100000n,
                        data: "0x" + "aa".repeat(65) as Hex, // 65-byte ECDSA signature
                    },
                    {
                        mode: buildMode(FrameMode.SENDER),
                        target,
                        gasLimit: 200000n,
                        data: "0xcafebabe" as Hex,
                    },
                ],
                maxPriorityFeePerGas: 1n,
                maxFeePerGas: 2n,
                maxFeePerBlobGas: 0n,
                blobVersionedHashes: [],
            };

            const hash1 = computeFrameSigHash(tx);

            // Different VERIFY data → same hash
            const tx2: FrameTransaction = {
                ...tx,
                frames: [
                    { ...tx.frames[0]!, data: "0x" + "bb".repeat(65) as Hex },
                    tx.frames[1]!,
                ],
            };

            expect(computeFrameSigHash(tx2)).toBe(hash1);
        });

        it("should elide both VERIFY frames in paymaster tx", () => {
            const tx: FrameTransaction = {
                chainId: 1n,
                nonce: 0n,
                sender,
                frames: [
                    {
                        mode: buildMode(FrameMode.VERIFY, ApprovalScope.EXECUTION),
                        target: null,
                        gasLimit: 100000n,
                        data: "0x5e0de5" as Hex,
                    },
                    {
                        mode: buildMode(FrameMode.VERIFY, ApprovalScope.PAYMENT),
                        target: paymaster,
                        gasLimit: 100000n,
                        data: "0x9a4e55" as Hex,
                    },
                    {
                        mode: buildMode(FrameMode.SENDER),
                        target,
                        gasLimit: 200000n,
                        data: "0xcafebabe" as Hex,
                    },
                ],
                maxPriorityFeePerGas: 1n,
                maxFeePerGas: 2n,
                maxFeePerBlobGas: 0n,
                blobVersionedHashes: [],
            };

            const hash1 = computeFrameSigHash(tx);

            // Change both VERIFY data
            const tx2: FrameTransaction = {
                ...tx,
                frames: [
                    { ...tx.frames[0]!, data: "0xd1ff01" as Hex },
                    { ...tx.frames[1]!, data: "0xd1ff02" as Hex },
                    tx.frames[2]!,
                ],
            };

            expect(computeFrameSigHash(tx2)).toBe(hash1);
        });

        it("should NOT elide DEFAULT frame data", () => {
            const tx: FrameTransaction = {
                chainId: 1n,
                nonce: 0n,
                sender,
                frames: [
                    {
                        mode: buildMode(FrameMode.DEFAULT),
                        target,
                        gasLimit: 500000n,
                        data: "0xde9101" as Hex,
                    },
                    {
                        mode: buildMode(FrameMode.VERIFY, ApprovalScope.BOTH),
                        target: null,
                        gasLimit: 100000n,
                        data: "0x519000" as Hex,
                    },
                ],
                maxPriorityFeePerGas: 1n,
                maxFeePerGas: 2n,
                maxFeePerBlobGas: 0n,
                blobVersionedHashes: [],
            };

            const hash1 = computeFrameSigHash(tx);

            const tx2: FrameTransaction = {
                ...tx,
                frames: [
                    { ...tx.frames[0]!, data: "0xde9102" as Hex },
                    tx.frames[1]!,
                ],
            };

            expect(computeFrameSigHash(tx2)).not.toBe(hash1);
        });

        it("should NOT elide SENDER frame data", () => {
            const tx: FrameTransaction = {
                chainId: 1n,
                nonce: 0n,
                sender,
                frames: [
                    {
                        mode: buildMode(FrameMode.VERIFY, ApprovalScope.BOTH),
                        target: null,
                        gasLimit: 100000n,
                        data: "0x519000" as Hex,
                    },
                    {
                        mode: buildMode(FrameMode.SENDER),
                        target,
                        gasLimit: 200000n,
                        data: "0xac0001" as Hex,
                    },
                ],
                maxPriorityFeePerGas: 1n,
                maxFeePerGas: 2n,
                maxFeePerBlobGas: 0n,
                blobVersionedHashes: [],
            };

            const hash1 = computeFrameSigHash(tx);

            const tx2: FrameTransaction = {
                ...tx,
                frames: [
                    tx.frames[0]!,
                    { ...tx.frames[1]!, data: "0xac0002" as Hex },
                ],
            };

            expect(computeFrameSigHash(tx2)).not.toBe(hash1);
        });
    });

    // Spec: The sig hash covers VERIFY frame targets (but not data)
    describe("VERIFY target is covered by hash", () => {
        it("changing VERIFY target should change the hash", () => {
            const tx: FrameTransaction = {
                chainId: 1n,
                nonce: 0n,
                sender,
                frames: [
                    {
                        mode: buildMode(FrameMode.VERIFY, ApprovalScope.PAYMENT),
                        target: paymaster,
                        gasLimit: 100000n,
                        data: "0x519000" as Hex,
                    },
                ],
                maxPriorityFeePerGas: 1n,
                maxFeePerGas: 2n,
                maxFeePerBlobGas: 0n,
                blobVersionedHashes: [],
            };

            const hash1 = computeFrameSigHash(tx);

            const tx2: FrameTransaction = {
                ...tx,
                frames: [
                    {
                        ...tx.frames[0]!,
                        target: "0x5555555555555555555555555555555555555555" as Address,
                    },
                ],
            };

            expect(computeFrameSigHash(tx2)).not.toBe(hash1);
        });
    });
});
