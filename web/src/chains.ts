import { defineChain } from "viem";

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
    default: { http: ["https://rpc.testnet.arc.network/"] },
  },
  blockExplorers: {
    default: {
      name: "Arcscan",
      url: "https://testnet.arcscan.app",
    },
  },
  testnet: true,
});
