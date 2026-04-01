import type { Hex } from "viem";
import type {
    BuildFrameTransactionParameters,
    BuildFrameTransactionReturnType,
} from "../types/transaction.js";
import type { Frame } from "../types/frame.js";
import { FrameMode, ApprovalScope, buildMode } from "../types/frame.js";
import { encodeEoaSenderData } from "../eoa.js";
import { validateFrameTransaction } from "../utils/validation.js";

/**
 * Builds a frame transaction from user intent (SENDER calls).
 *
 * Auto-generates the validation prefix:
 * - Self-pay (no paymaster): prepends VERIFY frame with scope 0x3 (both)
 * - Sponsored (with paymaster): prepends VERIFY(scope=0x1) for sender + VERIFY(scope=0x2) for paymaster
 * - Deploy: prepends DEFAULT frame for account deployment before VERIFY frame(s)
 *
 * VERIFY frames are created with empty data placeholders — signatures are inserted
 * later via `insertVerifyData`.
 *
 * @param params - The build parameters with user calls and optional paymaster/deploy config
 * @returns A complete frame transaction with validation prefix
 */
export function buildFrameTransaction(
    params: BuildFrameTransactionParameters,
): BuildFrameTransactionReturnType {
    const {
        chainId,
        nonce,
        sender,
        calls,
        maxPriorityFeePerGas,
        maxFeePerGas,
        maxFeePerBlobGas = 0n,
        blobVersionedHashes = [],
        paymaster,
        deploy,
        accountType = "smart-account",
    } = params;

    const frames: Frame[] = [];

    // Optional deploy frame (DEFAULT mode, first frame)
    if (deploy) {
        frames.push({
            mode: buildMode(FrameMode.DEFAULT),
            target: deploy.target,
            gasLimit: deploy.gasLimit,
            data: deploy.data,
        });
    }

    // Sender VERIFY frame
    if (paymaster) {
        // Sponsored: sender approves execution only (scope 0x1)
        frames.push({
            mode: buildMode(FrameMode.VERIFY, ApprovalScope.EXECUTION),
            target: null, // null defaults to sender
            gasLimit: 100000n,
            data: "0x" as Hex, // placeholder for signature
        });
        // Payer VERIFY frame: paymaster approves payment (scope 0x2)
        frames.push({
            mode: buildMode(FrameMode.VERIFY, ApprovalScope.PAYMENT),
            target: paymaster,
            gasLimit: 100000n,
            data: "0x" as Hex, // placeholder for paymaster signature
        });
    } else {
        // Self-pay: sender approves both execution and payment (scope 0x3)
        frames.push({
            mode: buildMode(FrameMode.VERIFY, ApprovalScope.BOTH),
            target: null, // null defaults to sender
            gasLimit: 100000n,
            data: "0x" as Hex, // placeholder for signature
        });
    }

    // SENDER frames from user calls
    if (accountType === "eoa") {
        // EOA default code: SENDER target is null (sender), data is RLP-encoded subcalls
        for (const call of calls) {
            frames.push({
                mode: buildMode(FrameMode.SENDER, ApprovalScope.ANY, call.atomicBatch ?? false),
                target: null,
                gasLimit: call.gasLimit,
                data: encodeEoaSenderData([
                    { target: call.target, value: call.value ?? 0n, data: call.data },
                ]),
            });
        }
    } else {
        // Smart account: SENDER target is the call target, data is calldata
        for (const call of calls) {
            frames.push({
                mode: buildMode(FrameMode.SENDER, ApprovalScope.ANY, call.atomicBatch ?? false),
                target: call.target,
                gasLimit: call.gasLimit,
                data: call.data,
            });
        }
    }

    const tx: BuildFrameTransactionReturnType = {
        chainId,
        nonce,
        sender,
        frames,
        maxPriorityFeePerGas,
        maxFeePerGas,
        maxFeePerBlobGas,
        blobVersionedHashes,
    };

    validateFrameTransaction(tx);

    return tx;
}
