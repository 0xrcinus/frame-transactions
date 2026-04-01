/**
 * Demo: Sponsored (paymaster) send via EIP-8141 frame transaction.
 *
 * The app acts as both sender and paymaster using the dev account.
 * This demonstrates the two-VERIFY-frame pattern:
 *   Frame 0: VERIFY (scope=EXECUTION) — sender approves execution
 *   Frame 1: VERIFY (scope=PAYMENT)   — paymaster approves gas payment
 *   Frame 2: SENDER                   — the actual call
 *
 * In production, the paymaster would be a separate account/contract.
 * Here we use the same dev account for both roles to demonstrate the flow.
 */

import { type Hex, type Address, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DEV_PRIVATE_KEY } from "./config.js";
import { publicClient } from "./rpc.js";
import {
    buildFrameTransaction,
    serializeFrameTransaction,
    computeFrameSigHash,
    signEoaVerifyFrame,
    computeTxHash,
} from "@wonderland/frame-transactions";

const RECIPIENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const SEND_AMOUNT = 500_000_000_000_000n; // 0.0005 ETH

// In this demo, the dev account plays both sender and paymaster.
const PAYMASTER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;
const PAYMASTER_KEY = DEV_PRIVATE_KEY;

async function main() {
    console.log("=== EIP-8141 Sponsored Send Demo ===\n");

    const account = privateKeyToAccount(DEV_PRIVATE_KEY);
    console.log(`Sender:    ${account.address}`);
    console.log(`Paymaster: ${PAYMASTER}`);
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

    console.log(`Chain ID: ${chainId} | Nonce: ${nonce} | Balance: ${formatEther(balance)} ETH\n`);

    // Build sponsored frame transaction
    const maxPriorityFeePerGas = 1_000_000_000n;
    const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;

    const frameTx = buildFrameTransaction({
        chainId: BigInt(chainId),
        nonce: BigInt(nonce),
        sender: account.address,
        paymaster: PAYMASTER,
        calls: [{ target: RECIPIENT, value: SEND_AMOUNT, data: "0x" as Hex, gasLimit: 100_000n }],
        accountType: "eoa",
        maxPriorityFeePerGas,
        maxFeePerGas,
    });

    console.log(`Frame tx built: ${frameTx.frames.length} frames`);
    console.log(`  Frame 0: VERIFY (scope=EXECUTION) — sender auth`);
    console.log(`  Frame 1: VERIFY (scope=PAYMENT)   — paymaster auth`);
    console.log(`  Frame 2: SENDER                   — ETH transfer\n`);

    // Compute sig hash (same for both sender and paymaster)
    const sigHash = computeFrameSigHash(frameTx);
    console.log(`Sig hash: ${sigHash}\n`);

    // Sign: sender signs frame 0, paymaster signs frame 1
    console.log("Signing sender VERIFY frame (index 0)...");
    let signedTx = await signEoaVerifyFrame(frameTx, DEV_PRIVATE_KEY, 0);

    console.log("Signing paymaster VERIFY frame (index 1)...");
    signedTx = await signEoaVerifyFrame(signedTx, PAYMASTER_KEY, 1);

    // Serialize and send
    const serialized = serializeFrameTransaction(signedTx);
    const txHash = computeTxHash(signedTx);

    console.log(`\nTx hash: ${txHash}`);
    console.log(`Size:    ${(serialized.length - 2) / 2} bytes\n`);

    console.log("Sending sponsored transaction...");
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

    const recipientBalance = await publicClient.getBalance({ address: RECIPIENT });
    console.log(`\nRecipient balance: ${formatEther(recipientBalance)} ETH`);
}

main().catch(console.error);
