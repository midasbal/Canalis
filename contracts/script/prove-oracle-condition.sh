#!/usr/bin/env bash
# End-to-end, on-chain proof of the Oracle price condition (Arc-native
# feature slice, spec section 7.3 #2) on Arc testnet against the REAL Pyth
# oracle contract — no mock, no guessed address/feed id:
#
#   1. Fetches a real signed EUR/USD price update from Pyth's Hermes API
#      and pushes it on-chain via `updatePriceFeeds` (paying the real fee).
#   2. Reads the price back from the oracle itself and prints it.
#   3. Registers a Manual + Forward flow whose oracle condition threshold
#      is set so the CURRENT real price BLOCKS it, and shows `executeFlow`
#      revert with "CanalisExecutor: price condition not met".
#   4. Registers an identical flow but with a threshold the current real
#      price SATISFIES, and shows `executeFlow` succeed (funds actually
#      move).
#
# Uses `cast send`/`cast call` directly against the real Arc RPC node, not
# `forge script` — see CLAUDE.md's precompile gotcha (Arc USDC transfers
# call a blocklist precompile Foundry's local revm can't execute).
#
# Requires contracts/.env with RPC_URL and PRIVATE_KEY (the flow owner /
# deployer, who must also be the CanalisAccount owner used below, and must
# hold a small amount of Arc's native gas-USDC to pay both tx gas and
# Pyth's update fee).
#
# Usage: ./script/prove-oracle-condition.sh <EXECUTOR> <ACCOUNT>

set -euo pipefail
cd "$(dirname "$0")/.."
set -a
source .env
set +a

EXECUTOR="$1"
ACCOUNT="$2"
USDC=0x3600000000000000000000000000000000000000
ORACLE=0x2880aB155794e7179c9eE2e38200202908C17B43
HERMES_URL=https://hermes.pyth.network  # production Hermes — Arc testnet Pyth verifies against the real guardian set, see keeper/README.md
EUR_USD_ID=0xa995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b
DEPOSIT_AMOUNT=1000000    # 1.000000 USDC (6dp) — only needed for the ALLOW leg's real transfer
FORWARD_AMOUNT=100000     # 0.100000 USDC (6dp)
MAX_STALENESS=300         # seconds
EXPLORER=https://testnet.arcscan.app/tx

DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
RECIPIENT=$(cast wallet new --json | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['address'])")

echo "Deployer (flow owner): $DEPLOYER"
echo "CanalisExecutor:       $EXECUTOR"
echo "CanalisAccount:        $ACCOUNT"
echo "Pyth oracle:            $ORACLE"
echo "Throwaway recipient:   $RECIPIENT"
echo

# =============================================================================
# 1. Fetch a real signed EUR/USD update from Hermes and push it on-chain.
# =============================================================================
echo "=== fetching real EUR/USD update from Hermes ==="
UPDATE_HEX=$(curl -s "$HERMES_URL/v2/updates/price/latest?ids[]=$EUR_USD_ID" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('0x' + d['binary']['data'][0])")
echo "update data length: ${#UPDATE_HEX} hex chars"

FEE=$(cast call "$ORACLE" "getUpdateFee(bytes[])(uint256)" "[$UPDATE_HEX]" --rpc-url "$RPC_URL" | awk '{print $1}')
echo "getUpdateFee: $FEE (native gas token wei)"

echo "--- updatePriceFeeds ---"
TX_UPDATE=$(cast send "$ORACLE" "updatePriceFeeds(bytes[])" "[$UPDATE_HEX]" --value "$FEE" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "updatePriceFeeds: $EXPLORER/$TX_UPDATE"
echo

echo "=== reading the price back from the oracle itself ==="
PRICE_RAW=$(cast call "$ORACLE" "getPriceUnsafe(bytes32)(int64,uint64,int32,uint256)" "$EUR_USD_ID" --rpc-url "$RPC_URL")
PRICE=$(echo "$PRICE_RAW" | sed -n '1p' | awk '{print $1}')
EXPO=$(echo "$PRICE_RAW" | sed -n '3p' | awk '{print $1}')
PUBLISH_TIME=$(echo "$PRICE_RAW" | sed -n '4p' | awk '{print $1}')
REAL_PRICE_USD=$(python3 -c "print($PRICE * (10 ** $EXPO))")
echo "Real EUR/USD price read from the oracle: $REAL_PRICE_USD (raw price=$PRICE, expo=$EXPO, publishTime=$PUBLISH_TIME)"
echo

# 18-decimal fixed point thresholds bracketing the real price.
THRESHOLD_BLOCK=$(python3 -c "print(int(($REAL_PRICE_USD + 0.02) * 10**18))")
THRESHOLD_ALLOW=$(python3 -c "print(int(($REAL_PRICE_USD - 0.02) * 10**18))")
echo "BLOCK-leg threshold (priceAbove=true, above the real price so it fails): $THRESHOLD_BLOCK"
echo "ALLOW-leg threshold (priceAbove=true, below the real price so it passes): $THRESHOLD_ALLOW"
echo

# =============================================================================
# 2. BLOCK leg: threshold the current real price does NOT satisfy.
# =============================================================================
echo "=== registerFlow (BLOCK leg: priceAbove=true, threshold=$THRESHOLD_BLOCK) ==="
TX_REG_BLOCK=$(cast send "$EXECUTOR" \
  "registerFlow((address,(uint8,uint256,uint256,uint256,bool),(uint256,uint256,uint256,uint256,uint256,uint256,address[],address[],bytes32,uint256,bool,uint256)[],(uint8,address[],uint256[],uint256,uint256,uint256,address,address,uint256)[],bool,uint256))" \
  "($ACCOUNT,(3,0,0,0,false),[(0,0,0,0,0,0,[],[],$EUR_USD_ID,$THRESHOLD_BLOCK,true,$MAX_STALENESS)],[(1,[$RECIPIENT],[],$FORWARD_AMOUNT,0,0,0x0000000000000000000000000000000000000000,0x0000000000000000000000000000000000000000,0)],true,0)" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "registerFlow: $EXPLORER/$TX_REG_BLOCK"

FLOW_ID_BLOCK=$(cast receipt "$TX_REG_BLOCK" --rpc-url "$RPC_URL" --json | python3 -c "
import json, sys
r = json.load(sys.stdin)
executor = '$EXECUTOR'.lower()
for log in r['logs']:
    if log['address'].lower() == executor and len(log['topics']) >= 2:
        print(int(log['topics'][1], 16))
        break
")
echo "Registered flowId (BLOCK leg): $FLOW_ID_BLOCK"

echo "--- previewFlow (BLOCK leg) ---"
PREVIEW_BLOCK=$(cast call "$EXECUTOR" "previewFlow(uint256)(bool,string)" "$FLOW_ID_BLOCK" --from "$DEPLOYER" --rpc-url "$RPC_URL")
echo "$PREVIEW_BLOCK"

echo "--- executeFlow (BLOCK leg) — expect revert 'price condition not met' ---"
BLOCK_RESULT="FAIL"
set +e
BLOCK_OUTPUT=$(cast send "$EXECUTOR" "executeFlow(uint256)" "$FLOW_ID_BLOCK" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" 2>&1)
BLOCK_STATUS=$?
set -e
echo "$BLOCK_OUTPUT"
if [ "$BLOCK_STATUS" -ne 0 ] && echo "$BLOCK_OUTPUT" | grep -q "price condition not met"; then
  BLOCK_RESULT="PASS"
fi
echo "BLOCK leg: $BLOCK_RESULT"
echo

# =============================================================================
# 3. ALLOW leg: threshold the current real price DOES satisfy — fund the
#    account first so the real Forward transfer has something to move.
# =============================================================================
echo "--- approve + deposit USDC into CanalisAccount (ALLOW leg) ---"
cast send "$USDC" "approve(address,uint256)" "$ACCOUNT" "$DEPOSIT_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" > /dev/null
TX_DEPOSIT=$(cast send "$ACCOUNT" "deposit(uint256)" "$DEPOSIT_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "deposit: $EXPLORER/$TX_DEPOSIT"

echo "=== registerFlow (ALLOW leg: priceAbove=true, threshold=$THRESHOLD_ALLOW) ==="
TX_REG_ALLOW=$(cast send "$EXECUTOR" \
  "registerFlow((address,(uint8,uint256,uint256,uint256,bool),(uint256,uint256,uint256,uint256,uint256,uint256,address[],address[],bytes32,uint256,bool,uint256)[],(uint8,address[],uint256[],uint256,uint256,uint256,address,address,uint256)[],bool,uint256))" \
  "($ACCOUNT,(3,0,0,0,false),[(0,0,0,0,0,0,[],[],$EUR_USD_ID,$THRESHOLD_ALLOW,true,$MAX_STALENESS)],[(1,[$RECIPIENT],[],$FORWARD_AMOUNT,0,0,0x0000000000000000000000000000000000000000,0x0000000000000000000000000000000000000000,0)],true,0)" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "registerFlow: $EXPLORER/$TX_REG_ALLOW"

FLOW_ID_ALLOW=$(cast receipt "$TX_REG_ALLOW" --rpc-url "$RPC_URL" --json | python3 -c "
import json, sys
r = json.load(sys.stdin)
executor = '$EXECUTOR'.lower()
for log in r['logs']:
    if log['address'].lower() == executor and len(log['topics']) >= 2:
        print(int(log['topics'][1], 16))
        break
")
echo "Registered flowId (ALLOW leg): $FLOW_ID_ALLOW"

echo "--- previewFlow (ALLOW leg) ---"
PREVIEW_ALLOW=$(cast call "$EXECUTOR" "previewFlow(uint256)(bool,string)" "$FLOW_ID_ALLOW" --from "$DEPLOYER" --rpc-url "$RPC_URL")
echo "$PREVIEW_ALLOW"

echo "--- executeFlow (ALLOW leg) — expect success, funds move ---"
TX_EXEC_ALLOW=$(cast send "$EXECUTOR" "executeFlow(uint256)" "$FLOW_ID_ALLOW" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "executeFlow: $EXPLORER/$TX_EXEC_ALLOW"

RECIPIENT_USDC=$(cast call "$USDC" "balanceOf(address)(uint256)" "$RECIPIENT" --rpc-url "$RPC_URL" | awk '{print $1}')
echo "Recipient USDC balance after (6dp): $RECIPIENT_USDC (expected $FORWARD_AMOUNT)"

ALLOW_RESULT="FAIL"
if [ "$RECIPIENT_USDC" -eq "$FORWARD_AMOUNT" ]; then
  ALLOW_RESULT="PASS"
fi
echo "ALLOW leg: $ALLOW_RESULT"
echo

# =============================================================================
# Summary
# =============================================================================
echo "=================================================================="
echo "Real EUR/USD price read from the live Pyth oracle: $REAL_PRICE_USD"
echo "updatePriceFeeds tx:      $EXPLORER/$TX_UPDATE"
echo "BLOCK leg registerFlow:   $EXPLORER/$TX_REG_BLOCK ($BLOCK_RESULT)"
echo "ALLOW leg registerFlow:   $EXPLORER/$TX_REG_ALLOW"
echo "ALLOW leg executeFlow:    $EXPLORER/$TX_EXEC_ALLOW ($ALLOW_RESULT)"
echo "=================================================================="

if [ "$BLOCK_RESULT" = "PASS" ] && [ "$ALLOW_RESULT" = "PASS" ]; then
  echo "PASS: oracle price condition blocked at the real price, then allowed once the threshold matched it."
else
  echo "FAIL: block-then-allow proof did not behave as expected."
  exit 1
fi
