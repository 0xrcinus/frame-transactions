import type { Account, Chain, Client, Hex, Transport } from "viem";
import { sendRawTransaction } from "viem/actions";
import type { PrepareFrameTransactionReturnType } from "../types/transaction.js";
import type { AccountType } from "../types/transaction.js";
import { AccountError } from "../errors/index.js";
import { signFrameVerify } from "../utils/signing.js";
import { insertVerifyData } from "./insertVerifyData.js";
import { serializeFrameTransaction } from "./serializeFrameTransaction.js";

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
 * 1. `prepareFrameTransaction(...)` -> get sigHash
 * 2. Paymaster signs sigHash
 * 3. `sendPreparedFrameTransaction(...)` with payer signature
 *
 * @param client - A viem wallet client
 * @param parameters - The prepared frame tx with payer signature
 * @returns The transaction hash
 *
 * @example
 * import { createWalletClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { mainnet } from 'viem/chains'
 * import { prepareFrameTransaction, sendPreparedFrameTransaction } from '@wonderland/frame-transactions'
 *
 * const client = createWalletClient({
 *   account: privateKeyToAccount('0x...'),
 *   chain: mainnet,
 *   transport: http(),
 * })
 *
 * const prepared = await prepareFrameTransaction(client, { ... })
 * // ... get paymaster signature for prepared.sigHash ...
 * const hash = await sendPreparedFrameTransaction(client, {
 *   ...prepared,
 *   payerVerifyData: paymasterSignature,
 * })
 */
export async function sendPreparedFrameTransaction<
    chain extends Chain | undefined = Chain | undefined,
    account extends Account | undefined = Account | undefined,
>(
    client: Client<Transport, chain, account>,
    parameters: SendPreparedFrameTransactionParameters,
): Promise<Hex> {
    const account_ = client.account;
    if (!account_) {
        throw new AccountError(
            "No account found on client.",
            {
                details:
                    "sendPreparedFrameTransaction requires a client with an account. " +
                    "Provide an account via createWalletClient({ account: ... }).",
            },
        );
    }

    const {
        frameTx,
        sigHash,
        senderVerifyIndex,
        payerVerifyIndex,
        payerVerifyData,
        accountType,
    } = parameters;

    const senderVerifyData = await signFrameVerify(
        account_,
        sigHash,
        accountType,
    );

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

    return sendRawTransaction(client, { serializedTransaction: serialized });
}
