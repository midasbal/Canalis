import { TriggerType } from "./flows";
import type { ComposerAction, ComposerCondition, ComposerTrigger } from "./composer";
import { shortAddress } from "./format";
import { ORACLE_FEEDS } from "./oracleFeeds";
import { BRIDGE_DESTINATIONS } from "./bridgeDestinations";
import { ActionType } from "./flows";

/**
 * One-line, live descriptions of a single draft node for the channel
 * canvas. Reads the SAME ComposerDraft fields the existing field editors
 * write to, formatted loosely (never throws on partial/invalid input,
 * since this is presentation only) — validateComposerDraft is still the
 * only thing that gates deploy. Titles come from the composer's own
 * existing kind-label maps (flowSummary.ts / lib/composer.ts), not
 * duplicated here.
 */

function trimmedOr(value: string, fallback: string): string {
  const t = value.trim();
  return t ? t : fallback;
}

function shortDate(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function triggerNodeSummary(trigger: ComposerTrigger): string {
  switch (trigger.kind) {
    case TriggerType.Manual:
      return 'Fires when you click "Run now."';
    case TriggerType.OnReceive:
      return "Fires when USDC arrives.";
    case TriggerType.OnThreshold:
      return trigger.thresholdAmount.trim() ? `Balance at or above ${trigger.thresholdAmount.trim()} USDC` : "Set a threshold amount";
    case TriggerType.OnSchedule: {
      const seconds = Number(trigger.intervalSeconds);
      if (Number.isFinite(seconds) && seconds > 0) return `Every ${seconds}s`;
      if (trigger.scheduleMode === "custom") {
        const at = shortDate(trigger.scheduleAt);
        return at ? `Runs once at ${at}` : "Pick a first-run time";
      }
      return "Runs once, right away";
    }
    default:
      return "";
  }
}

export function conditionNodeSummary(condition: ComposerCondition): string {
  switch (condition.kind) {
    case "amountCap": {
      const min = condition.minAmount.trim();
      const max = condition.maxAmount.trim();
      if (min && max) return `${min} to ${max} USDC`;
      if (min) return `At least ${min} USDC`;
      if (max) return `At most ${max} USDC`;
      return "Set an amount range";
    }
    case "minBalance":
      return condition.minBalance.trim() ? `Balance at or above ${condition.minBalance.trim()} USDC` : "Set a minimum balance";
    case "cooldown":
      return condition.cooldownSeconds.trim() ? `At least ${condition.cooldownSeconds.trim()}s since last run` : "Set a cooldown";
    case "timeWindow": {
      const start = shortDate(condition.windowStart);
      const end = shortDate(condition.windowEnd);
      if (start && end) return `${start} to ${end}`;
      if (start) return `No earlier than ${start}`;
      if (end) return `No later than ${end}`;
      return "Set a start, an end, or both";
    }
    case "allowList": {
      const n = condition.recipients.length;
      return n > 0 ? `Only paying ${n} address${n === 1 ? "" : "es"}` : "Add at least one address";
    }
    case "denyList": {
      const n = condition.recipients.length;
      return n > 0 ? `Never paying ${n} address${n === 1 ? "" : "es"}` : "Add at least one address";
    }
    case "oraclePrice": {
      const feed = ORACLE_FEEDS.find((f) => f.key === condition.oracleFeedKey);
      const label = feed?.label ?? "Feed";
      const direction = condition.oracleDirection === "above" ? "at or above" : "below";
      return condition.oracleThreshold.trim() ? `${label} ${direction} ${condition.oracleThreshold.trim()}` : `Set a ${label} threshold`;
    }
    default:
      return "";
  }
}

export function actionNodeSummary(action: ComposerAction): string {
  switch (action.kind) {
    case ActionType.Forward:
      return `Forward ${trimmedOr(action.forwardAmount, "…")} USDC to ${
        action.forwardRecipient.trim() ? shortAddress(action.forwardRecipient.trim()) : "…"
      }`;
    case ActionType.Split: {
      const n = action.splitRecipients.length;
      return `Split ${trimmedOr(action.splitTotal, "…")} USDC across ${n} recipient${n === 1 ? "" : "s"}`;
    }
    case ActionType.Sweep:
      return `Sweep above ${trimmedOr(action.sweepThreshold, "0")} USDC to ${
        action.sweepDestination.trim() ? shortAddress(action.sweepDestination.trim()) : "…"
      }`;
    case ActionType.LockRelease: {
      const at = shortDate(action.lockReleaseAt);
      return `Lock ${trimmedOr(action.lockAmount, "…")} USDC${at ? `, releasable ${at}` : ""}`;
    }
    case ActionType.Swap: {
      const tokenOut = action.swapTokenIn === "USDC" ? "EURC" : "USDC";
      return `Swap ${trimmedOr(action.swapAmountIn, "…")} ${action.swapTokenIn} to ${tokenOut}`;
    }
    case ActionType.Bridge: {
      const destination = BRIDGE_DESTINATIONS.find((d) => d.key === action.bridgeDestinationKey);
      return `Bridge ${trimmedOr(action.bridgeAmount, "…")} USDC to ${destination?.label ?? "destination"}`;
    }
    default:
      return "";
  }
}
