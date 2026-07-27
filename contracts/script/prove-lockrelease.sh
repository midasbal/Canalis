#!/usr/bin/env bash
# End-to-end, on-chain proof of the LockRelease action (slice 4) on Arc
# testnet: register a Manual + LockRelease flow with a short real-time
# lock, run it once to lock (funds move into the executor's own custody),
# show an immediate release attempt reverts "still locked", actually wait
# out the lock, then show release succeeds exactly once and a further
# attempt reverts "already released".
#
# Requires contracts/.env with RPC_URL and PRIVATE_KEY (the flow owner).
#
# Usage: ./script/prove-lockrelease.sh <EXECUTOR> <ACCOUNT>

set -euo pipefail
cd "$(dirname "$0")/.."
set -a
source .env
set +a

EXECUTOR="$1"
ACCOUNT="$2"
USDC=0x3600000000000000000000000000000000000000
DEPOSIT_AMOUNT=500000     # 0.500000 USDC (6dp)
LOCK_AMOUNT=300000        # 0.300000 USDC
LOCK_SECONDS=30           # short enough to actually wait out in a live demo
EXPLORER=https://testnet.arcscan.app/tx

DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
RECIPIENT=$(cast wallet new --json | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['address'])")

echo "Deployer:              $DEPLOYER"
echo "CanalisAccount:        $ACCOUNT"
echo "Throwaway recipient:   $RECIPIENT"
echo "lock amount / seconds: $LOCK_AMOUNT / $LOCK_SECONDS"
echo

echo "--- approve + deposit ---"
cast send "$USDC" "approve(address,uint256)" "$ACCOUNT" "$DEPOSIT_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" > /dev/null
TX1=$(cast send "$ACCOUNT" "deposit(uint256)" "$DEPOSIT_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "deposit: $EXPLORER/$TX1"

NOW=$(cast block latest --rpc-url "$RPC_URL" --field timestamp)
UNLOCK_AT=$((NOW + LOCK_SECONDS))
echo "Chain timestamp now: $NOW, unlockTime: $UNLOCK_AT"

echo "--- registerFlow (Manual trigger, LockRelease action, unlockTime=$UNLOCK_AT) ---"
TX2=$(cast send "$EXECUTOR" \
  "registerFlow((address,(uint8,uint256,uint256,uint256,bool),(uint256,uint256,uint256,uint256,uint256,uint256,address[],address[])[],(uint8,address[],uint256[],uint256,uint256,uint256)[],bool,uint256))" \
  "($ACCOUNT,(3,0,0,0,false),[],[(3,[$RECIPIENT],[],$LOCK_AMOUNT,0,$UNLOCK_AT)],true,0)" \
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
echo "=== LOCK (1st executeFlow): moves funds account -> executor ==="
TX3=$(cast send "$EXECUTOR" "executeFlow(uint256)" "$FLOW_ID" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "executeFlow (lock): $EXPLORER/$TX3"

EXECUTOR_BAL_AFTER_LOCK=$(cast call "$USDC" "balanceOf(address)(uint256)" "$EXECUTOR" --rpc-url "$RPC_URL" | awk '{print $1}')
RECIPIENT_BAL_AFTER_LOCK=$(cast call "$USDC" "balanceOf(address)(uint256)" "$RECIPIENT" --rpc-url "$RPC_URL" | awk '{print $1}')
echo "Executor USDC balance after lock (6dp):   $EXECUTOR_BAL_AFTER_LOCK"
echo "Recipient USDC balance after lock (6dp):  $RECIPIENT_BAL_AFTER_LOCK"

echo
echo "=== PRE-RELEASE (2nd executeFlow, immediately): expect revert 'still locked' ==="
set +e
CALL_OUTPUT=$(cast call "$EXECUTOR" "executeFlow(uint256)" "$FLOW_ID" --from "$DEPLOYER" --rpc-url "$RPC_URL" 2>&1)
set -e
echo "$CALL_OUTPUT"

echo
echo "--- actually waiting out the lock (${LOCK_SECONDS}s) ---"
sleep "$LOCK_SECONDS"
sleep 3 # small buffer past unlockTime for real chain time to advance past it

echo
echo "=== RELEASE (3rd executeFlow, after waiting): moves funds executor -> recipient ==="
TX4=$(cast send "$EXECUTOR" "executeFlow(uint256)" "$FLOW_ID" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "executeFlow (release): $EXPLORER/$TX4"

EXECUTOR_BAL_AFTER_RELEASE=$(cast call "$USDC" "balanceOf(address)(uint256)" "$EXECUTOR" --rpc-url "$RPC_URL" | awk '{print $1}')
RECIPIENT_BAL_AFTER_RELEASE=$(cast call "$USDC" "balanceOf(address)(uint256)" "$RECIPIENT" --rpc-url "$RPC_URL" | awk '{print $1}')
echo "Executor USDC balance after release (6dp):  $EXECUTOR_BAL_AFTER_RELEASE"
echo "Recipient USDC balance after release (6dp): $RECIPIENT_BAL_AFTER_RELEASE"

echo
echo "=== DOUBLE-RELEASE (4th executeFlow): expect revert 'already released' ==="
set +e
CALL_OUTPUT2=$(cast call "$EXECUTOR" "executeFlow(uint256)" "$FLOW_ID" --from "$DEPLOYER" --rpc-url "$RPC_URL" 2>&1)
set -e
echo "$CALL_OUTPUT2"

echo

if [ "$RECIPIENT_BAL_AFTER_LOCK" -eq 0 ] \
  && echo "$CALL_OUTPUT" | grep -q "CanalisExecutor: still locked" \
  && [ "$RECIPIENT_BAL_AFTER_RELEASE" -eq "$LOCK_AMOUNT" ] \
  && echo "$CALL_OUTPUT2" | grep -q "CanalisExecutor: already released"; then
  echo "PASS: locked funds moved to the executor; pre-release call reverted; release paid the recipient exactly once; a further release attempt reverted 'already released'."
else
  echo "FAIL: LockRelease did not behave as expected."
  exit 1
fi
