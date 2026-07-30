import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { AccountFunding } from "./AccountFunding";
import { DeployedFlows } from "./DeployedFlows";
import { RunLog } from "./RunLog";
import { InfoTooltip } from "./ui/InfoTooltip";
import { useCanalisAccount } from "../lib/useCanalisAccount";
import { canalisAccountAbi, canalisExecutorAbi, erc20Abi } from "../lib/abi";
import { CANALIS_EURC_ADDRESS, CANALIS_EXECUTOR_ADDRESS } from "../lib/contracts";
import { arcscanAddressUrl, shortAddress } from "../lib/format";
import type { Flow } from "../lib/flows";

/** Arc testnet USDC/EURC's ERC-20 decimals — do not confuse with the 18-decimal native gas token. */
const TOKEN_DECIMALS = 6;

/**
 * Dashboard: a slim connected-account line, a compact live stats cluster
 * (USDC/EURC vault balances + how many deployed flows are active), the
 * deployed-flows list (the page's primary content), and the funding +
 * run-log sections below as lighter secondary panels.
 */
interface DashboardProps {
  /** Switches the app to the Builder tab — wired to the "no channels yet" empty state's CTA. */
  onGoToBuilder: () => void;
}

export function Dashboard({ onGoToBuilder }: DashboardProps) {
  const { address, isConnected } = useAccount();
  const { accountAddress, hasAccount, isLoading: accountLoading } = useCanalisAccount();

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

  const flowIdsQuery = useReadContract({
    address: CANALIS_EXECUTOR_ADDRESS,
    abi: canalisExecutorAbi,
    functionName: "flowsOf",
    args: accountAddress ? [accountAddress] : undefined,
    query: { enabled: Boolean(accountAddress && CANALIS_EXECUTOR_ADDRESS) },
  });
  const flowIds = flowIdsQuery.data ?? [];

  // Same getFlow-per-id read RunLog already performs for this account's
  // flows — react-query dedupes the identical query keys, so this doesn't
  // add new network traffic beyond what the page already loads.
  const flowsQuery = useReadContracts({
    contracts: flowIds.map(
      (flowId) =>
        ({
          address: CANALIS_EXECUTOR_ADDRESS,
          abi: canalisExecutorAbi,
          functionName: "getFlow",
          args: [flowId],
        }) as const,
    ),
    query: { enabled: flowIds.length > 0 },
  });
  const activeCount = flowsQuery.data?.filter((r) => r.status === "success" && (r.result as Flow).active).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-bronze/10 pb-4">
        {isConnected && address ? (
          <a
            href={arcscanAddressUrl(address)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 font-mono text-xs text-brand-muted underline underline-offset-2 hover:text-brand-ink"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {shortAddress(address)}
          </a>
        ) : (
          <p className="text-sm text-brand-muted">Connect a wallet from the sidebar to view account details.</p>
        )}
      </div>

      {isConnected && (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
          <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-brand-muted/70">
            Vault
            <InfoTooltip label="About these stats">
              Your vault's live balances, and how many of your deployed flows are currently active.
            </InfoTooltip>
          </span>

          {accountLoading ? (
            <p className="text-sm text-brand-muted">Checking for your vault…</p>
          ) : !hasAccount ? (
            <p className="text-sm text-brand-muted">No vault yet. Create one below to see your balances.</p>
          ) : (
            <>
              <Stat label="USDC" value={usdcBalance.data !== undefined ? formatUnits(usdcBalance.data, TOKEN_DECIMALS) : "…"} />
              <Stat
                label="EURC"
                value={
                  !CANALIS_EURC_ADDRESS
                    ? "—"
                    : eurcBalance.data !== undefined
                      ? formatUnits(eurcBalance.data, TOKEN_DECIMALS)
                      : "…"
                }
              />
              <Stat
                label="Active flows"
                value={activeCount !== undefined ? `${activeCount} / ${flowIds.length}` : flowIds.length > 0 ? "…" : "0 / 0"}
              />
            </>
          )}
        </div>
      )}

      <DeployedFlows onGoToBuilder={onGoToBuilder} />

      <div className="my-1 border-t border-brand-bronze/10" />

      <AccountFunding />

      <RunLog />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-mono text-lg font-semibold text-brand-ink">{value}</span>
      <span className="text-xs text-brand-muted">{label}</span>
    </div>
  );
}
