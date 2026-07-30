import { Fragment, useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { createPortal } from "react-dom";
import { ActionType } from "../../lib/flows";
import {
  ACTION_KIND_LABELS,
  CONDITION_KIND_LABELS,
  emptyAction,
  emptyCondition,
  type ComposerAction,
  type ComposerCondition,
  type ComposerTrigger,
  type ConditionKind,
} from "../../lib/composer";
import { triggerTypeLabel } from "../../lib/flowSummary";
import { actionNodeSummary, conditionNodeSummary, triggerNodeSummary } from "../../lib/nodeSummary";
import { shortAddress } from "../../lib/format";
import { useReducedMotion } from "../../lib/useReducedMotion";
import { ACTION_ICONS, CONDITION_ICONS, TRIGGER_ICONS } from "../ui/blockIcons";
import { CloseIcon } from "../ui/icons";
import { TriggerSection } from "./TriggerSection";
import { ConditionCard, CONDITION_KINDS } from "./ConditionsSection";
import { ActionCard, ACTION_KINDS, bpsStringToPercentText } from "./ActionsSection";

type Selected =
  | { type: "trigger" }
  | { type: "condition"; id: string }
  | { type: "action"; id: string }
  | { type: "addCondition" }
  | { type: "addAction" }
  | null;

interface ChannelCanvasProps {
  trigger: ComposerTrigger;
  onTriggerChange: (trigger: ComposerTrigger) => void;
  conditions: ComposerCondition[];
  onConditionsChange: (conditions: ComposerCondition[]) => void;
  actions: ComposerAction[];
  onActionsChange: (actions: ComposerAction[]) => void;
  /**
   * Whether the CURRENT draft is deployable, i.e. `validateComposerDraft(...)
   * .length === 0` — the exact same signal FlowComposer already computes to
   * enable/disable its Deploy button. Passed straight through, never
   * recomputed here: this view never re-derives or duplicates validation,
   * it only reads the existing result to decide how far the ambient "value"
   * animation travels.
   */
  valid: boolean;
}

/** Seconds between one connector's traveling dot and the next's, via negative animation-delay, so a chain of connectors reads as one continuous traveler instead of N independently-looping dots. */
const STAGGER_SECONDS = 0.4;

/**
 * The builder's signature surface: the current ComposerDraft (the SAME
 * draft FlowComposer already owns) read left to right as a channel, an
 * aqueduct in miniature — the trigger as the source on the far left, the
 * conditions as gates along the middle, the actions as outlets on the
 * right (a Split action visibly forking into one branch per recipient).
 *
 * This is a new VIEW over the existing draft, nothing else: it calls the
 * exact same onTriggerChange/onConditionsChange/onActionsChange callbacks
 * FlowComposer already passed to the vertical stepper, reuses the exact
 * same per-type field editors (TriggerSection wholesale; ConditionCard/
 * ActionCard exported from their section files unmodified) inside a side
 * panel, and never touches lib/composer.ts's draft model, validation, or
 * lib/flows.ts's Flow encoding.
 *
 * The ambient "value" animation is presentation only, driven entirely by
 * the `valid` prop: the source-and-gates portion
 * (trigger, conditions, the "Add gate" affordance) always shows the
 * traveling glow, since a flow always has a trigger; the outlet portion
 * (actions, Split's branches, the "Add outlet" affordance) only lights up
 * and completes the traveling animation when `valid` is true, otherwise it
 * renders dim and static, no new validation logic involved.
 */
export function ChannelCanvas({
  trigger,
  onTriggerChange,
  conditions,
  onConditionsChange,
  actions,
  onActionsChange,
  valid,
}: ChannelCanvasProps) {
  const [selected, setSelected] = useState<Selected>(null);
  const reducedMotion = useReducedMotion();

  function removeCondition(id: string) {
    onConditionsChange(conditions.filter((c) => c.id !== id));
    if (selected?.type === "condition" && selected.id === id) setSelected(null);
  }

  function removeAction(id: string) {
    onActionsChange(actions.filter((a) => a.id !== id));
    if (selected?.type === "action" && selected.id === id) setSelected(null);
  }

  // Zone A (source + gates) is always lit; zone B (outlets) only completes
  // the flow when the draft is actually deployable. Each zone's connectors
  // get their own 0,1,2... sequence so the staggered delay reads as one
  // traveler per zone, regardless of how many gates/outlets exist.
  let gateIndex = 0;
  let outletIndex = 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-0 overflow-x-auto pb-3">
        <NodeCard
          category="trigger"
          icon={TRIGGER_ICONS[trigger.kind]}
          title={triggerTypeLabel(trigger.kind)}
          detail={triggerNodeSummary(trigger)}
          selected={selected?.type === "trigger"}
          onClick={() => setSelected({ type: "trigger" })}
          dim={false}
          reducedMotion={reducedMotion}
        />
        <Connector index={gateIndex++} lit reducedMotion={reducedMotion} />

        {conditions.map((c) => {
          const thisGateIndex = gateIndex++;
          return (
            <Fragment key={c.id}>
              <NodeCard
                category="condition"
                icon={CONDITION_ICONS[c.kind]}
                title={CONDITION_KIND_LABELS[c.kind]}
                detail={conditionNodeSummary(c)}
                selected={selected?.type === "condition" && selected.id === c.id}
                onClick={() => setSelected({ type: "condition", id: c.id })}
                onRemove={() => removeCondition(c.id)}
                removeLabel={`Remove ${CONDITION_KIND_LABELS[c.kind]} condition`}
                dim={false}
                gateGlowIndex={thisGateIndex}
                reducedMotion={reducedMotion}
              />
              <Connector index={thisGateIndex} lit reducedMotion={reducedMotion} />
            </Fragment>
          );
        })}

        <AddButton label="Add gate" hint="optional" onClick={() => setSelected({ type: "addCondition" })} />
        <Connector index={outletIndex++} lit={valid} reducedMotion={reducedMotion} />

        {actions.map((a) => {
          const thisOutletIndex = outletIndex++;
          return (
            <Fragment key={a.id}>
              <NodeCard
                category="action"
                icon={ACTION_ICONS[a.kind]}
                title={ACTION_KIND_LABELS[a.kind]}
                detail={actionNodeSummary(a)}
                selected={selected?.type === "action" && selected.id === a.id}
                onClick={() => setSelected({ type: "action", id: a.id })}
                onRemove={() => removeAction(a.id)}
                removeLabel={`Remove ${ACTION_KIND_LABELS[a.kind]} action`}
                dim={!valid}
                reducedMotion={reducedMotion}
              />
              {a.kind === ActionType.Split && (
                <SplitBranches recipients={a.splitRecipients} lit={valid} index={thisOutletIndex} reducedMotion={reducedMotion} />
              )}
              <Connector index={thisOutletIndex} lit={valid} reducedMotion={reducedMotion} />
            </Fragment>
          );
        })}

        <AddButton label="Add outlet" onClick={() => setSelected({ type: "addAction" })} />
      </div>

      {selected && (
        <SidePanel title={panelTitle(selected, conditions, actions)} onClose={() => setSelected(null)}>
          {selected.type === "trigger" && <TriggerSection trigger={trigger} onChange={onTriggerChange} />}

          {selected.type === "condition" &&
            (() => {
              const condition = conditions.find((c) => c.id === selected.id);
              if (!condition) return null;
              return (
                <ConditionCard
                  key={condition.id}
                  condition={condition}
                  onChange={(patch) => onConditionsChange(conditions.map((c) => (c.id === condition.id ? { ...c, ...patch } : c)))}
                  onRemove={() => removeCondition(condition.id)}
                />
              );
            })()}

          {selected.type === "action" &&
            (() => {
              const index = actions.findIndex((a) => a.id === selected.id);
              const action = actions[index];
              if (!action) return null;
              return (
                <ActionCard
                  key={action.id}
                  index={index}
                  action={action}
                  onChange={(patch) => onActionsChange(actions.map((a) => (a.id === action.id ? { ...a, ...patch } : a)))}
                  onRemove={() => removeAction(action.id)}
                />
              );
            })()}

          {selected.type === "addCondition" && (
            <KindPicker
              kinds={CONDITION_KINDS}
              labels={CONDITION_KIND_LABELS}
              icons={CONDITION_ICONS}
              onPick={(kind: ConditionKind) => {
                const condition = emptyCondition(kind);
                onConditionsChange([...conditions, condition]);
                setSelected({ type: "condition", id: condition.id });
              }}
            />
          )}

          {selected.type === "addAction" && (
            <KindPicker
              kinds={ACTION_KINDS}
              labels={ACTION_KIND_LABELS}
              icons={ACTION_ICONS}
              onPick={(kind: ActionType) => {
                const action = emptyAction(kind);
                onActionsChange([...actions, action]);
                setSelected({ type: "action", id: action.id });
              }}
            />
          )}
        </SidePanel>
      )}
    </div>
  );
}

function panelTitle(selected: NonNullable<Selected>, conditions: ComposerCondition[], actions: ComposerAction[]): string {
  switch (selected.type) {
    case "trigger":
      return "Trigger";
    case "condition":
      return CONDITION_KIND_LABELS[conditions.find((c) => c.id === selected.id)?.kind ?? "amountCap"];
    case "action":
      return ACTION_KIND_LABELS[actions.find((a) => a.id === selected.id)?.kind ?? ActionType.Forward];
    case "addCondition":
      return "Add gate";
    case "addAction":
      return "Add outlet";
    default:
      return "";
  }
}

function Connector({ index, lit, reducedMotion }: { index: number; lit: boolean; reducedMotion: boolean }) {
  return (
    <div className="relative flex w-8 shrink-0 items-center sm:w-10" aria-hidden="true">
      <div
        className={`h-[2px] w-full rounded-full transition-colors duration-500 ${lit ? "bg-brand-bronze/50" : "bg-brand-bronze/20"}`}
        style={lit ? { boxShadow: "0 0 8px 0 color-mix(in oklab, var(--color-brand-violet) 45%, transparent)" } : undefined}
      />
      {lit && !reducedMotion && (
        <span
          className="animate-channel-value absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-brand-violet blur-[0.5px]"
          style={{ animationDelay: `${-(index * STAGGER_SECONDS)}s` }}
        />
      )}
    </div>
  );
}

const CATEGORY_CLASSES: Record<"trigger" | "condition" | "action", { rest: string; selected: string; dim: string }> = {
  trigger: {
    rest: "border-trigger/30 bg-trigger-soft/40 hover:border-trigger/50",
    selected: "border-trigger/60 bg-trigger-soft",
    dim: "border-trigger/15 bg-trigger-soft/15",
  },
  condition: {
    rest: "border-condition/30 bg-condition-soft/40 hover:border-condition/50",
    selected: "border-condition/60 bg-condition-soft",
    dim: "border-condition/15 bg-condition-soft/15",
  },
  action: {
    rest: "border-action/30 bg-action-soft/40 hover:border-action/50",
    selected: "border-action/60 bg-action-soft",
    dim: "border-action/15 bg-action-soft/15",
  },
};

function NodeCard({
  category,
  icon: Icon,
  title,
  detail,
  selected,
  onClick,
  onRemove,
  removeLabel,
  dim,
  gateGlowIndex,
  reducedMotion,
}: {
  category: "trigger" | "condition" | "action";
  icon: ComponentType;
  title: string;
  detail: string;
  selected: boolean;
  onClick: () => void;
  onRemove?: () => void;
  removeLabel?: string;
  /** True when this node sits in a not-yet-complete part of the channel (the outlet zone while the draft isn't deployable) — a static, always-legible dim treatment, not just an animation toggle. */
  dim: boolean;
  /** Condition nodes only: their position in the gate sequence, so the "value passing through" glow staggers the same way the connectors do. */
  gateGlowIndex?: number;
  reducedMotion: boolean;
}) {
  const classes = CATEGORY_CLASSES[category];
  const tone = dim ? classes.dim : selected ? classes.selected : classes.rest;

  return (
    <div className="relative shrink-0">
      {category === "condition" && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute -inset-1.5 -z-10 rounded-2xl bg-brand-violet-soft/30 blur-md ${
            reducedMotion ? "opacity-35" : "animate-flow-gate-glow"
          }`}
          style={reducedMotion ? undefined : { animationDelay: `${-((gateGlowIndex ?? 0) * STAGGER_SECONDS)}s` }}
        />
      )}
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={`flex w-40 flex-col gap-1.5 rounded-xl border px-3.5 py-3 text-left transition-colors duration-500 sm:w-44 ${tone} ${
          dim ? "opacity-70" : ""
        }`}
      >
        <span className="flex items-start justify-between gap-2">
          <span className="text-brand-bronze">
            <Icon />
          </span>
          {/* Reserves the top-right corner so the remove button (rendered as a sibling below, absolutely positioned within the same padded box) never overlaps the icon and never pokes outside the card. */}
          {onRemove && <span className="h-5 w-5 shrink-0" aria-hidden="true" />}
        </span>
        <span className="text-sm font-medium text-ink">{title}</span>
        <span className="line-clamp-2 text-xs leading-snug text-ink-muted">{detail}</span>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={removeLabel ?? "Remove"}
          className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-canvas text-[10px] leading-none text-ink-faint transition-colors duration-200 hover:border-red-400/50 hover:text-red-400"
        >
          ×
        </button>
      )}
    </div>
  );
}

function SplitBranches({
  recipients,
  lit,
  index,
  reducedMotion,
}: {
  recipients: ComposerAction["splitRecipients"];
  lit: boolean;
  index: number;
  reducedMotion: boolean;
}) {
  if (recipients.length === 0) return null;
  return (
    <div className="flex shrink-0 items-stretch" aria-hidden="true">
      <div className="flex w-5 items-center">
        <div className={`h-px w-full ${lit ? "bg-brand-bronze/40" : "bg-brand-bronze/15"}`} />
      </div>
      <div className={`flex flex-col justify-center gap-1.5 border-l-2 py-1 pl-3 ${lit ? "border-brand-bronze/30" : "border-brand-bronze/15"}`}>
        {recipients.map((r) => (
          <div
            key={r.id}
            className={`relative flex items-center gap-1.5 overflow-hidden rounded-lg border px-2.5 py-1 text-xs whitespace-nowrap ${
              lit ? "border-action/20 bg-action-soft/40" : "border-action/10 bg-action-soft/15 opacity-70"
            }`}
          >
            {lit && !reducedMotion && (
              <span
                className="animate-channel-value absolute top-1/2 left-0 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-brand-violet blur-[0.5px]"
                style={{ animationDelay: `${-(index * STAGGER_SECONDS)}s` }}
              />
            )}
            <span className="font-mono text-ink-muted">{r.address.trim() ? shortAddress(r.address.trim()) : "…"}</span>
            <span className="text-ink-faint">{r.bps.trim() ? `${bpsStringToPercentText(r.bps)}%` : "…"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AddButton({ label, hint, onClick }: { label: string; hint?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 flex-col items-center gap-0.5 self-center rounded-xl border border-dashed border-brand-bronze/40 px-3 py-2 text-center transition-colors duration-200 hover:border-brand-violet/50"
    >
      <span className="text-base leading-none text-brand-bronze">+</span>
      <span className="text-[11px] leading-tight font-medium whitespace-nowrap text-ink-muted">{label}</span>
      {hint && <span className="text-[10px] leading-tight text-ink-faint italic">{hint}</span>}
    </button>
  );
}

function KindPicker<K extends string | number>({
  kinds,
  labels,
  icons,
  onPick,
}: {
  kinds: K[];
  labels: Record<K, string>;
  icons: Record<K, ComponentType>;
  onPick: (kind: K) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {kinds.map((kind) => {
        const Icon: ComponentType = icons[kind];
        return (
          <button
            key={String(kind)}
            type="button"
            onClick={() => onPick(kind)}
            className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface px-3 py-4 text-center transition-colors duration-200 hover:border-ink-faint"
          >
            <span className="text-brand-bronze">
              <Icon />
            </span>
            <span className="text-xs font-medium text-ink">{labels[kind]}</span>
          </button>
        );
      })}
    </div>
  );
}

function SidePanel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[900]">
      <button type="button" aria-label="Close panel" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-rise-in absolute inset-y-0 right-0 flex w-full flex-col border-l border-border bg-canvas shadow-2xl shadow-black/40 sm:w-[26rem]"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border-soft px-5 py-4">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-ink-faint transition-colors duration-200 hover:text-ink"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
