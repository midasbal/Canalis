import { ActionType, SCHEDULE_NEVER_AGAIN, TriggerType, type Action, type Condition, type Flow, type Trigger } from "./flows";
import { formatDuration, formatTimestamp, formatUsdc, shortAddress } from "./format";

/**
 * Builds a plain-English sentence describing a Flow — used both for the
 * pre-deploy "what this will do" preview (Stage 4) and the deployed-flows
 * list (Stage 2). Works off the canonical `Flow` type so both call sites
 * (a composed-but-unregistered draft, or a real on-chain flow from
 * `getFlow`) go through the exact same wording, covering every
 * trigger/condition/action combination.
 */
export function summarizeFlow(flow: Flow): string {
  const triggerPart = summarizeTrigger(flow.trigger);
  const conditionParts = summarizeConditions(flow.conditions);
  const actionParts = summarizeActions(flow.actions);

  let sentence = triggerPart;
  if (conditionParts.length > 0) {
    sentence += `, if ${conditionParts.join(" and ")}`;
  }
  sentence += actionParts.length > 0 ? `, ${actionParts.join("; then ")}.` : ", do nothing (no actions configured).";
  return sentence;
}

function summarizeTrigger(trigger: Trigger): string {
  switch (trigger.kind) {
    case TriggerType.Manual:
      return "Run manually";
    case TriggerType.OnReceive:
      return "When USDC arrives";
    case TriggerType.OnThreshold:
      return `When balance is ≥ ${formatUsdc(trigger.thresholdAmount)} USDC`;
    case TriggerType.OnSchedule: {
      if (trigger.scheduleInterval > 0n) {
        return `Every ${formatDuration(trigger.scheduleInterval)}, next at ${formatTimestamp(trigger.scheduleAt)}`;
      }
      // One-shot: the executor sets scheduleAt to `type(uint256).max` once
      // it has run — "never due again", not a real future date.
      if (trigger.scheduleAt === SCHEDULE_NEVER_AGAIN) {
        return "One-time — already run";
      }
      return `One-time — runs at ${formatTimestamp(trigger.scheduleAt)}`;
    }
    default:
      return "On an unknown trigger";
  }
}

function summarizeConditions(conditions: Condition[]): string[] {
  const parts: string[] = [];
  for (const c of conditions) {
    if (c.minBalance > 0n) parts.push(`balance ≥ ${formatUsdc(c.minBalance)} USDC`);
    if (c.minAmount > 0n) parts.push(`amount ≥ ${formatUsdc(c.minAmount)} USDC`);
    if (c.maxAmount > 0n) parts.push(`amount ≤ ${formatUsdc(c.maxAmount)} USDC`);
    if (c.cooldownSeconds > 0n) parts.push(`at least ${formatDuration(c.cooldownSeconds)} since the last run`);
    if (c.windowStart > 0n && c.windowEnd > 0n) {
      parts.push(`between ${formatTimestamp(c.windowStart)} and ${formatTimestamp(c.windowEnd)}`);
    } else if (c.windowStart > 0n) {
      parts.push(`no earlier than ${formatTimestamp(c.windowStart)}`);
    } else if (c.windowEnd > 0n) {
      parts.push(`no later than ${formatTimestamp(c.windowEnd)}`);
    }
    if (c.allowedRecipients.length > 0) {
      parts.push(`only paying ${c.allowedRecipients.map(shortAddress).join(", ")}`);
    }
    if (c.deniedRecipients.length > 0) {
      parts.push(`never paying ${c.deniedRecipients.map(shortAddress).join(", ")}`);
    }
  }
  return parts;
}

function summarizeActions(actions: Action[]): string[] {
  return actions.map(summarizeAction);
}

function summarizeAction(action: Action): string {
  switch (action.kind) {
    case ActionType.Forward:
      return `forward ${formatUsdc(action.fixedAmount)} USDC to ${shortAddress(action.recipients[0] ?? "0x0")}`;
    case ActionType.Split: {
      const legs = action.recipients.map((recipient, i) => {
        const bps = action.amountsOrBps[i] ?? 0n;
        const pct = Number(bps) / 100;
        return `${pct}% to ${shortAddress(recipient)}`;
      });
      return `split ${formatUsdc(action.fixedAmount)} USDC — ${legs.join(", ")}`;
    }
    case ActionType.Sweep:
      return `sweep everything above ${formatUsdc(action.sweepThreshold)} USDC to ${shortAddress(action.recipients[0] ?? "0x0")}`;
    case ActionType.LockRelease:
      return `lock ${formatUsdc(action.fixedAmount)} USDC, releasable to ${shortAddress(action.recipients[0] ?? "0x0")} at ${formatTimestamp(action.unlockTime)}`;
    default:
      return "do an unknown action";
  }
}

/** Short, human label for an ActionType — used in the run log. */
export function actionTypeLabel(kind: ActionType): string {
  switch (kind) {
    case ActionType.Forward:
      return "Forward";
    case ActionType.Split:
      return "Split";
    case ActionType.Sweep:
      return "Sweep";
    case ActionType.LockRelease:
      return "Lock/Release";
    default:
      return "Unknown";
  }
}

/** Short, human label for a TriggerType — used in flow cards/badges. */
export function triggerTypeLabel(kind: TriggerType): string {
  switch (kind) {
    case TriggerType.Manual:
      return "Manual";
    case TriggerType.OnReceive:
      return "On receive";
    case TriggerType.OnThreshold:
      return "On threshold";
    case TriggerType.OnSchedule:
      return "On schedule";
    default:
      return "Unknown";
  }
}
