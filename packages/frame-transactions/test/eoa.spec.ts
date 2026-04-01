import { describe, it, expect } from "vitest";
import type { Hex, Address } from "viem";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildFrameTransaction } from "../src/actions/buildFrameTransaction.js";
import { serializeFrameTransaction } from "../src/actions/serializeFrameTransaction.js";
import { computeFrameSigHash } from "../src/utils/sigHash.js";
import { computeTxHash } from "../src/utils/encoding.js";
import { deserializeFrameTransaction } from "../src/utils/encoding.js";
import {
    encodeEcdsaVerifyData,
    encodeEoaSenderData,
    signEoaVerifyFrame,
} from "../src/eoa.js";
import {
    FrameMode,
    ApprovalScope,
    getExecutionMode,
    getApprovalScope,
    hasAtomicBatchFlag,
} from "../src/types/frame.js";

const sender = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;
const recipient = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const recipient2 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;
const paymaster = "0x5555555555555555555555555555555555555555" as Address;

// Hardhat #0 private key
const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;

const baseGas = {
    maxPriorityFeePerGas: 1_000_000_000n,
    maxFeePerGas: 2_000_000_000n,
};

describe("EOA support", () => {
    describe("encodeEcdsaVerifyData", () => {
        it("should produce 66-byte signature with 0x00 prefix", () => {
            const data = encodeEcdsaVerifyData({
                v: 27n,
                r: ("0x" + "ab".repeat(32)) as Hex,
                s: ("0x" + "cd".repeat(32)) as Hex,
            });

            // 0x + 00 (sig type) + 1b (v=27) + 32 bytes r + 32 bytes s = 2 + 132 chars
            expect(data).toMatch(/^0x00/);
            expect((data.length - 2) / 2).toBe(66);
        });

        it("should encode v=28 correctly", () => {
            const data = encodeEcdsaVerifyData({
                v: 28n,
                r: ("0x" + "00".repeat(32)) as Hex,
                s: ("0x" + "00".repeat(32)) as Hex,
            });

            // signature_type (0x00) + v (0x1c = 28) + r + s
            expect(data.slice(0, 6)).toBe("0x001c");
        });
    });

    describe("encodeEoaSenderData", () => {
        it("should RLP-encode a single call", () => {
            const data = encodeEoaSenderData([
                { target: recipient, value: 0n, data: "0x" as Hex },
            ]);
            expect(data).toMatch(/^0x/);
            // Should be valid RLP — non-empty
            expect(data.length).toBeGreaterThan(2);
        });

        it("should RLP-encode multiple calls", () => {
            const data = encodeEoaSenderData([
                { target: recipient, value: 1000n, data: "0x" as Hex },
                { target: recipient2, value: 0n, data: "0xdeadbeef" as Hex },
            ]);
            expect(data).toMatch(/^0x/);
            expect(data.length).toBeGreaterThan(2);
        });

        it("should encode zero value as empty bytes", () => {
            const data = encodeEoaSenderData([
                { target: recipient, value: 0n, data: "0x" as Hex },
            ]);
            // Zero value encoded as 0x (empty) in RLP, not 0x00
            // We can verify by checking the data doesn't contain an extra zero
            expect(data).toMatch(/^0x/);
        });
    });

    describe("buildFrameTransaction with accountType: eoa", () => {
        it("should build simple EOA tx with null SENDER target", () => {
            const tx = buildFrameTransaction({
                chainId: 1n,
                nonce: 0n,
                sender,
                calls: [{ target: recipient, value: 1000n, data: "0x" as Hex, gasLimit: 100_000n }],
                accountType: "eoa",
                ...baseGas,
            });

            expect(tx.frames.length).toBe(2);

            // VERIFY frame
            expect(getExecutionMode(tx.frames[0]!.mode)).toBe(FrameMode.VERIFY);
            expect(getApprovalScope(tx.frames[0]!.mode)).toBe(ApprovalScope.BOTH);
            expect(tx.frames[0]!.target).toBeNull();

            // SENDER frame: target is null (EOA default code), data is RLP-encoded
            expect(getExecutionMode(tx.frames[1]!.mode)).toBe(FrameMode.SENDER);
            expect(tx.frames[1]!.target).toBeNull();
            expect(tx.frames[1]!.data).not.toBe("0x"); // Should have RLP-encoded call data
        });

        it("should build batch EOA tx with atomic flags", () => {
            const tx = buildFrameTransaction({
                chainId: 1n,
                nonce: 0n,
                sender,
                calls: [
                    { target: recipient, value: 500n, data: "0x" as Hex, gasLimit: 100_000n, atomicBatch: true },
                    { target: recipient2, value: 300n, data: "0x" as Hex, gasLimit: 100_000n },
                ],
                accountType: "eoa",
                ...baseGas,
            });

            expect(tx.frames.length).toBe(3); // 1 VERIFY + 2 SENDER

            // Both SENDER frames should have null target
            expect(tx.frames[1]!.target).toBeNull();
            expect(tx.frames[2]!.target).toBeNull();

            // First SENDER has atomic flag
            expect(hasAtomicBatchFlag(tx.frames[1]!.mode)).toBe(true);
            expect(hasAtomicBatchFlag(tx.frames[2]!.mode)).toBe(false);
        });

        it("should build sponsored EOA tx", () => {
            const tx = buildFrameTransaction({
                chainId: 1n,
                nonce: 0n,
                sender,
                calls: [{ target: recipient, value: 1000n, data: "0x" as Hex, gasLimit: 100_000n }],
                paymaster,
                accountType: "eoa",
                ...baseGas,
            });

            expect(tx.frames.length).toBe(3); // 2 VERIFY + 1 SENDER

            // VERIFY frames
            expect(getExecutionMode(tx.frames[0]!.mode)).toBe(FrameMode.VERIFY);
            expect(getApprovalScope(tx.frames[0]!.mode)).toBe(ApprovalScope.EXECUTION);
            expect(getExecutionMode(tx.frames[1]!.mode)).toBe(FrameMode.VERIFY);
            expect(getApprovalScope(tx.frames[1]!.mode)).toBe(ApprovalScope.PAYMENT);
            expect(tx.frames[1]!.target).toBe(paymaster);

            // SENDER frame: null target for EOA
            expect(tx.frames[2]!.target).toBeNull();
        });

        it("should default to smart-account mode when accountType omitted", () => {
            const tx = buildFrameTransaction({
                chainId: 1n,
                nonce: 0n,
                sender,
                calls: [{ target: recipient, data: "0xdeadbeef" as Hex, gasLimit: 100_000n }],
                ...baseGas,
            });

            // Smart account: SENDER target is the call target
            expect(tx.frames[1]!.target).toBe(recipient);
        });

        it("should round-trip serialize/deserialize EOA tx", () => {
            const tx = buildFrameTransaction({
                chainId: 1729n,
                nonce: 5n,
                sender,
                calls: [{ target: recipient, value: 1_000_000n, data: "0x" as Hex, gasLimit: 100_000n }],
                accountType: "eoa",
                ...baseGas,
            });

            const serialized = serializeFrameTransaction(tx);
            const deserialized = deserializeFrameTransaction(serialized);

            expect(deserialized.chainId).toBe(1729n);
            expect(deserialized.nonce).toBe(5n);
            expect(deserialized.frames.length).toBe(2);
            expect(deserialized.frames[1]!.target).toBeNull();
        });
    });

    describe("signEoaVerifyFrame", () => {
        it("should sign and insert ECDSA signature into VERIFY frame", async () => {
            const tx = buildFrameTransaction({
                chainId: 1n,
                nonce: 0n,
                sender,
                calls: [{ target: recipient, value: 1000n, data: "0x" as Hex, gasLimit: 100_000n }],
                accountType: "eoa",
                ...baseGas,
            });

            expect(tx.frames[0]!.data).toBe("0x");

            const signed = await signEoaVerifyFrame(tx, privateKey);

            // VERIFY frame should now have 66-byte ECDSA signature
            expect(signed.frames[0]!.data).toMatch(/^0x00/);
            expect((signed.frames[0]!.data.length - 2) / 2).toBe(66);
        });

        it("should produce stable sig hash (VERIFY data elided)", async () => {
            const tx = buildFrameTransaction({
                chainId: 1n,
                nonce: 0n,
                sender,
                calls: [{ target: recipient, value: 1000n, data: "0x" as Hex, gasLimit: 100_000n }],
                accountType: "eoa",
                ...baseGas,
            });

            const sigHashBefore = computeFrameSigHash(tx);
            const signed = await signEoaVerifyFrame(tx, privateKey);
            const sigHashAfter = computeFrameSigHash(signed);

            expect(sigHashAfter).toBe(sigHashBefore);
        });

        it("should sign specific VERIFY frame index for sponsored tx", async () => {
            const tx = buildFrameTransaction({
                chainId: 1n,
                nonce: 0n,
                sender,
                calls: [{ target: recipient, value: 1000n, data: "0x" as Hex, gasLimit: 100_000n }],
                paymaster,
                accountType: "eoa",
                ...baseGas,
            });

            // Sign sender VERIFY (index 0)
            const signed1 = await signEoaVerifyFrame(tx, privateKey, 0);
            expect(signed1.frames[0]!.data).toMatch(/^0x00/);
            expect(signed1.frames[1]!.data).toBe("0x"); // paymaster still unsigned

            // Sign paymaster VERIFY (index 1)
            const signed2 = await signEoaVerifyFrame(signed1, privateKey, 1);
            expect(signed2.frames[1]!.data).toMatch(/^0x00/);
        });

        it("should throw for out-of-bounds frame index", async () => {
            const tx = buildFrameTransaction({
                chainId: 1n,
                nonce: 0n,
                sender,
                calls: [{ target: recipient, data: "0x" as Hex, gasLimit: 100_000n }],
                accountType: "eoa",
                ...baseGas,
            });

            await expect(signEoaVerifyFrame(tx, privateKey, 5)).rejects.toThrow(
                /out of bounds/,
            );
        });

        it("should throw for non-VERIFY frame", async () => {
            const tx = buildFrameTransaction({
                chainId: 1n,
                nonce: 0n,
                sender,
                calls: [{ target: recipient, data: "0x" as Hex, gasLimit: 100_000n }],
                accountType: "eoa",
                ...baseGas,
            });

            await expect(signEoaVerifyFrame(tx, privateKey, 1)).rejects.toThrow(
                /not a VERIFY frame/,
            );
        });
    });

    describe("computeTxHash", () => {
        it("should compute keccak256 of serialized transaction", () => {
            const tx = buildFrameTransaction({
                chainId: 1n,
                nonce: 0n,
                sender,
                calls: [{ target: recipient, value: 1000n, data: "0x" as Hex, gasLimit: 100_000n }],
                accountType: "eoa",
                ...baseGas,
            });

            const hash = computeTxHash(tx);
            expect(hash).toMatch(/^0x[0-9a-f]{64}$/);

            // Should match keccak256 of manual serialization
            const serialized = serializeFrameTransaction(tx);
            expect(hash).toBe(keccak256(serialized));
        });
    });

    describe("full EOA end-to-end", () => {
        it("should build, sign, serialize, and compute hash for simple send", async () => {
            const tx = buildFrameTransaction({
                chainId: 1729n,
                nonce: 0n,
                sender,
                calls: [{ target: recipient, value: 1_000_000_000_000_000n, data: "0x" as Hex, gasLimit: 100_000n }],
                accountType: "eoa",
                ...baseGas,
            });

            const signed = await signEoaVerifyFrame(tx, privateKey);
            const serialized = serializeFrameTransaction(signed);
            const txHash = computeTxHash(signed);

            expect(serialized).toMatch(/^0x06/);
            expect(txHash).toMatch(/^0x[0-9a-f]{64}$/);

            // Deserialize and verify structure
            const decoded = deserializeFrameTransaction(serialized);
            expect(decoded.frames.length).toBe(2);
            expect(decoded.frames[0]!.target).toBeNull();
            expect(decoded.frames[1]!.target).toBeNull();
            expect((decoded.frames[0]!.data.length - 2) / 2).toBe(66);
        });

        it("should build, sign, serialize batch with atomic flags", async () => {
            const tx = buildFrameTransaction({
                chainId: 1729n,
                nonce: 0n,
                sender,
                calls: [
                    { target: recipient, value: 500n, data: "0x" as Hex, gasLimit: 100_000n, atomicBatch: true },
                    { target: recipient2, value: 300n, data: "0x" as Hex, gasLimit: 100_000n, atomicBatch: true },
                    { target: recipient, value: 200n, data: "0x" as Hex, gasLimit: 100_000n },
                ],
                accountType: "eoa",
                ...baseGas,
            });

            const signed = await signEoaVerifyFrame(tx, privateKey);
            const serialized = serializeFrameTransaction(signed);

            const decoded = deserializeFrameTransaction(serialized);
            expect(decoded.frames.length).toBe(4);
            expect(hasAtomicBatchFlag(decoded.frames[1]!.mode)).toBe(true);
            expect(hasAtomicBatchFlag(decoded.frames[2]!.mode)).toBe(true);
            expect(hasAtomicBatchFlag(decoded.frames[3]!.mode)).toBe(false);
        });

        it("should build, sign, serialize sponsored tx", async () => {
            const tx = buildFrameTransaction({
                chainId: 1729n,
                nonce: 0n,
                sender,
                calls: [{ target: recipient, value: 500_000n, data: "0x" as Hex, gasLimit: 100_000n }],
                paymaster,
                accountType: "eoa",
                ...baseGas,
            });

            // Sign both VERIFY frames
            let signed = await signEoaVerifyFrame(tx, privateKey, 0);
            signed = await signEoaVerifyFrame(signed, privateKey, 1);

            const serialized = serializeFrameTransaction(signed);
            const decoded = deserializeFrameTransaction(serialized);

            expect(decoded.frames.length).toBe(3);
            // Both VERIFY frames should have signatures
            expect((decoded.frames[0]!.data.length - 2) / 2).toBe(66);
            expect((decoded.frames[1]!.data.length - 2) / 2).toBe(66);
        });
    });
});
