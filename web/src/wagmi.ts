import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { arcTestnet } from "./chains";

/**
 * Minimal wagmi config: Arc testnet only, injected wallet (e.g. MetaMask)
 * only. TODO: add Circle Wallets connector once user-controlled/modular
 * wallet support on Arc testnet is confirmed (see docs/canalis-spec.md
 * section 11, "Open decisions").
 */
export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: http(),
  },
});
