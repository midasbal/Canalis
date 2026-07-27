import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { FlowBlock, type BlockCategory } from "./ui/FlowBlock";
import { FlowConnector } from "./ui/FlowConnector";
import { DeployForwardFlow } from "./DeployForwardFlow";

const TRIGGER_BLOCKS = [
  { label: "On receive", description: "Fires when USDC lands in the account." },
  { label: "On schedule", description: "Fires once or on a recurring interval." },
  { label: "On threshold", description: "Fires when balance crosses a level." },
  { label: "Manual", description: "Fires only via an explicit run-now call." },
];

const CONDITION_BLOCKS = [
  { label: "Amount cap", description: "Per-run minimum / maximum amount." },
  { label: "Cooldown", description: "Minimum time since this flow last ran." },
  { label: "Time window", description: "Only allow execution in a date/time range." },
  { label: "Balance check", description: "Account must hold at least this much." },
  { label: "Allow / deny list", description: "Restrict eligible recipients." },
];

const ACTION_BLOCKS = [
  { label: "Split", description: "Distribute to N recipients by bps or amount." },
  { label: "Forward", description: "Send a fixed amount to one recipient." },
  { label: "Sweep", description: "Move balance above a threshold onward." },
  { label: "Lock / release", description: "Time-lock funds, release after unlock." },
];

const EXAMPLE_FLOW: { category: BlockCategory; label: string }[] = [
  { category: "trigger", label: "On receive" },
  { category: "condition", label: "Balance check" },
  { category: "action", label: "Split" },
];

const CATEGORY_TEXT: Record<BlockCategory, string> = {
  trigger: "text-trigger",
  condition: "text-condition",
  action: "text-action",
};

function PaletteColumn({
  title,
  category,
  blocks,
}: {
  title: string;
  category: BlockCategory;
  blocks: { label: string; description: string }[];
}) {
  return (
    <div className="flex-1">
      <h4 className={`mb-3 text-xs font-semibold uppercase tracking-wider ${CATEGORY_TEXT[category]}`}>{title}</h4>
      <div className="flex flex-col gap-2">
        {blocks.map((block) => (
          <FlowBlock key={block.label} category={category} label={block.label} description={block.description} />
        ))}
      </div>
    </div>
  );
}

/**
 * Builder palette: the trigger / condition / action blocks available for
 * composing a flow, plus a static example of how they read together.
 * Drag-and-drop composition and on-chain deploy are not implemented yet —
 * see docs/canalis-spec.md section 7.1.
 */
export function BuilderCanvas() {
  return (
    <div className="flex flex-col gap-6">
      <Card
        eyebrow="Flow builder"
        title="Compose trigger → condition → action"
        action={<Badge tone="warning">Drag &amp; drop coming soon</Badge>}
      >
        <p className="mb-6 max-w-2xl text-sm text-ink-muted">
          Every Canalis flow is one trigger, any number of guard conditions, and an ordered list of actions that run
          atomically. Browse the available blocks below.
        </p>

        <div className="flex flex-col gap-4 sm:flex-row">
          <PaletteColumn title="Triggers" category="trigger" blocks={TRIGGER_BLOCKS} />
          <FlowConnector vertical />
          <FlowConnector />
          <PaletteColumn title="Conditions" category="condition" blocks={CONDITION_BLOCKS} />
          <FlowConnector vertical />
          <FlowConnector />
          <PaletteColumn title="Actions" category="action" blocks={ACTION_BLOCKS} />
        </div>
      </Card>

      <Card eyebrow="Example" title="How a flow reads">
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          {EXAMPLE_FLOW.map((step, i) => (
            <div key={step.label} className="flex items-center gap-2">
              <span
                className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                  step.category === "trigger"
                    ? "border-trigger/40 bg-trigger-soft text-trigger"
                    : step.category === "condition"
                      ? "border-condition/40 bg-condition-soft text-condition"
                      : "border-action/40 bg-action-soft text-action"
                }`}
              >
                {step.label}
              </span>
              {i < EXAMPLE_FLOW.length - 1 && <FlowConnector />}
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-ink-faint">
          Example only — "On receive → balance check → split" is one flow this palette can express, once the
          builder canvas and executor wiring are implemented.
        </p>
      </Card>

      <div className="flex items-center gap-3">
        <button
          disabled
          title="TODO: drag-and-drop composition for arbitrary trigger/condition/action graphs"
          className="cursor-not-allowed rounded-xl bg-accent/40 px-5 py-2.5 text-sm font-medium text-white/70"
        >
          Deploy from canvas
        </button>
        <span className="text-xs text-ink-faint">
          Full drag-and-drop composition isn't built yet — use "Deploy a Forward flow" below for a real, working
          flow.
        </span>
      </div>

      <DeployForwardFlow />
    </div>
  );
}
