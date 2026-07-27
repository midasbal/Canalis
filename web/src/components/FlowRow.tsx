import { useEffect, useRef } from "react";
import type { Address } from "viem";
import { useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { canalisExecutorAbi } from "../lib/abi";
import { CANALIS_EXECUTOR_ADDRESS } from "../lib/contracts";
import { SCHEDULE_NEVER_AGAIN, TriggerType, type Flow } from "../lib/flows";
import { arcscanTxUrl, formatCountdown } from "../lib/format";
import { getRevertReason } from "../lib/errors";
import { summarizeFlow, triggerTypeLabel } from "../lib/flowSummary";
import { useNowSeconds } from "../lib/useNowSeconds";

interface FlowRowProps {
  flowId: bigint;
  walletAddress: Address | undefined;
  /** Bumped by the parent on a shared timer — see DeployedFlows — so every row's live status refreshes together as one batch instead of N independent timers. */
  previewRefreshTick: number;
  onChanged: () => void;
}

/**
 * One deployed flow: its plain-English summary (Stage 2), pause/resume +
 * run-now controls (Stage 2), and a live `previewFlow`-backed status +
 * next-run countdown (Stage 3).
 *
 * Reads go through the shared rate-limited transport (lib/rateLimitedTransport.ts)
 * so a page of N rows doesn't burst the public Arc RPC; every read here
 * still resolves to loaded/empty/ERROR — never a permanent spinner — with a
 * compact retry affordance on failure. Run/Pause are guarded against
 * double-submit with a synchronous ref (not just the reactive `disabled`
 * prop, which can lag a render behind a real double-click) and surface
 * decoded revert reasons instead of a raw error dump.
 */
export function FlowRow({ flowId, walletAddress, previewRefreshTick, onChanged }: FlowRowProps) {
  const now = useNowSeconds(1000);

  const flowQuery = useReadContract({
    address: CANALIS_EXECUTOR_ADDRESS,
    abi: canalisExecutorAbi,
    functionName: "getFlow",
    args: [flowId],
    query: { enabled: Boolean(CANALIS_EXECUTOR_ADDRESS) },
  });

  const previewQuery = useReadContract({
    address: CANALIS_EXECUTOR_ADDRESS,
    abi: canalisExecutorAbi,
    functionName: "previewFlow",
    args: [flowId],
    account: walletAddress,
    query: { enabled: Boolean(CANALIS_EXECUTOR_ADDRESS) },
  });
  const refetchPreview = previewQuery.refetch;

  // Centralized refresh: one shared timer upstream ticks this, rather than
  // each row running its own independent refetchInterval.
  useEffect(() => {
    if (previewRefreshTick === 0) return; // skip the initial mount value
    refetchPreview();
  }, [previewRefreshTick, refetchPreview]);

  const pauseTx = useWriteContract();
  const pauseReceipt = useWaitForTransactionReceipt({ hash: pauseTx.data });
  const pausingRef = useRef(false);

  const runTx = useWriteContract();
  const runReceipt = useWaitForTransactionReceipt({ hash: runTx.data });
  const runningRef = useRef(false);

  useEffect(() => {
    if (!pauseReceipt.isSuccess) return;
    flowQuery.refetch();
    previewQuery.refetch();
    onChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pauseReceipt.isSuccess]);

  useEffect(() => {
    if (!runReceipt.isSuccess) return;
    flowQuery.refetch();
    previewQuery.refetch();
    onChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runReceipt.isSuccess]);

  if (flowQuery.isLoading) {
    return (
      <Card>
        <p className="text-sm text-ink-muted">Loading flow #{flowId.toString()}…</p>
      </Card>
    );
  }

  if (flowQuery.isError || !flowQuery.data) {
    return (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-red-400">
            Couldn't load flow #{flowId.toString()} — {getRevertReason(flowQuery.error)}
          </p>
          <button
            onClick={() => flowQuery.refetch()}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink transition-colors duration-200 hover:border-ink-faint"
          >
            Retry
          </button>
        </div>
      </Card>
    );
  }

  // The ABI decodes uint8 fields as plain `number`; cast to the canonical,
  // narrower `Flow` type (lib/flows.ts) that the rest of the app shares.
  const flow = flowQuery.data as unknown as Flow;
  const pausing = pauseTx.isPending || pauseReceipt.isLoading;
  const running = runTx.isPending || runReceipt.isLoading;

  async function handleToggleActive() {
    if (!CANALIS_EXECUTOR_ADDRESS || pausingRef.current) return;
    pausingRef.current = true;
    try {
      await pauseTx.writeContractAsync({
        address: CANALIS_EXECUTOR_ADDRESS,
        abi: canalisExecutorAbi,
        functionName: "setFlowActive",
        args: [flowId, !flow.active],
      });
    } catch {
      // Surfaced via pauseTx.error below — swallow here so a rejection
      // (e.g. the wallet popup being dismissed) never reaches the console
      // as an unhandled promise rejection.
    } finally {
      pausingRef.current = false;
    }
  }

  async function handleRunNow() {
    if (!CANALIS_EXECUTOR_ADDRESS || runningRef.current) return;
    runningRef.current = true;
    try {
      await runTx.writeContractAsync({
        address: CANALIS_EXECUTOR_ADDRESS,
        abi: canalisExecutorAbi,
        functionName: "executeFlow",
        args: [flowId],
      });
    } catch {
      // Surfaced via runTx.error below.
    } finally {
      runningRef.current = false;
    }
  }

  const [canRun, reason] = previewQuery.data ?? [undefined, undefined];

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink">Flow #{flowId.toString()}</span>
            <Badge tone={flow.active ? "accent" : "neutral"}>{flow.active ? "Active" : "Paused"}</Badge>
            <span className="text-xs text-trigger">{triggerTypeLabel(flow.trigger.kind)}</span>
          </div>
          <p className="text-sm text-ink-muted">{summarizeFlow(flow)}</p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <button
            onClick={handleToggleActive}
            disabled={pausing || running}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink transition-colors duration-200 hover:border-ink-faint disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pausing ? "Working…" : flow.active ? "Pause" : "Resume"}
          </button>
          <button
            onClick={handleRunNow}
            disabled={running || pausing}
            className="rounded-lg bg-action px-3 py-1.5 text-xs font-medium text-white transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? "Running…" : "Run now"}
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border-soft pt-3 text-xs">
        {previewQuery.isError ? (
          <span className="flex items-center gap-1.5 text-red-400">
            Live status unavailable
            <button onClick={() => previewQuery.refetch()} className="underline underline-offset-2">
              Retry
            </button>
          </span>
        ) : canRun === undefined ? (
          <span className="text-ink-faint">Checking live status…</span>
        ) : canRun ? (
          <span className="flex items-center gap-1.5 text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Would run now
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-ink-faint" title={reason}>
            <span className="h-1.5 w-1.5 rounded-full bg-ink-faint" /> Wouldn't run: {reason}
          </span>
        )}

        {flow.trigger.kind === TriggerType.OnSchedule && flow.active && flow.trigger.scheduleAt !== SCHEDULE_NEVER_AGAIN && (
          <span className="text-ink-faint">Next run: {formatCountdown(flow.trigger.scheduleAt, now)}</span>
        )}
      </div>

      {(pauseTx.error || runTx.error) && (
        <p className="mt-2 text-xs text-red-400">{getRevertReason(pauseTx.error ?? runTx.error)}</p>
      )}

      {runReceipt.isSuccess && runReceipt.data && (
        <a
          href={arcscanTxUrl(runReceipt.data.transactionHash)}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-xs text-accent-strong underline underline-offset-2"
        >
          View run on arcscan
        </a>
      )}
      {pauseReceipt.isSuccess && pauseReceipt.data && (
        <a
          href={arcscanTxUrl(pauseReceipt.data.transactionHash)}
          target="_blank"
          rel="noreferrer"
          className="mt-2 ml-3 inline-block text-xs text-accent-strong underline underline-offset-2"
        >
          View on arcscan
        </a>
      )}
    </Card>
  );
}
