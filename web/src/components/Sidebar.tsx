import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { formatUnits } from "viem";
import { Logo } from "./ui/Logo";
import { CopyIcon } from "./ui/icons";
import { WalletConnect } from "./WalletConnect";
import { useCanalisAccount } from "../lib/useCanalisAccount";
import { canalisAccountAbi, erc20Abi } from "../lib/abi";
import { CANALIS_EURC_ADDRESS } from "../lib/contracts";
import { shortAddress } from "../lib/format";

export type Tab = "builder" | "dashboard";

const USDC_DECIMALS = 6;

const NAV_ITEMS: { id: Tab; label: string }[] = [
  { id: "builder", label: "Builder" },
  { id: "dashboard", label: "Flows" },
];

interface SidebarContentProps {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  onLogoClick: () => void;
}

/**
 * Shared sidebar content — the wordmark, the Builder/Dashboard nav, and the
 * pinned vault/wallet panel. Rendered twice: once as the persistent desktop
 * column (Sidebar below) and once inside the mobile slide-over (App.tsx),
 * so both stay in lockstep with zero duplicated logic.
 */
function SidebarContent({ tab, onTabChange, onLogoClick }: SidebarContentProps) {
  return (
    <div className="flex h-full flex-col">
      <button
        type="button"
        onClick={onLogoClick}
        className="flex shrink-0 items-center gap-2 px-5 pt-6 pb-2 transition-opacity duration-200 hover:opacity-80"
        aria-label="Back to the Canalis landing page"
      >
        <Logo className="h-7 w-7" />
        <span className="text-base font-semibold tracking-tight text-brand-ink">Canalis</span>
      </button>

      <nav className="mt-6 flex flex-col gap-1 px-3" aria-label="Primary">
        {NAV_ITEMS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => onTabChange(id)}
            aria-current={tab === id ? "page" : undefined}
            className={`rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors duration-200 ${
              tab === id
                ? "border border-brand-violet/40 bg-brand-violet/15 text-brand-ink"
                : "border border-transparent text-brand-muted hover:text-brand-ink"
            }`}
          >
            {label}
          </button>
        ))}
        <span
          className="cursor-default rounded-lg border border-transparent px-3 py-2 text-left text-sm font-medium text-brand-muted/40"
          title="Coming soon"
        >
          Docs
        </span>
      </nav>

      <div className="flex-1" />

      <AccountPanel />
    </div>
  );
}

/**
 * Pinned bottom-of-sidebar panel: the connected wallet's CanalisAccount
 * vault address (copyable) plus its live USDC/EURC balances, or a compact
 * connect prompt when disconnected. Reuses the same reads AccountFunding
 * already uses (useCanalisAccount + canalisAccountAbi.balance for USDC),
 * and the same erc20 balanceOf pattern AccountFunding uses for the wallet's
 * USDC balance, pointed at EURC instead — no new data-fetching abstraction.
 */
function AccountPanel() {
  const { isConnected } = useAccount();
  const { accountAddress, hasAccount, isLoading: accountLoading } = useCanalisAccount();
  const [copied, setCopied] = useState(false);

  const usdcBalance = useReadContract({
    address: accountAddress,
    abi: canalisAccountAbi,
    functionName: "balance",
    query: { enabled: Boolean(accountAddress) },
  });

  const eurcBalance = useReadContract({
    address: CANALIS_EURC_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: accountAddress ? [accountAddress] : undefined,
    query: { enabled: Boolean(accountAddress && CANALIS_EURC_ADDRESS) },
  });

  function handleCopy() {
    if (!accountAddress) return;
    navigator.clipboard.writeText(accountAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="shrink-0 border-t border-brand-bronze/15 p-3">
      {isConnected && (
        <div className="mb-3 rounded-lg border border-brand-bronze/15 bg-brand-surface/50 p-3">
          {accountLoading ? (
            <p className="text-xs text-brand-muted">Checking for your vault…</p>
          ) : !hasAccount ? (
            <p className="text-xs text-brand-muted">No vault yet. Create one from Builder or Flows.</p>
          ) : (
            <>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-brand-muted/70">Vault</p>
              <button
                type="button"
                onClick={handleCopy}
                title={accountAddress}
                className="mb-3 flex w-full items-center gap-1.5 font-mono text-xs text-brand-ink transition-colors duration-200 hover:text-brand-violet-soft"
              >
                <span className="truncate">{shortAddress(accountAddress!)}</span>
                <CopyIcon />
                {copied && <span className="shrink-0 text-brand-violet-soft">Copied</span>}
              </button>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[11px] text-brand-muted/70">USDC</p>
                  <p className="font-mono text-sm text-brand-ink">
                    {usdcBalance.data !== undefined ? formatUnits(usdcBalance.data, USDC_DECIMALS) : "…"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-brand-muted/70">EURC</p>
                  <p className="font-mono text-sm text-brand-ink">
                    {CANALIS_EURC_ADDRESS
                      ? eurcBalance.data !== undefined
                        ? formatUnits(eurcBalance.data, USDC_DECIMALS)
                        : "…"
                      : "—"}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <WalletConnect />
    </div>
  );
}

interface SidebarProps {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  onLogoClick: () => void;
}

/** Persistent full-height left sidebar, desktop only (see App.tsx for the mobile slide-over). */
export function Sidebar({ tab, onTabChange, onLogoClick }: SidebarProps) {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-brand-bronze/15 bg-brand-base-alt/40 md:flex lg:w-72">
      <SidebarContent tab={tab} onTabChange={onTabChange} onLogoClick={onLogoClick} />
    </aside>
  );
}

export { SidebarContent };
