// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CanalisExecutor} from "../src/CanalisExecutor.sol";
import {CanalisAccount} from "../src/CanalisAccount.sol";

/// @notice Deploys CanalisExecutor and one CanalisAccount for the deployer.
/// Usage (Arc testnet):
///   forge script script/Deploy.s.sol:Deploy --rpc-url $RPC_URL \
///     --private-key $PRIVATE_KEY --broadcast
///
/// TODO: replace USDC_ADDRESS below with the confirmed Arc testnet USDC
/// address from https://docs.arc.io/arc/references/contract-addresses
contract Deploy is Script {
    address constant USDC_ADDRESS = 0x3600000000000000000000000000000000000000; // TODO: confirm

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        CanalisExecutor executor = new CanalisExecutor();
        CanalisAccount account = new CanalisAccount(deployer, USDC_ADDRESS, address(executor));

        vm.stopBroadcast();

        console.log("CanalisExecutor deployed at:", address(executor));
        console.log("CanalisAccount deployed at:", address(account));
    }
}
