import { flowAbiParameter } from "./flows";

/**
 * Hand-maintained ABI subsets — only the functions/events this frontend
 * slice actually calls, mirrored from the Solidity contracts in
 * contracts/src/. Keep in sync by hand for now; worth generating from the
 * compiled artifacts once the contract surface grows.
 */

export const canalisExecutorAbi = [
  {
    type: "function",
    name: "registerFlow",
    stateMutability: "nonpayable",
    inputs: [flowAbiParameter],
    outputs: [{ name: "flowId", type: "uint256" }],
  },
  {
    type: "function",
    name: "executeFlow",
    stateMutability: "nonpayable",
    inputs: [{ name: "flowId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getFlow",
    stateMutability: "view",
    inputs: [{ name: "flowId", type: "uint256" }],
    outputs: [flowAbiParameter],
  },
  {
    type: "function",
    name: "setFlowActive",
    stateMutability: "nonpayable",
    inputs: [
      { name: "flowId", type: "uint256" },
      { name: "active", type: "bool" },
    ],
    outputs: [],
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
    name: "flowsOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
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
  {
    type: "event",
    name: "ActionExecuted",
    inputs: [
      { name: "flowId", type: "uint256", indexed: true },
      { name: "actionIndex", type: "uint256", indexed: true },
      { name: "kind", type: "uint8", indexed: false },
      { name: "recipient", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FlowActiveSet",
    inputs: [
      { name: "flowId", type: "uint256", indexed: true },
      { name: "active", type: "bool", indexed: false },
    ],
  },
] as const;

export const canalisAccountAbi = [
  {
    type: "function",
    name: "balance",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/** Minimal ERC-20 subset needed to read/approve USDC from the connected wallet. */
export const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/** CanalisSwapPool — just what the composer needs for a live quote + reserve display. */
export const canalisSwapPoolAbi = [
  {
    type: "function",
    name: "quote",
    stateMutability: "view",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "amountIn", type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "reserveUsdc",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "reserveEurc",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const canalisAccountFactoryAbi = [
  {
    type: "function",
    name: "accountOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "createAccount",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "account", type: "address" }],
  },
  {
    type: "event",
    name: "AccountCreated",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "account", type: "address", indexed: true },
    ],
  },
] as const;
