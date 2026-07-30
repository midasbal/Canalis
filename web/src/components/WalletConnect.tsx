import { useAccount, useConnect, useDisconnect } from "wagmi";

/** Connect/disconnect button for the injected wallet on Arc testnet. */
export function WalletConnect() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-full border border-brand-bronze/20 bg-brand-surface px-3 py-1.5 font-mono text-xs text-brand-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {address.slice(0, 6)}…{address.slice(-4)}
        </span>
        <button
          onClick={() => disconnect()}
          className="rounded-full border border-brand-bronze/20 px-3 py-1.5 text-xs font-medium text-brand-muted transition-colors duration-200 hover:border-brand-bronze/40 hover:text-brand-ink"
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
      className="whitespace-nowrap rounded-full border border-brand-violet/40 bg-brand-violet/15 px-3 py-1.5 text-xs font-medium text-brand-ink transition-all duration-300 hover:border-brand-violet/70 hover:bg-brand-violet/25 hover:shadow-[0_0_28px_-6px_var(--color-brand-violet)] disabled:cursor-not-allowed disabled:opacity-50 sm:px-4 sm:text-sm"
    >
      {isPending ? "Connecting…" : connectors.length === 0 ? "No wallet" : "Connect wallet"}
    </button>
  );
}
