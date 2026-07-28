#!/usr/bin/env bash
# End-to-end, on-chain proof of previewFlow (engine-for-UI addendum,
# capability 3) on Arc testnet: register a not-yet-due OnSchedule flow and
# a due one, show previewFlow reports (false, reason) / (true, "")
# respectively, then cross-check each against a REAL executeFlow call to
# prove the preview matches reality exactly.
#
# Uses `cast send`/`cast call` directly against the real Arc RPC node
# instead of `forge script` — see prove-forward-flow.sh for why.
#
# Requires contracts/.env with RPC_URL and PRIVATE_KEY (the flow owner).
#
# Usage: ./script/prove-preview.sh <EXECUTOR> <ACCOUNT>

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
cast send "$ACCOUNT" "deposit(uint256)" "$DEPOSIT_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" > /dev/null
echo "deposited"

NOW=$(cast block latest --rpc-url "$RPC_URL" --field timestamp)

echo
echo "=== FLOW A: OnSchedule, NOT yet due (scheduleAt = now + 3600) ==="
TXA=$(cast send "$EXECUTOR" \
  "registerFlow((address,(uint8,uint256,uint256,uint256,bool),(uint256,uint256,uint256,uint256,uint256,uint256,address[],address[])[],(uint8,address[],uint256[],uint256,uint256,uint256,address,address,uint256)[],bool,uint256))" \
  "($ACCOUNT,(1,$((NOW + 3600)),0,0,false),[],[(1,[$RECIPIENT],[],$FORWARD_AMOUNT,0,0,0x0000000000000000000000000000000000000000,0x0000000000000000000000000000000000000000,0)],true,0)" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
FLOW_A=$(cast receipt "$TXA" --rpc-url "$RPC_URL" --json | python3 -c "
import json, sys
r = json.load(sys.stdin)
executor = '$EXECUTOR'.lower()
for log in r['logs']:
    if log['address'].lower() == executor and len(log['topics']) >= 2:
        print(int(log['topics'][1], 16))
        break
")
echo "Registered flowId: $FLOW_A"

PREVIEW_A=$(cast call "$EXECUTOR" "previewFlow(uint256)(bool,string)" "$FLOW_A" --rpc-url "$RPC_URL")
echo "previewFlow($FLOW_A): $PREVIEW_A"

echo "--- cross-check: real executeFlow call ---"
set +e
CALL_A=$(cast call "$EXECUTOR" "executeFlow(uint256)" "$FLOW_A" --from "$DEPLOYER" --rpc-url "$RPC_URL" 2>&1)
set -e
echo "$CALL_A"

echo
echo "=== FLOW B: OnSchedule, due now (scheduleAt = now) ==="
TXB=$(cast send "$EXECUTOR" \
  "registerFlow((address,(uint8,uint256,uint256,uint256,bool),(uint256,uint256,uint256,uint256,uint256,uint256,address[],address[])[],(uint8,address[],uint256[],uint256,uint256,uint256,address,address,uint256)[],bool,uint256))" \
  "($ACCOUNT,(1,$NOW,0,0,false),[],[(1,[$RECIPIENT],[],$FORWARD_AMOUNT,0,0,0x0000000000000000000000000000000000000000,0x0000000000000000000000000000000000000000,0)],true,0)" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
FLOW_B=$(cast receipt "$TXB" --rpc-url "$RPC_URL" --json | python3 -c "
import json, sys
r = json.load(sys.stdin)
executor = '$EXECUTOR'.lower()
for log in r['logs']:
    if log['address'].lower() == executor and len(log['topics']) >= 2:
        print(int(log['topics'][1], 16))
        break
")
echo "Registered flowId: $FLOW_B"

PREVIEW_B=$(cast call "$EXECUTOR" "previewFlow(uint256)(bool,string)" "$FLOW_B" --rpc-url "$RPC_URL")
echo "previewFlow($FLOW_B): $PREVIEW_B"

echo "--- cross-check: real executeFlow call, should SUCCEED (matches preview) ---"
TXC=$(cast send "$EXECUTOR" "executeFlow(uint256)" "$FLOW_B" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "executeFlow($FLOW_B): $EXPLORER/$TXC"

AFTER=$(cast call "$USDC" "balanceOf(address)(uint256)" "$RECIPIENT" --rpc-url "$RPC_URL" | awk '{print $1}')
echo "Recipient USDC balance after (6dp): $AFTER"
echo

if echo "$PREVIEW_A" | grep -q "false" && echo "$PREVIEW_A" | grep -q "schedule not due" \
  && echo "$CALL_A" | grep -q "CanalisExecutor: schedule not due" \
  && echo "$PREVIEW_B" | grep -q "true" \
  && [ "$AFTER" -eq "$FORWARD_AMOUNT" ]; then
  echo "PASS: previewFlow matched reality for both the not-due flow (false, reason == the real revert reason) and the due flow (true, \"\" == the real executeFlow success)."
else
  echo "FAIL: previewFlow did not match reality."
  exit 1
fi
