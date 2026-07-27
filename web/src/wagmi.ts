import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { arcTestnet, ARC_RPC_URL } from "./chains";
import { rateLimitedHttp } from "./lib/rateLimitedTransport";

/**
 * Minimal wagmi config: Arc testnet only, injected wallet (e.g. MetaMask)
 * only. TODO: add Circle Wallets connector once user-controlled/modular
 * wallet support on Arc testnet is confirmed (see docs/canalis-spec.md
 * section 11, "Open decisions").
 *
 * The transport is rate-limit-aware (see lib/rateLimitedTransport.ts) —
 * set VITE_ARC_RPC_URL to a keyed endpoint to sidestep the public RPC's
 * throttling entirely; the wrapper is still a safety net either way.
 */
export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: rateLimitedHttp(ARC_RPC_URL),
  },
});
