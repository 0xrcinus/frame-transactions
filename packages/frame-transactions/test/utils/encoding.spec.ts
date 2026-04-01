import { describe, it, expect } from "vitest";
import type { Hex, Address } from "viem";
import {
    serializeFrameTransactionRlp,
    deserializeFrameTransaction,
} from "../../src/utils/encoding.js";
import { FrameMode, ApprovalScope, buildMode } from "../../src/types/frame.js";
import type { FrameTransaction } from "../../src/types/frame.js";

function makeSimpleTx(overrides?: Partial<FrameTransaction>): FrameTransaction {
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
        ...overrides,
    };
}

describe("encoding", () => {
    describe("serializeFrameTransactionRlp", () => {
        it("should produce a hex string starting with 0x06", () => {
            const tx = makeSimpleTx();
            const serialized = serializeFrameTransactionRlp(tx);
            expect(serialized).toMatch(/^0x06/);
        });

        it("should produce valid hex", () => {
            const tx = makeSimpleTx();
            const serialized = serializeFrameTransactionRlp(tx);
            expect(serialized).toMatch(/^0x[0-9a-f]+$/);
        });
    });

    describe("round-trip serialization", () => {
        it("should round-trip a simple transaction", () => {
            const tx = makeSimpleTx();
            const serialized = serializeFrameTransactionRlp(tx);
            const deserialized = deserializeFrameTransaction(serialized);

            expect(deserialized.chainId).toBe(tx.chainId);
            expect(deserialized.nonce).toBe(tx.nonce);
            expect(deserialized.sender.toLowerCase()).toBe(tx.sender.toLowerCase());
            expect(deserialized.frames.length).toBe(tx.frames.length);
            expect(deserialized.maxPriorityFeePerGas).toBe(tx.maxPriorityFeePerGas);
            expect(deserialized.maxFeePerGas).toBe(tx.maxFeePerGas);
            expect(deserialized.maxFeePerBlobGas).toBe(tx.maxFeePerBlobGas);
        });

        it("should preserve frame modes", () => {
            const tx = makeSimpleTx();
            const serialized = serializeFrameTransactionRlp(tx);
            const deserialized = deserializeFrameTransaction(serialized);

            expect(deserialized.frames[0]!.mode).toBe(tx.frames[0]!.mode);
            expect(deserialized.frames[1]!.mode).toBe(tx.frames[1]!.mode);
        });

        it("should preserve frame data", () => {
            const tx = makeSimpleTx();
            const serialized = serializeFrameTransactionRlp(tx);
            const deserialized = deserializeFrameTransaction(serialized);

            expect(deserialized.frames[0]!.data).toBe(tx.frames[0]!.data);
            expect(deserialized.frames[1]!.data).toBe(tx.frames[1]!.data);
        });

        it("should handle null targets as empty bytes", () => {
            const tx = makeSimpleTx();
            const serialized = serializeFrameTransactionRlp(tx);
            const deserialized = deserializeFrameTransaction(serialized);

            expect(deserialized.frames[0]!.target).toBeNull();
            expect(deserialized.frames[1]!.target).not.toBeNull();
        });

        it("should round-trip with blob hashes", () => {
            const tx = makeSimpleTx({
                maxFeePerBlobGas: 1000000n,
                blobVersionedHashes: [
                    "0x0100000000000000000000000000000000000000000000000000000000000001" as Hex,
                ],
            });
            const serialized = serializeFrameTransactionRlp(tx);
            const deserialized = deserializeFrameTransaction(serialized);

            expect(deserialized.maxFeePerBlobGas).toBe(1000000n);
            expect(deserialized.blobVersionedHashes.length).toBe(1);
        });
    });

    describe("deserializeFrameTransaction", () => {
        it("should reject non-0x06 type prefix", () => {
            expect(() =>
                deserializeFrameTransaction("0x02deadbeef" as Hex),
            ).toThrow("Expected frame transaction type 0x06");
        });
    });
});
