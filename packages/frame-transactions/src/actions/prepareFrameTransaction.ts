import type { Account, Address, Chain, Client, Hex, Transport } from "viem";
import { getTransactionCount } from "viem/actions";
import type { AccountType, FrameCall, PrepareFrameTransactionReturnType } from "../types/transaction.js";
import { AccountError } from "../errors/index.js";
import { buildFrameTransaction } from "./buildFrameTransaction.js";
import { computeFrameSigHash } from "../utils/sigHash.js";
import { findVerifyIndices } from "../utils/findVerifyIndices.js";

/** Parameters for preparing a frame transaction */
export type PrepareFrameTransactionParameters = {
    calls: FrameCall[];
    maxPriorityFeePerGas: bigint;
    maxFeePerGas: bigint;
    maxFeePerBlobGas?: bigint;
    blobVersionedHashes?: Hex[];
    /** Paymaster address for sponsored transactions */
    paymaster?: Address;
    /** Optional deploy frame for first-time account deployment */
    deploy?: {
        target: Address;
        data: Hex;
        gasLimit: bigint;
    };
    /** Override chain ID (resolved from client if omitted) */
    chainId?: bigint;
    /** Override nonce (fetched from chain if omitted) */
    nonce?: bigint;
    /** Override sender (resolved from client account if omitted) */
    sender?: Address;
    /** Account type: 'eoa' or 'smart-account' (default) */
    accountType?: AccountType;
};

/**
 * Prepares a frame transaction for the sponsored flow.
 *
 * Resolves `chainId` from the client's chain, `sender` from the client's account,
 * and `nonce` via `eth_getTransactionCount` -- all overridable via params.
 *
 * Builds the frame transaction with VERIFY placeholders and computes the
 * signature hash. The caller can then get the paymaster to sign the sig hash
 * and use `sendPreparedFrameTransaction` to complete the transaction.
 *
 * @param client - A viem client (public or wallet)
 * @param params - The call parameters
 * @returns The prepared frame transaction, sig hash, and VERIFY frame indices
 *
 * @example
 * import { createWalletClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { mainnet } from 'viem/chains'
 * import { prepareFrameTransaction } from '@wonderland/frame-transactions'
 *
 * const client = createWalletClient({
 *   account: privateKeyToAccount('0x...'),
 *   chain: mainnet,
 *   transport: http(),
 * })
 *
 * const prepared = await prepareFrameTransaction(client, {
 *   calls: [{ target: '0x...', data: '0x...', gasLimit: 100000n }],
 *   maxPriorityFeePerGas: 1_000_000_000n,
 *   maxFeePerGas: 2_000_000_000n,
 * })
 * // prepared.sigHash can now be sent to a paymaster for signing
 */
export async function prepareFrameTransaction<
    chain extends Chain | undefined = Chain | undefined,
    account extends Account | undefined = Account | undefined,
>(
    client: Client<Transport, chain, account>,
    params: PrepareFrameTransactionParameters,
): Promise<PrepareFrameTransactionReturnType> {
    let chainId: bigint;
    if (params.chainId !== undefined) {
        chainId = params.chainId;
    } else if (client.chain) {
        chainId = BigInt(client.chain.id);
    } else {
        throw new AccountError(
            "No chain found on client and no chainId override provided.",
            {
                details:
                    "Provide a chain via createWalletClient({ chain: ... }) or pass chainId in the parameters.",
            },
        );
    }

    let sender: Address;
    if (params.sender !== undefined) {
        sender = params.sender;
    } else if (client.account) {
        sender = client.account.address;
    } else {
        throw new AccountError(
            "No account found on client and no sender override provided.",
            {
                details:
                    "Provide an account via createWalletClient({ account: ... }) or pass sender in the parameters.",
            },
        );
    }

    const nonce =
        params.nonce ??
        BigInt(
            await getTransactionCount(client, {
                address: sender,
                blockTag: "pending",
            }),
        );

    const frameTx = buildFrameTransaction({
        ...params,
        chainId,
        nonce,
        sender,
    });

    const sigHash = computeFrameSigHash(frameTx);

    // Find the VERIFY frame indices
    const { senderVerifyIndex, payerVerifyIndex } = findVerifyIndices(frameTx.frames);

    return {
        frameTx,
        sigHash,
        senderVerifyIndex,
        payerVerifyIndex,
    };
}

