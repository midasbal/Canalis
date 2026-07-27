#!/usr/bin/env bash
# End-to-end, on-chain proof of the Split action (slice 2) on Arc testnet:
# deposit USDC into the deployer's CanalisAccount, register a Manual +
# Split flow distributing 70%/30% to two fresh throwaway recipients, run
# it, and confirm each recipient's balance rose by exactly its share.
#
# Uses `cast send`/`cast call` directly against the real Arc RPC node
# instead of `forge script` — see prove-forward-flow.sh for why (Arc's
# USDC calls a blocklist precompile Foundry's local revm can't execute).
#
# Requires contracts/.env with RPC_URL and PRIVATE_KEY. Never echoes
# secrets. Usage: ./script/prove-split-flow.sh <EXECUTOR> <ACCOUNT>

set -euo pipefail
cd "$(dirname "$0")/.."
set -a
source .env
set +a

EXECUTOR="$1"
ACCOUNT="$2"
USDC=0x3600000000000000000000000000000000000000
DEPOSIT_AMOUNT=1000000  # 1.000000 USDC (6dp)
BPS_1=7000              # 70%
BPS_2=3000              # 30%
EXPLORER=https://testnet.arcscan.app/tx

DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
RECIPIENTS_JSON=$(cast wallet new --number 2 --json)
RECIPIENT_1=$(echo "$RECIPIENTS_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['address'])")
RECIPIENT_2=$(echo "$RECIPIENTS_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)[1]['address'])")

echo "Deployer:              $DEPLOYER"
echo "CanalisAccount:        $ACCOUNT"
echo "Recipient 1 (70%):     $RECIPIENT_1"
echo "Recipient 2 (30%):     $RECIPIENT_2"
echo

BEFORE_1=$(cast call "$USDC" "balanceOf(address)(uint256)" "$RECIPIENT_1" --rpc-url "$RPC_URL" | awk '{print $1}')
BEFORE_2=$(cast call "$USDC" "balanceOf(address)(uint256)" "$RECIPIENT_2" --rpc-url "$RPC_URL" | awk '{print $1}')
BEFORE_ACCOUNT=$(cast call "$ACCOUNT" "balance()(uint256)" --rpc-url "$RPC_URL" | awk '{print $1}')
echo "Recipient 1 balance BEFORE (6dp): $BEFORE_1"
echo "Recipient 2 balance BEFORE (6dp): $BEFORE_2"
echo "Account balance BEFORE (6dp):     $BEFORE_ACCOUNT"
echo

echo "--- approve ---"
TX1=$(cast send "$USDC" "approve(address,uint256)" "$ACCOUNT" "$DEPOSIT_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "approve:      $EXPLORER/$TX1"

echo "--- deposit ---"
TX2=$(cast send "$ACCOUNT" "deposit(uint256)" "$DEPOSIT_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "deposit:      $EXPLORER/$TX2"

echo "--- registerFlow (Manual trigger, single Split action, 70/30) ---"
TX3=$(cast send "$EXECUTOR" \
  "registerFlow((address,(uint8,uint256,uint256,uint256,bool),(uint256,uint256,uint256,uint256,uint256,uint256,address[],address[])[],(uint8,address[],uint256[],uint256,uint256,uint256)[],bool,uint256))" \
  "($ACCOUNT,(3,0,0,0,false),[],[(0,[$RECIPIENT_1,$RECIPIENT_2],[$BPS_1,$BPS_2],$DEPOSIT_AMOUNT,0,0)],true,0)" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "registerFlow: $EXPLORER/$TX3"

FLOW_ID=$(cast receipt "$TX3" --rpc-url "$RPC_URL" --json | python3 -c "
import json, sys
r = json.load(sys.stdin)
executor = '$EXECUTOR'.lower()
for log in r['logs']:
    if log['address'].lower() == executor and len(log['topics']) >= 2:
        print(int(log['topics'][1], 16))
        break
")
echo "Registered flowId: $FLOW_ID"

echo "--- executeFlow ---"
TX4=$(cast send "$EXECUTOR" "executeFlow(uint256)" "$FLOW_ID" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "executeFlow:  $EXPLORER/$TX4"
echo

AFTER_1=$(cast call "$USDC" "balanceOf(address)(uint256)" "$RECIPIENT_1" --rpc-url "$RPC_URL" | awk '{print $1}')
AFTER_2=$(cast call "$USDC" "balanceOf(address)(uint256)" "$RECIPIENT_2" --rpc-url "$RPC_URL" | awk '{print $1}')
AFTER_ACCOUNT=$(cast call "$ACCOUNT" "balance()(uint256)" --rpc-url "$RPC_URL" | awk '{print $1}')
echo "Recipient 1 balance AFTER (6dp): $AFTER_1"
echo "Recipient 2 balance AFTER (6dp): $AFTER_2"
echo "Account balance AFTER (6dp):     $AFTER_ACCOUNT"
echo

DELTA_1=$((AFTER_1 - BEFORE_1))
DELTA_2=$((AFTER_2 - BEFORE_2))
EXPECTED_1=$((DEPOSIT_AMOUNT * BPS_1 / 10000))
EXPECTED_2=$((DEPOSIT_AMOUNT * BPS_2 / 10000))
ACCOUNT_DELTA=$((AFTER_ACCOUNT - BEFORE_ACCOUNT))
EXPECTED_ACCOUNT_DELTA=$((DEPOSIT_AMOUNT - EXPECTED_1 - EXPECTED_2))

echo "Delta 1: $DELTA_1 (expected $EXPECTED_1)"
echo "Delta 2: $DELTA_2 (expected $EXPECTED_2)"
echo "Account delta: $ACCOUNT_DELTA (expected $EXPECTED_ACCOUNT_DELTA, i.e. deposit minus what was distributed)"
echo

if [ "$DELTA_1" -eq "$EXPECTED_1" ] && [ "$DELTA_2" -eq "$EXPECTED_2" ] && [ "$ACCOUNT_DELTA" -eq "$EXPECTED_ACCOUNT_DELTA" ]; then
  echo "PASS: both recipients received exactly their bps share; account retains exactly the remainder."
else
  echo "FAIL: distribution did not match expected shares."
  exit 1
fi
