import { BaseError, ContractFunctionRevertedError } from "viem";

/**
 * Extracts a clean, human-readable revert reason from a wagmi/viem write
 * error — e.g. "cooldown not elapsed" instead of a raw multi-line viem
 * error dump. CanalisExecutor uses plain `require(cond, "reason")` reverts
 * (no custom errors), so this mainly unwraps viem's decoded `Error(string)`
 * reason; falls back to viem's own shortMessage, then the raw message.
 */
export function getRevertReason(error: unknown): string {
  if (!error) return "Unknown error.";

  const decoded = decodedRevertReason(error);
  if (decoded) return decoded;

  if (error instanceof BaseError) {
    if (error.shortMessage?.toLowerCase().includes("user rejected")) {
      return "Rejected in wallet.";
    }
    return error.shortMessage ?? error.message ?? "Transaction failed.";
  }

  return error instanceof Error ? error.message : String(error);
}

/**
 * Translates any wallet/RPC/network/contract error into a short, plain
 * message safe to show a user directly — never the raw provider/RPC text.
 * Used by every toast error path (AccountFunding, CreateCanalisAccountPrompt,
 * FlowComposer, FlowRow); the real error always still goes to console.error
 * so it's not lost for debugging.
 */
export function getFriendlyErrorMessage(error: unknown): string {
  // eslint-disable-next-line no-console
  console.error(error);

  if (!error) return GENERIC_FALLBACK;

  const raw = rawErrorText(error).toLowerCase();

  if (isUserRejection(error, raw)) return "Rejected in wallet.";
  if (raw.includes("rate limit") || raw.includes("429")) return "Network busy, try again in a moment.";
  if (raw.includes("insufficient funds")) return "Not enough gas to send this transaction.";
  if (isNetworkError(raw)) return "Network error, please try again.";

  const decoded = decodedRevertReason(error);
  if (decoded) {
    const lower = decoded.toLowerCase();
    if (SWAP_LIQUIDITY_PATTERNS.some((pattern) => lower.includes(pattern))) {
      return "Swap failed: not enough liquidity for this amount right now.";
    }
    return decoded;
  }

  return GENERIC_FALLBACK;
}

const GENERIC_FALLBACK = "Something went wrong, please try again.";

const SWAP_LIQUIDITY_PATTERNS = [
  "insufficient output",
  "insufficient liquidity",
  "insufficient usdc reserve",
  "insufficient eurc reserve",
  "no liquidity",
];

/** A decoded `require(cond, "reason")` revert string, or null if this error isn't a recognizable contract revert. */
function decodedRevertReason(error: unknown): string | null {
  if (!(error instanceof BaseError)) return null;

  const revertError = error.walk((e) => e instanceof ContractFunctionRevertedError);
  if (revertError instanceof ContractFunctionRevertedError) {
    const reason = revertError.reason ?? revertError.data?.errorName;
    if (reason) return stripContractPrefix(reason);
  }

  // Fallback: viem's shortMessage for a plain require() revert usually
  // reads "... reverted with the following reason: X." — pull just X.
  const match = error.shortMessage?.match(/reverted with the following reason:\s*(.+?)\.?\s*$/i);
  if (match) return stripContractPrefix(match[1]);

  return null;
}

function isUserRejection(error: unknown, raw: string): boolean {
  if (findErrorCode(error) === 4001) return true;
  return raw.includes("user rejected") || raw.includes("denied");
}

function isNetworkError(raw: string): boolean {
  return (
    raw.includes("network") ||
    raw.includes("timeout") ||
    raw.includes("timed out") ||
    raw.includes("connection") ||
    raw.includes("failed to fetch")
  );
}

/** Walks the error's `cause` chain (viem wraps provider errors this way) looking for an EIP-1193 numeric error code. */
function findErrorCode(error: unknown): number | undefined {
  let current = error as { code?: unknown; cause?: unknown } | undefined;
  for (let depth = 0; current && depth < 10; depth += 1) {
    if (typeof current.code === "number") return current.code;
    current = current.cause as typeof current;
  }
  return undefined;
}

/** Every bit of message text an error carries, concatenated and lowercased by the caller for substring matching. Never shown to the user directly. */
function rawErrorText(error: unknown): string {
  const parts: string[] = [];
  if (error instanceof BaseError) {
    if (error.shortMessage) parts.push(error.shortMessage);
    if (error.details) parts.push(error.details);
  }
  if (error instanceof Error && error.message) parts.push(error.message);
  if (parts.length === 0) parts.push(String(error));
  return parts.join(" ");
}

/** "CanalisExecutor: cooldown not elapsed" -> "cooldown not elapsed" — the prefix is an implementation detail, not user-facing. */
function stripContractPrefix(reason: string): string {
  return reason.replace(/^[A-Za-z0-9]+:\s*/, "");
}
