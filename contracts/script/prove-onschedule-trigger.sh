#!/usr/bin/env bash
# End-to-end, on-chain proof of the OnSchedule trigger (slice 4) on Arc
# testnet: register a Manual-account-owned flow with OnSchedule trigger due
# immediately, run it via a NON-owner keeper key (proving the trigger is
# caller-agnostic), then immediately re-run before the next interval
# (blocked — "schedule not due").
#
# Uses `cast send`/`cast call` directly against the real Arc RPC node
# instead of `forge script` — see prove-forward-flow.sh for why.
#
# Requires contracts/.env with RPC_URL and PRIVATE_KEY (the flow OWNER /
# deployer). Also requires KEEPER_PRIVATE_KEY env var — a funded, non-owner
# key used as the caller of executeFlow, to prove the trigger doesn't gate
# on msg.sender.
#
# Usage: KEEPER_PRIVATE_KEY=0x... ./script/prove-onschedule-trigger.sh <EXECUTOR> <ACCOUNT>

set -euo pipefail
cd "$(dirname "$0")/.."
set -a
source .env
set +a

EXECUTOR="$1"
ACCOUNT="$2"
: "${KEEPER_PRIVATE_KEY:?set KEEPER_PRIVATE_KEY to a funded, non-owner key}"
USDC=0x3600000000000000000000000000000000000000
DEPOSIT_AMOUNT=1000000    # 1.000000 USDC (6dp)
FORWARD_AMOUNT=250000     # 0.250000 USDC per run
SCHEDULE_INTERVAL=3600    # 1 hour — long enough that "immediate re-run" is unambiguously not due
EXPLORER=https://testnet.arcscan.app/tx

DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
KEEPER=$(cast wallet address --private-key "$KEEPER_PRIVATE_KEY")
RECIPIENT=$(cast wallet new --json | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['address'])")

echo "Deployer (flow owner): $DEPLOYER"
echo "CanalisAccount:        $ACCOUNT"
echo "Keeper (non-owner):    $KEEPER"
echo "Throwaway recipient:   $RECIPIENT"
echo

NOW=$(cast block latest --rpc-url "$RPC_URL" --field timestamp)
echo "Chain timestamp (scheduleAt): $NOW"
echo

echo "--- approve ---"
TX1=$(cast send "$USDC" "approve(address,uint256)" "$ACCOUNT" "$DEPOSIT_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "approve:      $EXPLORER/$TX1"

echo "--- deposit ---"
TX2=$(cast send "$ACCOUNT" "deposit(uint256)" "$DEPOSIT_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "deposit:      $EXPLORER/$TX2"

echo "--- registerFlow (OnSchedule trigger, due now, interval=${SCHEDULE_INTERVAL}s) ---"
TX3=$(cast send "$EXECUTOR" \
  "registerFlow((address,(uint8,uint256,uint256,uint256,bool),(uint256,uint256,uint256,uint256,uint256,uint256,address[],address[])[],(uint8,address[],uint256[],uint256,uint256,uint256)[],bool,uint256))" \
  "($ACCOUNT,(1,$NOW,$SCHEDULE_INTERVAL,0,false),[],[(1,[$RECIPIENT],[],$FORWARD_AMOUNT,0,0)],true,0)" \
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

echo
echo "=== FIRST RUN: due now, called by the KEEPER (not the owner) ==="
TX4=$(cast send "$EXECUTOR" "executeFlow(uint256)" "$FLOW_ID" \
  --rpc-url "$RPC_URL" --private-key "$KEEPER_PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "executeFlow (1st, keeper, allowed): $EXPLORER/$TX4"

AFTER_FIRST=$(cast call "$USDC" "balanceOf(address)(uint256)" "$RECIPIENT" --rpc-url "$RPC_URL" | awk '{print $1}')
echo "Recipient USDC balance after 1st run (6dp): $AFTER_FIRST"

echo
echo "=== SECOND RUN: immediately after, next interval not reached ==="
echo "--- cast call executeFlow (free simulation, capture revert reason) ---"
set +e
CALL_OUTPUT=$(cast call "$EXECUTOR" "executeFlow(uint256)" "$FLOW_ID" --from "$KEEPER" --rpc-url "$RPC_URL" 2>&1)
set -e
echo "$CALL_OUTPUT"

echo "--- cast send executeFlow (forced broadcast, real mined-and-failed tx) ---"
set +e
TX5=$(cast send "$EXECUTOR" "executeFlow(uint256)" "$FLOW_ID" \
  --rpc-url "$RPC_URL" --private-key "$KEEPER_PRIVATE_KEY" --gas-limit 300000 --json 2>&1 | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])" 2>/dev/null)
set -e
if [ -n "${TX5:-}" ]; then
  echo "executeFlow (2nd, blocked): $EXPLORER/$TX5"
  STATUS=$(cast receipt "$TX5" --rpc-url "$RPC_URL" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['status'])")
  echo "Receipt status: $STATUS (expect 0x0 = failed)"
else
  echo "(node refused to broadcast a guaranteed-revert tx even with --gas-limit; the cast call above is the revert proof)"
fi

AFTER_SECOND=$(cast call "$USDC" "balanceOf(address)(uint256)" "$RECIPIENT" --rpc-url "$RPC_URL" | awk '{print $1}')
echo
echo "Recipient USDC balance after blocked 2nd attempt (6dp): $AFTER_SECOND"
echo

if [ "$AFTER_FIRST" -eq "$FORWARD_AMOUNT" ] && [ "$AFTER_SECOND" -eq "$AFTER_FIRST" ] && echo "$CALL_OUTPUT" | grep -q "CanalisExecutor: schedule not due"; then
  echo "PASS: keeper (non-owner) successfully ran the due schedule; immediate re-run blocked with 'schedule not due' and moved nothing further."
else
  echo "FAIL: OnSchedule trigger did not behave as expected."
  exit 1
fi
