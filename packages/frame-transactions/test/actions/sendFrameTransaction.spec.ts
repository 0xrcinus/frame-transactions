import { describe, it, expect, vi } from "vitest";
import type { Hex, Address, Account } from "viem";
import { parseSignature } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sendFrameTransaction } from "../../src/actions/sendFrameTransaction.js";
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

const txHash =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex;

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

const baseParams = {
    calls: [{ target: recipient, data: "0xdeadbeef" as Hex, gasLimit: 100_000n }],
    maxPriorityFeePerGas: 1_000_000_000n,
    maxFeePerGas: 2_000_000_000n,
};

describe("sendFrameTransaction", () => {
    it("should send a self-pay smart-account transaction", async () => {
        const { client, sentTxs } = mockClient();
        const hash = await sendFrameTransaction(client, baseParams);

        expect(hash).toBe(txHash);
        expect(sentTxs.length).toBe(1);

        // Verify the serialized tx is valid
        const deserialized = deserializeFrameTransaction(sentTxs[0]!);
        expect(deserialized.chainId).toBe(1n);
        expect(deserialized.frames.length).toBe(2);
        expect(getExecutionMode(deserialized.frames[0]!.mode)).toBe(FrameMode.VERIFY);
        expect(getApprovalScope(deserialized.frames[0]!.mode)).toBe(ApprovalScope.BOTH);
        expect(getExecutionMode(deserialized.frames[1]!.mode)).toBe(FrameMode.SENDER);
        // VERIFY frame should have signature data (not empty)
        expect(deserialized.frames[0]!.data).not.toBe("0x");
    });

    it("should send an EOA transaction with raw ECDSA signing", async () => {
        const { client, sentTxs } = mockClient();
        const hash = await sendFrameTransaction(client, {
            ...baseParams,
            accountType: "eoa",
        });

        expect(hash).toBe(txHash);
        const deserialized = deserializeFrameTransaction(sentTxs[0]!);
        // EOA verify data: 0x00 prefix + v + r + s = 66 bytes
        expect((deserialized.frames[0]!.data.length - 2) / 2).toBe(66);
        expect(deserialized.frames[0]!.data.startsWith("0x00")).toBe(true);
    });

    it("should throw AccountError when client has no account", async () => {
        const { client } = mockClient({ account: null });
        await expect(sendFrameTransaction(client, baseParams)).rejects.toThrow(
            "No account found on client",
        );
    });

    it("should resolve nonce and submit transaction via RPC", async () => {
        const { client } = mockClient();
        await sendFrameTransaction(client, baseParams);

        const calls = client.request.mock.calls.map(
            (c: [{ method: string }]) => c[0].method,
        );
        expect(calls).toContain("eth_getTransactionCount");
        expect(calls).toContain("eth_sendRawTransaction");
    });
});
