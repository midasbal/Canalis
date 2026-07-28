#!/usr/bin/env bash
# End-to-end, on-chain proof of the cooldown condition (slice 3) on Arc
# testnet: register a Manual + Forward flow with a 5-second cooldown, run
# it once (succeeds — no prior execution to cool down from), then
# immediately re-run it with no delay (blocked — cooldown not elapsed).
#
# Uses `cast send`/`cast call` directly against the real Arc RPC node
# instead of `forge script` — see prove-forward-flow.sh for why (Arc's
# USDC calls a blocklist precompile Foundry's local revm can't execute).
#
# No vm.warp here (this isn't a Foundry test) — the proof is that the very
# next call, made immediately after the first with no wait, reverts. The
# "blocked" call is also broadcast with an explicit --gas-limit to bypass
# cast's automatic gas estimation, producing a real mined-and-failed
# transaction with a genuine arcscan hash, not just an off-chain simulation.
#
# Requires contracts/.env with RPC_URL and PRIVATE_KEY. Never echoes
# secrets. Usage: ./script/prove-cooldown-condition.sh <EXECUTOR> <ACCOUNT>

set -euo pipefail
cd "$(dirname "$0")/.."
set -a
source .env
set +a

EXECUTOR="$1"
ACCOUNT="$2"
USDC=0x3600000000000000000000000000000000000000
DEPOSIT_AMOUNT=1000000    # 1.000000 USDC (6dp)
FORWARD_AMOUNT=100000     # 0.100000 USDC per run
COOLDOWN_SECONDS=5
EXPLORER=https://testnet.arcscan.app/tx

DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
RECIPIENT=$(cast wallet new --json | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['address'])")

echo "Deployer:              $DEPLOYER"
echo "CanalisAccount:        $ACCOUNT"
echo "Throwaway recipient:   $RECIPIENT"
echo "cooldownSeconds:       $COOLDOWN_SECONDS"
echo

BEFORE=$(cast call "$USDC" "balanceOf(address)(uint256)" "$RECIPIENT" --rpc-url "$RPC_URL" | awk '{print $1}')
echo "Recipient USDC balance BEFORE (6dp): $BEFORE"
echo

echo "--- approve ---"
TX1=$(cast send "$USDC" "approve(address,uint256)" "$ACCOUNT" "$DEPOSIT_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "approve:      $EXPLORER/$TX1"

echo "--- deposit ---"
TX2=$(cast send "$ACCOUNT" "deposit(uint256)" "$DEPOSIT_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "deposit:      $EXPLORER/$TX2"

echo "--- registerFlow (Manual trigger, Forward action, cooldownSeconds=$COOLDOWN_SECONDS) ---"
TX3=$(cast send "$EXECUTOR" \
  "registerFlow((address,(uint8,uint256,uint256,uint256,bool),(uint256,uint256,uint256,uint256,uint256,uint256,address[],address[])[],(uint8,address[],uint256[],uint256,uint256,uint256,address,address,uint256)[],bool,uint256))" \
  "($ACCOUNT,(3,0,0,0,false),[(0,0,$COOLDOWN_SECONDS,0,0,0,[],[])],[(1,[$RECIPIENT],[],$FORWARD_AMOUNT,0,0,0x0000000000000000000000000000000000000000,0x0000000000000000000000000000000000000000,0)],true,0)" \
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
echo "=== FIRST RUN: no prior execution, cooldown does not apply ==="
TX4=$(cast send "$EXECUTOR" "executeFlow(uint256)" "$FLOW_ID" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "executeFlow (1st, allowed): $EXPLORER/$TX4"

AFTER_FIRST=$(cast call "$USDC" "balanceOf(address)(uint256)" "$RECIPIENT" --rpc-url "$RPC_URL" | awk '{print $1}')
echo "Recipient USDC balance after 1st run (6dp): $AFTER_FIRST"

echo
echo "=== SECOND RUN: immediately after, cooldown has not elapsed ==="
echo "--- cast call executeFlow (free simulation, capture revert reason) ---"
set +e
CALL_OUTPUT=$(cast call "$EXECUTOR" "executeFlow(uint256)" "$FLOW_ID" --from "$DEPLOYER" --rpc-url "$RPC_URL" 2>&1)
set -e
echo "$CALL_OUTPUT"

echo "--- cast send executeFlow (forced broadcast, real mined-and-failed tx) ---"
set +e
TX5=$(cast send "$EXECUTOR" "executeFlow(uint256)" "$FLOW_ID" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --gas-limit 300000 --json 2>&1 | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])" 2>/dev/null)
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

if [ "$AFTER_FIRST" -eq "$FORWARD_AMOUNT" ] && [ "$AFTER_SECOND" -eq "$AFTER_FIRST" ] && echo "$CALL_OUTPUT" | grep -q "CanalisExecutor: cooldown not elapsed"; then
  echo "PASS: first run succeeded and moved funds; immediate re-run blocked with the cooldown reason and moved nothing further."
else
  echo "FAIL: cooldown condition did not behave as expected."
  exit 1
fi
