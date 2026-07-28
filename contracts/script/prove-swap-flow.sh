#!/usr/bin/env bash
# End-to-end, on-chain proof of the Swap action (Arc-native feature slice)
# on Arc testnet: deposit USDC into a CanalisAccount, register a Manual +
# Swap flow (swap 1 USDC -> EURC via CanalisSwapPool, with a real
# minAmountOut), execute it, and assert the recipient received ~the
# expected EURC (matching the pool's own quote() exactly) and the pool's
# reserves moved correctly.
#
# Uses `cast send`/`cast call` directly against the real Arc RPC node
# instead of `forge script` — see prove-forward-flow.sh for why (Arc's
# USDC calls a blocklist precompile Foundry's local revm can't execute).
#
# Requires contracts/.env with RPC_URL and PRIVATE_KEY (the flow owner /
# deployer, who must also be the CanalisAccount owner used below).
#
# Usage: ./script/prove-swap-flow.sh <EXECUTOR> <ACCOUNT> <POOL>

set -euo pipefail
cd "$(dirname "$0")/.."
set -a
source .env
set +a

EXECUTOR="$1"
ACCOUNT="$2"
POOL="$3"
USDC=0x3600000000000000000000000000000000000000
EURC=0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a
DEPOSIT_AMOUNT=5000000    # 5.000000 USDC (6dp)
SWAP_AMOUNT_IN=1000000    # 1.000000 USDC (6dp)
SLIPPAGE_BPS=100          # 1% slippage tolerance
EXPLORER=https://testnet.arcscan.app/tx

DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
RECIPIENT=$(cast wallet new --json | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['address'])")

echo "Deployer (flow owner): $DEPLOYER"
echo "CanalisAccount:        $ACCOUNT"
echo "CanalisSwapPool:       $POOL"
echo "Throwaway recipient:   $RECIPIENT"
echo

echo "--- pool reserves before ---"
RESERVE_USDC_BEFORE=$(cast call "$POOL" "reserveUsdc()(uint256)" --rpc-url "$RPC_URL" | awk '{print $1}')
RESERVE_EURC_BEFORE=$(cast call "$POOL" "reserveEurc()(uint256)" --rpc-url "$RPC_URL" | awk '{print $1}')
echo "reserveUsdc: $RESERVE_USDC_BEFORE, reserveEurc: $RESERVE_EURC_BEFORE"

echo "--- live quote for $SWAP_AMOUNT_IN USDC -> EURC ---"
QUOTE=$(cast call "$POOL" "quote(address,uint256)(uint256)" "$USDC" "$SWAP_AMOUNT_IN" --rpc-url "$RPC_URL" | awk '{print $1}')
echo "quote() amountOut: $QUOTE"
MIN_AMOUNT_OUT=$(python3 -c "print(int($QUOTE * (10000 - $SLIPPAGE_BPS) / 10000))")
echo "minAmountOut (${SLIPPAGE_BPS}bps slippage floor): $MIN_AMOUNT_OUT"
echo

echo "--- approve + deposit USDC into CanalisAccount ---"
cast send "$USDC" "approve(address,uint256)" "$ACCOUNT" "$DEPOSIT_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" > /dev/null
TX1=$(cast send "$ACCOUNT" "deposit(uint256)" "$DEPOSIT_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "deposit: $EXPLORER/$TX1"

echo "--- registerFlow (Manual trigger, Swap action: $SWAP_AMOUNT_IN USDC -> EURC, min $MIN_AMOUNT_OUT) ---"
TX2=$(cast send "$EXECUTOR" \
  "registerFlow((address,(uint8,uint256,uint256,uint256,bool),(uint256,uint256,uint256,uint256,uint256,uint256,address[],address[])[],(uint8,address[],uint256[],uint256,uint256,uint256,address,address,uint256)[],bool,uint256))" \
  "($ACCOUNT,(3,0,0,0,false),[],[(4,[$RECIPIENT],[],$SWAP_AMOUNT_IN,0,0,$USDC,$EURC,$MIN_AMOUNT_OUT)],true,0)" \
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
echo "=== previewFlow (must be a pure dry-run, no funds move) ==="
cast call "$EXECUTOR" "previewFlow(uint256)(bool,string)" "$FLOW_ID" --from "$DEPLOYER" --rpc-url "$RPC_URL"

echo
echo "=== executeFlow: swap $SWAP_AMOUNT_IN USDC -> EURC, deliver to $RECIPIENT ==="
TX3=$(cast send "$EXECUTOR" "executeFlow(uint256)" "$FLOW_ID" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "executeFlow: $EXPLORER/$TX3"

RECIPIENT_EURC=$(cast call "$EURC" "balanceOf(address)(uint256)" "$RECIPIENT" --rpc-url "$RPC_URL" | awk '{print $1}')
RECIPIENT_USDC=$(cast call "$USDC" "balanceOf(address)(uint256)" "$RECIPIENT" --rpc-url "$RPC_URL" | awk '{print $1}')
ACCOUNT_BALANCE_AFTER=$(cast call "$ACCOUNT" "balance()(uint256)" --rpc-url "$RPC_URL" | awk '{print $1}')
RESERVE_USDC_AFTER=$(cast call "$POOL" "reserveUsdc()(uint256)" --rpc-url "$RPC_URL" | awk '{print $1}')
RESERVE_EURC_AFTER=$(cast call "$POOL" "reserveEurc()(uint256)" --rpc-url "$RPC_URL" | awk '{print $1}')

echo
echo "Recipient EURC balance after (6dp): $RECIPIENT_EURC"
echo "Recipient USDC balance after (6dp): $RECIPIENT_USDC (must be 0 — recipient only ever receives tokenOut)"
echo "CanalisAccount USDC balance after (6dp): $ACCOUNT_BALANCE_AFTER (deposit $DEPOSIT_AMOUNT - swapIn $SWAP_AMOUNT_IN)"
echo "Pool reserves after: $RESERVE_USDC_AFTER USDC / $RESERVE_EURC_AFTER EURC"
echo

EXPECTED_ACCOUNT_BALANCE=$((DEPOSIT_AMOUNT - SWAP_AMOUNT_IN))
EXPECTED_RESERVE_USDC=$((RESERVE_USDC_BEFORE + SWAP_AMOUNT_IN))
EXPECTED_RESERVE_EURC=$((RESERVE_EURC_BEFORE - QUOTE))

if [ "$RECIPIENT_EURC" -eq "$QUOTE" ] \
  && [ "$RECIPIENT_USDC" -eq 0 ] \
  && [ "$ACCOUNT_BALANCE_AFTER" -eq "$EXPECTED_ACCOUNT_BALANCE" ] \
  && [ "$RESERVE_USDC_AFTER" -eq "$EXPECTED_RESERVE_USDC" ] \
  && [ "$RESERVE_EURC_AFTER" -eq "$EXPECTED_RESERVE_EURC" ]; then
  echo "PASS: recipient received exactly the pool's quoted EURC output; CanalisAccount dropped by exactly the swapped-in USDC; pool reserves moved by exactly the swap amounts."
else
  echo "FAIL: Swap action did not behave as expected."
  exit 1
fi
