import type { Account, Chain, Client, Hex, Transport } from "viem";
import {
    sendFrameTransaction,
    type SendFrameTransactionParameters,
    type SendFrameTransactionReturnType,
} from "../actions/sendFrameTransaction.js";
import {
    prepareFrameTransaction,
    type PrepareFrameTransactionParameters,
} from "../actions/prepareFrameTransaction.js";
import {
    sendPreparedFrameTransaction,
    type SendPreparedFrameTransactionParameters,
} from "../actions/sendPreparedFrameTransaction.js";
import type { PrepareFrameTransactionReturnType } from "../types/transaction.js";

export type FrameActions = {
    /**
     * Sends calls as a frame transaction (self-pay).
     * Resolves chainId, sender, nonce from the client.
     */
    sendFrameTransaction: (
        parameters: SendFrameTransactionParameters,
    ) => Promise<SendFrameTransactionReturnType>;

    /**
     * Prepares a frame transaction for the sponsored flow.
     * Resolves chainId, sender, nonce from the client.
     * Returns sigHash for paymaster to sign.
     */
    prepareFrameTransaction: (
        parameters: PrepareFrameTransactionParameters,
    ) => Promise<PrepareFrameTransactionReturnType>;

    /**
     * Sends a prepared frame transaction with payer signature.
     * Signs the sender VERIFY frame using the client's account.
     */
    sendPreparedFrameTransaction: (
        parameters: SendPreparedFrameTransactionParameters,
    ) => Promise<Hex>;
};

/**
 * Decorator that adds frame transaction actions to a viem client.
 *
 * Usage:
 * ```ts
 * const client = createWalletClient({ ... }).extend(frameActions())
 * await client.sendFrameTransaction({ calls: [...], ... })
 * ```
 */
export function frameActions() {
    return (client: Client<Transport, Chain, Account>): FrameActions => ({
        sendFrameTransaction: (parameters) => sendFrameTransaction(client, parameters),
        prepareFrameTransaction: (parameters) => prepareFrameTransaction(client, parameters),
        sendPreparedFrameTransaction: (parameters) =>
            sendPreparedFrameTransaction(client, parameters),
    });
}
