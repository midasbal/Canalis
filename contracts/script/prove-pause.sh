#!/usr/bin/env bash
# End-to-end, on-chain proof of pause/cancel (engine-for-UI addendum,
# capability 1) on Arc testnet: register a Manual + Forward flow, pause it
# via setFlowActive, show executeFlow reverts "flow inactive", unpause,
# show it now runs.
#
# Uses `cast send`/`cast call` directly against the real Arc RPC node
# instead of `forge script` — see prove-forward-flow.sh for why.
#
# Requires contracts/.env with RPC_URL and PRIVATE_KEY (the flow owner).
#
# Usage: ./script/prove-pause.sh <EXECUTOR> <ACCOUNT>

set -euo pipefail
cd "$(dirname "$0")/.."
set -a
source .env
set +a

EXECUTOR="$1"
ACCOUNT="$2"
USDC=0x3600000000000000000000000000000000000000
DEPOSIT_AMOUNT=500000    # 0.500000 USDC (6dp)
FORWARD_AMOUNT=100000    # 0.100000 USDC
EXPLORER=https://testnet.arcscan.app/tx

DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
RECIPIENT=$(cast wallet new --json | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['address'])")

echo "Deployer:              $DEPLOYER"
echo "CanalisAccount:        $ACCOUNT"
echo "Throwaway recipient:   $RECIPIENT"
echo

echo "--- approve + deposit ---"
cast send "$USDC" "approve(address,uint256)" "$ACCOUNT" "$DEPOSIT_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" > /dev/null
TX1=$(cast send "$ACCOUNT" "deposit(uint256)" "$DEPOSIT_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "deposit: $EXPLORER/$TX1"

echo "--- registerFlow (Manual trigger, Forward action) ---"
TX2=$(cast send "$EXECUTOR" \
  "registerFlow((address,(uint8,uint256,uint256,uint256,bool),(uint256,uint256,uint256,uint256,uint256,uint256,address[],address[])[],(uint8,address[],uint256[],uint256,uint256,uint256,address,address,uint256)[],bool,uint256))" \
  "($ACCOUNT,(3,0,0,0,false),[],[(1,[$RECIPIENT],[],$FORWARD_AMOUNT,0,0,0x0000000000000000000000000000000000000000,0x0000000000000000000000000000000000000000,0)],true,0)" \
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
echo "=== PAUSE (setFlowActive false) ==="
TX3=$(cast send "$EXECUTOR" "setFlowActive(uint256,bool)" "$FLOW_ID" false \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "setFlowActive(false): $EXPLORER/$TX3"

echo
echo "=== EXECUTE WHILE PAUSED: expect revert 'flow inactive' ==="
set +e
CALL_OUTPUT=$(cast call "$EXECUTOR" "executeFlow(uint256)" "$FLOW_ID" --from "$DEPLOYER" --rpc-url "$RPC_URL" 2>&1)
set -e
echo "$CALL_OUTPUT"

echo
echo "=== UNPAUSE (setFlowActive true) ==="
TX4=$(cast send "$EXECUTOR" "setFlowActive(uint256,bool)" "$FLOW_ID" true \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "setFlowActive(true): $EXPLORER/$TX4"

echo
echo "=== EXECUTE AFTER UNPAUSE: expect success ==="
TX5=$(cast send "$EXECUTOR" "executeFlow(uint256)" "$FLOW_ID" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "executeFlow (after unpause): $EXPLORER/$TX5"

AFTER=$(cast call "$USDC" "balanceOf(address)(uint256)" "$RECIPIENT" --rpc-url "$RPC_URL" | awk '{print $1}')
echo "Recipient USDC balance after (6dp): $AFTER"
echo

if echo "$CALL_OUTPUT" | grep -q "CanalisExecutor: flow inactive" && [ "$AFTER" -eq "$FORWARD_AMOUNT" ]; then
  echo "PASS: paused flow reverted 'flow inactive'; unpaused flow executed and moved funds."
else
  echo "FAIL: pause/unpause did not behave as expected."
  exit 1
fi
