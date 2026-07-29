// Minimal ABI slice of CanalisExecutor — just what the keeper needs:
// enumerate one account's flows via flowsOf, dry-run each via previewFlow,
// and call executeFlow when it's due. Entirely eth_call-based — no
// getLogs, so it's immune to the tiny getLogs range caps free-tier RPCs
// impose (QuickNode as low as 5 blocks, Alchemy 10). Mirrors
// contracts/src/interfaces/ICanalisExecutor.sol exactly; keep in sync with
// it on every executor redeploy.

// `condition` tuple, mirroring FlowTypes.Condition field-for-field (see
// contracts/src/libraries/FlowTypes.sol / web/src/lib/flows.ts's identical
// mirror) — needed here only to read `priceId`/`maxStaleness` back out of
// `getFlow`, not to construct flows.
const conditionTupleComponents = [
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
] as const;

export const canalisExecutorAbi = [
  {
    type: "function",
    name: "flowsOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "previewFlow",
    stateMutability: "view",
    inputs: [{ name: "flowId", type: "uint256" }],
    outputs: [
      { name: "canRun", type: "bool" },
      { name: "reason", type: "string" },
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
    // Used to read back each flow's conditions and check for an oracle
    // price condition (`priceId`/`maxStaleness`) before deciding whether to
    // refresh the on-chain price (index.ts's `oraclePriceIdsNeeded`), and
    // to build the Telegram notification's flow summary (flowSummary.ts's
    // `describeFlow`, index.ts's `notifyFlowExecuted`).
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
          { name: "conditions", type: "tuple[]", components: conditionTupleComponents },
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
      },
    ],
  },
] as const;

/**
 * Minimal IPyth slice the keeper needs to keep a flow's oracle condition
 * fresh — see contracts/src/interfaces/IPyth.sol (the Solidity mirror) and
 * keeper/README.md "Oracle price updates". Read-only `getPriceUnsafe` to
 * check current staleness; `updatePriceFeeds`/`getUpdateFee` to push a
 * fresh signed price fetched from Hermes.
 */
export const pythAbi = [
  {
    type: "function",
    name: "getPriceUnsafe",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      {
        name: "price",
        type: "tuple",
        components: [
          { name: "price", type: "int64" },
          { name: "conf", type: "uint64" },
          { name: "expo", type: "int32" },
          { name: "publishTime", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "updatePriceFeeds",
    stateMutability: "payable",
    inputs: [{ name: "updateData", type: "bytes[]" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getUpdateFee",
    stateMutability: "view",
    inputs: [{ name: "updateData", type: "bytes[]" }],
    outputs: [{ name: "feeAmount", type: "uint256" }],
  },
] as const;
