import { useAccount, useConnect, useDisconnect } from "wagmi";

/** Connect/disconnect button for the injected wallet on Arc testnet. */
export function WalletConnect() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 font-mono text-xs text-ink-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {address.slice(0, 6)}…{address.slice(-4)}
        </span>
        <button
          onClick={() => disconnect()}
          className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors duration-200 hover:border-ink-faint hover:text-ink"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => connect({ connector: connectors[0] })}
      disabled={isPending || connectors.length === 0}
      className="whitespace-nowrap rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-sm shadow-accent/30 transition-all duration-200 hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50 sm:px-4 sm:text-sm"
    >
      {isPending ? "Connecting…" : connectors.length === 0 ? "No wallet" : "Connect wallet"}
    </button>
  );
}
