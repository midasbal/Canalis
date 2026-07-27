import { useAccount, useReadContract } from "wagmi";
import { canalisAccountFactoryAbi } from "./abi";
import { CANALIS_ACCOUNT_FACTORY_ADDRESS } from "./contracts";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Resolves the connected wallet's CanalisAccount address via
 * CanalisAccountFactory.accountOf. Shared by the Dashboard (balance) and
 * Builder (deploy/run) so both read the same live on-chain state instead
 * of duplicating the lookup.
 */
export function useCanalisAccount() {
  const { address: walletAddress } = useAccount();

  const {
    data: rawAccountAddress,
    isLoading,
    refetch: refetchAccount,
  } = useReadContract({
    address: CANALIS_ACCOUNT_FACTORY_ADDRESS,
    abi: canalisAccountFactoryAbi,
    functionName: "accountOf",
    args: walletAddress ? [walletAddress] : undefined,
    query: { enabled: Boolean(walletAddress && CANALIS_ACCOUNT_FACTORY_ADDRESS) },
  });

  const hasAccount = Boolean(rawAccountAddress && rawAccountAddress !== ZERO_ADDRESS);

  return {
    walletAddress,
    accountAddress: hasAccount ? rawAccountAddress : undefined,
    hasAccount,
    isLoading,
    refetchAccount,
  };
}
