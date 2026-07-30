import { useEffect, useRef, useState } from "react";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { formatUnits, parseUnits } from "viem";
import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { CreateCanalisAccountPrompt } from "./CreateCanalisAccountPrompt";
import { useCanalisAccount } from "../lib/useCanalisAccount";
import { canalisAccountAbi, erc20Abi } from "../lib/abi";
import { CANALIS_ACCOUNT_FACTORY_ADDRESS, CANALIS_USDC_ADDRESS } from "../lib/contracts";
import { arcscanAddressUrl, arcscanTxUrl } from "../lib/format";
import { getFriendlyErrorMessage } from "../lib/errors";
import { useToast } from "./ui/ToastProvider";

/** Arc testnet USDC's ERC-20 decimals — do not confuse with the 18-decimal native gas token. */
const USDC_DECIMALS = 6;
const CONTRACTS_CONFIGURED = Boolean(CANALIS_ACCOUNT_FACTORY_ADDRESS && CANALIS_USDC_ADDRESS);

/**
 * Funds the connected wallet's CanalisAccount: shows both balances (wallet
 * USDC and the account's USDC), a real two-step approve-then-deposit flow,
 * and a minimal withdraw-back-to-wallet action. Nothing here is faked —
 * every balance is a live on-chain read, and the Deposit button only
 * unlocks once the on-chain allowance genuinely covers the amount (not
 * just because an approve transaction was sent).
 */
export function AccountFunding() {
  const { isConnected, address: walletAddress } = useAccount();
  const { accountAddress, hasAccount, isLoading: accountLoading } = useCanalisAccount();
  const toast = useToast();

  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  // Toast messages read the submitted amount after the input's own state is
  // cleared on success (see the deposit/withdraw success effects below), so
  // each amount is captured here at submit time, not read live from state.
  const depositAmountRef = useRef("");
  const withdrawAmountRef = useRef("");
  const approveToastRef = useRef<string | null>(null);
  const depositToastRef = useRef<string | null>(null);
  const withdrawToastRef = useRef<string | null>(null);

  const walletBalance = useReadContract({
    address: CANALIS_USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: walletAddress ? [walletAddress] : undefined,
    query: { enabled: Boolean(walletAddress && CANALIS_USDC_ADDRESS) },
  });
  const refetchWalletBalance = walletBalance.refetch;

  const accountBalance = useReadContract({
    address: accountAddress,
    abi: canalisAccountAbi,
    functionName: "balance",
    query: { enabled: Boolean(accountAddress) },
  });
  const refetchAccountBalance = accountBalance.refetch;

  const allowance = useReadContract({
    address: CANALIS_USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: walletAddress && accountAddress ? [walletAddress, accountAddress] : undefined,
    query: { enabled: Boolean(walletAddress && accountAddress && CANALIS_USDC_ADDRESS) },
  });
  const refetchAllowance = allowance.refetch;

  const approveTx = useWriteContract();
  const approveReceipt = useWaitForTransactionReceipt({ hash: approveTx.data });

  const depositTx = useWriteContract();
  const depositReceipt = useWaitForTransactionReceipt({ hash: depositTx.data });

  const withdrawTx = useWriteContract();
  const withdrawReceipt = useWaitForTransactionReceipt({ hash: withdrawTx.data });

  useEffect(() => {
    if (approveReceipt.isSuccess) {
      refetchAllowance();
    }
  }, [approveReceipt.isSuccess, refetchAllowance]);

  useEffect(() => {
    if (depositReceipt.isSuccess) {
      refetchAccountBalance();
      refetchWalletBalance();
      refetchAllowance();
      setDepositAmount("");
    }
  }, [depositReceipt.isSuccess, refetchAccountBalance, refetchWalletBalance, refetchAllowance]);

  useEffect(() => {
    if (withdrawReceipt.isSuccess) {
      refetchAccountBalance();
      refetchWalletBalance();
      setWithdrawAmount("");
    }
  }, [withdrawReceipt.isSuccess, refetchAccountBalance, refetchWalletBalance]);

  useEffect(() => {
    if (!approveToastRef.current) return;
    if (approveReceipt.isSuccess) {
      toast.update(approveToastRef.current, { kind: "success", title: "USDC approved", detail: "You can deposit now." });
      approveToastRef.current = null;
    } else if (approveTx.error) {
      toast.update(approveToastRef.current, { kind: "error", title: "Approval failed", detail: getFriendlyErrorMessage(approveTx.error) });
      approveToastRef.current = null;
    }
  }, [approveReceipt.isSuccess, approveTx.error, toast]);

  useEffect(() => {
    if (!depositToastRef.current) return;
    if (depositReceipt.isSuccess && depositReceipt.data) {
      toast.update(depositToastRef.current, {
        kind: "success",
        title: <>Deposited <span className="font-mono">{depositAmountRef.current}</span> USDC</>,
        detail: "Balances refreshed.",
        action: { label: "View on arcscan", href: arcscanTxUrl(depositReceipt.data.transactionHash) },
      });
      depositToastRef.current = null;
    } else if (depositTx.error) {
      toast.update(depositToastRef.current, { kind: "error", title: "Deposit failed", detail: getFriendlyErrorMessage(depositTx.error) });
      depositToastRef.current = null;
    }
  }, [depositReceipt.isSuccess, depositReceipt.data, depositTx.error, toast]);

  useEffect(() => {
    if (!withdrawToastRef.current) return;
    if (withdrawReceipt.isSuccess && withdrawReceipt.data) {
      toast.update(withdrawToastRef.current, {
        kind: "success",
        title: <>Withdrew <span className="font-mono">{withdrawAmountRef.current}</span> USDC</>,
        detail: "Balances refreshed.",
        action: { label: "View on arcscan", href: arcscanTxUrl(withdrawReceipt.data.transactionHash) },
      });
      withdrawToastRef.current = null;
    } else if (withdrawTx.error) {
      toast.update(withdrawToastRef.current, { kind: "error", title: "Withdrawal failed", detail: getFriendlyErrorMessage(withdrawTx.error) });
      withdrawToastRef.current = null;
    }
  }, [withdrawReceipt.isSuccess, withdrawReceipt.data, withdrawTx.error, toast]);

  if (!CONTRACTS_CONFIGURED) {
    return (
      <Card eyebrow="Account funding" title="Deposit & withdraw USDC" variant="flat" action={<Badge tone="warning">Not configured</Badge>}>
        <p className="text-sm text-ink-muted">
          Set <code className="font-mono text-ink">VITE_CANALIS_ACCOUNT_FACTORY_ADDRESS</code> and{" "}
          <code className="font-mono text-ink">VITE_USDC_ADDRESS</code> in <code>web/.env</code>.
        </p>
      </Card>
    );
  }

  if (!isConnected) {
    return (
      <Card eyebrow="Account funding" title="Deposit & withdraw USDC" variant="flat">
        <p className="text-sm text-ink-muted">Connect a wallet to fund your account.</p>
      </Card>
    );
  }

  if (accountLoading) {
    return (
      <Card eyebrow="Account funding" title="Deposit & withdraw USDC" variant="flat">
        <p className="text-sm text-ink-muted">Checking for your Canalis account…</p>
      </Card>
    );
  }

  if (!hasAccount) {
    return (
      <Card eyebrow="Account funding" title="Deposit & withdraw USDC" variant="flat">
        <CreateCanalisAccountPrompt message="You need a CanalisAccount before you can deposit funds." />
      </Card>
    );
  }

  let parsedDeposit = 0n;
  try {
    if (depositAmount) parsedDeposit = parseUnits(depositAmount, USDC_DECIMALS);
  } catch {
    parsedDeposit = 0n;
  }

  let parsedWithdraw = 0n;
  try {
    if (withdrawAmount) parsedWithdraw = parseUnits(withdrawAmount, USDC_DECIMALS);
  } catch {
    parsedWithdraw = 0n;
  }

  const exceedsWalletBalance = walletBalance.data !== undefined && parsedDeposit > walletBalance.data;
  const approvedEnough = allowance.data !== undefined && parsedDeposit > 0n && allowance.data >= parsedDeposit;

  const approving = approveTx.isPending || approveReceipt.isLoading;
  const depositing = depositTx.isPending || depositReceipt.isLoading;
  const withdrawing = withdrawTx.isPending || withdrawReceipt.isLoading;

  const canApprove = parsedDeposit > 0n && !exceedsWalletBalance && !approvedEnough && !approving;
  const canDeposit = parsedDeposit > 0n && !exceedsWalletBalance && approvedEnough && !depositing;

  function handleApprove() {
    if (!accountAddress || parsedDeposit <= 0n) return;
    approveToastRef.current = toast.push({ kind: "pending", title: "Approving USDC…" });
    approveTx.writeContract({
      address: CANALIS_USDC_ADDRESS!,
      abi: erc20Abi,
      functionName: "approve",
      args: [accountAddress, parsedDeposit],
    });
  }

  function handleDeposit() {
    if (!accountAddress || parsedDeposit <= 0n) return;
    depositAmountRef.current = depositAmount;
    depositToastRef.current = toast.push({ kind: "pending", title: `Depositing ${depositAmount} USDC…` });
    depositTx.writeContract({
      address: accountAddress,
      abi: canalisAccountAbi,
      functionName: "deposit",
      args: [parsedDeposit],
    });
  }

  function handleWithdraw() {
    if (!accountAddress || !walletAddress || parsedWithdraw <= 0n) return;
    withdrawAmountRef.current = withdrawAmount;
    withdrawToastRef.current = toast.push({ kind: "pending", title: `Withdrawing ${withdrawAmount} USDC…` });
    withdrawTx.writeContract({
      address: accountAddress,
      abi: canalisAccountAbi,
      functionName: "withdraw",
      args: [walletAddress, parsedWithdraw],
    });
  }

  return (
    <Card eyebrow="Account funding" title="Deposit & withdraw USDC" variant="flat">
      <p className="mb-1 text-xs text-ink-faint">CanalisAccount</p>
      <a
        href={arcscanAddressUrl(accountAddress!)}
        target="_blank"
        rel="noreferrer"
        className="mb-4 block break-all font-mono text-xs text-ink-muted underline underline-offset-2"
      >
        {accountAddress}
      </a>

      <div className="mb-5 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-ink-faint">Account balance</p>
          <p className="text-lg font-semibold text-ink">
            {accountBalance.data !== undefined ? formatUnits(accountBalance.data, USDC_DECIMALS) : "…"}{" "}
            <span className="text-xs font-normal text-ink-muted">USDC</span>
          </p>
        </div>
        <div>
          <p className="text-xs text-ink-faint">Wallet balance</p>
          <p className="text-lg font-semibold text-ink">
            {walletBalance.data !== undefined ? formatUnits(walletBalance.data, USDC_DECIMALS) : "…"}{" "}
            <span className="text-xs font-normal text-ink-muted">USDC</span>
          </p>
        </div>
      </div>

      <div className="border-t border-border-soft pt-4">
        <p className="mb-3 text-sm font-medium text-ink">Deposit</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-ink-muted">Amount (USDC)</span>
            <input
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>
          <button
            onClick={handleApprove}
            disabled={!canApprove}
            className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-ink transition-colors duration-200 hover:border-ink-faint disabled:cursor-not-allowed disabled:opacity-50"
          >
            {approving ? "Approving…" : "1. Approve"}
          </button>
          <button
            onClick={handleDeposit}
            disabled={!canDeposit}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            {depositing ? "Depositing…" : "2. Deposit"}
          </button>
        </div>

        {exceedsWalletBalance && <p className="mt-2 text-xs text-red-400">Amount exceeds your wallet balance.</p>}
      </div>

      <div className="mt-5 border-t border-border-soft pt-4">
        <p className="mb-3 text-sm font-medium text-ink">Withdraw (to your wallet)</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-ink-muted">Amount (USDC)</span>
            <input
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>
          <button
            onClick={handleWithdraw}
            disabled={parsedWithdraw <= 0n || withdrawing}
            className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-ink transition-colors duration-200 hover:border-ink-faint disabled:cursor-not-allowed disabled:opacity-50"
          >
            {withdrawing ? "Withdrawing…" : "Withdraw"}
          </button>
        </div>
      </div>
    </Card>
  );
}
