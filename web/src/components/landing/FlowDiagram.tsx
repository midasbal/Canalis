import type { ComponentType } from "react";
import { ChannelLine } from "./ChannelLine";
import { AmountCapIcon, ManualTriggerIcon, SplitActionIcon } from "../ui/blockIcons";

const STEPS: { numeral: string; label: string; example: string; icon: ComponentType; col: "col-start-1" | "col-start-3" | "col-start-5" }[] = [
  { numeral: "I", label: "Trigger", example: "USDC arrives", icon: ManualTriggerIcon, col: "col-start-1" },
  { numeral: "II", label: "Condition", example: "balance ≥ threshold", icon: AmountCapIcon, col: "col-start-3" },
  { numeral: "III", label: "Action", example: "split 70 / 30", icon: SplitActionIcon, col: "col-start-5" },
];

// Every block icon (ui/blockIcons.tsx) is a fixed 22px box whose own accent
// dot — its "value/output point" — sits at cy=20 of a 0-24 viewBox, i.e.
// 20/24 of the box height down from the top, regardless of how each icon's
// own glyph (arrow/brackets/fork) is drawn inside that box. That dot, not
// the box's geometric center, is the icon's true optical anchor: connectors
// centered on the box middle instead sat ~7px above every accent dot,
// visibly disconnected from it. ICON_HEIGHT_PX/DOT_OFFSET_PX below convert
// that same ratio into the fixed offset used to place the connector.
const ICON_HEIGHT_PX = 22;
const DOT_OFFSET_PX = (20 / 24) * ICON_HEIGHT_PX;
const CONNECTOR_HEIGHT_PX = 2; // ChannelLine's own fixed SVG height attribute

/**
 * The trigger → condition → action model, drawn as three nodes joined by
 * the channel motif (see ChannelLine) — a small, honest illustration of
 * how a flow is actually structured, not a marketing flourish. Reused
 * wherever the landing needs to show "how it works" at a glance. Icons
 * are the same block-icon set the Builder's channel canvas uses, so a
 * trigger/condition/action reads identically on both surfaces.
 *
 * A single 5-column grid (step, connector, step, connector, step) with
 * explicit column placement, not flex auto-layout: icons and connectors
 * all share row 1, top-aligned (not center-aligned — see DOT_OFFSET_PX
 * above for why), so every icon's own accent dot and both connectors land
 * on the exact same horizontal line. Both connectors share the identical
 * width class too, so their dash scale (and therefore dash length/
 * spacing) matches exactly. The label/example text sits in its own row
 * below, explicitly placed under its matching icon, free to wrap without
 * ever disturbing the connector row above it.
 */
export function FlowDiagram() {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-start gap-y-4">
      {STEPS.map((step) => (
        <span key={`icon-${step.label}`} className={`row-start-1 ${step.col} flex justify-center text-brand-bronze`}>
          <step.icon />
        </span>
      ))}
      <div
        className="row-start-1 col-start-2 w-10 justify-self-center sm:w-16"
        style={{ marginTop: `${DOT_OFFSET_PX - CONNECTOR_HEIGHT_PX / 2}px` }}
      >
        <ChannelLine orientation="horizontal" />
      </div>
      <div
        className="row-start-1 col-start-4 w-10 justify-self-center sm:w-16"
        style={{ marginTop: `${DOT_OFFSET_PX - CONNECTOR_HEIGHT_PX / 2}px` }}
      >
        <ChannelLine orientation="horizontal" />
      </div>

      {STEPS.map((step) => (
        <div key={`text-${step.label}`} className={`row-start-2 ${step.col} flex flex-col items-center gap-1.5 text-center`}>
          <span className="font-mono text-[11px] font-medium tracking-[0.16em] text-brand-muted uppercase">
            <span className="font-display text-brand-bronze/80 italic">{step.numeral}.</span> {step.label}
          </span>
          <span className="text-sm text-brand-ink/80">{step.example}</span>
        </div>
      ))}
    </div>
  );
}
