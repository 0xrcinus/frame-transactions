import type { Account, Chain, Client, Hex, Transport } from "viem";
import { parseSignature } from "viem";
import type { PrepareFrameTransactionReturnType } from "../types/transaction.js";
import type { AccountType } from "../types/transaction.js";
import { insertVerifyData } from "./insertVerifyData.js";
import { serializeFrameTransaction } from "./serializeFrameTransaction.js";
import { encodeEcdsaVerifyData } from "../eoa.js";

/** Parameters for sending a prepared frame transaction */
export type SendPreparedFrameTransactionParameters = PrepareFrameTransactionReturnType & {
    /** Paymaster's signature for the payer VERIFY frame (required if paymaster was used) */
    payerVerifyData?: Hex;
    /** Account type: 'eoa' or 'smart-account' (default) */
    accountType?: AccountType;
};

/**
 * Sends a previously prepared frame transaction.
 *
 * Signs the sender VERIFY frame using the client's account, inserts the
 * paymaster signature if provided, then serializes and submits.
 *
 * For EOA accounts (`accountType: 'eoa'`), uses raw ECDSA signing via
 * `account.sign`. For smart accounts (default), uses `account.signMessage`.
 *
 * Used in the sponsored flow after the paymaster has signed:
 * 1. `prepareFrameTransaction(...)` → get sigHash
 * 2. Paymaster signs sigHash
 * 3. `sendPreparedFrameTransaction(...)` with payer signature
 *
 * @param client - A viem wallet client
 * @param parameters - The prepared frame tx with payer signature
 * @returns The transaction hash
 */
export async function sendPreparedFrameTransaction(
    client: Client<Transport, Chain, Account>,
    parameters: SendPreparedFrameTransactionParameters,
): Promise<Hex> {
    const {
        frameTx,
        sigHash,
        senderVerifyIndex,
        payerVerifyIndex,
        payerVerifyData,
        accountType,
    } = parameters;

    const account = client.account;

    // Sign the sender VERIFY frame
    let senderVerifyData: Hex;

    if (accountType === "eoa") {
        if (!("sign" in account) || typeof account.sign !== "function") {
            throw new Error(
                "EOA signing requires a local account (e.g. privateKeyToAccount). " +
                    "The account must have a sign() method for raw ECDSA signing.",
            );
        }
        const rawSig = await (account as Account & { sign: (args: { hash: Hex }) => Promise<Hex> }).sign({
            hash: sigHash,
        });
        const { v, r, s } = parseSignature(rawSig);
        senderVerifyData = encodeEcdsaVerifyData({ v: v ?? 27n, r, s });
    } else {
        if (!account.signMessage) {
            throw new Error("Account does not support signMessage");
        }
        senderVerifyData = await account.signMessage({
            message: { raw: sigHash },
        });
    }

    let signedTx = insertVerifyData(frameTx, {
        frameIndex: senderVerifyIndex,
        data: senderVerifyData,
    });

    // Insert paymaster signature if present
    if (payerVerifyIndex !== undefined && payerVerifyData) {
        signedTx = insertVerifyData(signedTx, {
            frameIndex: payerVerifyIndex,
            data: payerVerifyData,
        });
    }

    const serialized = serializeFrameTransaction(signedTx);

    const hash = await client.request({
        method: "eth_sendRawTransaction" as never,
        params: [serialized] as never,
    } as never);

    return hash as Hex;
}
