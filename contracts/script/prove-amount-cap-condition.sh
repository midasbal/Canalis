#!/usr/bin/env bash
# End-to-end, on-chain proof of the amount-cap condition (slice 3) on Arc
# testnet: register two Manual + Forward flows sharing the same maxAmount
# condition — one whose forward amount exceeds the cap (blocked), one
# within it (allowed) — and show both outcomes with real transactions.
#
# Uses `cast send`/`cast call` directly against the real Arc RPC node
# instead of `forge script` — see prove-forward-flow.sh for why (Arc's
# USDC calls a blocklist precompile Foundry's local revm can't execute).
#
# The "blocked" executeFlow call is broadcast with an explicit --gas-limit
# to bypass cast's automatic gas estimation (which would otherwise refuse
# to broadcast a call it knows will revert) — this produces a real, mined,
# failed transaction with a genuine arcscan hash, not just an off-chain
# simulation. We also run a free `cast call` first to capture the exact
# revert reason string.
#
# Requires contracts/.env with RPC_URL and PRIVATE_KEY. Never echoes
# secrets. Usage: ./script/prove-amount-cap-condition.sh <EXECUTOR> <ACCOUNT>

set -euo pipefail
cd "$(dirname "$0")/.."
set -a
source .env
set +a

EXECUTOR="$1"
ACCOUNT="$2"
USDC=0x3600000000000000000000000000000000000000
DEPOSIT_AMOUNT=1000000  # 1.000000 USDC (6dp)
MAX_AMOUNT=400000       # 0.400000 USDC cap
OVER_CAP_AMOUNT=500000  # 0.500000 USDC — exceeds the cap
UNDER_CAP_AMOUNT=300000 # 0.300000 USDC — within the cap
EXPLORER=https://testnet.arcscan.app/tx

DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
RECIPIENT=$(cast wallet new --json | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['address'])")

echo "Deployer:              $DEPLOYER"
echo "CanalisAccount:        $ACCOUNT"
echo "Throwaway recipient:   $RECIPIENT"
echo "maxAmount condition:   $MAX_AMOUNT (0.400000 USDC)"
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

REGISTER_SIG="registerFlow((address,(uint8,uint256,uint256,uint256,bool),(uint256,uint256,uint256,uint256,uint256,uint256,address[],address[])[],(uint8,address[],uint256[],uint256,uint256,uint256,address,address,uint256)[],bool,uint256))"

register_flow() {
  local amount="$1"
  cast send "$EXECUTOR" "$REGISTER_SIG" \
    "($ACCOUNT,(3,0,0,0,false),[(0,$MAX_AMOUNT,0,0,0,0,[],[])],[(1,[$RECIPIENT],[],$amount,0,0,0x0000000000000000000000000000000000000000,0x0000000000000000000000000000000000000000,0)],true,0)" \
    --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])"
}

flow_id_from_tx() {
  local tx="$1"
  cast receipt "$tx" --rpc-url "$RPC_URL" --json | python3 -c "
import json, sys
r = json.load(sys.stdin)
executor = '$EXECUTOR'.lower()
for log in r['logs']:
    if log['address'].lower() == executor and len(log['topics']) >= 2:
        print(int(log['topics'][1], 16))
        break
"
}

echo
echo "=== BLOCKED CASE: forward $OVER_CAP_AMOUNT exceeds cap $MAX_AMOUNT ==="
echo "--- registerFlow (over cap) ---"
TX3=$(register_flow "$OVER_CAP_AMOUNT")
echo "registerFlow: $EXPLORER/$TX3"
OVER_CAP_FLOW_ID=$(flow_id_from_tx "$TX3")
echo "Registered flowId: $OVER_CAP_FLOW_ID"

echo "--- cast call executeFlow (free simulation, capture revert reason) ---"
set +e
CALL_OUTPUT=$(cast call "$EXECUTOR" "executeFlow(uint256)" "$OVER_CAP_FLOW_ID" --from "$DEPLOYER" --rpc-url "$RPC_URL" 2>&1)
set -e
echo "$CALL_OUTPUT"

echo "--- cast send executeFlow (forced broadcast, real mined-and-failed tx) ---"
set +e
TX4=$(cast send "$EXECUTOR" "executeFlow(uint256)" "$OVER_CAP_FLOW_ID" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --gas-limit 300000 --json 2>&1 | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])" 2>/dev/null)
set -e
if [ -n "${TX4:-}" ]; then
  echo "executeFlow (blocked): $EXPLORER/$TX4"
  STATUS=$(cast receipt "$TX4" --rpc-url "$RPC_URL" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['status'])")
  echo "Receipt status: $STATUS (expect 0x0 = failed)"
else
  echo "(node refused to broadcast a guaranteed-revert tx even with --gas-limit; the cast call above is the revert proof)"
fi

echo
echo "=== ALLOWED CASE: forward $UNDER_CAP_AMOUNT is within cap $MAX_AMOUNT ==="
echo "--- registerFlow (under cap) ---"
TX5=$(register_flow "$UNDER_CAP_AMOUNT")
echo "registerFlow: $EXPLORER/$TX5"
UNDER_CAP_FLOW_ID=$(flow_id_from_tx "$TX5")
echo "Registered flowId: $UNDER_CAP_FLOW_ID"

echo "--- executeFlow (expected to succeed) ---"
TX6=$(cast send "$EXECUTOR" "executeFlow(uint256)" "$UNDER_CAP_FLOW_ID" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "executeFlow (allowed): $EXPLORER/$TX6"

AFTER=$(cast call "$USDC" "balanceOf(address)(uint256)" "$RECIPIENT" --rpc-url "$RPC_URL" | awk '{print $1}')
echo
echo "Recipient USDC balance AFTER (6dp): $AFTER"

DELTA=$((AFTER - BEFORE))
echo "Delta: $DELTA (expected $UNDER_CAP_AMOUNT — only the allowed forward should have moved funds)"
echo

if [ "$DELTA" -eq "$UNDER_CAP_AMOUNT" ] && echo "$CALL_OUTPUT" | grep -q "CanalisExecutor: amount exceeds cap"; then
  echo "PASS: over-cap forward blocked with the cap reason; under-cap forward succeeded and moved exactly the allowed amount."
else
  echo "FAIL: amount-cap condition did not behave as expected."
  exit 1
fi
