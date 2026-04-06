import type { Address, Hex } from "viem";

/** EIP-8141 constants */
export const FRAME_TX_TYPE = 0x06;
export const FRAME_TX_INTRINSIC_COST = 15000n;
export const ENTRY_POINT = "0x00000000000000000000000000000000000000aa" as Address;
export const MAX_FRAMES = 1000;

/** Default gas limit for auto-generated VERIFY frames */
export const DEFAULT_VERIFY_GAS_LIMIT = 100_000n;

/** Empty data placeholder for unsigned VERIFY frames */
export const EMPTY_DATA = "0x" as Hex;

/** Frame execution mode (lower 8 bits of mode field) */
export const FrameMode = {
    /** Execute as ENTRY_POINT */
    DEFAULT: 0,
    /** Validation frame, must call APPROVE */
    VERIFY: 1,
    /** Execute on behalf of sender */
    SENDER: 2,
} as const;
export type FrameMode = (typeof FrameMode)[keyof typeof FrameMode];

/**
 * Approval scope for VERIFY frames.
 * Constrains what the APPROVE opcode can approve.
 */
export const ApprovalScope = {
    /** Any scope allowed */
    ANY: 0,
    /** Only execution approval (0x1) */
    EXECUTION: 1,
    /** Only payment approval (0x2) */
    PAYMENT: 2,
    /** Only combined execution + payment (0x3) */
    BOTH: 3,
} as const;
export type ApprovalScope = (typeof ApprovalScope)[keyof typeof ApprovalScope];

/** A single frame in a frame transaction */
export type Frame = {
    /** Full mode field (includes execution mode, approval scope bits, atomic batch flag) */
    mode: number;
    /** Target address, or null to default to tx.sender */
    target: Address | null;
    /** Gas limit for this frame */
    gasLimit: bigint;
    /** Frame calldata */
    data: Hex;
};

/** A frame transaction (EIP-8141, type 0x06) */
export type FrameTransaction = {
    chainId: bigint;
    nonce: bigint;
    sender: Address;
    frames: Frame[];
    maxPriorityFeePerGas: bigint;
    maxFeePerGas: bigint;
    maxFeePerBlobGas: bigint;
    blobVersionedHashes: Hex[];
};

/**
 * Extracts the execution mode from a mode field.
 * @param mode - The full mode field
 * @returns The execution mode (lower 8 bits)
 */
export function getExecutionMode(mode: number): FrameMode {
    return (mode & 0xff) as FrameMode;
}

/**
 * Extracts the approval scope from a mode field (bits 9-10).
 * @param mode - The full mode field
 * @returns The approval scope
 */
export function getApprovalScope(mode: number): ApprovalScope {
    return ((mode >> 8) & 3) as ApprovalScope;
}

/**
 * Checks if the atomic batch flag is set (bit 11).
 * @param mode - The full mode field
 * @returns True if atomic batch flag is set
 */
export function hasAtomicBatchFlag(mode: number): boolean {
    return ((mode >> 10) & 1) === 1;
}

/**
 * Builds a mode field from components.
 * @param executionMode - The execution mode (DEFAULT, VERIFY, SENDER)
 * @param approvalScope - The approval scope constraint (bits 9-10)
 * @param atomicBatch - Whether to set the atomic batch flag (bit 11)
 * @returns The composed mode field
 */
export function buildMode(
    executionMode: FrameMode,
    approvalScope: ApprovalScope = ApprovalScope.ANY,
    atomicBatch: boolean = false,
): number {
    let mode = executionMode & 0xff;
    mode |= (approvalScope & 3) << 8;
    if (atomicBatch) {
        mode |= 1 << 10;
    }
    return mode;
}
