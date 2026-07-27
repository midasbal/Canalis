import { useAccount, useReadContract } from "wagmi";
import { formatUnits } from "viem";
import { Card } from "./ui/Card";
import { EmptyState } from "./ui/EmptyState";
import { FlowIcon, LogIcon } from "./ui/icons";
import { AccountFunding } from "./AccountFunding";
import { useCanalisAccount } from "../lib/useCanalisAccount";
import { canalisAccountAbi } from "../lib/abi";

/** Arc testnet USDC's ERC-20 decimals — do not confuse with the 18-decimal native gas token. */
const USDC_DECIMALS = 6;

/**
 * Dashboard: connected account and USDC balance are live via wagmi.
 * Deployed flows and the run log are still honest "not implemented yet"
 * empty states until CanalisExecutor event indexing is wired up — see
 * docs/canalis-spec.md section 7.1 (MVP checklist).
 */
export function Dashboard() {
  const { address, isConnected } = useAccount();
  const { accountAddress, hasAccount, isLoading: accountLoading } = useCanalisAccount();

  const { data: balance, isLoading: balanceLoading } = useReadContract({
    address: accountAddress,
    abi: canalisAccountAbi,
    functionName: "balance",
    query: { enabled: Boolean(accountAddress) },
  });

  return (
    <div className="flex flex-col gap-6">
      <Card eyebrow="Account" title={isConnected ? "Connected" : "Not connected"}>
        {isConnected && address ? (
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="font-mono text-sm text-ink">{address}</span>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">Connect a wallet from the header to view account details.</p>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card eyebrow="USDC" title="Balance">
          {!isConnected ? (
            <p className="text-sm text-ink-muted">Connect a wallet to see your balance.</p>
          ) : accountLoading ? (
            <p className="text-sm text-ink-muted">Checking for your Canalis account…</p>
          ) : !hasAccount ? (
            <p className="text-sm text-ink-muted">No CanalisAccount yet — create one from the Builder tab.</p>
          ) : balanceLoading ? (
            <p className="text-sm text-ink-muted">Loading balance…</p>
          ) : (
            <p className="text-2xl font-semibold text-ink">
              {formatUnits(balance ?? 0n, USDC_DECIMALS)} <span className="text-sm text-ink-muted">USDC</span>
            </p>
          )}
        </Card>

        <Card eyebrow="Flows" title="Deployed flows">
          <EmptyState
            icon={<FlowIcon />}
            title="No flows deployed yet"
            detail="Listing all deployed flows isn't wired up yet — the Builder tab can deploy and run one Forward flow."
          />
        </Card>
      </div>

      <AccountFunding />

      <Card eyebrow="Activity" title="Run log">
        <EmptyState
          icon={<LogIcon />}
          title="No executions recorded yet"
          detail="This will index FlowExecuted / ActionExecuted events and link each run to arcscan."
        />
      </Card>
    </div>
  );
}
