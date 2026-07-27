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
