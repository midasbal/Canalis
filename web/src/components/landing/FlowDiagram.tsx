import type { ComponentType } from "react";
import { ChannelLine } from "./ChannelLine";
import { AmountCapIcon, ManualTriggerIcon, SplitActionIcon } from "../ui/blockIcons";

const STEPS: { numeral: string; label: string; example: string; icon: ComponentType }[] = [
  { numeral: "I", label: "Trigger", example: "USDC arrives", icon: ManualTriggerIcon },
  { numeral: "II", label: "Condition", example: "balance ≥ threshold", icon: AmountCapIcon },
  { numeral: "III", label: "Action", example: "split 70 / 30", icon: SplitActionIcon },
];

/**
 * The trigger → condition → action model, drawn as three nodes joined by
 * the channel motif (see ChannelLine) — a small, honest illustration of
 * how a flow is actually structured, not a marketing flourish. Reused
 * wherever the landing needs to show "how it works" at a glance. Icons
 * are the same block-icon set the Builder's channel canvas uses, so a
 * trigger/condition/action reads identically on both surfaces.
 */
export function FlowDiagram() {
  return (
    <div className="flex flex-col items-stretch gap-0 sm:flex-row sm:items-center">
      {STEPS.map((step, i) => (
        <div key={step.label} className="flex flex-1 flex-col items-center sm:flex-row">
          <div className="flex flex-col items-center gap-2 py-4 text-center sm:py-0">
            <span className="text-brand-bronze">
              <step.icon />
            </span>
            <span className="font-mono text-[11px] font-medium tracking-[0.16em] text-brand-muted uppercase">
              <span className="font-display text-brand-bronze/80 italic">{step.numeral}.</span> {step.label}
            </span>
            <span className="text-sm text-brand-ink/80">{step.example}</span>
          </div>
          {i < STEPS.length - 1 && (
            <>
              <ChannelLine orientation="vertical" className="h-8 w-4 sm:hidden" />
              <ChannelLine orientation="horizontal" className="hidden w-12 shrink-0 sm:block" />
            </>
          )}
        </div>
      ))}
    </div>
  );
}
