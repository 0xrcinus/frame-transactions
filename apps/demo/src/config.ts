import { defineChain } from "viem";

export const RPC_URL = process.env.RPC_URL ?? "https://demo.eip-8141.ethrex.xyz/rpc";

// Hardhat #0 dev account (pre-funded on ethrex demo)
export const DEV_PRIVATE_KEY =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

export const ethrexDemo = defineChain({
    id: 1729,
    name: "ethrex-demo",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
        default: { http: [RPC_URL] },
    },
});
