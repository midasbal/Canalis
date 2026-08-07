import type { Address, Hex } from "viem";

/**
 * TS mirror of contracts/src/libraries/FlowTypes.sol. Keep these in sync by
 * hand for the MVP — see docs/canalis-spec.md section 6 for the full block
 * catalogue (only a subset is implemented here).
 */

// Plain const objects instead of `enum` — TS's `erasableSyntaxOnly` (used so
// this project can run directly via `tsc --erasableSyntaxOnly`/Node type
// stripping) disallows enums since they emit runtime code.
export const TriggerType = {
  OnReceive: 0,
  OnSchedule: 1,
  OnThreshold: 2,
  Manual: 3,
} as const;
export type TriggerType = (typeof TriggerType)[keyof typeof TriggerType];

export const ActionType = {
  Split: 0,
  Forward: 1,
  Sweep: 2,
  LockRelease: 3,
  Swap: 4,
  Bridge: 5,
} as const;
export type ActionType = (typeof ActionType)[keyof typeof ActionType];

/**
 * Mirrors Solidity's `type(uint256).max`, the sentinel CanalisExecutor's
 * `_advanceTrigger` sets a one-shot OnSchedule flow's `scheduleAt` to once
 * it has run — "never due again", not a literal far-future timestamp.
 * UI code MUST check for this before formatting `scheduleAt` as a date.
 */
export const SCHEDULE_NEVER_AGAIN = 2n ** 256n - 1n;

export interface Trigger {
  kind: TriggerType;
  scheduleAt: bigint;
  scheduleInterval: bigint;
  thresholdAmount: bigint;
  thresholdIsAbove: boolean;
}

export interface Condition {
  minAmount: bigint;
  maxAmount: bigint;
  cooldownSeconds: bigint;
  windowStart: bigint;
  windowEnd: bigint;
  minBalance: bigint;
  allowedRecipients: Address[];
  deniedRecipients: Address[];
  /** Pyth price feed id; `PRICE_ID_UNSET` = no oracle constraint. */
  priceId: Hex;
  /** 18-decimal fixed-point USD price threshold (e.g. 1.08 => 1_080000000000000000n). Only meaningful when priceId is set. */
  priceThreshold: bigint;
  /** true = price must be >= priceThreshold, false = price must be <= priceThreshold. */
  priceAbove: boolean;
  /** seconds; the oracle's stored price must be no older than this. */
  maxStaleness: bigint;
}

/** Mirrors Solidity's `bytes32(0)` sentinel for `Condition.priceId` — unset, no oracle constraint. */
export const PRICE_ID_UNSET: Hex = `0x${"0".repeat(64)}`;

export interface Action {
  kind: ActionType;
  recipients: Address[];
  amountsOrBps: bigint[];
  fixedAmount: bigint; // Swap: amountIn; Bridge: burn amount
  sweepThreshold: bigint;
  unlockTime: bigint;
  tokenIn: Address; // Swap: token sold from the account (the pool's USDC or EURC)
  tokenOut: Address; // Swap: token bought and delivered to recipients[0]
  minAmountOut: bigint; // Swap: slippage floor
  /** Bridge (CCTP V2): destination CCTP domain id, e.g. 0 = Ethereum Sepolia. */
  destinationDomain: number;
  /** Bridge: recipient on the destination chain, as bytes32 (an EVM address left-padded with zeros) — see `addressToBytes32`. */
  mintRecipient: Hex;
}

/** Mirrors Solidity's `bytes32(0)` sentinel for `Action.mintRecipient` — unset. */
export const MINT_RECIPIENT_UNSET: Hex = `0x${"0".repeat(64)}`;

/** Left-pads an EVM address into the bytes32 CCTP expects for `mintRecipient`. */
export function addressToBytes32(address: Address): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

/** Recovers the low-160-bit EVM address from a bytes32 CCTP mint recipient (or any zero-padded address-shaped bytes32). */
export function bytes32ToAddress(value: Hex): Address {
  return `0x${value.slice(-40)}`;
}

export interface Flow {
  owner: Address;
  trigger: Trigger;
  conditions: Condition[];
  actions: Action[];
  active: boolean;
  lastExecutedAt: bigint;
}

/**
 * viem ABI parameter descriptor mirroring `FlowTypes.Flow` field-for-field
 * (names/order/types must match the Solidity struct exactly). Exported so
 * lib/abi.ts's `registerFlow`/`getFlow` ABI entries share this single
 * definition instead of duplicating the nested tuple.
 */
export const flowAbiParameter = {
  name: "flow",
  type: "tuple",
  components: [
    { name: "owner", type: "address" },
    {
      name: "trigger",
      type: "tuple",
      components: [
        { name: "kind", type: "uint8" },
        { name: "scheduleAt", type: "uint256" },
        { name: "scheduleInterval", type: "uint256" },
        { name: "thresholdAmount", type: "uint256" },
        { name: "thresholdIsAbove", type: "bool" },
      ],
    },
    {
      name: "conditions",
      type: "tuple[]",
      components: [
        { name: "minAmount", type: "uint256" },
        { name: "maxAmount", type: "uint256" },
        { name: "cooldownSeconds", type: "uint256" },
        { name: "windowStart", type: "uint256" },
        { name: "windowEnd", type: "uint256" },
        { name: "minBalance", type: "uint256" },
        { name: "allowedRecipients", type: "address[]" },
        { name: "deniedRecipients", type: "address[]" },
        { name: "priceId", type: "bytes32" },
        { name: "priceThreshold", type: "uint256" },
        { name: "priceAbove", type: "bool" },
        { name: "maxStaleness", type: "uint256" },
      ],
    },
    {
      name: "actions",
      type: "tuple[]",
      components: [
        { name: "kind", type: "uint8" },
        { name: "recipients", type: "address[]" },
        { name: "amountsOrBps", type: "uint256[]" },
        { name: "fixedAmount", type: "uint256" },
        { name: "sweepThreshold", type: "uint256" },
        { name: "unlockTime", type: "uint256" },
        { name: "tokenIn", type: "address" },
        { name: "tokenOut", type: "address" },
        { name: "minAmountOut", type: "uint256" },
        { name: "destinationDomain", type: "uint32" },
        { name: "mintRecipient", type: "bytes32" },
      ],
    },
    { name: "active", type: "bool" },
    { name: "lastExecutedAt", type: "uint256" },
  ],
} as const;
