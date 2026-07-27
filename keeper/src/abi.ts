// Minimal ABI slice of CanalisExecutor — just what the keeper needs:
// enumerate one account's flows via flowsOf, dry-run each via previewFlow,
// and call executeFlow when it's due. Entirely eth_call-based — no
// getLogs, so it's immune to the tiny getLogs range caps free-tier RPCs
// impose (QuickNode as low as 5 blocks, Alchemy 10). Mirrors
// contracts/src/interfaces/ICanalisExecutor.sol exactly; keep in sync with
// it on every executor redeploy.

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
] as const;
