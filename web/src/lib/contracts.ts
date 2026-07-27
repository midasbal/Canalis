import type { Address } from "viem";

/**
 * Deployed contract addresses, read from env (see web/.env.example).
 * Undefined until contracts.sol has actually been deployed and the
 * addresses copied into web/.env — components must handle that case
 * honestly rather than assuming a value.
 */
export const CANALIS_EXECUTOR_ADDRESS = (import.meta.env.VITE_CANALIS_EXECUTOR_ADDRESS || undefined) as
  | Address
  | undefined;

export const CANALIS_ACCOUNT_FACTORY_ADDRESS = (import.meta.env.VITE_CANALIS_ACCOUNT_FACTORY_ADDRESS || undefined) as
  | Address
  | undefined;
