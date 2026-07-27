import { useEffect, useState } from "react";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { decodeEventLog, isAddress, parseUnits } from "viem";
import type { Address } from "viem";
import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { useCanalisAccount } from "../lib/useCanalisAccount";
import { canalisAccountFactoryAbi, canalisExecutorAbi } from "../lib/abi";
import { CANALIS_ACCOUNT_FACTORY_ADDRESS, CANALIS_EXECUTOR_ADDRESS } from "../lib/contracts";
import { ActionType, TriggerType, encodeFlow, type Flow } from "../lib/flows";

/** Arc testnet USDC's ERC-20 decimals — do not confuse with the 18-decimal native gas token. */
const USDC_DECIMALS = 6;
const CONTRACTS_CONFIGURED = Boolean(CANALIS_EXECUTOR_ADDRESS && CANALIS_ACCOUNT_FACTORY_ADDRESS);

function buildManualForwardFlow(account: Address, recipient: Address, amount: bigint): Flow {
  return {
    owner: account,
    trigger: {
      kind: TriggerType.Manual,
      scheduleAt: 0n,
      scheduleInterval: 0n,
      thresholdAmount: 0n,
      thresholdIsAbove: false,
    },
    conditions: [],
    actions: [
      {
        kind: ActionType.Forward,
        recipients: [recipient],
        amountsOrBps: [],
        fixedAmount: amount,
        sweepThreshold: 0n,
        unlockTime: 0n,
      },
    ],
    active: true,
    lastExecutedAt: 0n,
  };
}

/**
 * The one real end-to-end path in the Builder: create a CanalisAccount if
 * needed, compose a Manual-trigger, single-Forward-action flow, register
 * it on-chain, then run it. Full drag-and-drop composition and every
 * other trigger/action type stay out of scope — see the palette above.
 */
export function DeployForwardFlow() {
  const { isConnected } = useAccount();
  const { accountAddress, hasAccount, isLoading: accountLoading, refetchAccount } = useCanalisAccount();

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [flowId, setFlowId] = useState<bigint | null>(null);

  const createAccount = useWriteContract();
  const createAccountReceipt = useWaitForTransactionReceipt({ hash: createAccount.data });

  const registerFlow = useWriteContract();
  const registerFlowReceipt = useWaitForTransactionReceipt({ hash: registerFlow.data });

  const runFlow = useWriteContract();
  const runFlowReceipt = useWaitForTransactionReceipt({ hash: runFlow.data });

  useEffect(() => {
    if (createAccountReceipt.isSuccess) {
      refetchAccount();
    }
  }, [createAccountReceipt.isSuccess, refetchAccount]);

  useEffect(() => {
    if (!registerFlowReceipt.isSuccess || !registerFlowReceipt.data) return;
    for (const log of registerFlowReceipt.data.logs) {
      try {
        const decoded = decodeEventLog({ abi: canalisExecutorAbi, data: log.data, topics: log.topics });
        if (decoded.eventName === "FlowRegistered") {
          setFlowId(decoded.args.flowId);
          return;
        }
      } catch {
        // Not a FlowRegistered log (e.g. an ERC20 Transfer from the same tx) — skip.
      }
    }
  }, [registerFlowReceipt.isSuccess, registerFlowReceipt.data]);

  if (!CONTRACTS_CONFIGURED) {
    return (
      <Card eyebrow="Deploy" title="Deploy a Forward flow" action={<Badge tone="warning">Not configured</Badge>}>
        <p className="text-sm text-ink-muted">
          Set <code className="font-mono text-ink">VITE_CANALIS_EXECUTOR_ADDRESS</code> and{" "}
          <code className="font-mono text-ink">VITE_CANALIS_ACCOUNT_FACTORY_ADDRESS</code> in <code>web/.env</code>{" "}
          after deploying the contracts.
        </p>
      </Card>
    );
  }

  if (!isConnected) {
    return (
      <Card eyebrow="Deploy" title="Deploy a Forward flow">
        <p className="text-sm text-ink-muted">Connect a wallet to deploy a flow.</p>
      </Card>
    );
  }

  if (accountLoading) {
    return (
      <Card eyebrow="Deploy" title="Deploy a Forward flow">
        <p className="text-sm text-ink-muted">Checking for your Canalis account…</p>
      </Card>
    );
  }

  if (!hasAccount) {
    const creating = createAccount.isPending || createAccountReceipt.isLoading;
    return (
      <Card eyebrow="Deploy" title="Deploy a Forward flow">
        <p className="mb-4 text-sm text-ink-muted">You need a CanalisAccount before you can deploy a flow.</p>
        <button
          onClick={() =>
            createAccount.writeContract({
              address: CANALIS_ACCOUNT_FACTORY_ADDRESS!,
              abi: canalisAccountFactoryAbi,
              functionName: "createAccount",
            })
          }
          disabled={creating}
          className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create Canalis account"}
        </button>
        {createAccount.error && <p className="mt-2 text-xs text-red-400">{createAccount.error.message}</p>}
      </Card>
    );
  }

  let parsedAmount = 0n;
  try {
    if (amount) parsedAmount = parseUnits(amount, USDC_DECIMALS);
  } catch {
    parsedAmount = 0n;
  }

  const recipientValid = isAddress(recipient);
  const deploying = registerFlow.isPending || registerFlowReceipt.isLoading;
  const canDeploy = recipientValid && parsedAmount > 0n && !deploying;

  function handleDeploy() {
    if (!accountAddress || !recipientValid || parsedAmount <= 0n) return;

    setFlowId(null);
    registerFlow.writeContract({
      address: CANALIS_EXECUTOR_ADDRESS!,
      abi: canalisExecutorAbi,
      functionName: "registerFlow",
      args: [buildManualForwardFlow(accountAddress, recipient as Address, parsedAmount)],
    });
  }

  const running = runFlow.isPending || runFlowReceipt.isLoading;

  return (
    <Card eyebrow="Deploy" title="Deploy a Forward flow">
      <p className="mb-4 text-sm text-ink-muted">
        Manual trigger → Forward action: send a fixed amount of USDC to one recipient, on demand.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-ink-muted">Recipient</span>
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x…"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-ink"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-muted">Amount (USDC)</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            className="w-32 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>
        <button
          onClick={handleDeploy}
          disabled={!canDeploy}
          className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          {deploying ? "Deploying…" : "Deploy flow"}
        </button>
      </div>

      {registerFlow.error && <p className="mt-2 text-xs text-red-400">{registerFlow.error.message}</p>}

      {recipientValid && parsedAmount > 0n && accountAddress && (
        <p className="mt-3 break-all font-mono text-[11px] text-ink-faint">
          Encoded flow (on-chain data):{" "}
          {encodeFlow(buildManualForwardFlow(accountAddress, recipient as Address, parsedAmount)).slice(0, 74)}…
        </p>
      )}

      {flowId !== null && (
        <div className="mt-4 flex items-center gap-3 border-t border-border-soft pt-4">
          <span className="text-sm text-ink-muted">Flow #{flowId.toString()} registered.</span>
          <button
            onClick={() =>
              runFlow.writeContract({
                address: CANALIS_EXECUTOR_ADDRESS!,
                abi: canalisExecutorAbi,
                functionName: "executeFlow",
                args: [flowId],
              })
            }
            disabled={running}
            className="rounded-xl bg-action px-4 py-2 text-sm font-medium text-white transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? "Running…" : "Run"}
          </button>
          {runFlowReceipt.isSuccess && <Badge tone="accent">Executed</Badge>}
        </div>
      )}
      {runFlow.error && <p className="mt-2 text-xs text-red-400">{runFlow.error.message}</p>}
    </Card>
  );
}
