#!/usr/bin/env bash
# Seeds CanalisSwapPool with initial USDC/EURC liquidity from the deployer
# (the pool's owner). Owner-gated addLiquidity, so this must run with the
# deployer's PRIVATE_KEY. Uses `cast send` directly against the live RPC
# (not `forge script`) — see CLAUDE.md's precompile gotcha.
#
# Requires contracts/.env with RPC_URL and PRIVATE_KEY (the pool owner /
# deployer). Assumes the deployer already holds USDC (real balance, not
# faucet-checked here) and EURC — if EURC balance is 0, claim some from
# https://faucet.circle.com first; this script stops with a clear message
# rather than silently seeding a lopsided or empty pool.
#
# Usage: ./script/seed-swap-pool.sh <POOL> <USDC_AMOUNT_6DP> <EURC_AMOUNT_6DP>
#   e.g. ./script/seed-swap-pool.sh 0xPOOL... 20000000 18000000   # 20 USDC / 18 EURC

set -euo pipefail
cd "$(dirname "$0")/.."
set -a
source .env
set +a

POOL="$1"
USDC_AMOUNT="${2:?usage: seed-swap-pool.sh <POOL> <USDC_AMOUNT_6DP> <EURC_AMOUNT_6DP>}"
EURC_AMOUNT="${3:?usage: seed-swap-pool.sh <POOL> <USDC_AMOUNT_6DP> <EURC_AMOUNT_6DP>}"
USDC=0x3600000000000000000000000000000000000000
EURC=0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a
EXPLORER=https://testnet.arcscan.app/tx

DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
echo "Pool:     $POOL"
echo "Deployer: $DEPLOYER"
echo

USDC_BAL=$(cast call "$USDC" "balanceOf(address)(uint256)" "$DEPLOYER" --rpc-url "$RPC_URL" | awk '{print $1}')
EURC_BAL=$(cast call "$EURC" "balanceOf(address)(uint256)" "$DEPLOYER" --rpc-url "$RPC_URL" | awk '{print $1}')
echo "Deployer USDC balance (6dp): $USDC_BAL"
echo "Deployer EURC balance (6dp): $EURC_BAL"
echo

if [ "$EURC_BAL" -eq 0 ]; then
  echo "STOP: deployer holds 0 EURC. Claim testnet EURC from https://faucet.circle.com first, then re-run this script."
  exit 1
fi
if [ "$USDC_BAL" -lt "$USDC_AMOUNT" ]; then
  echo "STOP: deployer USDC balance ($USDC_BAL) is below the requested seed amount ($USDC_AMOUNT). Claim more from https://faucet.circle.com."
  exit 1
fi
if [ "$EURC_BAL" -lt "$EURC_AMOUNT" ]; then
  echo "STOP: deployer EURC balance ($EURC_BAL) is below the requested seed amount ($EURC_AMOUNT). Claim more from https://faucet.circle.com."
  exit 1
fi

echo "--- approve USDC ---"
TX1=$(cast send "$USDC" "approve(address,uint256)" "$POOL" "$USDC_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "approve USDC: $EXPLORER/$TX1"

echo "--- approve EURC ---"
TX2=$(cast send "$EURC" "approve(address,uint256)" "$POOL" "$EURC_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "approve EURC: $EXPLORER/$TX2"

echo "--- addLiquidity($USDC_AMOUNT, $EURC_AMOUNT) ---"
TX3=$(cast send "$POOL" "addLiquidity(uint256,uint256)" "$USDC_AMOUNT" "$EURC_AMOUNT" \
  --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "addLiquidity: $EXPLORER/$TX3"

RESERVE_USDC=$(cast call "$POOL" "reserveUsdc()(uint256)" --rpc-url "$RPC_URL" | awk '{print $1}')
RESERVE_EURC=$(cast call "$POOL" "reserveEurc()(uint256)" --rpc-url "$RPC_URL" | awk '{print $1}')
echo
echo "Pool reserves now: $RESERVE_USDC USDC / $RESERVE_EURC EURC (6dp)"

if [ "$RESERVE_USDC" -eq "$USDC_AMOUNT" ] && [ "$RESERVE_EURC" -eq "$EURC_AMOUNT" ]; then
  echo "PASS: pool seeded with the exact requested liquidity."
else
  echo "FAIL: pool reserves do not match the requested seed amounts."
  exit 1
fi
