import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { usePublicClient } from "wagmi";
import type { Address, Hex } from "viem";
import { canalisExecutorAbi } from "./abi";
import { CANALIS_EXECUTOR_ADDRESS, CANALIS_EXECUTOR_DEPLOY_BLOCK, CANALIS_GETLOGS_CHUNK_BLOCKS, CANALIS_RUNLOG_LOOKBACK_BLOCKS } from "./contracts";
import type { ActionType } from "./flows";

/** How often the live catch-up poll runs. */
const LIVE_POLL_MS = 15_000;
const TOAST_LIFETIME_MS = 8_000;

interface RunLogAction {
  logKey: string;
  actionIndex: bigint;
  kind: ActionType;
  recipient: Address;
  amount: bigint;
}

export interface RunLogEntry {
  txHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  flowId: bigint;
  triggeredBy: Address;
  timestamp: bigint;
  actions: RunLogAction[];
  /** true when `triggeredBy` isn't the currently connected wallet — an on-chain fact, not a guess. */
  isAuto: boolean;
}

interface ToastMessage {
  id: string;
  text: string;
}

interface FlowExecutedRaw {
  logKey: string;
  txHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  flowId: bigint;
  triggeredBy: Address;
  timestamp: bigint;
}

interface ActionExecutedRaw {
  logKey: string;
  txHash: Hex;
  actionIndex: bigint;
  kind: ActionType;
  recipient: Address;
  amount: bigint;
}

interface ChunkedScanResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logs: any[];
  /** true if at least one chunk failed even after the transport's own retry/backoff — the rest of the scan still runs, this just flags the result as partial. */
  incomplete: boolean;
}

/**
 * Scans [fromBlock, toBlock] in CANALIS_GETLOGS_CHUNK_BLOCKS-sized windows —
 * shared by both the initial historical backfill and the live catch-up
 * poll below, so NEITHER path can ever issue a single getLogs call wider
 * than the configured cap, no matter how large the requested range is
 * (e.g. a backgrounded tab catching up after a long gap).
 */
async function scanLogsChunked(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
  eventAbiItem: (typeof canalisExecutorAbi)[number],
  fromBlock: bigint,
  toBlock: bigint,
): Promise<ChunkedScanResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allLogs: any[] = [];
  let incomplete = false;
  let from = fromBlock;

  while (from <= toBlock) {
    const to = from + CANALIS_GETLOGS_CHUNK_BLOCKS - 1n < toBlock ? from + CANALIS_GETLOGS_CHUNK_BLOCKS - 1n : toBlock;
    try {
      const logs = await publicClient.getLogs({
        address: CANALIS_EXECUTOR_ADDRESS,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        event: eventAbiItem as any,
        fromBlock: from,
        toBlock: to,
      });
      allLogs.push(...logs);
    } catch {
      // One bad chunk (even after the rate-limited transport's own
      // retry/backoff is exhausted) shouldn't fail the whole scan — keep
      // going and surface what did load, flagged as partial.
      incomplete = true;
    }
    from = to + 1n;
  }

  return { logs: allLogs, incomplete };
}

function mapFlowExecutedLog(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  log: any,
): FlowExecutedRaw {
  return {
    logKey: `${log.transactionHash}-${log.logIndex}`,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.logIndex,
    flowId: log.args.flowId,
    triggeredBy: log.args.triggeredBy,
    timestamp: log.args.timestamp,
  };
}

function mapActionExecutedLog(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  log: any,
): ActionExecutedRaw {
  return {
    logKey: `${log.transactionHash}-${log.logIndex}`,
    txHash: log.transactionHash,
    actionIndex: log.args.actionIndex,
    kind: log.args.kind,
    recipient: log.args.recipient,
    amount: log.args.amount,
  };
}

const FLOW_EXECUTED_ABI_ITEM = canalisExecutorAbi.find((e) => e.type === "event" && e.name === "FlowExecuted")!;
const ACTION_EXECUTED_ABI_ITEM = canalisExecutorAbi.find((e) => e.type === "event" && e.name === "ActionExecuted")!;

/**
 * Stage 3: historical + live FlowExecuted/ActionExecuted events, merged by
 * transaction hash into one row per execution (with its action legs
 * nested). "Ran itself" is detected honestly, not guessed: `isAuto`
 * compares the event's real `triggeredBy` against the connected wallet —
 * an on-chain fact. A toast only fires for entries that arrive via the
 * LIVE poll after the initial historical backlog has loaded, so old runs
 * from before this page was open are never mis-announced as "just
 * happened".
 *
 * Free-tier RPCs cap `eth_getLogs` hard (QuickNode as low as 5 blocks,
 * Alchemy 10) — both the historical backfill and the live catch-up poll
 * go through `scanLogsChunked`, so no request here ever spans more than
 * `CANALIS_GETLOGS_CHUNK_BLOCKS`. The backfill is also bounded to a small
 * RECENT window (`CANALIS_RUNLOG_LOOKBACK_BLOCKS`), not deployBlock→head —
 * older runs beyond that window simply aren't backfilled.
 *
 * `ownFlowIds` scopes the log to one CanalisAccount's own flows — the
 * executor is shared across every user, so without this filter the log
 * would show everyone's executions, not just yours. Pass `undefined`
 * while the caller's own flow-id list hasn't loaded yet (nothing is shown
 * until it has, rather than briefly flashing unrelated activity).
 */
export function useRunLog(connectedWallet: Address | undefined, ownFlowIds: readonly bigint[] | undefined) {
  const publicClient = usePublicClient();
  const ownFlowIdSet = useMemo(() => new Set((ownFlowIds ?? []).map((id) => id.toString())), [ownFlowIds]);
  const [flowExecuted, setFlowExecuted] = useState<FlowExecutedRaw[]>([]);
  const [actionExecuted, setActionExecuted] = useState<ActionExecutedRaw[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [historyError, setHistoryError] = useState<unknown>(null);
  const [partial, setPartial] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Read inside the live-poll interval (set up once, see below) without
  // forcing that interval to tear down and restart whenever these change.
  const connectedWalletRef = useRef(connectedWallet);
  useEffect(() => {
    connectedWalletRef.current = connectedWallet;
  }, [connectedWallet]);
  const ownFlowIdSetRef = useRef(ownFlowIdSet);
  useEffect(() => {
    ownFlowIdSetRef.current = ownFlowIdSet;
  }, [ownFlowIdSet]);

  // Set once the historical backfill completes, to the last block it
  // covered — the live poll below picks up from exactly there.
  const lastSeenBlockRef = useRef<bigint | null>(null);

  useEffect(() => {
    if (!publicClient || !CANALIS_EXECUTOR_ADDRESS) return;
    let cancelled = false;
    setHistoryError(null);
    setPartial(false);

    (async () => {
      try {
        const latestBlock = await publicClient.getBlockNumber();
        const lookbackStart = latestBlock > CANALIS_RUNLOG_LOOKBACK_BLOCKS ? latestBlock - CANALIS_RUNLOG_LOOKBACK_BLOCKS : 0n;
        // The deploy block only ever raises the floor (skip ranges before
        // the contract existed) — the recent-window bound is what actually
        // keeps this from scanning deployBlock→head.
        const fromStart = CANALIS_EXECUTOR_DEPLOY_BLOCK && CANALIS_EXECUTOR_DEPLOY_BLOCK > lookbackStart
          ? CANALIS_EXECUTOR_DEPLOY_BLOCK
          : lookbackStart;

        const [flowResult, actionResult] = await Promise.all([
          scanLogsChunked(publicClient, FLOW_EXECUTED_ABI_ITEM, fromStart, latestBlock),
          scanLogsChunked(publicClient, ACTION_EXECUTED_ABI_ITEM, fromStart, latestBlock),
        ]);
        if (cancelled) return;

        setFlowExecuted(flowResult.logs.map(mapFlowExecutedLog));
        setActionExecuted(actionResult.logs.map(mapActionExecutedLog));
        // A chunk failing mid-scan degrades to "show what loaded" (see
        // scanLogsChunked) rather than failing the whole log — flagged
        // here so the UI can show a non-blocking "partial history" notice.
        setPartial(flowResult.incomplete || actionResult.incomplete);
        lastSeenBlockRef.current = latestBlock;
        setHydrated(true);
      } catch (error) {
        // Only reached if we couldn't even determine the block range to
        // scan (e.g. getBlockNumber itself failed) — every read still
        // resolves to loaded/empty/ERROR, never a permanent "Loading run
        // history…".
        if (!cancelled) setHistoryError(error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publicClient, reloadNonce]);

  function retryHistory() {
    setReloadNonce((n) => n + 1);
  }

  // Live catch-up poll — deliberately NOT wagmi's useWatchContractEvent,
  // whose internal polling can request an arbitrarily wide range in one
  // getLogs call after a gap (e.g. a backgrounded tab). This reuses the
  // same chunker as the historical backfill, so a request here can never
  // exceed CANALIS_GETLOGS_CHUNK_BLOCKS regardless of how long the tab was
  // away.
  useEffect(() => {
    if (!publicClient || !CANALIS_EXECUTOR_ADDRESS) return;
    let cancelled = false;
    let inFlight = false;

    const timer = setInterval(() => {
      if (inFlight || lastSeenBlockRef.current === null) return; // still waiting on the initial backfill
      inFlight = true;

      (async () => {
        try {
          const latestBlock = await publicClient.getBlockNumber();
          const from = lastSeenBlockRef.current! + 1n;
          if (from > latestBlock || cancelled) return;

          const [flowResult, actionResult] = await Promise.all([
            scanLogsChunked(publicClient, FLOW_EXECUTED_ABI_ITEM, from, latestBlock),
            scanLogsChunked(publicClient, ACTION_EXECUTED_ABI_ITEM, from, latestBlock),
          ]);
          if (cancelled) return;

          const freshFlowLogs = flowResult.logs.map(mapFlowExecutedLog);
          setFlowExecuted((prev) => dedupeByKey([...prev, ...freshFlowLogs]));
          setActionExecuted((prev) => dedupeByKey([...prev, ...actionResult.logs.map(mapActionExecutedLog)]));

          for (const entry of freshFlowLogs) {
            if (!ownFlowIdSetRef.current.has(entry.flowId.toString())) continue; // not one of this account's flows
            const wallet = connectedWalletRef.current;
            if (wallet && entry.triggeredBy.toLowerCase() === wallet.toLowerCase()) continue;
            pushToast(setToasts, `Flow #${entry.flowId.toString()} ran automatically. See the run log below.`);
          }

          // Only advance past what we're confident we actually covered —
          // a failed chunk just means the same (dedupe-safe) range gets
          // retried next tick instead of silently skipping blocks.
          if (!flowResult.incomplete && !actionResult.incomplete) {
            lastSeenBlockRef.current = latestBlock;
          }
        } catch {
          // Transient RPC hiccup — try again next tick.
        } finally {
          inFlight = false;
        }
      })();
    }, LIVE_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [publicClient]);

  const entries: RunLogEntry[] = useMemo(() => {
    if (!ownFlowIds) return []; // caller's own flow list hasn't loaded yet — show nothing rather than everyone's activity

    const merged = flowExecuted
      .filter((f) => ownFlowIdSet.has(f.flowId.toString()))
      .map((f): RunLogEntry => ({
        txHash: f.txHash,
        blockNumber: f.blockNumber,
        logIndex: f.logIndex,
        flowId: f.flowId,
        triggeredBy: f.triggeredBy,
        timestamp: f.timestamp,
        actions: actionExecuted
          .filter((a) => a.txHash === f.txHash)
          .map((a) => ({ logKey: a.logKey, actionIndex: a.actionIndex, kind: a.kind, recipient: a.recipient, amount: a.amount }))
          .sort((a, b) => Number(a.actionIndex - b.actionIndex)),
        isAuto: Boolean(connectedWallet) && f.triggeredBy.toLowerCase() !== connectedWallet!.toLowerCase(),
      }));

    return merged.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return b.blockNumber > a.blockNumber ? 1 : -1;
      return b.logIndex - a.logIndex;
    });
  }, [flowExecuted, actionExecuted, connectedWallet, ownFlowIds, ownFlowIdSet]);

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return { entries, hydrated, historyError, partial, retryHistory, toasts, dismissToast };
}

function dedupeByKey<T extends { logKey: string }>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const item of items) seen.set(item.logKey, item);
  return [...seen.values()];
}

let toastCounter = 0;
function pushToast(setToasts: Dispatch<SetStateAction<ToastMessage[]>>, text: string) {
  toastCounter += 1;
  const id = `toast-${toastCounter}`;
  setToasts((prev) => [...prev, { id, text }]);
  setTimeout(() => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, TOAST_LIFETIME_MS);
}
