#!/usr/bin/env bash
# End-to-end, on-chain proof of the Sweep action (slice 2) on Arc testnet:
# deposit USDC into the deployer's CanalisAccount, register a Manual +
# Sweep flow (threshold 0.400000 USDC) to a fresh throwaway recipient, run
# it, and confirm the recipient got exactly (balance - threshold) while
# the account retains exactly the threshold.
#
# Uses `cast send`/`cast call` directly against the real Arc RPC node
# instead of `forge script` — see prove-forward-flow.sh for why (Arc's
# USDC calls a blocklist precompile Foundry's local revm can't execute).
#
# Requires contracts/.env with RPC_URL and PRIVATE_KEY. Never echoes
# secrets. Usage: ./script/prove-sweep-flow.sh <EXECUTOR> <ACCOUNT>

set -euo pipefail
cd "$(dirname "$0")/.."
set -a
source .env
set +a

EXECUTOR="$1"
ACCOUNT="$2"
USDC=0x3600000000000000000000000000000000000000
DEPOSIT_AMOUNT=1000000  # 1.000000 USDC (6dp)
THRESHOLD=400000        # 0.400000 USDC (6dp) — left behind
EXPLORER=https://testnet.arcscan.app/tx

DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
RECIPIENT=$(cast wallet new --json | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['address'])")

echo "Deployer:              $DEPLOYER"
echo "CanalisAccount:        $ACCOUNT"
echo "Throwaway recipient:   $RECIPIENT"
echo

BEFORE=$(cast call "$USDC" "balanceOf(address)(uint256)" "$RECIPIENT" --rpc-url "$RPC_URL" | awk '{print $1}')
BEFORE_ACCOUNT=$(cast call "$ACCOUNT" "balance()(uint256)" --rpc-url "$RPC_URL" | awk '{print $1}')
echo "Recipient USDC balance BEFORE (6dp): $BEFORE"
echo "Account balance BEFORE (6dp):        $BEFORE_ACCOUNT"
echo

echo "--- approve ---"
TX1=$(cast send "$USDC" "approve(address,uint256)" "$ACCOUNT" "$DEPOSIT_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "approve:      $EXPLORER/$TX1"

echo "--- deposit ---"
TX2=$(cast send "$ACCOUNT" "deposit(uint256)" "$DEPOSIT_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "deposit:      $EXPLORER/$TX2"

echo "--- registerFlow (Manual trigger, single Sweep action, threshold 0.4) ---"
TX3=$(cast send "$EXECUTOR" \
  "registerFlow((address,(uint8,uint256,uint256,uint256,bool),(uint256,uint256,uint256,uint256,uint256,uint256,address[],address[])[],(uint8,address[],uint256[],uint256,uint256,uint256)[],bool,uint256))" \
  "($ACCOUNT,(3,0,0,0,false),[],[(2,[$RECIPIENT],[],0,$THRESHOLD,0)],true,0)" \
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

AFTER=$(cast call "$USDC" "balanceOf(address)(uint256)" "$RECIPIENT" --rpc-url "$RPC_URL" | awk '{print $1}')
AFTER_ACCOUNT=$(cast call "$ACCOUNT" "balance()(uint256)" --rpc-url "$RPC_URL" | awk '{print $1}')
echo "Recipient USDC balance AFTER (6dp): $AFTER"
echo "Account balance AFTER (6dp):        $AFTER_ACCOUNT"
echo

DELTA=$((AFTER - BEFORE))
EXPECTED_SWEPT=$((DEPOSIT_AMOUNT - THRESHOLD))
ACCOUNT_DELTA=$((AFTER_ACCOUNT - BEFORE_ACCOUNT))
EXPECTED_ACCOUNT_DELTA=$THRESHOLD

echo "Delta: $DELTA (expected $EXPECTED_SWEPT)"
echo "Account delta: $ACCOUNT_DELTA (expected $EXPECTED_ACCOUNT_DELTA, i.e. retains exactly the threshold)"
echo

if [ "$DELTA" -eq "$EXPECTED_SWEPT" ] && [ "$AFTER_ACCOUNT" -eq "$THRESHOLD" ]; then
  echo "PASS: recipient received exactly (balance - threshold); account retains exactly the threshold."
else
  echo "FAIL: sweep amounts did not match expected values."
  exit 1
fi
