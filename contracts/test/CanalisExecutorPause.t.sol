// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CanalisExecutor} from "../src/CanalisExecutor.sol";
import {CanalisAccount} from "../src/CanalisAccount.sol";
import {CanalisAccountFactory} from "../src/CanalisAccountFactory.sol";
import {FlowTypes} from "../src/libraries/FlowTypes.sol";
import {ICanalisExecutor} from "../src/interfaces/ICanalisExecutor.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @dev Engine-for-UI addendum, capability 1: owner-only pause/cancel via
/// `setFlowActive`. `executeFlow` already checked `flow.active` first,
/// before any trigger-specific logic — this suite proves that check blocks
/// ALL four trigger types identically, that only the flow's owner may
/// toggle it, and that unpausing restores execution.
contract CanalisExecutorPauseTest is Test {
    CanalisExecutor internal executor;
    CanalisAccountFactory internal factory;
    MockERC20 internal usdc;

    address internal alice = address(0xA11CE);
    address internal recipient = address(0xB0B);
    address internal keeper = address(0xCAFE);
    address internal aliceAccount;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        executor = new CanalisExecutor(makeAddr("swapPool"));
        factory = new CanalisAccountFactory(address(usdc), address(executor));

        vm.prank(alice);
        aliceAccount = factory.createAccount();
    }

    function _fund(uint256 amount) internal {
        usdc.mint(alice, amount);
        vm.prank(alice);
        usdc.approve(aliceAccount, amount);
        vm.prank(alice);
        CanalisAccount(aliceAccount).deposit(amount);
    }

    function _forwardFlow(FlowTypes.Trigger memory trigger) internal view returns (FlowTypes.Flow memory flow) {
        flow.owner = aliceAccount;
        flow.trigger = trigger;

        address[] memory recipients = new address[](1);
        recipients[0] = recipient;

        FlowTypes.Action[] memory actions = new FlowTypes.Action[](1);
        actions[0] = FlowTypes.Action({
            kind: FlowTypes.ActionType.Forward,
            recipients: recipients,
            amountsOrBps: new uint256[](0),
            fixedAmount: 100_000,
            sweepThreshold: 0,
            unlockTime: 0,
            tokenIn: address(0),
            tokenOut: address(0),
            minAmountOut: 0
        });
        flow.actions = actions;
    }

    function _manualTrigger() internal pure returns (FlowTypes.Trigger memory) {
        return FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.Manual,
            scheduleAt: 0,
            scheduleInterval: 0,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
    }

    function _dueScheduleTrigger() internal view returns (FlowTypes.Trigger memory) {
        return FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.OnSchedule,
            scheduleAt: block.timestamp,
            scheduleInterval: 0,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
    }

    function _metThresholdTrigger(uint256 amount) internal pure returns (FlowTypes.Trigger memory) {
        return FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.OnThreshold,
            scheduleAt: 0,
            scheduleInterval: 0,
            thresholdAmount: amount,
            thresholdIsAbove: true
        });
    }

    function _receiveTrigger() internal pure returns (FlowTypes.Trigger memory) {
        return FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.OnReceive,
            scheduleAt: 0,
            scheduleInterval: 0,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
    }

    // =======================================================================
    // Pause blocks execution — every trigger type
    // =======================================================================

    function test_Pause_BlocksManualExecution() public {
        _fund(1_000_000);
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(_forwardFlow(_manualTrigger()));

        vm.prank(alice);
        executor.setFlowActive(flowId, false);

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: flow inactive");
        executor.executeFlow(flowId);
    }

    function test_Pause_BlocksOnScheduleExecution_EvenWhenDue() public {
        _fund(1_000_000);
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(_forwardFlow(_dueScheduleTrigger()));

        vm.prank(alice);
        executor.setFlowActive(flowId, false);

        vm.prank(keeper);
        vm.expectRevert("CanalisExecutor: flow inactive");
        executor.executeFlow(flowId);
    }

    function test_Pause_BlocksOnThresholdExecution_EvenWhenMet() public {
        _fund(1_000_000);
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(_forwardFlow(_metThresholdTrigger(500_000)));

        vm.prank(alice);
        executor.setFlowActive(flowId, false);

        vm.prank(keeper);
        vm.expectRevert("CanalisExecutor: flow inactive");
        executor.executeFlow(flowId);
    }

    function test_Pause_BlocksOnReceiveExecution_EvenWhenArmed() public {
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(_forwardFlow(_receiveTrigger()));
        _fund(1_000_000); // arms OnReceive

        vm.prank(alice);
        executor.setFlowActive(flowId, false);

        vm.prank(keeper);
        vm.expectRevert("CanalisExecutor: flow inactive");
        executor.executeFlow(flowId);
    }

    // =======================================================================
    // Unpause restores execution
    // =======================================================================

    function test_Unpause_RestoresExecution() public {
        _fund(1_000_000);
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(_forwardFlow(_manualTrigger()));

        vm.prank(alice);
        executor.setFlowActive(flowId, false);
        vm.prank(alice);
        executor.setFlowActive(flowId, true);

        vm.prank(alice);
        executor.executeFlow(flowId);

        assertEq(usdc.balanceOf(recipient), 100_000, "unpaused flow should execute normally");
    }

    // =======================================================================
    // Auth
    // =======================================================================

    function test_SetFlowActive_RevertsForNonOwner() public {
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(_forwardFlow(_manualTrigger()));

        vm.expectRevert("CanalisExecutor: caller is not flow owner");
        executor.setFlowActive(flowId, false);
    }

    function test_SetFlowActive_RevertsForUnknownFlow() public {
        vm.expectRevert("CanalisExecutor: unknown flow");
        executor.setFlowActive(999, false);
    }

    function test_SetFlowActive_EmitsFlowActiveSet() public {
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(_forwardFlow(_manualTrigger()));

        vm.expectEmit(true, false, false, true, address(executor));
        emit ICanalisExecutor.FlowActiveSet(flowId, false);
        vm.prank(alice);
        executor.setFlowActive(flowId, false);
    }

    function test_GetFlow_ReflectsActiveFlag() public {
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(_forwardFlow(_manualTrigger()));
        assertTrue(executor.getFlow(flowId).active, "should default active");

        vm.prank(alice);
        executor.setFlowActive(flowId, false);
        assertFalse(executor.getFlow(flowId).active, "should reflect the pause");
    }
}
