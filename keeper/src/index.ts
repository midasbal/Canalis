import { createPublicClient, createWalletClient, http, type BaseError } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.ts";
import { arcTestnet } from "./chain.ts";
import { canalisExecutorAbi, TriggerType } from "./abi.ts";

// Canalis keeper — a trust-minimized poke service for the caller-agnostic
// triggers (OnSchedule / OnThreshold / OnReceive). It never decides
// anything on the user's behalf: it just calls `executeFlow`, and
// CanalisExecutor re-verifies the real on-chain precondition itself. A
// revert here (schedule not due, threshold not met, no new deposit) is
// the normal, expected outcome for most polls — not an error condition —
// so the loop always catches and continues rather than crashing. Manual
// flows are never touched; only the account owner may fire those.
//
// Flow discovery: FlowRegistered events are indexed directly from the
// executor (across ALL owners, not per-account), since CanalisExecutor has
// no on-chain per-owner enumeration function. See CLAUDE.md / spec §7.1.

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

const knownFlowIds = new Set<bigint>();
let lastScannedBlock = config.fromBlock === 0n ? 0n : config.fromBlock - 1n;

function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

async function discoverNewFlows() {
  const latestBlock = await publicClient.getBlockNumber();
  if (latestBlock < lastScannedBlock) return; // reorg edge case: just wait for next poll

  const flowRegisteredEvent = canalisExecutorAbi.find((e) => e.type === "event" && e.name === "FlowRegistered") as any;

  // The RPC caps eth_getLogs at a 10,000-block range, so chunk the scan
  // rather than requesting the whole span in one call.
  const MAX_RANGE = 9_999n;
  let from = lastScannedBlock === 0n ? 0n : lastScannedBlock + 1n;

  while (from <= latestBlock) {
    const to = from + MAX_RANGE < latestBlock ? from + MAX_RANGE : latestBlock;

    const logs = await publicClient.getLogs({
      address: config.executorAddress,
      event: flowRegisteredEvent,
      fromBlock: from,
      toBlock: to,
    });

    for (const entry of logs) {
      const flowId = (entry as any).args.flowId as bigint;
      if (!knownFlowIds.has(flowId)) {
        knownFlowIds.add(flowId);
        log(`discovered flow #${flowId} (owner ${(entry as any).args.owner})`);
      }
    }

    from = to + 1n;
  }

  lastScannedBlock = latestBlock;
}

async function pokeFlow(flowId: bigint) {
  try {
    const flow = await publicClient.readContract({
      address: config.executorAddress,
      abi: canalisExecutorAbi,
      functionName: "getFlow",
      args: [flowId],
    });

    if (!flow.active) return;
    if (flow.trigger.kind === TriggerType.Manual) return; // owner-only, not the keeper's job

    // Free simulation first: if the trigger/conditions aren't satisfied
    // yet, this throws and we skip without spending any gas. This is a
    // gas-saving pre-filter only — the real send below still goes through
    // the exact same on-chain re-verification regardless.
    const { request } = await publicClient.simulateContract({
      account,
      address: config.executorAddress,
      abi: canalisExecutorAbi,
      functionName: "executeFlow",
      args: [flowId],
    });

    const hash = await walletClient.writeContract(request);
    log(`executeFlow(#${flowId}) sent: ${explorerTx(hash)}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    log(`executeFlow(#${flowId}) ${receipt.status === "success" ? "SUCCEEDED" : "FAILED"}: ${explorerTx(hash)}`);
  } catch (err) {
    const reason = extractRevertReason(err);
    log(`skip flow #${flowId}: ${reason}`);
  }
}

function extractRevertReason(err: unknown): string {
  const asBase = err as BaseError;
  return asBase?.shortMessage ?? (err instanceof Error ? err.message : String(err));
}

const INTER_FLOW_DELAY_MS = 350; // stay under the public RPC's per-second rate limit

async function pollOnce() {
  await discoverNewFlows();
  for (const flowId of knownFlowIds) {
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
  log(`canalis-keeper starting: executor=${config.executorAddress} keeper=${account.address} pollIntervalMs=${config.pollIntervalMs}`);

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
