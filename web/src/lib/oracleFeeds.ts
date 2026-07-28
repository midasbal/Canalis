import type { Hex } from "viem";

/**
 * Curated catalog of real Pyth price feed ids the composer's oracle
 * condition can target. IMPORTANT: these are PRODUCTION (mainnet Hermes,
 * hermes.pyth.network) feed ids, not the testnet/beta catalog
 * (hermes-beta.pyth.network) — confirmed on-chain that Arc testnet's
 * deployed Pyth contract (0x2880aB155794e7179c9eE2e38200202908C17B43)
 * verifies against the real production Wormhole guardian set, so it
 * REJECTS hermes-beta-signed updates ("InvalidWormholeVaa") and only
 * accepts hermes.pyth.network updates for these production feed ids — see
 * docs/canalis-spec.md section 7.3 #2 "provider verification" for the
 * full trail. `expo` mirrors each feed's current Pyth exponent, shown for
 * reference only — the contract reads the live `expo` from the oracle
 * itself on every check, it never trusts this constant.
 */
export interface OracleFeed {
  key: string;
  label: string;
  priceId: Hex;
  expo: number;
}

export const ORACLE_FEEDS: OracleFeed[] = [
  { key: "EURUSD", label: "EUR/USD", priceId: "0xa995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b", expo: -5 },
  { key: "BTCUSD", label: "BTC/USD", priceId: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", expo: -8 },
  { key: "ETHUSD", label: "ETH/USD", priceId: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", expo: -8 },
];

export function oracleFeedByPriceId(priceId: string): OracleFeed | undefined {
  return ORACLE_FEEDS.find((f) => f.priceId.toLowerCase() === priceId.toLowerCase());
}
