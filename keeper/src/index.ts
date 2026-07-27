import { createPublicClient, createWalletClient, http, type BaseError } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.ts";
import { arcTestnet } from "./chain.ts";
import { canalisExecutorAbi } from "./abi.ts";

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
// Flow discovery: flowsOf(CANALIS_ACCOUNT) — a single eth_call, not a
// getLogs scan. CanalisExecutor has no on-chain "list every flow across
// every owner" function, so this keeper services ONE configured account
// (see README.md "Flow discovery" for why, and what multi-account support
// would need).

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
    log(`executeFlow(#${flowId}) ${receipt.status === "success" ? "SUCCEEDED" : "FAILED"}: ${explorerTx(hash)}`);
  } catch (err) {
    // Covers both a previewFlow/executeFlow revert (e.g. state changed
    // between the preview read and the send) and a transient RPC error —
    // either way, one bad flow must never take down the whole poll loop.
    const reason = extractRevertReason(err);
    log(`skip flow #${flowId}: ${reason}`);
  }
}

function extractRevertReason(err: unknown): string {
  const asBase = err as BaseError;
  return asBase?.shortMessage ?? (err instanceof Error ? err.message : String(err));
}

const INTER_FLOW_DELAY_MS = 350; // stay under free-tier RPC rate limits

async function pollOnce() {
  const flowIds = await publicClient.readContract({
    address: config.executorAddress,
    abi: canalisExecutorAbi,
    functionName: "flowsOf",
    args: [config.canalisAccount],
  });

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
    `canalis-keeper starting: executor=${config.executorAddress} account=${config.canalisAccount} keeper=${account.address} pollIntervalMs=${config.pollIntervalMs}`,
  );

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
