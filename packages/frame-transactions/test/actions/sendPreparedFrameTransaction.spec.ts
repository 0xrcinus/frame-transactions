import { describe, it, expect, vi } from "vitest";
import type { Hex, Address, Account } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sendPreparedFrameTransaction } from "../../src/actions/sendPreparedFrameTransaction.js";
import { prepareFrameTransaction } from "../../src/actions/prepareFrameTransaction.js";
import { deserializeFrameTransaction } from "../../src/utils/encoding.js";
import {
    FrameMode,
    ApprovalScope,
    getExecutionMode,
    getApprovalScope,
} from "../../src/types/frame.js";

// Hardhat #0
const privateKey =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const account = privateKeyToAccount(privateKey);
const recipient = "0x2222222222222222222222222222222222222222" as Address;
const paymaster = "0x5555555555555555555555555555555555555555" as Address;

const txHash =
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hex;

function mockClient(overrides?: {
    account?: Account | null;
    chainId?: number;
}) {
    const sentTxs: Hex[] = [];
    return {
        client: {
            account: overrides && "account" in overrides ? overrides.account : account,
            chain: { id: overrides?.chainId ?? 1 },
            request: vi.fn(async (args: { method: string; params?: unknown[] }) => {
                if (args.method === "eth_getTransactionCount") {
                    return "0x0";
                }
                if (args.method === "eth_sendRawTransaction") {
                    sentTxs.push((args.params as Hex[])[0]!);
                    return txHash;
                }
                throw new Error(`Unexpected RPC: ${args.method}`);
            }),
        } as any,
        sentTxs,
    };
}

const baseCallParams = {
    calls: [{ target: recipient, data: "0xdeadbeef" as Hex, gasLimit: 100_000n }],
    maxPriorityFeePerGas: 1_000_000_000n,
    maxFeePerGas: 2_000_000_000n,
};

describe("sendPreparedFrameTransaction", () => {
    it("should send a self-pay prepared transaction", async () => {
        const { client, sentTxs } = mockClient();
        const prepared = await prepareFrameTransaction(client, baseCallParams);
        const hash = await sendPreparedFrameTransaction(client, prepared);

        expect(hash).toBe(txHash);
        expect(sentTxs.length).toBe(1);

        const deserialized = deserializeFrameTransaction(sentTxs[0]!);
        expect(deserialized.frames.length).toBe(2);
        expect(getExecutionMode(deserialized.frames[0]!.mode)).toBe(FrameMode.VERIFY);
        // Signed: data should not be empty
        expect(deserialized.frames[0]!.data).not.toBe("0x");
    });

    it("should send a sponsored prepared transaction with paymaster signature", async () => {
        const { client, sentTxs } = mockClient();
        const prepared = await prepareFrameTransaction(client, {
            ...baseCallParams,
            paymaster,
        });

        expect(prepared.payerVerifyIndex).toBeDefined();

        const dummyPayerSig = ("0x" + "cc".repeat(65)) as Hex;
        const hash = await sendPreparedFrameTransaction(client, {
            ...prepared,
            payerVerifyData: dummyPayerSig,
        });

        expect(hash).toBe(txHash);

        const deserialized = deserializeFrameTransaction(sentTxs[0]!);
        expect(deserialized.frames.length).toBe(3);

        // Sender VERIFY (scope EXECUTION)
        expect(getExecutionMode(deserialized.frames[0]!.mode)).toBe(FrameMode.VERIFY);
        expect(getApprovalScope(deserialized.frames[0]!.mode)).toBe(ApprovalScope.EXECUTION);
        expect(deserialized.frames[0]!.data).not.toBe("0x");

        // Payer VERIFY (scope PAYMENT) — has our dummy signature
        expect(getExecutionMode(deserialized.frames[1]!.mode)).toBe(FrameMode.VERIFY);
        expect(getApprovalScope(deserialized.frames[1]!.mode)).toBe(ApprovalScope.PAYMENT);
        expect(deserialized.frames[1]!.data).toBe(dummyPayerSig);
    });

    it("should send with EOA account type", async () => {
        const { client, sentTxs } = mockClient();
        const prepared = await prepareFrameTransaction(client, {
            ...baseCallParams,
            accountType: "eoa",
        });
        const hash = await sendPreparedFrameTransaction(client, {
            ...prepared,
            accountType: "eoa",
        });

        expect(hash).toBe(txHash);

        const deserialized = deserializeFrameTransaction(sentTxs[0]!);
        // EOA verify data: 0x00 prefix + 66 bytes
        expect((deserialized.frames[0]!.data.length - 2) / 2).toBe(66);
        expect(deserialized.frames[0]!.data.startsWith("0x00")).toBe(true);
    });

    it("should throw AccountError when client has no account", async () => {
        const { client: goodClient } = mockClient();
        const prepared = await prepareFrameTransaction(goodClient, baseCallParams);

        const { client: badClient } = mockClient({ account: null });
        await expect(
            sendPreparedFrameTransaction(badClient, prepared),
        ).rejects.toThrow("No account found on client");
    });

    it("should not insert payer data when payerVerifyData is absent", async () => {
        const { client, sentTxs } = mockClient();
        const prepared = await prepareFrameTransaction(client, {
            ...baseCallParams,
            paymaster,
        });

        // Send without payerVerifyData — payer VERIFY should remain empty
        const hash = await sendPreparedFrameTransaction(client, {
            ...prepared,
            // payerVerifyData deliberately omitted
        });

        expect(hash).toBe(txHash);
        const deserialized = deserializeFrameTransaction(sentTxs[0]!);
        // Payer VERIFY frame data should still be "0x" (placeholder)
        expect(deserialized.frames[1]!.data).toBe("0x");
    });
});
