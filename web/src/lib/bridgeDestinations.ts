/**
 * Curated catalog of CCTP V2 destination chains the composer's Bridge
 * action can target — confirmed live on-chain before implementation (see
 * docs/canalis-spec.md section 7.3 #3): Arc testnet's real TokenMessengerV2
 * (`remoteTokenMessengers(0)`) is wired to Ethereum Sepolia's real
 * TokenMessengerV2 at the same address (CCTP V2 deploys deterministically
 * via CREATE2 — every supported chain shares the same contract address).
 * Only Ethereum Sepolia today; add more entries once their CCTP domain +
 * remote wiring is verified the same way, not guessed.
 */
export interface BridgeDestination {
  key: string;
  label: string;
  /** CCTP domain id for this destination chain. */
  domain: number;
  /** For building an explorer link to the (separate, async) mint transaction once it lands. */
  explorerTxBase: string;
}

export const BRIDGE_DESTINATIONS: BridgeDestination[] = [
  { key: "ETH_SEPOLIA", label: "Ethereum Sepolia", domain: 0, explorerTxBase: "https://sepolia.etherscan.io/tx" },
];

export function bridgeDestinationByDomain(domain: number): BridgeDestination | undefined {
  return BRIDGE_DESTINATIONS.find((d) => d.domain === domain);
}
