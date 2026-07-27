import { defineChain } from "viem";

/**
 * Public Arc testnet RPC — rate-limits bursts of parallel calls (the same
 * limit the keeper service had to self-pace around, see keeper/README.md).
 * Set VITE_ARC_RPC_URL to a keyed endpoint (Alchemy/QuickNode/etc.) to
 * avoid it; falls back to the public URL honestly if unset.
 */
export const ARC_RPC_URL = (import.meta.env.VITE_ARC_RPC_URL as string | undefined) || "https://rpc.testnet.arc.network/";

/**
 * Arc testnet — Circle's stablecoin-native L1 where USDC is the gas token.
 * Values per docs/canalis-spec.md section 10 (confirm against
 * https://docs.arc.io before mainnet use).
 */
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    // TODO: confirm native gas decimals against https://docs.arc.io — most
    // EVM chains report 18 for native currency regardless of the token's
    // own ERC-20 decimals (USDC is 6 as an ERC-20).
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [ARC_RPC_URL] },
  },
  blockExplorers: {
    default: {
      name: "Arcscan",
      url: "https://testnet.arcscan.app",
    },
  },
  testnet: true,
});
