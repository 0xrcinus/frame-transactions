import type { Account, Chain, Client, Hex, Transport } from "viem";
import { parseSignature } from "viem";
import type { AccountType, FrameCall } from "../types/transaction.js";
import { prepareFrameTransaction } from "./prepareFrameTransaction.js";
import { insertVerifyData } from "./insertVerifyData.js";
import { serializeFrameTransaction } from "./serializeFrameTransaction.js";
import { encodeEcdsaVerifyData } from "../eoa.js";

/** Parameters for sendFrameTransaction */
export type SendFrameTransactionParameters = {
    calls: FrameCall[];
    maxPriorityFeePerGas: bigint;
    maxFeePerGas: bigint;
    maxFeePerBlobGas?: bigint;
    blobVersionedHashes?: Hex[];
    /** Account type: 'eoa' or 'smart-account' (default) */
    accountType?: AccountType;
};

/** Return type for sendFrameTransaction */
export type SendFrameTransactionReturnType = Hex;

/**
 * Sends calls as a frame transaction (self-pay flow).
 *
 * Resolves chainId, sender, and nonce from the client automatically.
 *
 * The wallet auto-generates the sender VERIFY frame with scope 0x3 (both
 * execution and payment), signs it, serializes, and submits.
 *
 * For EOA accounts (`accountType: 'eoa'`), uses raw ECDSA signing via
 * `account.sign` (available on local accounts like `privateKeyToAccount`).
 * For smart accounts (default), uses `account.signMessage` (EIP-191).
 *
 * For sponsored transactions, use `prepareFrameTransaction` → paymaster signs →
 * `sendPreparedFrameTransaction` instead.
 *
 * @param client - A viem wallet client
 * @param parameters - The calls and gas parameters
 * @returns The transaction hash
 */
export async function sendFrameTransaction(
    client: Client<Transport, Chain, Account>,
    parameters: SendFrameTransactionParameters,
): Promise<SendFrameTransactionReturnType> {
    const account = client.account;

    const prepared = await prepareFrameTransaction(client, {
        calls: parameters.calls,
        maxPriorityFeePerGas: parameters.maxPriorityFeePerGas,
        maxFeePerGas: parameters.maxFeePerGas,
        maxFeePerBlobGas: parameters.maxFeePerBlobGas,
        blobVersionedHashes: parameters.blobVersionedHashes,
        accountType: parameters.accountType,
    });

    // Sign the sender VERIFY frame
    let verifyData: Hex;

    if (parameters.accountType === "eoa") {
        // EOA: raw ECDSA signing (no EIP-191 prefix) — requires a local account
        if (!("sign" in account) || typeof account.sign !== "function") {
            throw new Error(
                "EOA signing requires a local account (e.g. privateKeyToAccount). " +
                    "The account must have a sign() method for raw ECDSA signing.",
            );
        }
        const rawSig = await (account as Account & { sign: (args: { hash: Hex }) => Promise<Hex> }).sign({
            hash: prepared.sigHash,
        });
        const { v, r, s } = parseSignature(rawSig);
        verifyData = encodeEcdsaVerifyData({ v: v ?? 27n, r, s });
    } else {
        // Smart account: EIP-191 signMessage
        if (!account.signMessage) {
            throw new Error("Account does not support signMessage");
        }
        verifyData = await account.signMessage({
            message: { raw: prepared.sigHash },
        });
    }

    const signedTx = insertVerifyData(prepared.frameTx, {
        frameIndex: prepared.senderVerifyIndex,
        data: verifyData,
    });

    // Serialize and send
    const serialized = serializeFrameTransaction(signedTx);

    const hash = await client.request({
        method: "eth_sendRawTransaction" as never,
        params: [serialized] as never,
    } as never);

    return hash as Hex;
}
