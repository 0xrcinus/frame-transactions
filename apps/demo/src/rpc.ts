/**
 * Shared viem clients for the ethrex demo node.
 */

import { createPublicClient, http } from "viem";
import { RPC_URL, ethrexDemo } from "./config.js";

export const publicClient = createPublicClient({
    chain: ethrexDemo,
    transport: http(RPC_URL),
});
