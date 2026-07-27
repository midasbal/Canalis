// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CanalisExecutor} from "../src/CanalisExecutor.sol";
import {CanalisAccountFactory} from "../src/CanalisAccountFactory.sol";

/// @notice Deploys CanalisExecutor + CanalisAccountFactory, then creates a
/// CanalisAccount for the deployer via the factory — no manual per-user
/// account deployment needed.
/// Usage (Arc testnet):
///   forge script script/Deploy.s.sol:Deploy --rpc-url $RPC_URL \
///     --private-key $PRIVATE_KEY --broadcast
contract Deploy is Script {
    /// Arc testnet USDC ERC-20 interface (system contract). 6 decimals —
    /// do not confuse with the native gas token, which is 18 decimals.
    address constant USDC_ADDRESS = 0x3600000000000000000000000000000000000000;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        CanalisExecutor executor = new CanalisExecutor();
        CanalisAccountFactory factory = new CanalisAccountFactory(USDC_ADDRESS, address(executor));
        address account = factory.createAccount();

        vm.stopBroadcast();

        console.log("Deployer:", deployer);
        console.log("CanalisExecutor deployed at:", address(executor));
        console.log("CanalisAccountFactory deployed at:", address(factory));
        console.log("Deployer's CanalisAccount created at:", account);
    }
}
