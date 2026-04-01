/**
 * Demo: Simple ETH send via EIP-8141 frame transaction.
 *
 * Uses EOA default code: one VERIFY frame (ECDSA) + one SENDER frame.
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

const RECIPIENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const SEND_AMOUNT = 1_000_000_000_000_000n; // 0.001 ETH

async function main() {
    console.log("=== EIP-8141 Simple Send Demo ===\n");

    const account = privateKeyToAccount(DEV_PRIVATE_KEY);
    console.log(`Sender:    ${account.address}`);
    console.log(`Recipient: ${RECIPIENT}`);
    console.log(`Amount:    ${formatEther(SEND_AMOUNT)} ETH\n`);

    // Fetch chain state
    const [chainId, nonce, balance, block] = await Promise.all([
        publicClient.getChainId(),
        publicClient.getTransactionCount({ address: account.address }),
        publicClient.getBalance({ address: account.address }),
        publicClient.getBlock(),
    ]);
    const baseFee = block.baseFeePerGas ?? 0n;

    console.log(`Chain ID:  ${chainId}`);
    console.log(`Nonce:     ${nonce}`);
    console.log(`Balance:   ${formatEther(balance)} ETH`);
    console.log(`Base fee:  ${baseFee} wei\n`);

    // Build frame transaction
    const maxPriorityFeePerGas = 1_000_000_000n;
    const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;

    const frameTx = buildFrameTransaction({
        chainId: BigInt(chainId),
        nonce: BigInt(nonce),
        sender: account.address,
        calls: [{ target: RECIPIENT, value: SEND_AMOUNT, data: "0x" as Hex, gasLimit: 100_000n }],
        accountType: "eoa",
        maxPriorityFeePerGas,
        maxFeePerGas,
    });

    console.log(`Frame tx built: ${frameTx.frames.length} frames`);
    console.log(`  Frame 0: VERIFY (scope=BOTH)`);
    console.log(`  Frame 1: SENDER (ETH transfer)\n`);

    // Sign, serialize, compute hash
    const signedTx = await signEoaVerifyFrame(frameTx, DEV_PRIVATE_KEY);
    const serialized = serializeFrameTransaction(signedTx);
    const txHash = computeTxHash(signedTx);

    console.log(`Tx hash:    ${txHash}`);
    console.log(`Serialized: ${serialized.slice(0, 40)}...`);
    console.log(`Size:       ${(serialized.length - 2) / 2} bytes\n`);

    // Send
    console.log("Sending transaction...");
    try {
        const hash = await publicClient.request({
            method: "eth_sendRawTransaction" as never,
            params: [serialized] as never,
        } as never) as Hex;
        console.log(`Submitted:  ${hash}\n`);

        console.log("Waiting for receipt...");
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        console.log(`Status:     ${receipt.status === "success" ? "SUCCESS" : "FAILED"}`);
        console.log(`Gas used:   ${receipt.gasUsed}`);
    } catch (e) {
        console.error(`Failed: ${(e as Error).message}`);
    }

    const recipientBalance = await publicClient.getBalance({ address: RECIPIENT });
    console.log(`\nRecipient balance: ${formatEther(recipientBalance)} ETH`);
}

main().catch(console.error);
