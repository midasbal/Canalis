/**
 * Custom block icons for the channel canvas (Builder) and the landing's
 * "how it works" illustration, so both surfaces share the same glyphs.
 * Hand-drawn, one shared visual language: a 24x24 viewBox, one stroke
 * weight (1.5, rounded caps/joins, currentColor so callers set bronze via
 * the category-colored node frame), a faint baseline "channel" segment
 * every icon sits on, and a single filled brand-violet dot marking the
 * value/output point, consistent placement per category. Kept in one
 * file, distinct from ui/icons.tsx (small chrome icons) and
 * landing/icons.tsx (the landing's own capability icons).
 */
import type { ComponentType, ReactNode } from "react";
import { TriggerType } from "../../lib/flows";
import type { ConditionKind } from "../../lib/composer";
import { ActionType } from "../../lib/flows";

const common = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** The shared baseline every block icon sits on, evoking the channel run beneath it. */
function Baseline() {
  return <path d="M3 20h18" opacity={0.35} />;
}

/** A filled brand-violet dot marking the value/output point, in the same spot across a category. */
function Accent({ cx, cy }: { cx: number; cy: number }) {
  return <circle cx={cx} cy={cy} r={1.4} className="fill-brand-violet" stroke="none" />;
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg {...common}>
      <Baseline />
      {children}
    </svg>
  );
}

// ---------------------------------------------------------------------
// Triggers — the source. Accent dot sits at the channel's start (left).
// ---------------------------------------------------------------------

export function ManualTriggerIcon() {
  return (
    <Icon>
      <path d="M12 5v7" />
      <path d="M9 9l3 3 3-3" />
      <Accent cx={5} cy={20} />
    </Icon>
  );
}

export function ScheduleTriggerIcon() {
  return (
    <Icon>
      <circle cx="12" cy="11" r="6.2" />
      <path d="M12 7.5V11l3 2" />
      <Accent cx={5} cy={20} />
    </Icon>
  );
}

export function ThresholdTriggerIcon() {
  return (
    <Icon>
      <path d="M7 5v13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5" />
      <path d="M7 12h10" />
      <path d="M9.5 9l2.5-2.5L14.5 9" />
      <Accent cx={5} cy={20} />
    </Icon>
  );
}

export function ReceiveTriggerIcon() {
  return (
    <Icon>
      <path d="M12 4v9" />
      <path d="M8.5 10L12 13.5 15.5 10" />
      <path d="M6 16.5h12l-1.6 2.3a1 1 0 0 1-.8.4H8.4a1 1 0 0 1-.8-.4z" />
      <Accent cx={5} cy={20} />
    </Icon>
  );
}

// ---------------------------------------------------------------------
// Conditions — the gates. Accent dot sits mid-channel (center).
// ---------------------------------------------------------------------

export function AmountCapIcon() {
  return (
    <Icon>
      <path d="M8 6H6a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h2" />
      <path d="M16 6h2a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-2" />
      <Accent cx={12} cy={20} />
    </Icon>
  );
}

export function MinBalanceIcon() {
  return (
    <Icon>
      <rect x="6" y="5" width="12" height="14" rx="1.5" />
      <path d="M6 13h12" />
      <Accent cx={12} cy={20} />
    </Icon>
  );
}

export function CooldownIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="6.5" />
      <path d="M12 9v3.2l2 1.3" />
      <path d="M9.5 3.5h5" />
      <Accent cx={12} cy={20} />
    </Icon>
  );
}

export function TimeWindowIcon() {
  return (
    <Icon>
      <path d="M6 5v14" />
      <path d="M18 5v14" />
      <path d="M6 12h12" strokeDasharray="2.5 3" />
      <Accent cx={12} cy={20} />
    </Icon>
  );
}

export function AllowListIcon() {
  return (
    <Icon>
      <path d="M5 12a7 7 0 0 1 14 0" />
      <path d="M9.5 12l1.8 1.8L14.5 10" />
      <Accent cx={12} cy={20} />
    </Icon>
  );
}

export function DenyListIcon() {
  return (
    <Icon>
      <path d="M5 12a7 7 0 0 1 14 0" />
      <path d="M10 9.5l4 4M14 9.5l-4 4" />
      <Accent cx={12} cy={20} />
    </Icon>
  );
}

export function OraclePriceIcon() {
  return (
    <Icon>
      <path d="M4 15l4-5 3.5 3L18 6" />
      <path d="M14.5 6H18v3.5" />
      <Accent cx={12} cy={20} />
    </Icon>
  );
}

// ---------------------------------------------------------------------
// Actions — the outlets. Accent dot sits at the channel's end (right).
// ---------------------------------------------------------------------

export function ForwardActionIcon() {
  return (
    <Icon>
      <path d="M4 12h12" />
      <path d="M12.5 8.5L16 12l-3.5 3.5" />
      <Accent cx={19} cy={20} />
    </Icon>
  );
}

export function SplitActionIcon() {
  return (
    <Icon>
      <path d="M4 12h5" />
      <path d="M9 12l5.5-5.5M9 12l5.5 5.5" />
      <path d="M14.5 6.5H18M14.5 17.5H18" />
      <Accent cx={19} cy={20} />
    </Icon>
  );
}

export function SweepActionIcon() {
  return (
    <Icon>
      <path d="M5 8l6 6" />
      <path d="M9 5.5l9 9a2 2 0 0 1 0 2.8l-.7.7a2 2 0 0 1-2.8 0l-9-9z" />
      <Accent cx={19} cy={20} />
    </Icon>
  );
}

export function LockReleaseActionIcon() {
  return (
    <Icon>
      <rect x="6.5" y="11" width="11" height="8" rx="1.5" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
      <Accent cx={19} cy={20} />
    </Icon>
  );
}

export function SwapActionIcon() {
  return (
    <Icon>
      <path d="M5 9h11" />
      <path d="M13 5.5L16.5 9 13 12.5" />
      <path d="M19 15H8" />
      <path d="M11 11.5L7.5 15 11 18.5" />
      <Accent cx={19} cy={20} />
    </Icon>
  );
}

export function BridgeActionIcon() {
  return (
    <Icon>
      <path d="M4 15c1.5-3.5 4-5.5 8-5.5s6.5 2 8 5.5" />
      <path d="M6.5 15v3M17.5 15v3M4 18h16" />
      <Accent cx={19} cy={20} />
    </Icon>
  );
}

// ---------------------------------------------------------------------
// Lookup maps, keyed by the same kind values the composer draft already
// uses, so canvas nodes can go straight from a draft item to its icon.
// ---------------------------------------------------------------------

export const TRIGGER_ICONS: Record<TriggerType, ComponentType> = {
  [TriggerType.Manual]: ManualTriggerIcon,
  [TriggerType.OnSchedule]: ScheduleTriggerIcon,
  [TriggerType.OnThreshold]: ThresholdTriggerIcon,
  [TriggerType.OnReceive]: ReceiveTriggerIcon,
};

export const CONDITION_ICONS: Record<ConditionKind, ComponentType> = {
  amountCap: AmountCapIcon,
  minBalance: MinBalanceIcon,
  cooldown: CooldownIcon,
  timeWindow: TimeWindowIcon,
  allowList: AllowListIcon,
  denyList: DenyListIcon,
  oraclePrice: OraclePriceIcon,
};

export const ACTION_ICONS: Record<ActionType, ComponentType> = {
  [ActionType.Forward]: ForwardActionIcon,
  [ActionType.Split]: SplitActionIcon,
  [ActionType.Sweep]: SweepActionIcon,
  [ActionType.LockRelease]: LockReleaseActionIcon,
  [ActionType.Swap]: SwapActionIcon,
  [ActionType.Bridge]: BridgeActionIcon,
};
