import { describe, it, expect } from "vitest";
import type { Hex, Account } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { signFrameVerify } from "../../src/utils/signing.js";

// Hardhat #0
const privateKey =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const localAccount = privateKeyToAccount(privateKey);

const dummySigHash =
    "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as Hex;

describe("signFrameVerify", () => {
    describe("smart-account (default)", () => {
        it("should sign using signMessage with raw bytes", async () => {
            const result = await signFrameVerify(localAccount, dummySigHash);
            // signMessage returns a 65-byte EIP-191 signature
            expect(result).toMatch(/^0x[0-9a-f]+$/);
            expect(result.length).toBeGreaterThan(2);
        });

        it("should default to smart-account when accountType omitted", async () => {
            const result = await signFrameVerify(localAccount, dummySigHash);
            expect(result).toMatch(/^0x/);
        });

        it("should throw AccountError when account lacks signMessage", async () => {
            const noSignMessage = {
                address: localAccount.address,
                type: "local" as const,
            } as unknown as Account;

            await expect(
                signFrameVerify(noSignMessage, dummySigHash, "smart-account"),
            ).rejects.toThrow("Account does not support signMessage");
        });
    });

    describe("eoa", () => {
        it("should sign using raw ECDSA and return encoded verify data", async () => {
            const result = await signFrameVerify(
                localAccount,
                dummySigHash,
                "eoa",
            );
            // EOA verify data: 0x00 (sig type) + v (1 byte) + r (32) + s (32) = 66 bytes
            expect(result.startsWith("0x00")).toBe(true);
            expect((result.length - 2) / 2).toBe(66);
        });

        it("should throw AccountError for json-rpc account type", async () => {
            const jsonRpcAccount = {
                address: localAccount.address,
                type: "json-rpc" as const,
            } as unknown as Account;

            await expect(
                signFrameVerify(jsonRpcAccount, dummySigHash, "eoa"),
            ).rejects.toThrow("EOA signing requires a local account");
        });

        it("should throw AccountError for local account without sign()", async () => {
            const noSign = {
                address: localAccount.address,
                type: "local" as const,
                signMessage: localAccount.signMessage,
                // sign deliberately omitted
            } as unknown as Account;

            await expect(
                signFrameVerify(noSign, dummySigHash, "eoa"),
            ).rejects.toThrow("missing the sign() method");
        });
    });
});
