import { createPublicClient, createWalletClient, http, type BaseError, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.ts";
import { arcTestnet } from "./chain.ts";
import { canalisExecutorAbi, pythAbi } from "./abi.ts";
import { telegramEnabled, logDisabledNoticeOnce, notifyTelegram } from "./notify.ts";
import { describeFlow } from "./flowSummary.ts";

// Canalis keeper — a trust-minimized poke service for the caller-agnostic
// triggers (OnSchedule / OnThreshold / OnReceive). It never decides
// anything on the user's behalf: it just calls `executeFlow`, and
// CanalisExecutor re-verifies the real on-chain precondition itself. A
// revert here (schedule not due, threshold not met, no new deposit) is
// the normal, expected outcome for most polls — not an error condition —
// so the loop always catches and continues rather than crashing. Manual
// flows are never touched; `previewFlow` naturally excludes them anyway
// (its owner-only check reports canRun=false for any caller that isn't
// the account's human owner, which this keeper never is).
//
// Flow discovery: a global flow-id scan, not flowsOf(one account) and not
// a getLogs scan. CanalisExecutor assigns every flow id from ONE
// sequential counter shared across every CanalisAccount, and
// getFlow/previewFlow/executeFlow all take a bare flowId with no owner
// scoping, so this keeper can discover and poke every account's flows
// without ever knowing which accounts exist, still purely via eth_call.
// See extendFrontier() below and README.md "Flow discovery" for the
// mechanics and its tradeoffs at scale.
//
// Telegram notifications (see notify.ts) still go to a single operator
// chat for every autonomous run across every account — per-user routing
// is roadmap, not implemented here (see ROADMAP.md).
//
// ORACLE FRESHNESS (Arc-native feature, spec section 7.3 #2): before poking
// any flow, the keeper checks whether any of that poll's flows carry an
// oracle price condition, and if the on-chain stored price for that feed
// is older than the flow's own `maxStaleness`, fetches a fresh signed
// update from Pyth's Hermes API and submits it on-chain
// (`updatePriceFeeds`, paying the fee) BEFORE calling `previewFlow`.
// CanalisExecutor itself never calls `updatePriceFeeds` (it's a read-only
// consumer — see CanalisExecutor.sol class docs), so keeping the price
// fresh is entirely this keeper's job, same spirit as it re-poking
// OnSchedule/OnThreshold rather than deciding anything on-chain state
// itself doesn't already decide. See README.md "Oracle price updates".

const account = privateKeyToAccount(config.keeperPrivateKey);

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(config.rpcUrl),
});

const walletClient = createWalletClient({
  account,
  chain: arcTestnet,
  transport: http(config.rpcUrl),
});

const explorerTx = (hash: string) => `https://testnet.arcscan.app/tx/${hash}`;

function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

async function pokeFlow(flowId: bigint) {
  try {
    const [canRun, reason] = await publicClient.readContract({
      address: config.executorAddress,
      abi: canalisExecutorAbi,
      functionName: "previewFlow",
      args: [flowId],
      account: account.address,
    });

    if (!canRun) {
      log(`skip flow #${flowId}: ${reason}`);
      return;
    }

    const hash = await walletClient.writeContract({
      address: config.executorAddress,
      abi: canalisExecutorAbi,
      functionName: "executeFlow",
      args: [flowId],
    });
    log(`executeFlow(#${flowId}) sent: ${explorerTx(hash)}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const succeeded = receipt.status === "success";
    log(`executeFlow(#${flowId}) ${succeeded ? "SUCCEEDED" : "FAILED"}: ${explorerTx(hash)}`);

    if (succeeded) {
      await notifyFlowExecuted(flowId, hash);
    }
  } catch (err) {
    // Covers both a previewFlow/executeFlow revert (e.g. state changed
    // between the preview read and the send) and a transient RPC error —
    // either way, one bad flow must never take down the whole poll loop.
    const reason = extractRevertReason(err);
    log(`skip flow #${flowId}: ${reason}`);
  }
}

/**
 * Sends a "your money moved" Telegram ping for a flow that just executed
 * successfully. Only called on real SUCCESS, never on a skip/revert (see
 * pokeFlow above). A no-op if notifications are disabled; a failure to
 * build the summary or send the message is logged and swallowed — a
 * notification is a nice-to-have, never allowed to affect the poll loop.
 */
async function notifyFlowExecuted(flowId: bigint, hash: Hex) {
  if (!telegramEnabled()) return;

  try {
    const flow = await publicClient.readContract({
      address: config.executorAddress,
      abi: canalisExecutorAbi,
      functionName: "getFlow",
      args: [flowId],
    });
    const summary = describeFlow(flow);
    const text = `✅ *Flow #${flowId} ran automatically*\n${summary}\n${explorerTx(hash)}`;
    await notifyTelegram(text, log);
  } catch (err) {
    log(`telegram notify skipped (couldn't build flow summary): ${err instanceof Error ? err.message : String(err)}`);
  }
}

function extractRevertReason(err: unknown): string {
  const asBase = err as BaseError;
  return asBase?.shortMessage ?? (err instanceof Error ? err.message : String(err));
}

const INTER_FLOW_DELAY_MS = 350; // stay under free-tier RPC rate limits

/**
 * Collects every distinct oracle `priceId` referenced by an active flow's
 * conditions, mapped to the STRICTEST (smallest) `maxStaleness` any of
 * those flows requires for that feed — so a shared feed gets refreshed
 * often enough for its most demanding flow. Flows without an oracle
 * condition (the common case) contribute nothing here — this whole step
 * costs zero extra reads for a poll with no oracle-conditioned flows.
 */
async function oraclePriceIdsNeeded(flowIds: readonly bigint[]): Promise<Map<Hex, bigint>> {
  const requirements = new Map<Hex, bigint>();

  for (const flowId of flowIds) {
    let flow;
    try {
      flow = await publicClient.readContract({
        address: config.executorAddress,
        abi: canalisExecutorAbi,
        functionName: "getFlow",
        args: [flowId],
      });
    } catch {
      continue; // an unreadable flow just contributes nothing; pokeFlow will surface the real error later
    }

    for (const condition of flow.conditions) {
      if (condition.priceId === ZERO_PRICE_ID) continue;
      const existing = requirements.get(condition.priceId);
      if (existing === undefined || condition.maxStaleness < existing) {
        requirements.set(condition.priceId, condition.maxStaleness);
      }
    }
  }

  return requirements;
}

const ZERO_PRICE_ID: Hex = `0x${"0".repeat(64)}`;

/** Fetches a signed price update for `priceIds` from Pyth's Hermes API. */
async function fetchHermesUpdate(priceIds: Hex[]): Promise<Hex[]> {
  const params = priceIds.map((id) => `ids[]=${id}`).join("&");
  const res = await fetch(`${config.hermesUrl}/v2/updates/price/latest?${params}`);
  if (!res.ok) {
    throw new Error(`Hermes request failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { binary: { data: string[] } };
  return body.binary.data.map((hex) => (hex.startsWith("0x") ? (hex as Hex) : (`0x${hex}` as Hex)));
}

/**
 * Refreshes any oracle price this poll's flows actually need, ONLY when
 * the stored on-chain price is older than the strictest flow requires —
 * saving the update fee/gas entirely on polls with no oracle-conditioned
 * flows, and skipping feeds that are already fresh enough. One
 * `updatePriceFeeds` call batches every feed that needs it.
 */
async function refreshStaleOraclePrices(flowIds: readonly bigint[]) {
  const requirements = await oraclePriceIdsNeeded(flowIds);
  if (requirements.size === 0) return;

  const stale: Hex[] = [];
  const now = BigInt(Math.floor(Date.now() / 1000));

  for (const [priceId, maxStaleness] of requirements) {
    try {
      const price = await publicClient.readContract({
        address: config.oracleAddress,
        abi: pythAbi,
        functionName: "getPriceUnsafe",
        args: [priceId],
      });
      const age = now >= price.publishTime ? now - price.publishTime : 0n;
      if (age > maxStaleness) stale.push(priceId);
    } catch {
      // Feed never updated on-chain at all — definitely needs a push.
      stale.push(priceId);
    }
  }

  if (stale.length === 0) return;

  try {
    const updateData = await fetchHermesUpdate(stale);
    const fee = await publicClient.readContract({
      address: config.oracleAddress,
      abi: pythAbi,
      functionName: "getUpdateFee",
      args: [updateData],
    });

    const hash = await walletClient.writeContract({
      address: config.oracleAddress,
      abi: pythAbi,
      functionName: "updatePriceFeeds",
      args: [updateData],
      value: fee,
    });
    log(`oracle updatePriceFeeds(${stale.length} feed(s)) sent: ${explorerTx(hash)}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    log(`oracle updatePriceFeeds ${receipt.status === "success" ? "SUCCEEDED" : "FAILED"}: ${explorerTx(hash)}`);
  } catch (err) {
    // Never let an oracle-refresh failure take down the poll — flows just
    // fail their own price-staleness check downstream instead, with a
    // clear reason, same as any other unmet precondition.
    log(`oracle price refresh failed (continuing without it): ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * How many flow ids are known to exist, i.e. `getFlow` on every id in
 * `[0, knownFlowCount)` is known to succeed. Grows monotonically: flow
 * slots are never deleted (`setFlowActive` only flips a bool, it never
 * clears `_flows[id].owner`), so once an id is confirmed valid it stays
 * valid forever and never needs re-checking. Lives only in this process's
 * memory, not on disk — a keeper restart just re-discovers from 0 via
 * extendFrontier() below, which is cheap at this project's scale (see
 * README.md "Flow discovery").
 */
let knownFlowCount = 0n;

/**
 * Extends knownFlowCount past its current value by probing `getFlow` for
 * successive flow ids, one eth_call at a time, starting exactly where the
 * last probe left off. CanalisExecutor assigns flow ids from one global
 * counter shared by every CanalisAccount (`_nextFlowId`, incremented on
 * every registerFlow regardless of owner), so this single scan covers
 * every account's flows, not just one, with zero knowledge of which
 * accounts exist and zero getLogs calls.
 *
 * Stops the instant `getFlow` reverts with the executor's own
 * "unknown flow" guard (the `flowExists` modifier) — that revert IS the
 * expected end-of-scan signal, the same way a `previewFlow`
 * "not due"/"threshold not met" revert is an expected, logged-not-erred
 * outcome elsewhere in this file, not a failure. Any OTHER error (a
 * transient RPC/transport failure) propagates instead, so the caller can
 * back off and retry the SAME id next poll rather than silently treating
 * a network hiccup as "no more flows" and truncating the scan early.
 */
async function extendFrontier(): Promise<void> {
  for (;;) {
    try {
      await publicClient.readContract({
        address: config.executorAddress,
        abi: canalisExecutorAbi,
        functionName: "getFlow",
        args: [knownFlowCount],
      });
      knownFlowCount += 1n;
    } catch (err) {
      if (isUnknownFlowRevert(err)) return; // reached the frontier — expected, not an error
      throw err;
    }
  }
}

function isUnknownFlowRevert(err: unknown): boolean {
  return extractRevertReason(err).includes("CanalisExecutor: unknown flow");
}

function allKnownFlowIds(): bigint[] {
  return Array.from({ length: Number(knownFlowCount) }, (_, i) => BigInt(i));
}

async function pollOnce() {
  await extendFrontier();
  const flowIds = allKnownFlowIds();

  await refreshStaleOraclePrices(flowIds);

  for (const flowId of flowIds) {
    await pokeFlow(flowId);
    await new Promise((resolve) => setTimeout(resolve, INTER_FLOW_DELAY_MS));
  }
}

let stopping = false;
process.on("SIGINT", () => {
  log("shutting down (SIGINT)");
  stopping = true;
});
process.on("SIGTERM", () => {
  log("shutting down (SIGTERM)");
  stopping = true;
});

async function main() {
  log(
    `canalis-keeper starting: executor=${config.executorAddress} keeper=${account.address} pollIntervalMs=${config.pollIntervalMs} (watching all accounts via a global flow-id scan)`,
  );
  logDisabledNoticeOnce(log);

  if (telegramEnabled()) {
    try {
      await extendFrontier();
      await notifyTelegram(`🟢 Canalis keeper started, watching ${knownFlowCount} flow(s) across all accounts`, log);
    } catch (err) {
      log(`startup telegram ping skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  while (!stopping) {
    try {
      await pollOnce();
    } catch (err) {
      // Transport/RPC-level failure (not a flow-specific revert) — log and
      // keep the loop alive rather than crashing the whole service.
      log(`poll error: ${err instanceof Error ? err.message : String(err)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }
}

main();
