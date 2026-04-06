import type { Address, Hex } from "viem";
import type { FrameTransaction } from "./frame.js";

/** User-facing call description (becomes a SENDER frame) */
export type FrameCall = {
    /** Target contract address */
    target: Address;
    /** ETH value to send with this call */
    value?: bigint;
    /** Encoded calldata */
    data: Hex;
    /** Gas limit for this call frame */
    gasLimit: bigint;
    /** Whether this call is part of an atomic batch with the next call */
    atomicBatch?: boolean;
};

/** Account type for frame transaction building */
export type AccountType = "eoa" | "smart-account";

/** Parameters for building a frame transaction from user intent */
export type BuildFrameTransactionParameters = {
    chainId: bigint;
    nonce: bigint;
    sender: Address;
    calls: FrameCall[];
    maxPriorityFeePerGas: bigint;
    maxFeePerGas: bigint;
    maxFeePerBlobGas?: bigint;
    blobVersionedHashes?: Hex[];
    /** Paymaster address for sponsored transactions. If omitted, sender pays (self-relay). */
    paymaster?: Address;
    /** Optional deploy frame for first-time account deployment */
    deploy?: {
        target: Address;
        data: Hex;
        gasLimit: bigint;
    };
    /**
     * Account type controls SENDER frame encoding.
     * - `'smart-account'` (default): SENDER frames target the call target with calldata as data.
     * - `'eoa'`: SENDER frames target null (sender) with RLP-encoded subcalls as data.
     */
    accountType?: AccountType;
    /** Gas limit for auto-generated VERIFY frames (default: 100_000n) */
    verifyGasLimit?: bigint;
};

/** Result of building a frame transaction */
export type BuildFrameTransactionReturnType = FrameTransaction;

/** Result of preparing a frame transaction (for sponsored flow) */
export type PrepareFrameTransactionReturnType = {
    /** The built frame transaction with empty VERIFY data placeholders */
    frameTx: FrameTransaction;
    /** The signature hash (VERIFY data elided) */
    sigHash: Hex;
    /** Index of the sender VERIFY frame */
    senderVerifyIndex: number;
    /** Index of the payer VERIFY frame (if paymaster) */
    payerVerifyIndex?: number;
};

/** Serialized frame transaction (type 0x06 envelope) */
export type SerializedFrameTransaction = Hex;
