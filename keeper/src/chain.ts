import { defineChain } from "viem";

// Arc testnet — see CLAUDE.md / docs/canalis-spec.md for the canonical
// values. Native gas token is USDC at 18 decimals (distinct from the
// 6-decimal USDC ERC-20 interface the contracts move).
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.RPC_URL ?? "https://rpc.testnet.arc.network/"] },
  },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
});
