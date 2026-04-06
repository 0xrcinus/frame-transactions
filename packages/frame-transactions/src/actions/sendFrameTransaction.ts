import type { Account, Chain, Client, Hex, Transport } from "viem";
import { sendRawTransaction } from "viem/actions";
import type { AccountType, FrameCall } from "../types/transaction.js";
import { AccountError } from "../errors/index.js";
import { signFrameVerify } from "../utils/signing.js";
import { prepareFrameTransaction } from "./prepareFrameTransaction.js";
import { insertVerifyData } from "./insertVerifyData.js";
import { serializeFrameTransaction } from "./serializeFrameTransaction.js";

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
 * For sponsored transactions, use `prepareFrameTransaction` -> paymaster signs ->
 * `sendPreparedFrameTransaction` instead.
 *
 * @param client - A viem wallet client
 * @param parameters - The calls and gas parameters
 * @returns The transaction hash
 *
 * @example
 * import { createWalletClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { mainnet } from 'viem/chains'
 * import { sendFrameTransaction } from '@wonderland/frame-transactions'
 *
 * const client = createWalletClient({
 *   account: privateKeyToAccount('0x...'),
 *   chain: mainnet,
 *   transport: http(),
 * })
 *
 * const hash = await sendFrameTransaction(client, {
 *   calls: [{ target: '0x...', data: '0x...', gasLimit: 100000n }],
 *   maxPriorityFeePerGas: 1_000_000_000n,
 *   maxFeePerGas: 2_000_000_000n,
 * })
 */
export async function sendFrameTransaction<
    chain extends Chain | undefined = Chain | undefined,
    account extends Account | undefined = Account | undefined,
>(
    client: Client<Transport, chain, account>,
    parameters: SendFrameTransactionParameters,
): Promise<SendFrameTransactionReturnType> {
    const account_ = client.account;
    if (!account_) {
        throw new AccountError(
            "No account found on client.",
            {
                details:
                    "sendFrameTransaction requires a client with an account. " +
                    "Provide an account via createWalletClient({ account: ... }).",
            },
        );
    }

    const prepared = await prepareFrameTransaction(client, {
        ...parameters,
    });

    const verifyData = await signFrameVerify(
        account_,
        prepared.sigHash,
        parameters.accountType,
    );

    const signedTx = insertVerifyData(prepared.frameTx, {
        frameIndex: prepared.senderVerifyIndex,
        data: verifyData,
    });

    const serialized = serializeFrameTransaction(signedTx);

    return sendRawTransaction(client, { serializedTransaction: serialized });
}
