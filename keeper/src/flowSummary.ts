// Plain-English one-liner for a flow, used only for the Telegram
// notification text (see notify.ts / index.ts). Deliberately minimal — not
// a full flow description, just enough for a "your money moved" ping.
// Mirrors the enum ordering in contracts/src/libraries/FlowTypes.sol
// (TriggerType / ActionType) — keep in sync with that file, same as
// abi.ts already must be.

const TRIGGER_NAMES = ["OnReceive", "OnSchedule", "OnThreshold", "Manual"] as const;
const ACTION_NAMES = ["Split", "Forward", "Sweep", "LockRelease", "Swap", "Bridge"] as const;

// Arc testnet token addresses (see CLAUDE.md "Arc testnet facts") — used
// only to render a human-friendly symbol instead of a raw address.
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000".toLowerCase();
const EURC_ADDRESS = "0x89b50855aa3be2f677cd6303cec089b5f319d72a".toLowerCase();

function tokenSymbol(address: string): string {
  const lower = address.toLowerCase();
  if (lower === USDC_ADDRESS) return "USDC";
  if (lower === EURC_ADDRESS) return "EURC";
  return `${address.slice(0, 6)}…`;
}

/** Formats a 6-decimal USDC/EURC amount, trimming trailing zeros. */
function formatAmount6dp(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const frac = amount % 1_000_000n;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

interface FlowAction {
  kind: number;
  recipients: readonly string[];
  fixedAmount: bigint;
  sweepThreshold: bigint;
  tokenIn: string;
  tokenOut: string;
  destinationDomain: number;
}

interface FlowSummaryInput {
  trigger: { kind: number };
  actions: readonly FlowAction[];
}

/** One-line "trigger + first action" summary, e.g. "OnSchedule — Swap 3 USDC→EURC". */
export function describeFlow(flow: FlowSummaryInput): string {
  const triggerName = TRIGGER_NAMES[flow.trigger.kind] ?? `trigger#${flow.trigger.kind}`;
  const first = flow.actions[0];
  if (!first) return `${triggerName} trigger`;

  const actionName = ACTION_NAMES[first.kind] ?? `action#${first.kind}`;
  let detail: string;
  switch (first.kind) {
    case 0: // Split
      detail = `Split ${formatAmount6dp(first.fixedAmount)} USDC across ${first.recipients.length} recipient(s)`;
      break;
    case 1: // Forward
      detail = `Forward ${formatAmount6dp(first.fixedAmount)} USDC`;
      break;
    case 2: // Sweep
      detail = `Sweep balance above ${formatAmount6dp(first.sweepThreshold)} USDC`;
      break;
    case 3: // LockRelease
      detail = `Lock/release ${formatAmount6dp(first.fixedAmount)} USDC`;
      break;
    case 4: // Swap
      detail = `Swap ${formatAmount6dp(first.fixedAmount)} ${tokenSymbol(first.tokenIn)}→${tokenSymbol(first.tokenOut)}`;
      break;
    case 5: // Bridge
      detail = `Bridge ${formatAmount6dp(first.fixedAmount)} USDC (domain ${first.destinationDomain})`;
      break;
    default:
      detail = actionName;
  }
  return `${triggerName} — ${detail}`;
}
