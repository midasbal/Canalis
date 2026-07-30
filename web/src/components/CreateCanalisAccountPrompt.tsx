import { useEffect, useRef } from "react";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { useCanalisAccount } from "../lib/useCanalisAccount";
import { canalisAccountFactoryAbi } from "../lib/abi";
import { CANALIS_ACCOUNT_FACTORY_ADDRESS } from "../lib/contracts";
import { arcscanTxUrl } from "../lib/format";
import { getFriendlyErrorMessage } from "../lib/errors";
import { useToast } from "./ui/ToastProvider";

/**
 * Shared "you need a CanalisAccount first" prompt + real create action.
 * Used wherever a feature needs an account to exist first (Builder deploy,
 * Dashboard funding) so there's one honest, single implementation of
 * account creation rather than several copies.
 */
export function CreateCanalisAccountPrompt({ message }: { message: string }) {
  const { refetchAccount } = useCanalisAccount();
  const toast = useToast();
  const toastIdRef = useRef<string | null>(null);

  const createAccount = useWriteContract();
  const createAccountReceipt = useWaitForTransactionReceipt({ hash: createAccount.data });

  useEffect(() => {
    if (createAccountReceipt.isSuccess) {
      refetchAccount();
    }
  }, [createAccountReceipt.isSuccess, refetchAccount]);

  useEffect(() => {
    if (!toastIdRef.current) return;
    if (createAccountReceipt.isSuccess && createAccountReceipt.data) {
      toast.update(toastIdRef.current, {
        kind: "success",
        title: "Canalis account created",
        action: { label: "View on arcscan", href: arcscanTxUrl(createAccountReceipt.data.transactionHash) },
      });
      toastIdRef.current = null;
    } else if (createAccount.error) {
      toast.update(toastIdRef.current, { kind: "error", title: "Couldn't create account", detail: getFriendlyErrorMessage(createAccount.error) });
      toastIdRef.current = null;
    }
  }, [createAccountReceipt.isSuccess, createAccountReceipt.data, createAccount.error, toast]);

  const creating = createAccount.isPending || createAccountReceipt.isLoading;

  function handleCreate() {
    toastIdRef.current = toast.push({ kind: "pending", title: "Creating your Canalis account…" });
    createAccount.writeContract({
      address: CANALIS_ACCOUNT_FACTORY_ADDRESS!,
      abi: canalisAccountFactoryAbi,
      functionName: "createAccount",
    });
  }

  return (
    <>
      <p className="mb-4 text-sm text-ink-muted">{message}</p>
      <button
        onClick={handleCreate}
        disabled={creating}
        className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
      >
        {creating ? "Creating…" : "Create Canalis account"}
      </button>
    </>
  );
}
