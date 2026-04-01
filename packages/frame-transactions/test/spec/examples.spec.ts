import { describe, it, expect } from "vitest";
import type { Hex, Address } from "viem";
import { buildFrameTransaction } from "../../src/actions/buildFrameTransaction.js";
import { insertVerifyData } from "../../src/actions/insertVerifyData.js";
import { serializeFrameTransaction } from "../../src/actions/serializeFrameTransaction.js";
import { computeFrameSigHash } from "../../src/utils/sigHash.js";
import { deserializeFrameTransaction } from "../../src/utils/encoding.js";
import {
    FrameMode,
    ApprovalScope,
    buildMode,
    getExecutionMode,
    getApprovalScope,
    hasAtomicBatchFlag,
} from "../../src/types/frame.js";
import type { FrameTransaction } from "../../src/types/frame.js";

const sender = "0x1111111111111111111111111111111111111111" as Address;
const recipient = "0x2222222222222222222222222222222222222222" as Address;
const erc20 = "0x3333333333333333333333333333333333333333" as Address;
const dex = "0x4444444444444444444444444444444444444444" as Address;
const sponsor = "0x5555555555555555555555555555555555555555" as Address;
const deployer = "0x6666666666666666666666666666666666666666" as Address;

const baseGas = {
    maxPriorityFeePerGas: 1000000000n,
    maxFeePerGas: 2000000000n,
};

describe("EIP-8141 spec examples", () => {
    // Example 1: Simple Transaction
    // Frame 0: ENTRY_POINT → sender (VERIFY), Signature, calls APPROVE(0x3)
    // Frame 1: Sender → Target (SENDER), Call data
    describe("Example 1: Simple Transaction", () => {
        it("should build a self-relay tx with 1 call", () => {
            const tx = buildFrameTransaction({
                chainId: 1n,
                nonce: 0n,
                sender,
                calls: [{ target: recipient, data: "0x" as Hex, gasLimit: 21000n }],
                ...baseGas,
            });

            expect(tx.frames.length).toBe(2);

            // Frame 0: VERIFY with scope BOTH (0x3) — self_verify
            expect(getExecutionMode(tx.frames[0]!.mode)).toBe(FrameMode.VERIFY);
            expect(getApprovalScope(tx.frames[0]!.mode)).toBe(ApprovalScope.BOTH);
            expect(tx.frames[0]!.target).toBeNull(); // sender

            // Frame 1: SENDER
            expect(getExecutionMode(tx.frames[1]!.mode)).toBe(FrameMode.SENDER);
            expect(tx.frames[1]!.target).toBe(recipient);
        });

        it("should round-trip serialize/deserialize", () => {
            const tx = buildFrameTransaction({
                chainId: 1n,
                nonce: 0n,
                sender,
                calls: [{ target: recipient, data: "0x" as Hex, gasLimit: 21000n }],
                ...baseGas,
            });

            const signed = insertVerifyData(tx, {
                frameIndex: 0,
                data: "0x" + "ab".repeat(65) as Hex,
            });

            const serialized = serializeFrameTransaction(signed);
            const deserialized = deserializeFrameTransaction(serialized);

            expect(deserialized.frames.length).toBe(2);
            expect(deserialized.sender.toLowerCase()).toBe(sender.toLowerCase());
        });
    });

    // Example 1b: Simple account deployment
    // Frame 0: ENTRY_POINT → Deployer (DEFAULT), Initcode/Salt
    // Frame 1: ENTRY_POINT → sender (VERIFY), Signature
    // Frame 2: Sender → sender (SENDER), Destination/Amount
    describe("Example 1b: Simple account deployment", () => {
        it("should build a deploy + self-relay tx", () => {
            const tx = buildFrameTransaction({
                chainId: 1n,
                nonce: 0n,
                sender,
                calls: [{ target: recipient, data: "0x0a1b2c" as Hex, gasLimit: 21000n }],
                deploy: { target: deployer, data: "0x1c0de0" as Hex, gasLimit: 500000n },
                ...baseGas,
            });

            expect(tx.frames.length).toBe(3);

            // Frame 0: DEFAULT (deploy)
            expect(getExecutionMode(tx.frames[0]!.mode)).toBe(FrameMode.DEFAULT);
            expect(tx.frames[0]!.target).toBe(deployer);

            // Frame 1: VERIFY with scope BOTH
            expect(getExecutionMode(tx.frames[1]!.mode)).toBe(FrameMode.VERIFY);
            expect(getApprovalScope(tx.frames[1]!.mode)).toBe(ApprovalScope.BOTH);

            // Frame 2: SENDER
            expect(getExecutionMode(tx.frames[2]!.mode)).toBe(FrameMode.SENDER);
        });
    });

    // Example 2: Atomic Approve + Swap
    // Frame 0: VERIFY — signature, APPROVE(0x3)
    // Frame 1: SENDER — approve(DEX, amount) [atomic batch set]
    // Frame 2: SENDER — swap(...) [atomic batch not set]
    describe("Example 2: Atomic Approve + Swap", () => {
        it("should build with atomic batch flag", () => {
            const tx = buildFrameTransaction({
                chainId: 1n,
                nonce: 0n,
                sender,
                calls: [
                    {
                        target: erc20,
                        data: "0x0a9900" as Hex,
                        gasLimit: 50000n,
                        atomicBatch: true,
                    },
                    { target: dex, data: "0x05a900" as Hex, gasLimit: 200000n },
                ],
                ...baseGas,
            });

            expect(tx.frames.length).toBe(3);

            // Frame 0: VERIFY
            expect(getExecutionMode(tx.frames[0]!.mode)).toBe(FrameMode.VERIFY);

            // Frame 1: SENDER with atomic batch
            expect(getExecutionMode(tx.frames[1]!.mode)).toBe(FrameMode.SENDER);
            expect(hasAtomicBatchFlag(tx.frames[1]!.mode)).toBe(true);
            expect(tx.frames[1]!.target).toBe(erc20);

            // Frame 2: SENDER without atomic batch
            expect(getExecutionMode(tx.frames[2]!.mode)).toBe(FrameMode.SENDER);
            expect(hasAtomicBatchFlag(tx.frames[2]!.mode)).toBe(false);
            expect(tx.frames[2]!.target).toBe(dex);
        });
    });

    // Example 3: Sponsored Transaction (Fee Payment in ERC-20)
    // Frame 0: VERIFY — sender signature, APPROVE(0x1)
    // Frame 1: VERIFY — sponsor checks, APPROVE(0x2)
    // Frame 2: SENDER — transfer(sponsor, fees)
    // Frame 3: SENDER — user's intended call
    // Frame 4: DEFAULT — post op
    describe("Example 3: Sponsored Transaction", () => {
        it("should build a paymaster tx with sender + payer verify", () => {
            const tx = buildFrameTransaction({
                chainId: 1n,
                nonce: 0n,
                sender,
                calls: [
                    { target: erc20, data: "0x1feeee" as Hex, gasLimit: 50000n },
                    { target: recipient, data: "0x00ca11" as Hex, gasLimit: 200000n },
                ],
                paymaster: sponsor,
                ...baseGas,
            });

            expect(tx.frames.length).toBe(4);

            // Frame 0: sender VERIFY (scope EXECUTION = 0x1)
            expect(getExecutionMode(tx.frames[0]!.mode)).toBe(FrameMode.VERIFY);
            expect(getApprovalScope(tx.frames[0]!.mode)).toBe(ApprovalScope.EXECUTION);

            // Frame 1: payer VERIFY (scope PAYMENT = 0x2)
            expect(getExecutionMode(tx.frames[1]!.mode)).toBe(FrameMode.VERIFY);
            expect(getApprovalScope(tx.frames[1]!.mode)).toBe(ApprovalScope.PAYMENT);
            expect(tx.frames[1]!.target).toBe(sponsor);

            // Frames 2-3: SENDER calls
            expect(getExecutionMode(tx.frames[2]!.mode)).toBe(FrameMode.SENDER);
            expect(getExecutionMode(tx.frames[3]!.mode)).toBe(FrameMode.SENDER);
        });

        it("should produce valid sig hash for both signers", () => {
            const tx = buildFrameTransaction({
                chainId: 1n,
                nonce: 0n,
                sender,
                calls: [
                    { target: erc20, data: "0x1fa00e" as Hex, gasLimit: 50000n },
                ],
                paymaster: sponsor,
                ...baseGas,
            });

            const sigHash = computeFrameSigHash(tx);
            expect(sigHash).toMatch(/^0x[0-9a-f]{64}$/);

            // Both sender and paymaster sign the same sig hash
            // Insert different signatures, hash should have been the same
            const signed1 = insertVerifyData(tx, { frameIndex: 0, data: "0x5e0de5" as Hex });
            const signed2 = insertVerifyData(signed1, { frameIndex: 1, data: "0x9a4e55" as Hex });

            // Verify the sigHash is stable after inserting verify data
            // (since VERIFY data is elided from hash computation)
            expect(computeFrameSigHash(signed2)).toBe(sigHash);
        });
    });

    // Example 4: EOA paying gas in ERC-20s
    // Similar to Example 3 but with EOA default code
    describe("Example 4: EOA paying gas in ERC-20s", () => {
        it("should build same structure as Example 3 (paymaster flow)", () => {
            const tx = buildFrameTransaction({
                chainId: 1n,
                nonce: 0n,
                sender,
                calls: [
                    { target: erc20, data: "0x1feeee" as Hex, gasLimit: 50000n },
                    { target: recipient, data: "0x00ca11" as Hex, gasLimit: 200000n },
                ],
                paymaster: sponsor,
                ...baseGas,
            });

            // Same structure: [verify(0x1), verify(0x2), sender, sender]
            expect(tx.frames.length).toBe(4);
            expect(getExecutionMode(tx.frames[0]!.mode)).toBe(FrameMode.VERIFY);
            expect(getApprovalScope(tx.frames[0]!.mode)).toBe(ApprovalScope.EXECUTION);
            expect(getExecutionMode(tx.frames[1]!.mode)).toBe(FrameMode.VERIFY);
            expect(getApprovalScope(tx.frames[1]!.mode)).toBe(ApprovalScope.PAYMENT);
        });
    });

    // Full end-to-end: build → sign → serialize → deserialize
    describe("End-to-end flow", () => {
        it("should complete the full wallet pipeline", () => {
            // 1. Build
            const tx = buildFrameTransaction({
                chainId: 1n,
                nonce: 42n,
                sender,
                calls: [
                    { target: erc20, data: "0x0a9900" as Hex, gasLimit: 50000n, atomicBatch: true },
                    { target: dex, data: "0x05a900" as Hex, gasLimit: 200000n },
                ],
                ...baseGas,
            });

            // 2. Compute sig hash
            const sigHash = computeFrameSigHash(tx);
            expect(sigHash).toMatch(/^0x[0-9a-f]{64}$/);

            // 3. Insert signature (dummy for test)
            const dummySig = "0x" + "ab".repeat(65) as Hex;
            const signed = insertVerifyData(tx, { frameIndex: 0, data: dummySig });
            expect(signed.frames[0]!.data).toBe(dummySig);

            // 4. Serialize
            const serialized = serializeFrameTransaction(signed);
            expect(serialized).toMatch(/^0x06/);

            // 5. Deserialize and verify
            const decoded = deserializeFrameTransaction(serialized);
            expect(decoded.chainId).toBe(1n);
            expect(decoded.nonce).toBe(42n);
            expect(decoded.frames.length).toBe(3);
            expect(hasAtomicBatchFlag(decoded.frames[1]!.mode)).toBe(true);
            expect(hasAtomicBatchFlag(decoded.frames[2]!.mode)).toBe(false);
        });
    });
});
