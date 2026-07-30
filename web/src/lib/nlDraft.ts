import type { Address } from "viem";
import { ActionType, TriggerType } from "./flows";
import {
  emptyAction,
  emptyCondition,
  newAddressRow,
  newSplitRecipientRow,
  type ComposerAction,
  type ComposerCondition,
  type ComposerDraft,
} from "./composer";
import { unixSecondsToDatetimeLocal } from "./format";
import { ORACLE_FEEDS } from "./oracleFeeds";
import { BRIDGE_DESTINATIONS } from "./bridgeDestinations";

/**
 * The flat JSON shape the natural-language proxy's LLM is instructed to
 * return (see api/_lib/generateFlow.ts's system prompt) — deliberately NOT
 * the same shape as `ComposerDraft` (no per-row ids, no datetime-local
 * strings, no on-chain token addresses) so the model only has to reason
 * about the flow model in plain terms. `nlDraftToComposerDraft` below does
 * the (tolerant) conversion into the real thing, which then flows through
 * the EXACT SAME `validateComposerDraft` gate as a manually-built flow
 * before anything can deploy — see FlowComposer.tsx.
 */
export interface NlFlowDraft {
  trigger: {
    kind: "Manual" | "OnSchedule" | "OnThreshold" | "OnReceive";
    scheduleIntervalSeconds?: number;
    thresholdAmountUsdc?: number;
  };
  conditions: NlCondition[];
  actions: NlAction[];
}

export type NlCondition =
  | { kind: "amountCap"; minUsdc?: number; maxUsdc?: number }
  | { kind: "minBalance"; minBalanceUsdc?: number }
  | { kind: "cooldown"; cooldownSeconds?: number }
  | { kind: "timeWindow"; windowStartIso?: string; windowEndIso?: string }
  | { kind: "allowList"; addresses?: string[] }
  | { kind: "denyList"; addresses?: string[] }
  | { kind: "oraclePrice"; feed: string; direction: "above" | "below"; thresholdUsd?: number; maxStalenessSeconds?: number };

export type NlAction =
  | { kind: "Forward"; recipient?: string; amountUsdc?: number }
  | { kind: "Split"; totalUsdc?: number; recipients?: { recipient?: string; bps?: number }[] }
  | { kind: "Sweep"; destination?: string; thresholdUsdc?: number }
  | { kind: "LockRelease"; recipient?: string; amountUsdc?: number; releaseAtIso?: string }
  | { kind: "Swap"; tokenIn?: "USDC" | "EURC"; amountIn?: number; recipient?: string }
  | { kind: "Bridge"; destination?: string; amountUsdc?: number; recipient?: string };

/** What the proxy returns when the request is ambiguous, unsupported, or missing required info — see the system prompt's "WHEN TO REFUSE" section. Never guessed around; surfaced verbatim to the user. */
export interface NlFlowError {
  error: string;
}

export function isNlFlowError(value: unknown): value is NlFlowError {
  return typeof value === "object" && value !== null && typeof (value as { error?: unknown }).error === "string";
}

/**
 * Defensive parse of the proxy's response body — untrusted (LLM output,
 * relayed over the network), so this only trusts what it can actually
 * confirm the rough shape of, and otherwise returns a clarification error
 * rather than crashing the UI or silently coercing garbage into a draft.
 */
export function parseNlFlowResponse(raw: unknown): NlFlowDraft | NlFlowError {
  if (isNlFlowError(raw)) return raw;
  if (typeof raw !== "object" || raw === null) {
    return { error: "The AI builder returned an unexpected response. Try again, or use the manual composer." };
  }
  const v = raw as Record<string, unknown>;
  if (typeof v.trigger !== "object" || v.trigger === null || !Array.isArray(v.actions)) {
    return { error: "The AI builder returned an unexpected response. Try again, or use the manual composer." };
  }
  return {
    trigger: v.trigger as NlFlowDraft["trigger"],
    conditions: Array.isArray(v.conditions) ? (v.conditions as NlCondition[]) : [],
    actions: v.actions as NlAction[],
  };
}

const TRIGGER_KIND_MAP: Record<NlFlowDraft["trigger"]["kind"], TriggerType> = {
  Manual: TriggerType.Manual,
  OnSchedule: TriggerType.OnSchedule,
  OnThreshold: TriggerType.OnThreshold,
  OnReceive: TriggerType.OnReceive,
};

/** "" for 0/undefined/non-finite — lets a value the model wasn't given surface as an honest blank field for the human to fill in (same "don't invent" principle as address safety), rather than a fabricated 0 that reads as a real answer. */
function numOrEmpty(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n) || n === 0) return "";
  return String(n);
}

function isoToDatetimeLocalOrEmpty(iso: string | undefined): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  return unixSecondsToDatetimeLocal(BigInt(Math.floor(ms / 1000)));
}

/**
 * Resolves an address-shaped field from the model's output. "SELF" (the
 * model is instructed to only ever emit this for "me"/"my wallet" — see
 * the system prompt's ADDRESS SAFETY section) is swapped for the
 * CONNECTED WALLET here, client-side — the LLM never sees or chooses a
 * real address for it. Anything else (including "", or a real address the
 * user typed themselves) passes through unchanged; existing composer
 * validation checks it like any other address.
 */
function resolveAddress(value: string | undefined, connectedAddress: Address | undefined, warnings: string[], fieldLabel: string): string {
  if (!value) return "";
  if (value.trim().toUpperCase() === "SELF") {
    if (connectedAddress) return connectedAddress;
    warnings.push(`${fieldLabel}: you weren't connected, so this was left blank. Fill in an address before deploying.`);
    return "";
  }
  return value.trim();
}

export interface NlConversionResult {
  draft: ComposerDraft;
  /** Non-fatal notes to surface alongside the pre-filled draft (e.g. an unresolved "SELF", an unrecognized oracle feed). Never blocks the draft from loading — validateComposerDraft is what actually gates deploy. */
  warnings: string[];
}

/**
 * Converts the LLM's flat `NlFlowDraft` into a real `ComposerDraft` — the
 * SAME shape templates.ts's one-click templates produce (via
 * `emptyAction`/`emptyCondition`/`newAddressRow`/`newSplitRecipientRow`),
 * so it flows through the composer's existing sections and, critically,
 * its existing `validateComposerDraft` gate before deploy exactly like any
 * other draft. Never call this with the raw LLM error shape — check
 * `isNlFlowError`/`parseNlFlowResponse` first.
 */
export function nlDraftToComposerDraft(nl: NlFlowDraft, connectedAddress: Address | undefined): NlConversionResult {
  const warnings: string[] = [];

  const trigger = {
    kind: TRIGGER_KIND_MAP[nl.trigger?.kind] ?? TriggerType.Manual,
    scheduleMode: "now" as const,
    scheduleAt: "",
    intervalSeconds: numOrEmpty(nl.trigger?.scheduleIntervalSeconds),
    thresholdAmount: numOrEmpty(nl.trigger?.thresholdAmountUsdc),
  };

  const conditions: ComposerCondition[] = (nl.conditions ?? []).map((c) => nlConditionToComposer(c, warnings));
  const actions: ComposerAction[] = (nl.actions ?? []).map((a) => nlActionToComposer(a, connectedAddress, warnings));

  return { draft: { trigger, conditions, actions }, warnings };
}

function nlConditionToComposer(c: NlCondition, warnings: string[]): ComposerCondition {
  switch (c.kind) {
    case "amountCap": {
      const cond = emptyCondition("amountCap");
      cond.minAmount = numOrEmpty(c.minUsdc);
      cond.maxAmount = numOrEmpty(c.maxUsdc);
      return cond;
    }
    case "minBalance": {
      const cond = emptyCondition("minBalance");
      cond.minBalance = numOrEmpty(c.minBalanceUsdc);
      return cond;
    }
    case "cooldown": {
      const cond = emptyCondition("cooldown");
      cond.cooldownSeconds = numOrEmpty(c.cooldownSeconds);
      return cond;
    }
    case "timeWindow": {
      const cond = emptyCondition("timeWindow");
      cond.windowStart = isoToDatetimeLocalOrEmpty(c.windowStartIso);
      cond.windowEnd = isoToDatetimeLocalOrEmpty(c.windowEndIso);
      return cond;
    }
    case "allowList":
    case "denyList": {
      const cond = emptyCondition(c.kind);
      cond.recipients = (c.addresses ?? []).map((address) => {
        const row = newAddressRow();
        row.address = address.trim();
        return row;
      });
      return cond;
    }
    case "oraclePrice": {
      const cond = emptyCondition("oraclePrice");
      const feed = ORACLE_FEEDS.find((f) => f.label.toLowerCase() === c.feed?.toLowerCase());
      if (feed) {
        cond.oracleFeedKey = feed.key;
      } else {
        warnings.push(`Oracle price: didn't recognize feed "${c.feed}", defaulted to ${ORACLE_FEEDS[0].label}. Double-check it's right.`);
      }
      cond.oracleDirection = c.direction === "above" ? "above" : "below";
      cond.oracleThreshold = c.thresholdUsd !== undefined && c.thresholdUsd > 0 ? String(c.thresholdUsd) : "";
      cond.oracleMaxStalenessSeconds = c.maxStalenessSeconds && c.maxStalenessSeconds > 0 ? String(c.maxStalenessSeconds) : "300";
      return cond;
    }
    default:
      return emptyCondition("amountCap");
  }
}

function nlActionToComposer(a: NlAction, connectedAddress: Address | undefined, warnings: string[]): ComposerAction {
  switch (a.kind) {
    case "Forward": {
      const action = emptyAction(ActionType.Forward);
      action.forwardRecipient = resolveAddress(a.recipient, connectedAddress, warnings, "Forward recipient");
      action.forwardAmount = numOrEmpty(a.amountUsdc);
      return action;
    }
    case "Split": {
      const action = emptyAction(ActionType.Split);
      action.splitTotal = numOrEmpty(a.totalUsdc);
      action.splitRecipients = (a.recipients ?? []).map((r) => {
        const row = newSplitRecipientRow();
        row.address = resolveAddress(r.recipient, connectedAddress, warnings, "Split recipient");
        row.bps = r.bps !== undefined && r.bps > 0 ? String(r.bps) : "";
        return row;
      });
      return action;
    }
    case "Sweep": {
      const action = emptyAction(ActionType.Sweep);
      action.sweepDestination = resolveAddress(a.destination, connectedAddress, warnings, "Sweep destination");
      action.sweepThreshold = numOrEmpty(a.thresholdUsdc);
      return action;
    }
    case "LockRelease": {
      const action = emptyAction(ActionType.LockRelease);
      action.lockRecipient = resolveAddress(a.recipient, connectedAddress, warnings, "Lock/release recipient");
      action.lockAmount = numOrEmpty(a.amountUsdc);
      action.lockReleaseAt = isoToDatetimeLocalOrEmpty(a.releaseAtIso);
      return action;
    }
    case "Swap": {
      const action = emptyAction(ActionType.Swap);
      action.swapTokenIn = a.tokenIn === "EURC" ? "EURC" : "USDC";
      action.swapAmountIn = numOrEmpty(a.amountIn);
      action.swapRecipient = resolveAddress(a.recipient, connectedAddress, warnings, "Swap recipient");
      // swapMinAmountOut deliberately left blank — ActionsSection derives it
      // live from the pool's own quote() + slippage tolerance once rendered
      // (same as every existing template in templates.ts); an LLM has no
      // business guessing a slippage floor.
      return action;
    }
    case "Bridge": {
      const action = emptyAction(ActionType.Bridge);
      const destination = BRIDGE_DESTINATIONS.find((d) => d.label.toLowerCase() === a.destination?.toLowerCase());
      if (destination) {
        action.bridgeDestinationKey = destination.key;
      } else if (a.destination) {
        warnings.push(`Bridge: didn't recognize destination "${a.destination}", defaulted to ${BRIDGE_DESTINATIONS[0].label}. Double-check it's right.`);
      }
      action.bridgeAmount = numOrEmpty(a.amountUsdc);
      action.bridgeRecipient = resolveAddress(a.recipient, connectedAddress, warnings, "Bridge recipient");
      return action;
    }
    default:
      return emptyAction(ActionType.Forward);
  }
}
