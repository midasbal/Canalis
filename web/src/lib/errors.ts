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

  if (error instanceof BaseError) {
    const revertError = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revertError instanceof ContractFunctionRevertedError) {
      const reason = revertError.reason ?? revertError.data?.errorName;
      if (reason) return stripContractPrefix(reason);
    }

    if (error.shortMessage?.toLowerCase().includes("user rejected")) {
      return "Rejected in wallet.";
    }

    // Fallback: viem's shortMessage for a plain require() revert usually
    // reads "... reverted with the following reason: X." — pull just X.
    const match = error.shortMessage?.match(/reverted with the following reason:\s*(.+?)\.?\s*$/i);
    if (match) return stripContractPrefix(match[1]);

    return error.shortMessage ?? error.message ?? "Transaction failed.";
  }

  return error instanceof Error ? error.message : String(error);
}

/** "CanalisExecutor: cooldown not elapsed" -> "cooldown not elapsed" — the prefix is an implementation detail, not user-facing. */
function stripContractPrefix(reason: string): string {
  return reason.replace(/^[A-Za-z0-9]+:\s*/, "");
}
