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
} as const;
export type ActionType = (typeof ActionType)[keyof typeof ActionType];

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
}

export interface Action {
  kind: ActionType;
  recipients: Address[];
  amountsOrBps: bigint[];
  fixedAmount: bigint;
  sweepThreshold: bigint;
  unlockTime: bigint;
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
 * Encode a Flow into the calldata shape CanalisExecutor.registerFlow expects.
 * TODO: implement with viem's `encodeAbiParameters` once the executor ABI is
 * finalized (the struct currently matches FlowTypes.Flow directly, so this
 * may end up being a pass-through for `registerFlow`'s tuple argument).
 */
export function encodeFlow(_flow: Flow): Hex {
  throw new Error("TODO: encodeFlow not yet implemented");
}

/**
 * Decode a Flow previously read from CanalisExecutor.getFlow.
 * TODO: implement once the executor ABI is finalized.
 */
export function decodeFlow(_data: Hex): Flow {
  throw new Error("TODO: decodeFlow not yet implemented");
}
