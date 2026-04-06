import { describe, it, expect } from "vitest";
import type { Hex, Address } from "viem";
import { serializeFrameTransaction } from "../../src/actions/serializeFrameTransaction.js";
import { deserializeFrameTransaction } from "../../src/utils/encoding.js";
import { buildFrameTransaction } from "../../src/actions/buildFrameTransaction.js";
import { insertVerifyData } from "../../src/actions/insertVerifyData.js";

const sender = "0x1111111111111111111111111111111111111111" as Address;
const target = "0x2222222222222222222222222222222222222222" as Address;

describe("serializeFrameTransaction", () => {
    it("should serialize and deserialize a built transaction", () => {
        const tx = buildFrameTransaction({
            chainId: 1n,
            nonce: 5n,
            sender,
            calls: [{ target, data: "0xcafebabe" as Hex, gasLimit: 100000n }],
            maxPriorityFeePerGas: 1000000000n,
            maxFeePerGas: 2000000000n,
        });

        // Insert dummy signature
        const signed = insertVerifyData(tx, {
            frameIndex: 0,
            data: ("0x" + "ab".repeat(65)) as Hex,
        });

        const serialized = serializeFrameTransaction(signed);
        expect(serialized).toMatch(/^0x06/);

        const deserialized = deserializeFrameTransaction(serialized);
        expect(deserialized.chainId).toBe(1n);
        expect(deserialized.nonce).toBe(5n);
        expect(deserialized.frames.length).toBe(2);
    });

    it("should reject transactions with no frames", () => {
        expect(() =>
            serializeFrameTransaction({
                chainId: 1n,
                nonce: 0n,
                sender,
                frames: [],
                maxPriorityFeePerGas: 0n,
                maxFeePerGas: 0n,
                maxFeePerBlobGas: 0n,
                blobVersionedHashes: [],
            }),
        ).toThrow("Frame count must be between 1");
    });
});
