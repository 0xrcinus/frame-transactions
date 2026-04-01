import type { Account, Address, Chain, Client, Hex, Transport } from "viem";
import type { AccountType, FrameCall, PrepareFrameTransactionReturnType } from "../types/transaction.js";
import { FrameMode, getExecutionMode } from "../types/frame.js";
import { buildFrameTransaction } from "./buildFrameTransaction.js";
import { computeFrameSigHash } from "../utils/sigHash.js";

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
 * and `nonce` via `eth_getTransactionCount` — all overridable via params.
 *
 * Builds the frame transaction with VERIFY placeholders and computes the
 * signature hash. The caller can then get the paymaster to sign the sig hash
 * and use `sendPreparedFrameTransaction` to complete the transaction.
 *
 * @param client - A viem client (public or wallet)
 * @param params - The call parameters
 * @returns The prepared frame transaction, sig hash, and VERIFY frame indices
 */
export async function prepareFrameTransaction(
    client: Client<Transport, Chain, Account>,
    params: PrepareFrameTransactionParameters,
): Promise<PrepareFrameTransactionReturnType> {
    const chainId = params.chainId ?? BigInt(client.chain.id);
    const sender = params.sender ?? client.account.address;
    const nonce =
        params.nonce ??
        BigInt(
            await client.request({
                method: "eth_getTransactionCount" as never,
                params: [sender, "pending"] as never,
            } as never),
        );

    const frameTx = buildFrameTransaction({
        chainId,
        nonce,
        sender,
        calls: params.calls,
        maxPriorityFeePerGas: params.maxPriorityFeePerGas,
        maxFeePerGas: params.maxFeePerGas,
        maxFeePerBlobGas: params.maxFeePerBlobGas,
        blobVersionedHashes: params.blobVersionedHashes,
        paymaster: params.paymaster,
        deploy: params.deploy,
        accountType: params.accountType,
    });

    const sigHash = computeFrameSigHash(frameTx);

    // Find the VERIFY frame indices
    let senderVerifyIndex = -1;
    let payerVerifyIndex: number | undefined;

    for (let i = 0; i < frameTx.frames.length; i++) {
        const frame = frameTx.frames[i]!;
        if (getExecutionMode(frame.mode) === FrameMode.VERIFY) {
            if (senderVerifyIndex === -1) {
                senderVerifyIndex = i;
            } else if (payerVerifyIndex === undefined) {
                payerVerifyIndex = i;
            }
        }
    }

    return {
        frameTx,
        sigHash,
        senderVerifyIndex,
        payerVerifyIndex,
    };
}
