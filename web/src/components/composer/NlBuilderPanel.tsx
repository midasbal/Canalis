import { useState } from "react";
import type { Address } from "viem";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { InfoTooltip } from "../ui/InfoTooltip";
import type { ComposerDraft } from "../../lib/composer";
import { isNlFlowError, nlDraftToComposerDraft, parseNlFlowResponse } from "../../lib/nlDraft";

const MAX_PROMPT_CHARS = 500; // mirrors the proxy's own NL_MAX_PROMPT_CHARS default — see api/_lib/generateFlow.ts

interface NlBuilderPanelProps {
  /** The connected wallet EOA — used ONLY client-side to resolve the model's "SELF" sentinel (see lib/nlDraft.ts); the LLM never sees or chooses this address. */
  connectedAddress: Address | undefined;
  onGenerated: (draft: ComposerDraft, warnings: string[]) => void;
}

/**
 * Stage 3 of the natural-language flow builder (docs/canalis-spec.md §7.4):
 * a plain-English box that calls our own serverless proxy
 * (api/generate-flow.ts in production, its Vite dev-middleware twin
 * locally — NEVER Groq directly; see that file's header for the full
 * safety model) and pre-fills the EXISTING composer with the result. This
 * panel never deploys anything itself — the returned draft still goes
 * through the normal composer review and the same `validateComposerDraft`
 * gate as a manually-built flow before Deploy is even clickable.
 */
export function NlBuilderPanel({ connectedAddress, onGenerated }: NlBuilderPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<"error" | "info">("info");

  async function handleGenerate() {
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setNotice(null);
    try {
      const res = await fetch("/api/generate-flow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
      });

      let body: unknown;
      try {
        body = await res.json();
      } catch {
        setNoticeTone("error");
        setNotice("The AI builder returned an unreadable response. Try again, or use the manual composer below.");
        return;
      }

      if (!res.ok) {
        const message = isNlFlowError(body) ? body.error : `AI builder error (${res.status}). Try again, or use the manual composer below.`;
        setNoticeTone("error");
        setNotice(message);
        return;
      }

      const parsed = parseNlFlowResponse(body);
      if (isNlFlowError(parsed)) {
        setNoticeTone("error");
        setNotice(parsed.error);
        return;
      }

      const { draft, warnings } = nlDraftToComposerDraft(parsed, connectedAddress);
      onGenerated(draft, warnings);
      setNoticeTone("info");
      setNotice(
        warnings.length > 0
          ? `Draft generated. Review every field below before deploying. ${warnings.join(" ")}`
          : "Draft generated. Review every field below before deploying.",
      );
    } catch (err) {
      setNoticeTone("error");
      setNotice(err instanceof Error ? `Request failed: ${err.message}` : "Request failed. Try again, or use the manual composer below.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card
      variant="flat"
      eyebrow="Describe your flow"
      title={
        <>
          Draft with AI (optional)
          <InfoTooltip label="About Draft with AI">
            Describe a flow in plain English and get a starting draft below. You review and edit every field, and it
            never deploys on its own.
          </InfoTooltip>
        </>
      }
      action={<Badge tone="accent">Human reviews before deploy</Badge>}
    >
      <p className="mb-3 max-w-prose text-xs leading-snug text-ink-muted">
        Describe a flow in plain English and an LLM drafts it into the composer below for you to review, edit, and
        deploy yourself. It never deploys anything on its own, and it never invents recipient addresses. Leave one
        blank to fill in yourself, or say "to me" or "my wallet" to use your connected wallet.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value.slice(0, MAX_PROMPT_CHARS))}
          placeholder='e.g. "Every day, if EUR/USD is below 1.10, swap 5 USDC into EURC and send it to me."'
          rows={2}
          maxLength={MAX_PROMPT_CHARS}
          className="w-full flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
        />
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading || !prompt.trim()}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50 sm:self-start"
        >
          {loading ? "Generating…" : "Generate"}
        </button>
      </div>
      <p className="mt-1 text-right text-[11px] text-ink-faint">
        {prompt.length}/{MAX_PROMPT_CHARS}
      </p>

      {notice && <p className={`mt-2 text-xs leading-snug ${noticeTone === "error" ? "text-red-400" : "text-ink-muted"}`}>{notice}</p>}
    </Card>
  );
}
