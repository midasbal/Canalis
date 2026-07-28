import { useMemo } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { EmptyState } from "./ui/EmptyState";
import { LogIcon } from "./ui/icons";
import { CreateCanalisAccountPrompt } from "./CreateCanalisAccountPrompt";
import { useCanalisAccount } from "../lib/useCanalisAccount";
import { useRunLog, type RunLogEntry } from "../lib/useRunLog";
import { canalisExecutorAbi } from "../lib/abi";
import { ActionType, type Flow } from "../lib/flows";
import { arcscanAddressUrl, arcscanTxUrl, formatTimestamp, formatUsdc, shortAddress } from "../lib/format";
import { actionTypeLabel, tokenSymbol } from "../lib/flowSummary";
import { getRevertReason } from "../lib/errors";
import { CANALIS_EXECUTOR_ADDRESS } from "../lib/contracts";

const CONTRACTS_CONFIGURED = Boolean(CANALIS_EXECUTOR_ADDRESS);

/**
 * Stage 3: what every run actually DID — flow id, each action's real
 * recipient/amount, who triggered it, when, and a link to the transaction.
 * This is what fixes the earlier "Executed with no detail" placeholder.
 * Runs that weren't triggered by the connected wallet (a real on-chain
 * fact — see lib/useRunLog.ts) are labeled "Ran automatically"; ones that
 * arrive live while this page is open also surface as a transient banner.
 *
 * The executor is shared across every user, so the log is scoped to the
 * connected account's OWN flows (via flowsOf) — otherwise it would show
 * every Canalis user's activity, not just yours.
 */
export function RunLog() {
  const { address: walletAddress, isConnected } = useAccount();
  const { accountAddress, hasAccount, isLoading: accountLoading } = useCanalisAccount();

  const flowIdsQuery = useReadContract({
    address: CANALIS_EXECUTOR_ADDRESS,
    abi: canalisExecutorAbi,
    functionName: "flowsOf",
    args: accountAddress ? [accountAddress] : undefined,
    query: { enabled: Boolean(accountAddress && CANALIS_EXECUTOR_ADDRESS) },
  });

  const { entries, hydrated, historyError, partial, retryHistory, toasts, dismissToast } = useRunLog(walletAddress, flowIdsQuery.data);

  // Swap's ActionExecuted.amount is denominated in `tokenOut` (EURC when
  // swapping USDC->EURC, USDC the other direction) — every other action
  // type only ever moves USDC (CanalisAccount is USDC-only). Resolving the
  // real unit needs each flow's own definition (`getFlow`), not a hardcoded
  // "USDC" label — see RunLogRow below.
  const flowIds = flowIdsQuery.data ?? [];
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

  const swapOutputTokenByAction = useMemo(() => {
    const map = new Map<string, string>();
    flowIds.forEach((flowId, i) => {
      const result = flowsQuery.data?.[i];
      if (!result || result.status !== "success") return;
      const flow = result.result as Flow;
      flow.actions.forEach((action, actionIndex) => {
        if (action.kind === ActionType.Swap) {
          map.set(`${flowId.toString()}-${actionIndex}`, tokenSymbol(action.tokenOut));
        }
      });
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowIds, flowsQuery.data]);

  if (!CONTRACTS_CONFIGURED) {
    return (
      <Card eyebrow="Activity" title="Run log">
        <p className="text-sm text-ink-muted">
          Set <code className="font-mono text-ink">VITE_CANALIS_EXECUTOR_ADDRESS</code> in <code>web/.env</code>.
        </p>
      </Card>
    );
  }

  if (!isConnected) {
    return (
      <Card eyebrow="Activity" title="Run log">
        <p className="text-sm text-ink-muted">Connect a wallet to see your flows' run history.</p>
      </Card>
    );
  }

  if (accountLoading) {
    return (
      <Card eyebrow="Activity" title="Run log">
        <p className="text-sm text-ink-muted">Checking for your Canalis account…</p>
      </Card>
    );
  }

  if (!hasAccount) {
    return (
      <Card eyebrow="Activity" title="Run log">
        <CreateCanalisAccountPrompt message="You need a CanalisAccount before you have any run history." />
      </Card>
    );
  }

  return (
    <Card eyebrow="Activity" title="Run log">
      {toasts.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className="animate-rise-in flex items-center justify-between gap-3 rounded-xl border border-trigger/30 bg-trigger-soft px-3.5 py-2.5 text-sm text-trigger"
            >
              <span>{toast.text}</span>
              <button onClick={() => dismissToast(toast.id)} className="text-xs text-trigger/70 hover:text-trigger">
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}

      {flowIdsQuery.isError || historyError ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-red-400">
            Couldn't load run history — {getRevertReason(flowIdsQuery.error ?? historyError)}
          </p>
          <button
            onClick={() => (flowIdsQuery.isError ? flowIdsQuery.refetch() : retryHistory())}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink transition-colors duration-200 hover:border-ink-faint"
          >
            Retry
          </button>
        </div>
      ) : flowIdsQuery.isLoading || !hydrated ? (
        <p className="text-sm text-ink-muted">Loading run history…</p>
      ) : (
        <>
          {partial && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-condition/30 bg-condition-soft px-3.5 py-2.5 text-sm text-condition">
              <span>Some blocks couldn't be scanned — history below may be incomplete.</span>
              <button onClick={retryHistory} className="text-xs underline underline-offset-2">
                Retry full scan
              </button>
            </div>
          )}
          {entries.length === 0 ? (
            <EmptyState
              icon={<LogIcon />}
              title="No executions recorded yet"
              detail="Every FlowExecuted / ActionExecuted event on this executor will show up here, newest first."
            />
          ) : (
            <div className="flex flex-col gap-3">
              {entries.map((entry) => (
                <RunLogRow key={`${entry.txHash}-${entry.flowId}`} entry={entry} swapOutputTokenByAction={swapOutputTokenByAction} />
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function RunLogRow({ entry, swapOutputTokenByAction }: { entry: RunLogEntry; swapOutputTokenByAction: Map<string, string> }) {
  return (
    <div className="rounded-xl border border-border-soft bg-surface/50 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">Flow #{entry.flowId.toString()}</span>
        {entry.isAuto && <Badge tone="accent">Ran automatically</Badge>}
        <span className="text-xs text-ink-faint">{formatTimestamp(entry.timestamp)}</span>
        <a
          href={arcscanTxUrl(entry.txHash)}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-accent-strong underline underline-offset-2"
        >
          View tx
        </a>
      </div>

      <p className="mb-2 text-xs text-ink-faint">
        Triggered by{" "}
        <a
          href={arcscanAddressUrl(entry.triggeredBy)}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-ink-muted underline underline-offset-2"
        >
          {shortAddress(entry.triggeredBy)}
        </a>
      </p>

      {entry.actions.length === 0 ? (
        <p className="text-xs text-ink-faint">No action detail on this transaction.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {entry.actions.map((action) => {
            // Every action type except Swap only ever moves USDC
            // (CanalisAccount is USDC-only) — Swap's real output token is
            // whatever the flow's own action.tokenOut is (e.g. EURC for a
            // USDC->EURC swap), resolved from the real on-chain flow
            // definition rather than assumed.
            const unit =
              action.kind === ActionType.Swap
                ? (swapOutputTokenByAction.get(`${entry.flowId.toString()}-${action.actionIndex.toString()}`) ?? "…")
                : "USDC";
            return (
              <li key={action.logKey} className="flex items-center gap-2 text-sm">
                <span className="rounded-md border border-action/30 bg-action-soft px-1.5 py-0.5 text-[11px] font-medium text-action">
                  {actionTypeLabel(action.kind)}
                </span>
                <span className="text-ink">
                  {formatUsdc(action.amount)} {unit} →{" "}
                  <a
                    href={arcscanAddressUrl(action.recipient)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono underline underline-offset-2"
                  >
                    {shortAddress(action.recipient)}
                  </a>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
