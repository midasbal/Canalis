import { useEffect, useState } from "react";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { decodeEventLog } from "viem";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { InfoTooltip } from "../ui/InfoTooltip";
import { CreateCanalisAccountPrompt } from "../CreateCanalisAccountPrompt";
import { useCanalisAccount } from "../../lib/useCanalisAccount";
import { canalisExecutorAbi } from "../../lib/abi";
import { CANALIS_ACCOUNT_FACTORY_ADDRESS, CANALIS_EXECUTOR_ADDRESS } from "../../lib/contracts";
import { arcscanTxUrl } from "../../lib/format";
import { getRevertReason } from "../../lib/errors";
import { summarizeFlow } from "../../lib/flowSummary";
import { defaultDraft, draftToFlow, validateComposerDraft, type ComposerDraft } from "../../lib/composer";
import { ChannelCanvas } from "./ChannelCanvas";
import { TemplatePicker } from "./TemplatePicker";
import { NlBuilderPanel } from "./NlBuilderPanel";

const CONTRACTS_CONFIGURED = Boolean(CANALIS_EXECUTOR_ADDRESS && CANALIS_ACCOUNT_FACTORY_ADDRESS);

/**
 * Stage 1 (compose + deploy) and Stage 4's pre-deploy dry-run: a vertical
 * stepper — trigger, then conditions, then actions — encoded via
 * lib/composer.ts + lib/flows.ts and deployed with a single `registerFlow`
 * call. The "what this will do" preview is entirely client-side
 * (lib/flowSummary.ts run against the draft-converted Flow) — `previewFlow`
 * on-chain only works for an already-registered flowId, so it's not used
 * here; see the Dashboard tab's deployed-flows list for where it belongs.
 */
export function FlowComposer() {
  const { isConnected, address: walletAddress } = useAccount();
  const { accountAddress, hasAccount, isLoading: accountLoading } = useCanalisAccount();

  const [draft, setDraft] = useState<ComposerDraft>(defaultDraft());
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [registeredFlowId, setRegisteredFlowId] = useState<bigint | null>(null);
  const [aiDraftActive, setAiDraftActive] = useState(false);

  const registerFlow = useWriteContract();
  const registerFlowReceipt = useWaitForTransactionReceipt({ hash: registerFlow.data });

  useEffect(() => {
    if (!registerFlowReceipt.isSuccess || !registerFlowReceipt.data) return;
    for (const log of registerFlowReceipt.data.logs) {
      try {
        const decoded = decodeEventLog({ abi: canalisExecutorAbi, data: log.data, topics: log.topics });
        if (decoded.eventName === "FlowRegistered") {
          setRegisteredFlowId(decoded.args.flowId);
          return;
        }
      } catch {
        // Not a FlowRegistered log — skip.
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerFlowReceipt.isSuccess, registerFlowReceipt.data]);

  if (!CONTRACTS_CONFIGURED) {
    return (
      <Card eyebrow="Build a flow" title="Compose a flow" action={<Badge tone="warning">Not configured</Badge>}>
        <p className="text-sm text-ink-muted">
          Set <code className="font-mono text-ink">VITE_CANALIS_EXECUTOR_ADDRESS</code> and{" "}
          <code className="font-mono text-ink">VITE_CANALIS_ACCOUNT_FACTORY_ADDRESS</code> in <code>web/.env</code>.
        </p>
      </Card>
    );
  }

  if (!isConnected) {
    return (
      <Card eyebrow="Build a flow" title="Compose a flow">
        <p className="text-sm text-ink-muted">Connect a wallet to compose and deploy a flow.</p>
      </Card>
    );
  }

  if (accountLoading) {
    return (
      <Card eyebrow="Build a flow" title="Compose a flow">
        <p className="text-sm text-ink-muted">Checking for your Canalis account…</p>
      </Card>
    );
  }

  if (!hasAccount || !accountAddress) {
    return (
      <Card eyebrow="Build a flow" title="Compose a flow">
        <CreateCanalisAccountPrompt message="You need a CanalisAccount before you can deploy a flow." />
      </Card>
    );
  }

  const composedFlow = draftToFlow(accountAddress, draft.trigger, draft.conditions, draft.actions);
  const errors = validateComposerDraft(draft.trigger, draft.conditions, draft.actions);
  const valid = errors.length === 0;

  const deploying = registerFlow.isPending || registerFlowReceipt.isLoading;

  function handleDeploy() {
    if (!accountAddress || !valid) return;
    setRegisteredFlowId(null);
    registerFlow.writeContract({
      address: CANALIS_EXECUTOR_ADDRESS!,
      abi: canalisExecutorAbi,
      functionName: "registerFlow",
      args: [composedFlow],
    });
  }

  function handleReset() {
    setDraft(defaultDraft());
    setSelectedTemplateId(null);
    setAiDraftActive(false);
    setRegisteredFlowId(null);
    registerFlow.reset();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4">
        <NlBuilderPanel
          connectedAddress={walletAddress}
          onGenerated={(picked, warnings) => {
            setDraft(picked);
            setSelectedTemplateId(null);
            setAiDraftActive(true);
            // eslint-disable-next-line no-console
            if (warnings.length > 0) console.info("AI draft warnings:", warnings);
          }}
        />

        <Card
          variant="flat"
          eyebrow="Templates"
          title={
            <>
              Start from a template (optional)
              <InfoTooltip label="About templates">
                Pre-built flows for common patterns. Pick one to fill in the builder below, then adjust anything
                before deploying.
              </InfoTooltip>
            </>
          }
        >
          <TemplatePicker
            selectedId={selectedTemplateId}
            onPick={(picked, templateId) => {
              if (templateId === selectedTemplateId) {
                // Clicking the already-selected template again toggles it
                // off, same as hitting Reset, not just clearing the
                // highlight while leaving the pre-filled draft behind.
                handleReset();
                return;
              }
              setDraft(picked);
              setSelectedTemplateId(templateId);
              setAiDraftActive(false);
            }}
          />
        </Card>
      </div>

      <div className="my-1 border-t border-brand-bronze/15" />

      <Card
        eyebrow="Build a flow"
        title={
          <>
            Compose trigger → conditions → actions
            <InfoTooltip label="About building a flow">
              Every flow needs exactly one trigger and at least one action. Conditions are optional. Fill these in
              below, then check the preview before you deploy.
            </InfoTooltip>
          </>
        }
        action={aiDraftActive ? <Badge tone="accent">Reviewing AI draft</Badge> : undefined}
      >
        <p className="mb-3 max-w-prose font-display text-sm text-brand-muted italic">
          Every channel begins with a single source.
        </p>

        <ChannelCanvas
          trigger={draft.trigger}
          onTriggerChange={(trigger) => setDraft({ ...draft, trigger })}
          conditions={draft.conditions}
          onConditionsChange={(conditions) => setDraft({ ...draft, conditions })}
          actions={draft.actions}
          onActionsChange={(actions) => setDraft({ ...draft, actions })}
        />
      </Card>

      <Card eyebrow="Preview" title="What this will do" className="border-brand-violet/25">
        <p className="max-w-prose text-sm text-ink">{summarizeFlow(composedFlow)}</p>

        {errors.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 border-t border-border-soft pt-3 text-xs text-red-400">
            {errors.map((e) => (
              <li key={e}>• {e}</li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex items-center gap-3 border-t border-border-soft pt-4">
          <button
            onClick={handleDeploy}
            disabled={!valid || deploying}
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deploying ? "Deploying…" : "Deploy flow"}
          </button>
          <button
            onClick={handleReset}
            disabled={deploying}
            className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-ink-muted transition-colors duration-200 hover:border-ink-faint disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reset
          </button>
        </div>

        {registerFlow.error && <p className="mt-2 text-xs text-red-400">{getRevertReason(registerFlow.error)}</p>}

        {registeredFlowId !== null && registerFlowReceipt.data && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="accent">Deployed</Badge>
            <span className="text-ink-muted">
              Flow #{registeredFlowId.toString()} registered. Switch to the Flows tab to see it in "Deployed flows".
            </span>
            <a
              href={arcscanTxUrl(registerFlowReceipt.data.transactionHash)}
              target="_blank"
              rel="noreferrer"
              className="text-accent-strong underline underline-offset-2"
            >
              View on arcscan
            </a>
          </div>
        )}
      </Card>
    </div>
  );
}
