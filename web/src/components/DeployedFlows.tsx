import { useEffect, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { Card } from "./ui/Card";
import { EmptyState } from "./ui/EmptyState";
import { FlowIcon } from "./ui/icons";
import { CreateCanalisAccountPrompt } from "./CreateCanalisAccountPrompt";
import { InfoTooltip } from "./ui/InfoTooltip";
import { FlowRow } from "./FlowRow";
import { useCanalisAccount } from "../lib/useCanalisAccount";
import { canalisExecutorAbi } from "../lib/abi";
import { CANALIS_EXECUTOR_ADDRESS } from "../lib/contracts";
import { getRevertReason } from "../lib/errors";

const CONTRACTS_CONFIGURED = Boolean(CANALIS_EXECUTOR_ADDRESS);
const PREVIEW_REFRESH_MS = 15_000;

const DEPLOYED_FLOWS_TITLE = (
  <>
    Deployed flows
    <InfoTooltip label="About deployed flows">
      Every flow you have deployed to your vault, with its live status and controls to pause, resume, or run it now.
    </InfoTooltip>
  </>
);

interface DeployedFlowsProps {
  /** Switches the app to the Builder tab — wired to the empty state's CTA. */
  onGoToBuilder: () => void;
}

/** Stage 2: the connected account's flows, via flowsOf(account) -> getFlow(id) per id. */
export function DeployedFlows({ onGoToBuilder }: DeployedFlowsProps) {
  const { isConnected, address: walletAddress } = useAccount();
  const { accountAddress, hasAccount, isLoading: accountLoading } = useCanalisAccount();

  const flowIdsQuery = useReadContract({
    address: CANALIS_EXECUTOR_ADDRESS,
    abi: canalisExecutorAbi,
    functionName: "flowsOf",
    args: accountAddress ? [accountAddress] : undefined,
    query: { enabled: Boolean(accountAddress && CANALIS_EXECUTOR_ADDRESS) },
  });

  // One shared timer drives every row's live-status refresh, instead of N
  // independent per-row timers all hitting the RPC at their own offset.
  const [previewRefreshTick, setPreviewRefreshTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setPreviewRefreshTick((t) => t + 1), PREVIEW_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  if (!CONTRACTS_CONFIGURED) {
    return (
      <Card eyebrow="Flows" title={DEPLOYED_FLOWS_TITLE}>
        <p className="text-sm text-ink-muted">
          Set <code className="font-mono text-ink">VITE_CANALIS_EXECUTOR_ADDRESS</code> in <code>web/.env</code>.
        </p>
      </Card>
    );
  }

  if (!isConnected) {
    return (
      <Card eyebrow="Flows" title={DEPLOYED_FLOWS_TITLE}>
        <p className="text-sm text-ink-muted">Connect a wallet to see your flows.</p>
      </Card>
    );
  }

  if (accountLoading) {
    return (
      <Card eyebrow="Flows" title={DEPLOYED_FLOWS_TITLE}>
        <p className="text-sm text-ink-muted">Checking for your Canalis account…</p>
      </Card>
    );
  }

  if (!hasAccount) {
    return (
      <Card eyebrow="Flows" title={DEPLOYED_FLOWS_TITLE}>
        <CreateCanalisAccountPrompt message="You need a CanalisAccount before you have any flows." />
      </Card>
    );
  }

  const flowIds = flowIdsQuery.data;

  return (
    <Card eyebrow="Flows" title={DEPLOYED_FLOWS_TITLE}>
      {flowIdsQuery.isLoading ? (
        <p className="text-sm text-ink-muted">Loading your flows…</p>
      ) : flowIdsQuery.isError ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-red-400">Couldn't load your flows. {getRevertReason(flowIdsQuery.error)}</p>
          <button
            onClick={() => flowIdsQuery.refetch()}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink transition-colors duration-200 hover:border-ink-faint"
          >
            Retry
          </button>
        </div>
      ) : !flowIds || flowIds.length === 0 ? (
        <EmptyState
          icon={<FlowIcon />}
          title="No channels running yet. Build one, and your money starts to move on its own."
          badge={null}
          action={
            <button
              type="button"
              onClick={onGoToBuilder}
              className="mt-1 rounded-full border border-brand-violet/40 bg-brand-violet/15 px-4 py-2 text-xs font-medium text-brand-ink transition-all duration-300 hover:border-brand-violet/70 hover:bg-brand-violet/25 hover:shadow-[0_0_28px_-6px_var(--color-brand-violet)]"
            >
              Go to Builder
            </button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {flowIds.map((flowId) => (
            <FlowRow
              key={flowId.toString()}
              flowId={flowId}
              walletAddress={walletAddress}
              previewRefreshTick={previewRefreshTick}
              onChanged={() => flowIdsQuery.refetch()}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
