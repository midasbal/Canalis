#!/usr/bin/env bash
# End-to-end, on-chain proof of the CCTP Bridge action (Arc-native feature
# slice, spec section 7.3 #3) on Arc testnet against the REAL Circle CCTP
# V2 TokenMessengerV2 — no mock, no guessed address:
#
#   1. Deposits USDC into a CanalisAccount.
#   2. Registers a Manual + Bridge flow (burn 1 USDC, destinationDomain=0
#      i.e. Ethereum Sepolia, mintRecipient = the deployer's own address).
#   3. Executes it and asserts the account was debited by exactly the burn
#      amount.
#   4. Reads the real `DepositForBurn` event back from the tx receipt and
#      prints its fields.
#   5. Reads the real `MessageSent` event (emitted by the local
#      MessageTransmitterV2 as part of the same call) and extracts the raw
#      message bytes (MessageV2 header decoded field-by-field for display).
#      NOTE: CCTP V2's on-chain message leaves `nonce` as bytes32(0) at
#      emission time (confirmed against Circle's own source,
#      MessageTransmitterV2.sol#sendMessage -> MessageV2._formatMessageForRelay)
#      — V2 assigns the real nonce off-chain, in Circle's attestation
#      response, unlike V1 which assigned it synchronously on-chain. So the
#      completion script (Stage 4) looks the message up by burn
#      TRANSACTION HASH against Circle's iris API, not by nonce.
#
# This proves the BURN only — the mint on Ethereum Sepolia is a SEPARATE,
# asynchronous transaction (Circle's attestation service must sign the
# message first). See keeper/scripts/complete-cctp-bridge.ts.
#
# Uses `cast send`/`cast call` directly against the real Arc RPC node, not
# `forge script` — see CLAUDE.md's precompile gotcha.
#
# Requires contracts/.env with RPC_URL and PRIVATE_KEY (the flow owner /
# deployer, who must also be the CanalisAccount owner used below).
#
# Usage: ./script/prove-cctp-bridge.sh <EXECUTOR> <ACCOUNT>

set -euo pipefail
cd "$(dirname "$0")/.."
set -a
source .env
set +a

EXECUTOR="$1"
ACCOUNT="$2"
USDC=0x3600000000000000000000000000000000000000
TOKEN_MESSENGER=0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA
MESSAGE_TRANSMITTER=0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275
SEPOLIA_DOMAIN=0
DEPOSIT_AMOUNT=2000000   # 2.000000 USDC (6dp)
BRIDGE_AMOUNT=1000000    # 1.000000 USDC (6dp)
EXPLORER=https://testnet.arcscan.app/tx

DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
MINT_RECIPIENT_BYTES32=$(python3 -c "print('0x' + '$DEPLOYER'[2:].lower().rjust(64, '0'))")

echo "Deployer (flow owner + mint recipient): $DEPLOYER"
echo "CanalisExecutor:       $EXECUTOR"
echo "CanalisAccount:        $ACCOUNT"
echo "CCTP TokenMessengerV2: $TOKEN_MESSENGER"
echo "mintRecipient (bytes32): $MINT_RECIPIENT_BYTES32"
echo

echo "--- approve + deposit USDC into CanalisAccount ---"
cast send "$USDC" "approve(address,uint256)" "$ACCOUNT" "$DEPOSIT_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" > /dev/null
TX_DEPOSIT=$(cast send "$ACCOUNT" "deposit(uint256)" "$DEPOSIT_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "deposit: $EXPLORER/$TX_DEPOSIT"

ACCOUNT_BALANCE_BEFORE=$(cast call "$ACCOUNT" "balance()(uint256)" --rpc-url "$RPC_URL" | awk '{print $1}')
echo "CanalisAccount balance before: $ACCOUNT_BALANCE_BEFORE"
echo

echo "=== registerFlow (Manual trigger, Bridge action: burn $BRIDGE_AMOUNT USDC -> Sepolia domain $SEPOLIA_DOMAIN) ==="
TX_REG=$(cast send "$EXECUTOR" \
  "registerFlow((address,(uint8,uint256,uint256,uint256,bool),(uint256,uint256,uint256,uint256,uint256,uint256,address[],address[],bytes32,uint256,bool,uint256)[],(uint8,address[],uint256[],uint256,uint256,uint256,address,address,uint256,uint32,bytes32)[],bool,uint256))" \
  "($ACCOUNT,(3,0,0,0,false),[],[(5,[],[],$BRIDGE_AMOUNT,0,0,0x0000000000000000000000000000000000000000,0x0000000000000000000000000000000000000000,0,$SEPOLIA_DOMAIN,$MINT_RECIPIENT_BYTES32)],true,0)" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "registerFlow: $EXPLORER/$TX_REG"

FLOW_ID=$(cast receipt "$TX_REG" --rpc-url "$RPC_URL" --json | python3 -c "
import json, sys
r = json.load(sys.stdin)
executor = '$EXECUTOR'.lower()
for log in r['logs']:
    if log['address'].lower() == executor and len(log['topics']) >= 2:
        print(int(log['topics'][1], 16))
        break
")
echo "Registered flowId: $FLOW_ID"
echo

echo "=== previewFlow (must be a pure dry-run, no funds move) ==="
cast call "$EXECUTOR" "previewFlow(uint256)(bool,string)" "$FLOW_ID" --from "$DEPLOYER" --rpc-url "$RPC_URL"
echo

echo "=== executeFlow: burn $BRIDGE_AMOUNT USDC via TokenMessengerV2.depositForBurn ==="
TX_EXEC=$(cast send "$EXECUTOR" "executeFlow(uint256)" "$FLOW_ID" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "executeFlow: $EXPLORER/$TX_EXEC"
echo

ACCOUNT_BALANCE_AFTER=$(cast call "$ACCOUNT" "balance()(uint256)" --rpc-url "$RPC_URL" | awk '{print $1}')
echo "CanalisAccount balance after: $ACCOUNT_BALANCE_AFTER (expected $((ACCOUNT_BALANCE_BEFORE - BRIDGE_AMOUNT)))"

BALANCE_RESULT="FAIL"
if [ "$ACCOUNT_BALANCE_AFTER" -eq "$((ACCOUNT_BALANCE_BEFORE - BRIDGE_AMOUNT))" ]; then
  BALANCE_RESULT="PASS"
fi
echo "Account debited by exactly the burn amount: $BALANCE_RESULT"
echo

echo "=== extracting DepositForBurn + MessageSent from the executeFlow receipt ==="
python3 <<PYEOF
import json, subprocess

receipt = json.loads(subprocess.check_output([
    "cast", "receipt", "$TX_EXEC", "--rpc-url", "$RPC_URL", "--json"
]))

DEPOSIT_FOR_BURN_TOPIC0 = "0x0c8c1cbdc5190613ebd485511d4e2812cfa45eecb79d845893331fedad5130a5"
MESSAGE_SENT_TOPIC0 = "0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036"
TOKEN_MESSENGER = "$TOKEN_MESSENGER".lower()
MESSAGE_TRANSMITTER = "$MESSAGE_TRANSMITTER".lower()

deposit_log = None
message_log = None
for log in receipt["logs"]:
    topics = log.get("topics", [])
    if not topics:
        continue
    if topics[0].lower() == DEPOSIT_FOR_BURN_TOPIC0 and log["address"].lower() == TOKEN_MESSENGER:
        deposit_log = log
    if topics[0].lower() == MESSAGE_SENT_TOPIC0 and log["address"].lower() == MESSAGE_TRANSMITTER:
        message_log = log

assert deposit_log is not None, "DepositForBurn event not found in receipt"
assert message_log is not None, "MessageSent event not found in receipt"

print("DepositForBurn found: PASS")
print("  burnToken (indexed):", "0x" + deposit_log["topics"][1][-40:])
print("  depositor (indexed):", "0x" + deposit_log["topics"][2][-40:])
print("  minFinalityThreshold (indexed):", int(deposit_log["topics"][3], 16))

# MessageSent(bytes message) — non-indexed dynamic bytes: ABI-encoded as
# [offset(32)][length(32)][data...]. Strip the 0x, then skip the first two
# 32-byte (64 hex-char) words to get straight to the message bytes.
data_hex = message_log["data"][2:]
length = int(data_hex[64:128], 16)
message_hex = data_hex[128:128 + length * 2]
message_bytes = bytes.fromhex(message_hex)

version = int.from_bytes(message_bytes[0:4], "big")
source_domain = int.from_bytes(message_bytes[4:8], "big")
destination_domain = int.from_bytes(message_bytes[8:12], "big")
nonce = message_bytes[12:44].hex()
sender = message_bytes[44:76].hex()
recipient = message_bytes[76:108].hex()

print()
print("MessageSent found: PASS")
print("  message bytes length:", len(message_bytes))
print("  message (hex):", "0x" + message_hex)
print("  version:", version)
print("  sourceDomain:", source_domain)
print("  destinationDomain:", destination_domain)
print("  nonce (bytes32):", "0x" + nonce)
print("  sender (TokenMessengerV2, bytes32):", "0x" + sender)
print("  recipient (remote TokenMessengerV2, bytes32):", "0x" + recipient)

with open("/tmp/cctp-bridge-proof.json", "w") as f:
    json.dump({
        "sourceDomain": source_domain,
        "burnTxHash": "$TX_EXEC",
        "message": "0x" + message_hex,
        "nonce": "0x" + nonce,
    }, f, indent=2)
print()
print("Wrote /tmp/cctp-bridge-proof.json for the Stage 4 completion script.")
PYEOF
echo

if [ "$BALANCE_RESULT" = "PASS" ]; then
  echo "=================================================================="
  echo "PASS: real CCTP V2 burn proven on Arc testnet."
  echo "executeFlow tx: $EXPLORER/$TX_EXEC"
  echo "Next: run keeper/scripts/complete-cctp-bridge.ts to complete the mint on Ethereum Sepolia."
  echo "=================================================================="
else
  echo "FAIL: Bridge action did not behave as expected."
  exit 1
fi
