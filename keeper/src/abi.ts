// Minimal ABI slice of CanalisExecutor — just what the keeper needs:
// enumerate flows via the FlowRegistered event, read them back, and call
// executeFlow. Mirrors contracts/src/libraries/FlowTypes.sol and
// contracts/src/interfaces/ICanalisExecutor.sol exactly; keep in sync with
// those on every executor redeploy.

const triggerTuple = {
  type: "tuple",
  components: [
    { name: "kind", type: "uint8" },
    { name: "scheduleAt", type: "uint256" },
    { name: "scheduleInterval", type: "uint256" },
    { name: "thresholdAmount", type: "uint256" },
    { name: "thresholdIsAbove", type: "bool" },
  ],
} as const;

const conditionTuple = {
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
  ],
} as const;

const actionTuple = {
  type: "tuple[]",
  components: [
    { name: "kind", type: "uint8" },
    { name: "recipients", type: "address[]" },
    { name: "amountsOrBps", type: "uint256[]" },
    { name: "fixedAmount", type: "uint256" },
    { name: "sweepThreshold", type: "uint256" },
    { name: "unlockTime", type: "uint256" },
  ],
} as const;

export const canalisExecutorAbi = [
  {
    type: "function",
    name: "getFlow",
    stateMutability: "view",
    inputs: [{ name: "flowId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "owner", type: "address" },
          { name: "trigger", ...triggerTuple },
          { name: "conditions", ...conditionTuple },
          { name: "actions", ...actionTuple },
          { name: "active", type: "bool" },
          { name: "lastExecutedAt", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "executeFlow",
    stateMutability: "nonpayable",
    inputs: [{ name: "flowId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "event",
    name: "FlowRegistered",
    inputs: [
      { name: "flowId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "FlowExecuted",
    inputs: [
      { name: "flowId", type: "uint256", indexed: true },
      { name: "triggeredBy", type: "address", indexed: true },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
] as const;

// TriggerType enum order — must match FlowTypes.sol exactly.
export const TriggerType = {
  OnReceive: 0,
  OnSchedule: 1,
  OnThreshold: 2,
  Manual: 3,
} as const;
