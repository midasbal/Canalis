#!/usr/bin/env bash
# On-chain proof of flowsOf (engine-for-UI addendum, capability 4) on Arc
# testnet: register a couple of flows against the deployer's CanalisAccount
# and confirm flowsOf(account) lists exactly those flow ids.
#
# Uses `cast send`/`cast call` directly against the real Arc RPC node
# instead of `forge script` — see prove-forward-flow.sh for why.
#
# Requires contracts/.env with RPC_URL and PRIVATE_KEY (the flow owner).
#
# Usage: ./script/prove-flowsof.sh <EXECUTOR> <ACCOUNT>

set -euo pipefail
cd "$(dirname "$0")/.."
set -a
source .env
set +a

EXECUTOR="$1"
ACCOUNT="$2"
EXPLORER=https://testnet.arcscan.app/tx

RECIPIENT=$(cast wallet new --json | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['address'])")

echo "CanalisAccount:        $ACCOUNT"
echo "Throwaway recipient:   $RECIPIENT"
echo

BEFORE=$(cast call "$EXECUTOR" "flowsOf(address)(uint256[])" "$ACCOUNT" --rpc-url "$RPC_URL")
echo "flowsOf($ACCOUNT) BEFORE: $BEFORE"

echo
echo "--- registerFlow x2 (Manual + Forward, zero conditions) ---"
TX1=$(cast send "$EXECUTOR" \
  "registerFlow((address,(uint8,uint256,uint256,uint256,bool),(uint256,uint256,uint256,uint256,uint256,uint256,address[],address[])[],(uint8,address[],uint256[],uint256,uint256,uint256,address,address,uint256)[],bool,uint256))" \
  "($ACCOUNT,(3,0,0,0,false),[],[(1,[$RECIPIENT],[],1,0,0,0x0000000000000000000000000000000000000000,0x0000000000000000000000000000000000000000,0)],true,0)" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
FLOW_1=$(cast receipt "$TX1" --rpc-url "$RPC_URL" --json | python3 -c "
import json, sys
r = json.load(sys.stdin)
executor = '$EXECUTOR'.lower()
for log in r['logs']:
    if log['address'].lower() == executor and len(log['topics']) >= 2:
        print(int(log['topics'][1], 16))
        break
")
echo "registerFlow #1: $EXPLORER/$TX1 -> flowId $FLOW_1"

TX2=$(cast send "$EXECUTOR" \
  "registerFlow((address,(uint8,uint256,uint256,uint256,bool),(uint256,uint256,uint256,uint256,uint256,uint256,address[],address[])[],(uint8,address[],uint256[],uint256,uint256,uint256,address,address,uint256)[],bool,uint256))" \
  "($ACCOUNT,(3,0,0,0,false),[],[(1,[$RECIPIENT],[],1,0,0,0x0000000000000000000000000000000000000000,0x0000000000000000000000000000000000000000,0)],true,0)" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
FLOW_2=$(cast receipt "$TX2" --rpc-url "$RPC_URL" --json | python3 -c "
import json, sys
r = json.load(sys.stdin)
executor = '$EXECUTOR'.lower()
for log in r['logs']:
    if log['address'].lower() == executor and len(log['topics']) >= 2:
        print(int(log['topics'][1], 16))
        break
")
echo "registerFlow #2: $EXPLORER/$TX2 -> flowId $FLOW_2"

AFTER=$(cast call "$EXECUTOR" "flowsOf(address)(uint256[])" "$ACCOUNT" --rpc-url "$RPC_URL")
echo
echo "flowsOf($ACCOUNT) AFTER: $AFTER"
echo

if echo "$AFTER" | grep -q "$FLOW_1" && echo "$AFTER" | grep -q "$FLOW_2"; then
  echo "PASS: flowsOf($ACCOUNT) lists both newly registered flow ids ($FLOW_1, $FLOW_2)."
else
  echo "FAIL: flowsOf did not list the expected flow ids."
  exit 1
fi
