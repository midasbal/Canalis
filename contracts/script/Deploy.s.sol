// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CanalisExecutor} from "../src/CanalisExecutor.sol";
import {CanalisAccountFactory} from "../src/CanalisAccountFactory.sol";
import {CanalisSwapPool} from "../src/CanalisSwapPool.sol";

/// @notice Deploys CanalisSwapPool + CanalisExecutor + CanalisAccountFactory,
/// then creates a CanalisAccount for the deployer via the factory — no
/// manual per-user account deployment needed. The pool is deployed empty
/// (no liquidity) — seed it separately via script/seed-swap-pool.sh.
/// Usage (Arc testnet):
///   forge script script/Deploy.s.sol:Deploy --rpc-url $RPC_URL \
///     --private-key $PRIVATE_KEY --broadcast
contract Deploy is Script {
    /// Arc testnet USDC ERC-20 interface (system contract). 6 decimals —
    /// do not confuse with the native gas token, which is 18 decimals.
    address constant USDC_ADDRESS = 0x3600000000000000000000000000000000000000;
    /// Arc testnet EURC ERC-20 interface. 6 decimals.
    address constant EURC_ADDRESS = 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a;
    /// Pyth's IPyth contract on Arc testnet, confirmed live (has code) via
    /// `cast codesize` against the real RPC — see docs/canalis-spec.md
    /// section 7.3 #2. A proxy contract; do not swap for a guessed address.
    /// IMPORTANT: verifies updates against the real PRODUCTION Wormhole
    /// guardian set (confirmed on-chain) — price updates must come from
    /// hermes.pyth.network (production Hermes), NOT hermes-beta; see
    /// keeper/README.md "Oracle price updates".
    address constant PYTH_ORACLE_ADDRESS = 0x2880aB155794e7179c9eE2e38200202908C17B43;
    /// Circle CCTP V2 TokenMessengerV2 on Arc testnet (domain 26), confirmed
    /// live via `cast codesize` and confirmed correctly wired to Ethereum
    /// Sepolia (domain 0) via `remoteTokenMessengers(0)` — see
    /// docs/canalis-spec.md section 7.3 #3. Deployed via CREATE2 at the SAME
    /// address on every CCTP V2-supported chain, including Ethereum Sepolia.
    address constant CCTP_TOKEN_MESSENGER_ADDRESS = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        CanalisSwapPool pool = new CanalisSwapPool(deployer, USDC_ADDRESS, EURC_ADDRESS);
        CanalisExecutor executor =
            new CanalisExecutor(address(pool), PYTH_ORACLE_ADDRESS, CCTP_TOKEN_MESSENGER_ADDRESS);
        CanalisAccountFactory factory = new CanalisAccountFactory(USDC_ADDRESS, address(executor));
        address account = factory.createAccount();

        vm.stopBroadcast();

        console.log("Deployer:", deployer);
        console.log("CanalisSwapPool deployed at:", address(pool));
        console.log("Pyth oracle (existing, not deployed):", PYTH_ORACLE_ADDRESS);
        console.log("CCTP TokenMessengerV2 (existing, not deployed):", CCTP_TOKEN_MESSENGER_ADDRESS);
        console.log("CanalisExecutor deployed at:", address(executor));
        console.log("CanalisAccountFactory deployed at:", address(factory));
        console.log("Deployer's CanalisAccount created at:", account);
    }
}
