import { describe, it, expect } from "vitest";
import type { Hex, Address } from "viem";
import {
    FRAME_TX_TYPE,
    FrameMode,
    ApprovalScope,
    buildMode,
    deserializeFrameTransaction,
    type FrameTransaction,
} from "../../src/index.js";
import { serializeFrameTransactionRlp } from "../../src/utils/encoding.js";

const sender = "0x1111111111111111111111111111111111111111" as Address;
const target = "0x2222222222222222222222222222222222222222" as Address;

describe("EIP-8141 serialization", () => {
    // Spec: type prefix is 0x06
    describe("type prefix", () => {
        it("should use FRAME_TX_TYPE = 0x06", () => {
            expect(FRAME_TX_TYPE).toBe(0x06);
        });

        it("serialized transaction starts with 0x06", () => {
            const tx: FrameTransaction = {
                chainId: 1n,
                nonce: 0n,
                sender,
                frames: [
                    {
                        mode: buildMode(FrameMode.VERIFY, ApprovalScope.BOTH),
                        target: null,
                        gasLimit: 100000n,
                        data: "0x" as Hex,
                    },
                ],
                maxPriorityFeePerGas: 0n,
                maxFeePerGas: 0n,
                maxFeePerBlobGas: 0n,
                blobVersionedHashes: [],
            };

            const serialized = serializeFrameTransactionRlp(tx);
            expect(serialized.slice(0, 4)).toBe("0x06");
        });
    });

    // Spec: payload = rlp([chain_id, nonce, sender, frames, max_priority_fee_per_gas,
    //        max_fee_per_gas, max_fee_per_blob_gas, blob_versioned_hashes])
    describe("payload structure", () => {
        it("should round-trip all 8 top-level fields", () => {
            const tx: FrameTransaction = {
                chainId: 42n,
                nonce: 7n,
                sender,
                frames: [
                    {
                        mode: buildMode(FrameMode.VERIFY, ApprovalScope.BOTH),
                        target: null,
                        gasLimit: 65536n,
                        data: "0xdeadbeef" as Hex,
                    },
                    {
                        mode: buildMode(FrameMode.SENDER),
                        target,
                        gasLimit: 200000n,
                        data: "0xcafebabe" as Hex,
                    },
                ],
                maxPriorityFeePerGas: 1000000000n,
                maxFeePerGas: 2000000000n,
                maxFeePerBlobGas: 0n,
                blobVersionedHashes: [],
            };

            const serialized = serializeFrameTransactionRlp(tx);
            const decoded = deserializeFrameTransaction(serialized);

            expect(decoded.chainId).toBe(42n);
            expect(decoded.nonce).toBe(7n);
            expect(decoded.sender.toLowerCase()).toBe(sender.toLowerCase());
            expect(decoded.frames.length).toBe(2);
            expect(decoded.maxPriorityFeePerGas).toBe(1000000000n);
            expect(decoded.maxFeePerGas).toBe(2000000000n);
            expect(decoded.maxFeePerBlobGas).toBe(0n);
            expect(decoded.blobVersionedHashes).toEqual([]);
        });
    });

    // Spec: frames = [[mode, target, gas_limit, data], ...]
    describe("frame encoding", () => {
        it("should preserve frame mode through round-trip", () => {
            const modes = [
                buildMode(FrameMode.DEFAULT),
                buildMode(FrameMode.VERIFY, ApprovalScope.EXECUTION),
                buildMode(FrameMode.SENDER, ApprovalScope.ANY, true),
            ];

            const tx: FrameTransaction = {
                chainId: 1n,
                nonce: 0n,
                sender,
                frames: modes.map((mode, i) => ({
                    mode,
                    target: i === 2 ? target : null,
                    gasLimit: 100000n,
                    data: "0x" as Hex,
                })),
                // Need a non-atomic SENDER after atomic one
                maxPriorityFeePerGas: 0n,
                maxFeePerGas: 0n,
                maxFeePerBlobGas: 0n,
                blobVersionedHashes: [],
            };

            // Add a trailing SENDER frame so atomic batch constraint is met
            tx.frames.push({
                mode: buildMode(FrameMode.SENDER),
                target,
                gasLimit: 100000n,
                data: "0x" as Hex,
            });

            const serialized = serializeFrameTransactionRlp(tx);
            const decoded = deserializeFrameTransaction(serialized);

            expect(decoded.frames[0]!.mode).toBe(modes[0]);
            expect(decoded.frames[1]!.mode).toBe(modes[1]);
            expect(decoded.frames[2]!.mode).toBe(modes[2]);
        });

        it("should handle null target as empty bytes", () => {
            const tx: FrameTransaction = {
                chainId: 1n,
                nonce: 0n,
                sender,
                frames: [{
                    mode: buildMode(FrameMode.VERIFY),
                    target: null,
                    gasLimit: 100000n,
                    data: "0x" as Hex,
                }],
                maxPriorityFeePerGas: 0n,
                maxFeePerGas: 0n,
                maxFeePerBlobGas: 0n,
                blobVersionedHashes: [],
            };

            const serialized = serializeFrameTransactionRlp(tx);
            const decoded = deserializeFrameTransaction(serialized);
            expect(decoded.frames[0]!.target).toBeNull();
        });
    });

    // Spec: If no blobs are included, blob_versioned_hashes must be empty and max_fee_per_blob_gas must be 0
    describe("blob fields", () => {
        it("should handle empty blob fields", () => {
            const tx: FrameTransaction = {
                chainId: 1n,
                nonce: 0n,
                sender,
                frames: [{
                    mode: buildMode(FrameMode.VERIFY),
                    target: null,
                    gasLimit: 100000n,
                    data: "0x" as Hex,
                }],
                maxPriorityFeePerGas: 0n,
                maxFeePerGas: 0n,
                maxFeePerBlobGas: 0n,
                blobVersionedHashes: [],
            };

            const serialized = serializeFrameTransactionRlp(tx);
            const decoded = deserializeFrameTransaction(serialized);
            expect(decoded.maxFeePerBlobGas).toBe(0n);
            expect(decoded.blobVersionedHashes).toEqual([]);
        });

        it("should handle non-zero blob fields", () => {
            const blobHash = "0x0100000000000000000000000000000000000000000000000000000000000001" as Hex;
            const tx: FrameTransaction = {
                chainId: 1n,
                nonce: 0n,
                sender,
                frames: [{
                    mode: buildMode(FrameMode.VERIFY),
                    target: null,
                    gasLimit: 100000n,
                    data: "0x" as Hex,
                }],
                maxPriorityFeePerGas: 0n,
                maxFeePerGas: 0n,
                maxFeePerBlobGas: 1000000n,
                blobVersionedHashes: [blobHash],
            };

            const serialized = serializeFrameTransactionRlp(tx);
            const decoded = deserializeFrameTransaction(serialized);
            expect(decoded.maxFeePerBlobGas).toBe(1000000n);
            expect(decoded.blobVersionedHashes.length).toBe(1);
        });
    });
});
