import { useAccount } from "wagmi";
import { Card } from "./ui/Card";
import { EmptyState } from "./ui/EmptyState";
import { CoinIcon, FlowIcon, LogIcon } from "./ui/icons";

/**
 * Dashboard: connected account is live via wagmi. Balance, deployed flows,
 * and the run log are honest "not implemented yet" empty states until
 * CanalisAccount / CanalisExecutor reads are wired up — see
 * docs/canalis-spec.md section 7.1 (MVP checklist).
 */
export function Dashboard() {
  const { address, isConnected } = useAccount();

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
          <EmptyState
            icon={<CoinIcon />}
            title="No balance data yet"
            detail="Reading the CanalisAccount USDC balance isn't wired up yet."
          />
        </Card>

        <Card eyebrow="Flows" title="Deployed flows">
          <EmptyState
            icon={<FlowIcon />}
            title="No flows deployed yet"
            detail="The Builder's deploy action isn't wired to the executor yet."
          />
        </Card>
      </div>

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
