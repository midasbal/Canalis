#!/usr/bin/env bash
# End-to-end, on-chain proof of the OnThreshold trigger (slice 4) on Arc
# testnet: register an OnThreshold (at/above) flow, show it reverts while
# the account balance is below the threshold, fund past the threshold, then
# show a NON-owner keeper key can run it successfully.
#
# Requires contracts/.env with RPC_URL and PRIVATE_KEY (the flow OWNER /
# deployer). Also requires KEEPER_PRIVATE_KEY — a funded, non-owner key.
#
# Usage: KEEPER_PRIVATE_KEY=0x... ./script/prove-onthreshold-trigger.sh <EXECUTOR> <ACCOUNT>

set -euo pipefail
cd "$(dirname "$0")/.."
set -a
source .env
set +a

EXECUTOR="$1"
ACCOUNT="$2"
: "${KEEPER_PRIVATE_KEY:?set KEEPER_PRIVATE_KEY to a funded, non-owner key}"
USDC=0x3600000000000000000000000000000000000000
BELOW_DEPOSIT=400000      # 0.400000 USDC — added while still below threshold
TOP_UP_DEPOSIT=700000     # crosses the threshold
FORWARD_AMOUNT=100000     # 0.100000 USDC
EXPLORER=https://testnet.arcscan.app/tx

DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
KEEPER=$(cast wallet address --private-key "$KEEPER_PRIVATE_KEY")
RECIPIENT=$(cast wallet new --json | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['address'])")

# This account may already hold a balance from other proof scripts sharing
# it — set the threshold safely ABOVE whatever is there now plus the below
# deposit, so "below" and "at/above" are unambiguous regardless of history.
STARTING_BALANCE=$(cast call "$ACCOUNT" "balance()(uint256)" --rpc-url "$RPC_URL" | awk '{print $1}')
THRESHOLD=$((STARTING_BALANCE + BELOW_DEPOSIT + 500000))

echo "Deployer (flow owner): $DEPLOYER"
echo "CanalisAccount:        $ACCOUNT"
echo "Keeper (non-owner):    $KEEPER"
echo "Throwaway recipient:   $RECIPIENT"
echo "Starting account balance: $STARTING_BALANCE"
echo "thresholdAmount:       $THRESHOLD (thresholdIsAbove=true)"
echo

echo "--- approve + deposit (below threshold) ---"
cast send "$USDC" "approve(address,uint256)" "$ACCOUNT" "$BELOW_DEPOSIT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" > /dev/null
TX1=$(cast send "$ACCOUNT" "deposit(uint256)" "$BELOW_DEPOSIT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "deposit (below): $EXPLORER/$TX1"

BALANCE=$(cast call "$ACCOUNT" "balance()(uint256)" --rpc-url "$RPC_URL" | awk '{print $1}')
echo "Account balance now: $BALANCE (below $THRESHOLD)"

echo "--- registerFlow (OnThreshold trigger, thresholdAmount=$THRESHOLD, thresholdIsAbove=true) ---"
TX2=$(cast send "$EXECUTOR" \
  "registerFlow((address,(uint8,uint256,uint256,uint256,bool),(uint256,uint256,uint256,uint256,uint256,uint256,address[],address[])[],(uint8,address[],uint256[],uint256,uint256,uint256)[],bool,uint256))" \
  "($ACCOUNT,(2,0,0,$THRESHOLD,true),[],[(1,[$RECIPIENT],[],$FORWARD_AMOUNT,0,0)],true,0)" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "registerFlow: $EXPLORER/$TX2"

FLOW_ID=$(cast receipt "$TX2" --rpc-url "$RPC_URL" --json | python3 -c "
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
echo "=== BELOW THRESHOLD: expect revert ==="
set +e
CALL_OUTPUT=$(cast call "$EXECUTOR" "executeFlow(uint256)" "$FLOW_ID" --from "$KEEPER" --rpc-url "$RPC_URL" 2>&1)
set -e
echo "$CALL_OUTPUT"

echo
echo "--- top up past the threshold ---"
cast send "$USDC" "approve(address,uint256)" "$ACCOUNT" "$TOP_UP_DEPOSIT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" > /dev/null
TX3=$(cast send "$ACCOUNT" "deposit(uint256)" "$TOP_UP_DEPOSIT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "deposit (top-up): $EXPLORER/$TX3"

BALANCE2=$(cast call "$ACCOUNT" "balance()(uint256)" --rpc-url "$RPC_URL" | awk '{print $1}')
echo "Account balance now: $BALANCE2 (at/above $THRESHOLD)"

echo
echo "=== AT/ABOVE THRESHOLD: keeper (non-owner) runs it ==="
TX4=$(cast send "$EXECUTOR" "executeFlow(uint256)" "$FLOW_ID" \
  --rpc-url "$RPC_URL" --private-key "$KEEPER_PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "executeFlow (keeper, allowed): $EXPLORER/$TX4"

AFTER=$(cast call "$USDC" "balanceOf(address)(uint256)" "$RECIPIENT" --rpc-url "$RPC_URL" | awk '{print $1}')
echo "Recipient USDC balance after (6dp): $AFTER"
echo

if echo "$CALL_OUTPUT" | grep -q "CanalisExecutor: threshold not met" && [ "$AFTER" -eq "$FORWARD_AMOUNT" ]; then
  echo "PASS: below-threshold call reverted with 'threshold not met'; at/above-threshold call by a non-owner keeper succeeded and moved funds."
else
  echo "FAIL: OnThreshold trigger did not behave as expected."
  exit 1
fi
