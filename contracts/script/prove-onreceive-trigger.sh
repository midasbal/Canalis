#!/usr/bin/env bash
# End-to-end, on-chain proof of the OnReceive trigger (slice 4) on Arc
# testnet: register an OnReceive flow, show it reverts before any new
# deposit, deposit USDC (which bumps CanalisAccount.depositNonce), show a
# NON-owner keeper key can now run it, then show the SAME deposit cannot
# fire it a second time ("no double-fire").
#
# Requires contracts/.env with RPC_URL and PRIVATE_KEY (the flow OWNER /
# deployer). Also requires KEEPER_PRIVATE_KEY — a funded, non-owner key.
#
# Usage: KEEPER_PRIVATE_KEY=0x... ./script/prove-onreceive-trigger.sh <EXECUTOR> <ACCOUNT>

set -euo pipefail
cd "$(dirname "$0")/.."
set -a
source .env
set +a

EXECUTOR="$1"
ACCOUNT="$2"
: "${KEEPER_PRIVATE_KEY:?set KEEPER_PRIVATE_KEY to a funded, non-owner key}"
USDC=0x3600000000000000000000000000000000000000
DEPOSIT_AMOUNT=500000     # 0.500000 USDC (6dp)
FORWARD_AMOUNT=100000     # 0.100000 USDC
EXPLORER=https://testnet.arcscan.app/tx

DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
KEEPER=$(cast wallet address --private-key "$KEEPER_PRIVATE_KEY")
RECIPIENT=$(cast wallet new --json | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['address'])")

echo "Deployer (flow owner): $DEPLOYER"
echo "CanalisAccount:        $ACCOUNT"
echo "Keeper (non-owner):    $KEEPER"
echo "Throwaway recipient:   $RECIPIENT"
echo

echo "--- registerFlow (OnReceive trigger) BEFORE the next deposit ---"
TX1=$(cast send "$EXECUTOR" \
  "registerFlow((address,(uint8,uint256,uint256,uint256,bool),(uint256,uint256,uint256,uint256,uint256,uint256,address[],address[])[],(uint8,address[],uint256[],uint256,uint256,uint256)[],bool,uint256))" \
  "($ACCOUNT,(0,0,0,0,false),[],[(1,[$RECIPIENT],[],$FORWARD_AMOUNT,0,0)],true,0)" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "registerFlow: $EXPLORER/$TX1"

FLOW_ID=$(cast receipt "$TX1" --rpc-url "$RPC_URL" --json | python3 -c "
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
echo "=== BEFORE any new deposit: expect revert ==="
set +e
CALL_OUTPUT=$(cast call "$EXECUTOR" "executeFlow(uint256)" "$FLOW_ID" --from "$KEEPER" --rpc-url "$RPC_URL" 2>&1)
set -e
echo "$CALL_OUTPUT"

echo
echo "--- deposit (bumps depositNonce, arms the OnReceive flow) ---"
cast send "$USDC" "approve(address,uint256)" "$ACCOUNT" "$DEPOSIT_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" > /dev/null
TX2=$(cast send "$ACCOUNT" "deposit(uint256)" "$DEPOSIT_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "deposit: $EXPLORER/$TX2"

echo
echo "=== AFTER deposit: keeper (non-owner) runs it ==="
TX3=$(cast send "$EXECUTOR" "executeFlow(uint256)" "$FLOW_ID" \
  --rpc-url "$RPC_URL" --private-key "$KEEPER_PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "executeFlow (keeper, allowed): $EXPLORER/$TX3"

AFTER_FIRST=$(cast call "$USDC" "balanceOf(address)(uint256)" "$RECIPIENT" --rpc-url "$RPC_URL" | awk '{print $1}')
echo "Recipient USDC balance after 1st run (6dp): $AFTER_FIRST"

echo
echo "=== SAME deposit tried again: no double-fire, expect revert ==="
set +e
CALL_OUTPUT2=$(cast call "$EXECUTOR" "executeFlow(uint256)" "$FLOW_ID" --from "$KEEPER" --rpc-url "$RPC_URL" 2>&1)
set -e
echo "$CALL_OUTPUT2"

AFTER_SECOND=$(cast call "$USDC" "balanceOf(address)(uint256)" "$RECIPIENT" --rpc-url "$RPC_URL" | awk '{print $1}')
echo "Recipient USDC balance after blocked 2nd attempt (6dp): $AFTER_SECOND"
echo

if echo "$CALL_OUTPUT" | grep -q "CanalisExecutor: no new deposit to consume" \
  && [ "$AFTER_FIRST" -eq "$FORWARD_AMOUNT" ] \
  && echo "$CALL_OUTPUT2" | grep -q "CanalisExecutor: no new deposit to consume" \
  && [ "$AFTER_SECOND" -eq "$AFTER_FIRST" ]; then
  echo "PASS: reverted before any deposit; ran once for a non-owner keeper right after a deposit; blocked from double-firing on the same deposit."
else
  echo "FAIL: OnReceive trigger did not behave as expected."
  exit 1
fi
