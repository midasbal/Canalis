#!/usr/bin/env bash
# End-to-end, on-chain proof of the first vertical slice on Arc testnet:
# deposit USDC into the deployer's CanalisAccount, register a Manual +
# Forward flow to a fresh throwaway recipient, run it, and confirm the
# recipient's USDC balance rose by exactly the forwarded amount.
#
# Uses `cast send`/`cast call` directly against the real Arc RPC node
# instead of `forge script`, because Arc's USDC implementation calls a
# custom blocklist precompile at 0x1800...0001 on every transfer that
# Foundry's local revm simulator does not implement (confirmed via direct
# `cast call` against the real node, which handles it fine). `forge script`
# always executes the script body once locally — even with
# --skip-simulation — to determine what to broadcast, so any script whose
# body touches a real USDC transfer fails locally before ever broadcasting.
# See contracts/script/ProveForwardFlow.s.sol for the equivalent Solidity
# logic (kept for reference / a future Foundry version that may support
# this precompile locally); this shell script is what actually ran.
#
# Requires contracts/.env with RPC_URL and PRIVATE_KEY. Never echoes
# secrets. Usage: ./script/prove-forward-flow.sh <EXECUTOR> <ACCOUNT>

set -euo pipefail
cd "$(dirname "$0")/.."
set -a
source .env
set +a

EXECUTOR="$1"
ACCOUNT="$2"
USDC=0x3600000000000000000000000000000000000000
DEPOSIT_AMOUNT=1000000  # 1.000000 USDC (6dp)
FORWARD_AMOUNT=500000   # 0.500000 USDC (6dp)
EXPLORER=https://testnet.arcscan.app/tx

DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
RECIPIENT=$(cast wallet new --json | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['address'])")

echo "Deployer:              $DEPLOYER"
echo "CanalisAccount:        $ACCOUNT"
echo "Throwaway recipient:   $RECIPIENT"
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

echo "--- registerFlow (Manual trigger, single Forward action) ---"
TX3=$(cast send "$EXECUTOR" \
  "registerFlow((address,(uint8,uint256,uint256,uint256,bool),(uint256,uint256,uint256,uint256,uint256,uint256,address[],address[])[],(uint8,address[],uint256[],uint256,uint256,uint256)[],bool,uint256))" \
  "($ACCOUNT,(3,0,0,0,false),[],[(1,[$RECIPIENT],[],$FORWARD_AMOUNT,0,0)],true,0)" \
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
echo "Recipient USDC balance AFTER (6dp):  $AFTER"

DELTA=$((AFTER - BEFORE))
echo "Delta: $DELTA (expected $FORWARD_AMOUNT)"
echo

if [ "$DELTA" -eq "$FORWARD_AMOUNT" ]; then
  echo "PASS: recipient balance rose by exactly the forwarded amount."
else
  echo "FAIL: recipient balance did not rise by exactly the forwarded amount."
  exit 1
fi
