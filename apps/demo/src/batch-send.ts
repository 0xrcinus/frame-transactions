/**
 * Demo: Batch send via EIP-8141 frame transaction.
 *
 * Sends ETH to multiple recipients in a single frame transaction
 * using atomic batching (all-or-nothing).
 */

import { type Hex, type Address, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DEV_PRIVATE_KEY } from "./config.js";
import { publicClient } from "./rpc.js";
import {
    buildFrameTransaction,
    serializeFrameTransaction,
    signEoaVerifyFrame,
    computeTxHash,
} from "@wonderland/frame-transactions";

// Hardhat accounts #1-3
const RECIPIENTS: { address: Address; amount: bigint }[] = [
    { address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", amount: 500_000_000_000_000n },
    { address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", amount: 300_000_000_000_000n },
    { address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906", amount: 200_000_000_000_000n },
];

async function main() {
    console.log("=== EIP-8141 Batch Send Demo ===\n");

    const account = privateKeyToAccount(DEV_PRIVATE_KEY);
    console.log(`Sender: ${account.address}\n`);

    console.log("Recipients:");
    for (const r of RECIPIENTS) {
        console.log(`  ${r.address} — ${formatEther(r.amount)} ETH`);
    }
    console.log();

    // Fetch chain state
    const [chainId, nonce, balance, block] = await Promise.all([
        publicClient.getChainId(),
        publicClient.getTransactionCount({ address: account.address }),
        publicClient.getBalance({ address: account.address }),
        publicClient.getBlock(),
    ]);
    const baseFee = block.baseFeePerGas ?? 0n;

    console.log(`Chain ID: ${chainId} | Nonce: ${nonce} | Balance: ${formatEther(balance)} ETH\n`);

    // Build batch frame transaction with atomic batching
    const maxPriorityFeePerGas = 1_000_000_000n;
    const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;

    const frameTx = buildFrameTransaction({
        chainId: BigInt(chainId),
        nonce: BigInt(nonce),
        sender: account.address,
        calls: RECIPIENTS.map((r, i) => ({
            target: r.address,
            value: r.amount,
            data: "0x" as Hex,
            gasLimit: 100_000n,
            atomicBatch: i < RECIPIENTS.length - 1, // all-or-nothing except last
        })),
        accountType: "eoa",
        maxPriorityFeePerGas,
        maxFeePerGas,
    });

    console.log(`Frame tx built: ${frameTx.frames.length} frames`);
    console.log(`  Frame 0: VERIFY (scope=BOTH)`);
    for (let i = 1; i < frameTx.frames.length; i++) {
        const isLast = i === frameTx.frames.length - 1;
        console.log(`  Frame ${i}: SENDER${!isLast ? " [atomic]" : ""} → ${RECIPIENTS[i - 1]!.address.slice(0, 10)}...`);
    }
    console.log();

    // Sign, serialize, compute hash
    const signedTx = await signEoaVerifyFrame(frameTx, DEV_PRIVATE_KEY);
    const serialized = serializeFrameTransaction(signedTx);
    const txHash = computeTxHash(signedTx);

    console.log(`Tx hash: ${txHash}`);
    console.log(`Size:    ${(serialized.length - 2) / 2} bytes\n`);

    // Send
    console.log("Sending batch transaction...");
    try {
        const hash = await publicClient.request({
            method: "eth_sendRawTransaction" as never,
            params: [serialized] as never,
        } as never) as Hex;
        console.log(`Submitted: ${hash}\n`);

        console.log("Waiting for receipt...");
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        console.log(`Status:   ${receipt.status === "success" ? "SUCCESS" : "FAILED"}`);
        console.log(`Gas used: ${receipt.gasUsed}`);
    } catch (e) {
        console.error(`Failed: ${(e as Error).message}`);
    }

    // Check final balances
    console.log("\nFinal balances:");
    for (const r of RECIPIENTS) {
        const bal = await publicClient.getBalance({ address: r.address });
        console.log(`  ${r.address.slice(0, 10)}... — ${formatEther(bal)} ETH`);
    }
}

main().catch(console.error);
