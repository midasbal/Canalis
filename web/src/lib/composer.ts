import { isAddress, parseUnits } from "viem";
import type { Address } from "viem";
import { ActionType, PRICE_ID_UNSET, TriggerType, type Action, type Condition, type Flow } from "./flows";
import { USDC_DECIMALS, datetimeLocalToUnixSeconds } from "./format";
import { CANALIS_EURC_ADDRESS, CANALIS_USDC_ADDRESS } from "./contracts";
import { ORACLE_FEEDS } from "./oracleFeeds";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

/**
 * Draft (string-based, form-friendly) state for the flow composer, and its
 * conversion into a real `Flow` (lib/flows.ts) for `registerFlow` / the
 * pre-deploy summary. Kept separate from `flows.ts` (a pure Solidity
 * mirror) since this is UI-only shape — free-text inputs, per-row ids for
 * add/remove lists, datetime-local strings — that never touches the chain
 * directly.
 */

let nextId = 0;
function freshId(): string {
  nextId += 1;
  return `row-${nextId}`;
}

// ---------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------

export interface ComposerTrigger {
  kind: TriggerType;
  scheduleMode: "now" | "custom";
  scheduleAt: string; // datetime-local value, used when scheduleMode === "custom"
  intervalSeconds: string; // "" or "0" = one-shot
  thresholdAmount: string; // USDC
}

export function defaultTrigger(): ComposerTrigger {
  return { kind: TriggerType.Manual, scheduleMode: "now", scheduleAt: "", intervalSeconds: "", thresholdAmount: "" };
}

/** The composer's full working state — trigger + conditions + actions. */
export interface ComposerDraft {
  trigger: ComposerTrigger;
  conditions: ComposerCondition[];
  actions: ComposerAction[];
}

export function defaultDraft(): ComposerDraft {
  return { trigger: defaultTrigger(), conditions: [], actions: [] };
}

// ---------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------

export type ConditionKind = "amountCap" | "minBalance" | "cooldown" | "timeWindow" | "allowList" | "denyList" | "oraclePrice";

export const CONDITION_KIND_LABELS: Record<ConditionKind, string> = {
  amountCap: "Amount cap",
  minBalance: "Minimum balance",
  cooldown: "Cooldown",
  timeWindow: "Time window",
  allowList: "Allow-list recipients",
  denyList: "Deny-list recipients",
  oraclePrice: "Oracle price",
};

export interface AddressRow {
  id: string;
  address: string;
}

export interface ComposerCondition {
  id: string;
  kind: ConditionKind;
  minAmount: string;
  maxAmount: string;
  minBalance: string;
  cooldownSeconds: string;
  windowStart: string; // datetime-local
  windowEnd: string; // datetime-local
  recipients: AddressRow[]; // allowList / denyList
  // oraclePrice
  oracleFeedKey: string; // key into ORACLE_FEEDS (lib/oracleFeeds.ts)
  oracleDirection: "above" | "below";
  oracleThreshold: string; // decimal USD price, e.g. "1.08"
  oracleMaxStalenessSeconds: string;
}

export function emptyCondition(kind: ConditionKind): ComposerCondition {
  return {
    id: freshId(),
    kind,
    minAmount: "",
    maxAmount: "",
    minBalance: "",
    cooldownSeconds: "",
    windowStart: "",
    windowEnd: "",
    recipients: [],
    oracleFeedKey: ORACLE_FEEDS[0].key,
    oracleDirection: "below",
    oracleThreshold: "",
    oracleMaxStalenessSeconds: "300",
  };
}

export function newAddressRow(): AddressRow {
  return { id: freshId(), address: "" };
}

// ---------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------

export const ACTION_KIND_LABELS: Record<ActionType, string> = {
  [ActionType.Forward]: "Forward",
  [ActionType.Split]: "Split",
  [ActionType.Sweep]: "Sweep",
  [ActionType.LockRelease]: "Lock / release",
  [ActionType.Swap]: "Swap",
};

export type SwapTokenSymbol = "USDC" | "EURC";

export interface SplitRecipientRow {
  id: string;
  address: string;
  bps: string; // basis points, 0-10000
}

export interface ComposerAction {
  id: string;
  kind: ActionType;
  // Forward
  forwardRecipient: string;
  forwardAmount: string;
  // Split
  splitTotal: string;
  splitRecipients: SplitRecipientRow[];
  // Sweep
  sweepDestination: string;
  sweepThreshold: string;
  // LockRelease
  lockRecipient: string;
  lockAmount: string;
  lockReleaseAt: string; // datetime-local
  // Swap
  swapTokenIn: SwapTokenSymbol;
  swapAmountIn: string;
  swapRecipient: string;
  swapSlippageBps: string; // UI-only tolerance; the composer derives swapMinAmountOut from this + a live pool quote
  swapMinAmountOut: string; // the actual on-chain slippage floor — kept in sync with slippageBps by the UI (see composer/SwapQuote.tsx), but this is the field that's actually sent
}

export function emptyAction(kind: ActionType): ComposerAction {
  return {
    id: freshId(),
    kind,
    forwardRecipient: "",
    forwardAmount: "",
    splitTotal: "",
    splitRecipients: [],
    sweepDestination: "",
    sweepThreshold: "",
    lockRecipient: "",
    lockAmount: "",
    lockReleaseAt: "",
    swapTokenIn: "USDC",
    swapAmountIn: "",
    swapRecipient: "",
    swapSlippageBps: "100", // 1% default tolerance
    swapMinAmountOut: "",
  };
}

export function newSplitRecipientRow(): SplitRecipientRow {
  return { id: freshId(), address: "", bps: "" };
}

// ---------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------

function parseUsdcSafe(value: string): bigint | null {
  if (!value.trim()) return null;
  try {
    const parsed = parseUnits(value.trim(), USDC_DECIMALS);
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
}

function parseIntSafe(value: string): bigint | null {
  if (!value.trim()) return null;
  if (!/^\d+$/.test(value.trim())) return null;
  return BigInt(value.trim());
}

/** Parses a decimal USD price string (e.g. "1.08") into the 18-decimal fixed-point uint CanalisExecutor compares against — see FlowTypes.Condition.priceThreshold docs. */
function parsePrice18Safe(value: string): bigint | null {
  if (!value.trim()) return null;
  try {
    const parsed = parseUnits(value.trim(), 18);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Draft -> Flow (tolerant: invalid/missing fields fall back to sentinel
// zero values so a partially-filled draft can still be summarized/previewed
// without throwing. `validateComposerDraft` is what actually gates deploy.)
// ---------------------------------------------------------------------

export function draftToFlow(
  owner: Address,
  trigger: ComposerTrigger,
  conditions: ComposerCondition[],
  actions: ComposerAction[],
): Flow {
  return {
    owner,
    trigger: {
      kind: trigger.kind,
      scheduleAt: triggerScheduleAt(trigger),
      scheduleInterval: parseIntSafe(trigger.intervalSeconds) ?? 0n,
      thresholdAmount: parseUsdcSafe(trigger.thresholdAmount) ?? 0n,
      // Engine (slice 4) only supports the "fires at/above" direction —
      // registerFlow reverts otherwise. Always true; there is no UI toggle
      // because the other direction doesn't exist on-chain.
      thresholdIsAbove: true,
    },
    conditions: conditions.map(conditionToStruct),
    actions: actions.map(actionToStruct),
    active: true,
    lastExecutedAt: 0n,
  };
}

function triggerScheduleAt(trigger: ComposerTrigger): bigint {
  if (trigger.kind !== TriggerType.OnSchedule) return 0n;
  if (trigger.scheduleMode === "now") return BigInt(Math.floor(Date.now() / 1000));
  return datetimeLocalToUnixSeconds(trigger.scheduleAt) ?? 0n;
}

function conditionToStruct(condition: ComposerCondition): Condition {
  const base: Condition = {
    minAmount: 0n,
    maxAmount: 0n,
    cooldownSeconds: 0n,
    windowStart: 0n,
    windowEnd: 0n,
    minBalance: 0n,
    allowedRecipients: [],
    deniedRecipients: [],
    priceId: PRICE_ID_UNSET,
    priceThreshold: 0n,
    priceAbove: false,
    maxStaleness: 0n,
  };

  switch (condition.kind) {
    case "amountCap":
      return { ...base, minAmount: parseUsdcSafe(condition.minAmount) ?? 0n, maxAmount: parseUsdcSafe(condition.maxAmount) ?? 0n };
    case "minBalance":
      return { ...base, minBalance: parseUsdcSafe(condition.minBalance) ?? 0n };
    case "cooldown":
      return { ...base, cooldownSeconds: parseIntSafe(condition.cooldownSeconds) ?? 0n };
    case "timeWindow":
      return {
        ...base,
        windowStart: datetimeLocalToUnixSeconds(condition.windowStart) ?? 0n,
        windowEnd: datetimeLocalToUnixSeconds(condition.windowEnd) ?? 0n,
      };
    case "allowList":
      return { ...base, allowedRecipients: validAddresses(condition.recipients) };
    case "denyList":
      return { ...base, deniedRecipients: validAddresses(condition.recipients) };
    case "oraclePrice": {
      const feed = ORACLE_FEEDS.find((f) => f.key === condition.oracleFeedKey);
      return {
        ...base,
        priceId: feed?.priceId ?? PRICE_ID_UNSET,
        priceThreshold: parsePrice18Safe(condition.oracleThreshold) ?? 0n,
        priceAbove: condition.oracleDirection === "above",
        maxStaleness: parseIntSafe(condition.oracleMaxStalenessSeconds) ?? 0n,
      };
    }
    default:
      return base;
  }
}

function validAddresses(rows: AddressRow[]): Address[] {
  return rows.map((r) => r.address.trim()).filter((a): a is Address => isAddress(a));
}

function actionToStruct(action: ComposerAction): Action {
  const base: Action = {
    kind: action.kind,
    recipients: [],
    amountsOrBps: [],
    fixedAmount: 0n,
    sweepThreshold: 0n,
    unlockTime: 0n,
    tokenIn: ZERO_ADDRESS,
    tokenOut: ZERO_ADDRESS,
    minAmountOut: 0n,
  };

  switch (action.kind) {
    case ActionType.Forward:
      return {
        ...base,
        recipients: isAddress(action.forwardRecipient.trim()) ? [action.forwardRecipient.trim() as Address] : [],
        fixedAmount: parseUsdcSafe(action.forwardAmount) ?? 0n,
      };
    case ActionType.Split:
      return {
        ...base,
        recipients: action.splitRecipients.map((r) => r.address.trim()) as Address[],
        amountsOrBps: action.splitRecipients.map((r) => parseIntSafe(r.bps) ?? 0n),
        fixedAmount: parseUsdcSafe(action.splitTotal) ?? 0n,
      };
    case ActionType.Sweep:
      return {
        ...base,
        recipients: isAddress(action.sweepDestination.trim()) ? [action.sweepDestination.trim() as Address] : [],
        sweepThreshold: parseUsdcSafe(action.sweepThreshold) ?? 0n,
      };
    case ActionType.LockRelease:
      return {
        ...base,
        recipients: isAddress(action.lockRecipient.trim()) ? [action.lockRecipient.trim() as Address] : [],
        fixedAmount: parseUsdcSafe(action.lockAmount) ?? 0n,
        unlockTime: datetimeLocalToUnixSeconds(action.lockReleaseAt) ?? 0n,
      };
    case ActionType.Swap: {
      const [tokenIn, tokenOut] = swapTokenAddresses(action.swapTokenIn);
      return {
        ...base,
        recipients: isAddress(action.swapRecipient.trim()) ? [action.swapRecipient.trim() as Address] : [],
        fixedAmount: parseUsdcSafe(action.swapAmountIn) ?? 0n,
        tokenIn: tokenIn ?? ZERO_ADDRESS,
        tokenOut: tokenOut ?? ZERO_ADDRESS,
        minAmountOut: parseUsdcSafe(action.swapMinAmountOut) ?? 0n,
      };
    }
    default:
      return base;
  }
}

/** [tokenIn, tokenOut] pool addresses for a composer swap direction. Either may be undefined if VITE_USDC_ADDRESS/VITE_EURC_ADDRESS aren't configured. */
export function swapTokenAddresses(tokenIn: SwapTokenSymbol): [Address | undefined, Address | undefined] {
  return tokenIn === "USDC" ? [CANALIS_USDC_ADDRESS, CANALIS_EURC_ADDRESS] : [CANALIS_EURC_ADDRESS, CANALIS_USDC_ADDRESS];
}

// ---------------------------------------------------------------------
// Validation — gates the Deploy button and lists what to fix.
// ---------------------------------------------------------------------

export function validateComposerDraft(
  trigger: ComposerTrigger,
  conditions: ComposerCondition[],
  actions: ComposerAction[],
): string[] {
  const errors: string[] = [];

  // Trigger
  if (trigger.kind === TriggerType.OnSchedule) {
    if (trigger.scheduleMode === "custom" && datetimeLocalToUnixSeconds(trigger.scheduleAt) === null) {
      errors.push("Schedule: pick a first-run date/time, or switch to \"now\".");
    }
    if (trigger.intervalSeconds.trim() && parseIntSafe(trigger.intervalSeconds) === null) {
      errors.push("Schedule: interval must be a whole number of seconds (0 or blank for one-time).");
    }
  }
  if (trigger.kind === TriggerType.OnThreshold) {
    const amount = parseUsdcSafe(trigger.thresholdAmount);
    if (amount === null || amount <= 0n) {
      errors.push("Threshold: amount must be a valid USDC amount greater than 0.");
    }
  }

  // Conditions
  for (const c of conditions) {
    const label = CONDITION_KIND_LABELS[c.kind];
    if (c.kind === "amountCap") {
      const min = c.minAmount.trim() ? parseUsdcSafe(c.minAmount) : 0n;
      const max = c.maxAmount.trim() ? parseUsdcSafe(c.maxAmount) : 0n;
      if (min === null) errors.push(`${label}: minimum amount is invalid.`);
      if (max === null) errors.push(`${label}: maximum amount is invalid.`);
      if (!c.minAmount.trim() && !c.maxAmount.trim()) errors.push(`${label}: set a minimum, a maximum, or both.`);
      if (min !== null && max !== null && min > 0n && max > 0n && min > max) {
        errors.push(`${label}: minimum can't be greater than maximum.`);
      }
    }
    if (c.kind === "minBalance") {
      const min = parseUsdcSafe(c.minBalance);
      if (min === null || min <= 0n) errors.push(`${label}: enter a valid USDC amount greater than 0.`);
    }
    if (c.kind === "cooldown") {
      const seconds = parseIntSafe(c.cooldownSeconds);
      if (seconds === null || seconds <= 0n) errors.push(`${label}: enter a whole number of seconds greater than 0.`);
    }
    if (c.kind === "timeWindow") {
      const start = c.windowStart ? datetimeLocalToUnixSeconds(c.windowStart) : null;
      const end = c.windowEnd ? datetimeLocalToUnixSeconds(c.windowEnd) : null;
      if (!c.windowStart && !c.windowEnd) errors.push(`${label}: set a start, an end, or both.`);
      if (c.windowStart && start === null) errors.push(`${label}: start date/time is invalid.`);
      if (c.windowEnd && end === null) errors.push(`${label}: end date/time is invalid.`);
      if (start !== null && end !== null && start >= end) errors.push(`${label}: start must be before end.`);
    }
    if (c.kind === "allowList" || c.kind === "denyList") {
      if (c.recipients.length === 0) errors.push(`${label}: add at least one address, or remove this condition.`);
      else if (validAddresses(c.recipients).length !== c.recipients.length) {
        errors.push(`${label}: every address must be a valid 0x… address.`);
      }
    }
    if (c.kind === "oraclePrice") {
      if (!ORACLE_FEEDS.some((f) => f.key === c.oracleFeedKey)) errors.push(`${label}: pick a feed.`);
      if (parsePrice18Safe(c.oracleThreshold) === null) errors.push(`${label}: enter a valid price threshold greater than 0.`);
      const staleness = parseIntSafe(c.oracleMaxStalenessSeconds);
      if (staleness === null || staleness <= 0n) errors.push(`${label}: max staleness must be a whole number of seconds greater than 0.`);
    }
  }

  // Actions
  if (actions.length === 0) {
    errors.push("Add at least one action.");
  }
  for (const a of actions) {
    const label = ACTION_KIND_LABELS[a.kind];
    if (a.kind === ActionType.Forward) {
      if (!isAddress(a.forwardRecipient.trim())) errors.push(`${label}: recipient must be a valid 0x… address.`);
      const amount = parseUsdcSafe(a.forwardAmount);
      if (amount === null || amount <= 0n) errors.push(`${label}: amount must be greater than 0.`);
    }
    if (a.kind === ActionType.Split) {
      const total = parseUsdcSafe(a.splitTotal);
      if (total === null || total <= 0n) errors.push(`${label}: total amount must be greater than 0.`);
      if (a.splitRecipients.length === 0) errors.push(`${label}: add at least one recipient.`);
      let bpsSum = 0n;
      for (const r of a.splitRecipients) {
        if (!isAddress(r.address.trim())) errors.push(`${label}: every recipient must be a valid 0x… address.`);
        const bps = parseIntSafe(r.bps);
        if (bps === null) errors.push(`${label}: every share must be a whole number of basis points (0-10000).`);
        else bpsSum += bps;
      }
      if (bpsSum > 10_000n) errors.push(`${label}: basis points sum to ${bpsSum}, must be ≤ 10000 (100%).`);
    }
    if (a.kind === ActionType.Sweep) {
      if (!isAddress(a.sweepDestination.trim())) errors.push(`${label}: destination must be a valid 0x… address.`);
      if (a.sweepThreshold.trim() && parseUsdcSafe(a.sweepThreshold) === null) {
        errors.push(`${label}: threshold must be a valid USDC amount.`);
      }
    }
    if (a.kind === ActionType.LockRelease) {
      if (!isAddress(a.lockRecipient.trim())) errors.push(`${label}: recipient must be a valid 0x… address.`);
      const amount = parseUsdcSafe(a.lockAmount);
      if (amount === null || amount <= 0n) errors.push(`${label}: amount must be greater than 0.`);
      if (datetimeLocalToUnixSeconds(a.lockReleaseAt) === null) errors.push(`${label}: pick a release date/time.`);
    }
    if (a.kind === ActionType.Swap) {
      if (!isAddress(a.swapRecipient.trim())) errors.push(`${label}: recipient must be a valid 0x… address.`);
      const amountIn = parseUsdcSafe(a.swapAmountIn);
      if (amountIn === null || amountIn <= 0n) errors.push(`${label}: amount to swap must be greater than 0.`);
      const [tokenIn, tokenOut] = swapTokenAddresses(a.swapTokenIn);
      if (!tokenIn || !tokenOut) {
        errors.push(`${label}: USDC/EURC pool addresses aren't configured (VITE_USDC_ADDRESS / VITE_EURC_ADDRESS).`);
      }
      const minAmountOut = parseUsdcSafe(a.swapMinAmountOut);
      if (minAmountOut === null || minAmountOut <= 0n) {
        errors.push(`${label}: minimum received must be a valid amount greater than 0 — real slippage protection, not zero.`);
      }
    }
  }

  return errors;
}
