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

/** Arc testnet USDC ERC-20 interface (system contract), 6 decimals. */
export const CANALIS_USDC_ADDRESS = (import.meta.env.VITE_USDC_ADDRESS || undefined) as Address | undefined;

/** Arc testnet EURC ERC-20 interface, 6 decimals — the Swap action's other token. */
export const CANALIS_EURC_ADDRESS = (import.meta.env.VITE_EURC_ADDRESS || undefined) as Address | undefined;

/** CanalisSwapPool — the self-built USDC/EURC constant-product AMM every Swap action routes through. */
export const CANALIS_SWAP_POOL_ADDRESS = (import.meta.env.VITE_CANALIS_SWAP_POOL_ADDRESS || undefined) as
  | Address
  | undefined;

/** Pyth's real IPyth contract on Arc testnet — every oracle price condition reads from here. */
export const CANALIS_ORACLE_ADDRESS = (import.meta.env.VITE_ORACLE_ADDRESS || undefined) as Address | undefined;

/**
 * Block CanalisExecutor was deployed at. Only used as a lower bound on the
 * run log's recent-history window (see CANALIS_RUNLOG_LOOKBACK_BLOCKS below)
 * — never as the scan's start on its own, since deployBlock→head can be
 * millions of blocks. Undefined is handled honestly (no lower bound beyond
 * the lookback window) rather than assumed.
 */
export const CANALIS_EXECUTOR_DEPLOY_BLOCK = import.meta.env.VITE_CANALIS_EXECUTOR_DEPLOY_BLOCK
  ? BigInt(import.meta.env.VITE_CANALIS_EXECUTOR_DEPLOY_BLOCK)
  : undefined;

/**
 * `eth_getLogs` chunk size for the run log's historical scan and live
 * catch-up polling. Free-tier RPCs cap this hard — QuickNode as low as 5
 * blocks, Alchemy 10 — so default conservatively; override with a higher
 * value only if your provider's plan actually supports it.
 */
export const CANALIS_GETLOGS_CHUNK_BLOCKS = import.meta.env.VITE_GETLOGS_CHUNK
  ? BigInt(import.meta.env.VITE_GETLOGS_CHUNK)
  : 10n;

/**
 * How many recent blocks the run log backfills on load. Deliberately NOT
 * deployBlock→head (could be millions of blocks at ~10/request) — old runs
 * beyond this window simply aren't backfilled; live polling picks up
 * everything from here forward.
 */
export const CANALIS_RUNLOG_LOOKBACK_BLOCKS = import.meta.env.VITE_RUNLOG_LOOKBACK_BLOCKS
  ? BigInt(import.meta.env.VITE_RUNLOG_LOOKBACK_BLOCKS)
  : 500n;
