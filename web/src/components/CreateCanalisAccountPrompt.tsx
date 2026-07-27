import { useEffect } from "react";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { useCanalisAccount } from "../lib/useCanalisAccount";
import { canalisAccountFactoryAbi } from "../lib/abi";
import { CANALIS_ACCOUNT_FACTORY_ADDRESS } from "../lib/contracts";
import { getRevertReason } from "../lib/errors";

/**
 * Shared "you need a CanalisAccount first" prompt + real create action.
 * Used wherever a feature needs an account to exist first (Builder deploy,
 * Dashboard funding) so there's one honest, single implementation of
 * account creation rather than several copies.
 */
export function CreateCanalisAccountPrompt({ message }: { message: string }) {
  const { refetchAccount } = useCanalisAccount();

  const createAccount = useWriteContract();
  const createAccountReceipt = useWaitForTransactionReceipt({ hash: createAccount.data });

  useEffect(() => {
    if (createAccountReceipt.isSuccess) {
      refetchAccount();
    }
  }, [createAccountReceipt.isSuccess, refetchAccount]);

  const creating = createAccount.isPending || createAccountReceipt.isLoading;

  return (
    <>
      <p className="mb-4 text-sm text-ink-muted">{message}</p>
      <button
        onClick={() =>
          createAccount.writeContract({
            address: CANALIS_ACCOUNT_FACTORY_ADDRESS!,
            abi: canalisAccountFactoryAbi,
            functionName: "createAccount",
          })
        }
        disabled={creating}
        className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
      >
        {creating ? "Creating…" : "Create Canalis account"}
      </button>
      {createAccount.error && <p className="mt-2 text-xs text-red-400">{getRevertReason(createAccount.error)}</p>}
    </>
  );
}
