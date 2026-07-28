import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

// Stage 4 completion script for the CCTP Bridge action (Arc-native feature
// slice, spec section 7.3 #3): proves the round trip by actually minting
// on Ethereum Sepolia the USDC a Canalis flow burned on Arc.
//
// CanalisExecutor's Bridge action only ever proves the BURN (see
// CanalisExecutor.sol's "ARC-NATIVE FEATURE: CCTP Bridge" docs) — the mint
// is a separate, asynchronous leg that needs Circle's off-chain
// attestation service to sign the burn message first. This script is that
// second leg, run standalone (not by the keeper's poll loop, which only
// ever pokes flows — a bridge completion isn't a flow to poke, it's a
// one-shot follow-up to a specific burn transaction):
//
//   1. Polls Circle's testnet CCTP V2 attestation API (Iris,
//      https://iris-api-sandbox.circle.com) for the burn transaction,
//      until it reports status "complete" (i.e. Circle has signed it).
//   2. Reads the recipient's Sepolia USDC balance before.
//   3. Calls MessageTransmitterV2.receiveMessage(message, attestation) on
//      Ethereum Sepolia — anyone may submit this (see CCTP_DESTINATION_CALLER
//      in CanalisExecutor.sol; this Bridge action always uses bytes32(0),
//      the permissionless "standard transfer" convention), so this script
//      genuinely mints funds to the recipient the ORIGINAL burn named, not
//      itself.
//   4. Reads the recipient's Sepolia USDC balance after and prints the diff.
//
// Usage:
//   cd keeper
//   node --env-file=.env scripts/complete-cctp-bridge.ts <arcBurnTxHash>
//
// Requires keeper/.env: SEPOLIA_RPC_URL, SEPOLIA_PRIVATE_KEY (a funded
// Sepolia wallet — needs a small amount of Sepolia ETH for gas; does NOT
// need to be the same wallet as the burn or the mint recipient, since
// destinationCaller is permissionless). See keeper/README.md "Completing a
// CCTP bridge".

const ARC_CCTP_DOMAIN = 26;
const IRIS_BASE_URL = "https://iris-api-sandbox.circle.com"; // testnet — NOT the production iris-api.circle.com
const SEPOLIA_MESSAGE_TRANSMITTER = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as const;
const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as const;

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 20 * 60_000; // Standard transfers wait for source-chain finality; can take several minutes.

const messageTransmitterAbi = [
  {
    type: "function",
    name: "receiveMessage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message", type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
] as const;

const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

interface IrisMessage {
  message: Hex;
  attestation: Hex;
  status: string;
  decodedMessage?: {
    decodedMessageBody?: {
      mintRecipient?: string;
      amount?: string;
    };
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`complete-cctp-bridge: missing required env var ${name} (see .env.example)`);
  }
  return value;
}

function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

async function fetchAttestation(burnTxHash: string): Promise<IrisMessage> {
  const url = `${IRIS_BASE_URL}/v2/messages/${ARC_CCTP_DOMAIN}?transactionHash=${burnTxHash}`;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const res = await fetch(url);
    if (res.ok) {
      const body = (await res.json()) as { messages: IrisMessage[] };
      const message = body.messages?.[0];
      if (message?.status === "complete" && message.attestation) {
        return message;
      }
      log(`attestation not ready yet (status=${message?.status ?? "unknown"}), polling again in ${POLL_INTERVAL_MS / 1000}s...`);
    } else if (res.status === 404) {
      log(`message not indexed by Iris yet (404), polling again in ${POLL_INTERVAL_MS / 1000}s...`);
    } else {
      throw new Error(`Iris request failed: ${res.status} ${res.statusText}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Timed out after ${POLL_TIMEOUT_MS / 60_000} minutes waiting for Circle's attestation`);
}

async function main() {
  const burnTxHash = process.argv[2];
  if (!burnTxHash) {
    throw new Error("Usage: node --env-file=.env scripts/complete-cctp-bridge.ts <arcBurnTxHash>");
  }

  const sepoliaRpcUrl = requireEnv("SEPOLIA_RPC_URL");
  const sepoliaPrivateKey = requireEnv("SEPOLIA_PRIVATE_KEY") as Hex;
  const account = privateKeyToAccount(sepoliaPrivateKey);

  const publicClient = createPublicClient({ chain: sepolia, transport: http(sepoliaRpcUrl) });
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(sepoliaRpcUrl) });

  log(`fetching Circle's attestation for Arc burn tx ${burnTxHash} (source domain ${ARC_CCTP_DOMAIN})...`);
  const attested = await fetchAttestation(burnTxHash);
  log(`attestation ready (status=complete). message length=${attested.message.length}, attestation length=${attested.attestation.length}`);

  const recipient = (attested.decodedMessage?.decodedMessageBody?.mintRecipient ?? account.address) as `0x${string}`;
  const amount = attested.decodedMessage?.decodedMessageBody?.amount;
  log(`mint recipient (from Circle's decoded message): ${recipient}${amount ? `, amount: ${amount} (6dp USDC)` : ""}`);

  const balanceBefore = await publicClient.readContract({
    address: SEPOLIA_USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [recipient],
  });
  log(`Sepolia USDC balance before: ${balanceBefore}`);

  log("submitting receiveMessage on Ethereum Sepolia...");
  const hash = await walletClient.writeContract({
    address: SEPOLIA_MESSAGE_TRANSMITTER,
    abi: messageTransmitterAbi,
    functionName: "receiveMessage",
    args: [attested.message, attested.attestation],
  });
  log(`receiveMessage sent: https://sepolia.etherscan.io/tx/${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  log(`receiveMessage ${receipt.status === "success" ? "SUCCEEDED" : "FAILED"}: https://sepolia.etherscan.io/tx/${hash}`);

  const balanceAfter = await publicClient.readContract({
    address: SEPOLIA_USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [recipient],
  });
  log(`Sepolia USDC balance after: ${balanceAfter} (delta: ${balanceAfter - balanceBefore})`);

  if (receipt.status !== "success") {
    throw new Error("receiveMessage transaction reverted");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
