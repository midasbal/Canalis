import { useAccount, useReadContract } from "wagmi";
import { formatUnits } from "viem";
import { Card } from "./ui/Card";
import { AccountFunding } from "./AccountFunding";
import { DeployedFlows } from "./DeployedFlows";
import { RunLog } from "./RunLog";
import { useCanalisAccount } from "../lib/useCanalisAccount";
import { canalisAccountAbi } from "../lib/abi";
import { arcscanAddressUrl } from "../lib/format";

/** Arc testnet USDC's ERC-20 decimals — do not confuse with the 18-decimal native gas token. */
const USDC_DECIMALS = 6;

/**
 * Dashboard: connected account + USDC balance (live), the connected
 * account's deployed flows with pause/resume/run-now controls and live
 * `previewFlow` status (slice 5, Stage 2/3), and the run log built from
 * real FlowExecuted/ActionExecuted events (Stage 3).
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
            <a
              href={arcscanAddressUrl(address)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-sm text-ink underline underline-offset-2"
            >
              {address}
            </a>
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

        <DeployedFlows />
      </div>

      <AccountFunding />

      <RunLog />
    </div>
  );
}
