// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CanalisExecutor} from "../src/CanalisExecutor.sol";
import {CanalisAccount} from "../src/CanalisAccount.sol";
import {CanalisAccountFactory} from "../src/CanalisAccountFactory.sol";
import {FlowTypes} from "../src/libraries/FlowTypes.sol";

/// @notice End-to-end, on-chain proof of the first vertical slice: deposit
/// USDC into the deployer's CanalisAccount, register a Manual + Forward
/// flow to a fresh throwaway recipient, run it, and assert the recipient's
/// USDC balance rose by exactly the forwarded amount.
///
/// KNOWN LIMITATION: `forge script` always executes this body once locally
/// (via revm) to determine what to broadcast, even with --skip-simulation.
/// Arc's real USDC calls a custom blocklist precompile at
/// 0x1800...0001 on every transfer that revm does not implement, so any
/// run of this script — dry-run or --broadcast — reverts locally before
/// ever reaching the network, even though the real Arc node handles that
/// precompile fine (confirmed via direct `cast call`). This script is kept
/// for reference/documentation of the intended logic; the actual proof was
/// run via script/prove-forward-flow.sh, which issues the same sequence of
/// calls directly through `cast send` against the live RPC endpoint,
/// bypassing local simulation entirely.
///
/// Reads CANALIS_EXECUTOR_ADDRESS / CANALIS_ACCOUNT_FACTORY_ADDRESS from
/// the environment (pass inline — not secrets, no need to persist them to
/// contracts/.env) plus RPC_URL / PRIVATE_KEY from contracts/.env.
///
/// Usage (Arc testnet):
///   CANALIS_EXECUTOR_ADDRESS=0x... CANALIS_ACCOUNT_FACTORY_ADDRESS=0x... \
///     forge script script/ProveForwardFlow.s.sol:ProveForwardFlow \
///     --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast
contract ProveForwardFlow is Script {
    /// Arc testnet USDC ERC-20 interface (system contract). 6 decimals —
    /// do not confuse with the native gas token, which is 18 decimals.
    address constant USDC_ADDRESS = 0x3600000000000000000000000000000000000000;

    uint256 constant DEPOSIT_AMOUNT = 1_000_000; // 1.000000 USDC (6dp)
    uint256 constant FORWARD_AMOUNT = 500_000; // 0.500000 USDC (6dp)

    function run() external {
        address executorAddr = vm.envAddress("CANALIS_EXECUTOR_ADDRESS");
        address factoryAddr = vm.envAddress("CANALIS_ACCOUNT_FACTORY_ADDRESS");
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        CanalisExecutor executor = CanalisExecutor(executorAddr);
        CanalisAccountFactory factory = CanalisAccountFactory(factoryAddr);
        IERC20 usdc = IERC20(USDC_ADDRESS);

        address accountAddr = factory.accountOf(deployer);
        require(accountAddr != address(0), "ProveForwardFlow: deployer has no CanalisAccount");
        CanalisAccount account = CanalisAccount(accountAddr);
        console.log("Deployer:", deployer);
        console.log("CanalisAccount:", accountAddr);

        address recipient = makeAddr("canalis-proof-recipient");
        console.log("Throwaway recipient:", recipient);

        uint256 recipientBalanceBefore = usdc.balanceOf(recipient);
        console.log("Recipient USDC balance BEFORE (6dp):", recipientBalanceBefore);

        FlowTypes.Flow memory flow;
        flow.owner = accountAddr;
        flow.trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.Manual,
            scheduleAt: 0,
            scheduleInterval: 0,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
        address[] memory recipients = new address[](1);
        recipients[0] = recipient;
        FlowTypes.Action[] memory actions = new FlowTypes.Action[](1);
        actions[0] = FlowTypes.Action({
            kind: FlowTypes.ActionType.Forward,
            recipients: recipients,
            amountsOrBps: new uint256[](0),
            fixedAmount: FORWARD_AMOUNT,
            sweepThreshold: 0,
            unlockTime: 0,
            tokenIn: address(0),
            tokenOut: address(0),
            minAmountOut: 0,
            destinationDomain: 0,
            mintRecipient: bytes32(0)
        });
        flow.actions = actions;

        vm.startBroadcast(deployerKey);

        usdc.approve(accountAddr, DEPOSIT_AMOUNT);
        account.deposit(DEPOSIT_AMOUNT);
        console.log("Deposited into CanalisAccount (6dp):", DEPOSIT_AMOUNT);

        uint256 flowId = executor.registerFlow(flow);
        console.log("Registered flowId:", flowId);

        executor.executeFlow(flowId);
        console.log("Executed flow.");

        vm.stopBroadcast();

        uint256 recipientBalanceAfter = usdc.balanceOf(recipient);
        console.log("Recipient USDC balance AFTER (6dp):", recipientBalanceAfter);

        uint256 delta = recipientBalanceAfter - recipientBalanceBefore;
        require(delta == FORWARD_AMOUNT, "ProveForwardFlow: recipient balance did not rise by exactly the forwarded amount");
        console.log("PASS: recipient balance rose by exactly the forwarded amount (6dp):", FORWARD_AMOUNT);
    }
}
