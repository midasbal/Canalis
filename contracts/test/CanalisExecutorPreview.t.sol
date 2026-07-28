// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CanalisExecutor} from "../src/CanalisExecutor.sol";
import {CanalisAccount} from "../src/CanalisAccount.sol";
import {CanalisAccountFactory} from "../src/CanalisAccountFactory.sol";
import {FlowTypes} from "../src/libraries/FlowTypes.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @dev Engine-for-UI addendum, capability 3: `previewFlow` is a
/// non-reverting dry-run sharing the exact same internal check path as
/// `executeFlow` (`_checkTrigger` / `_checkConditions`) — this suite
/// cross-checks previewFlow's (canRun, reason) against what a real
/// executeFlow call actually does, for every trigger type, for a failing
/// condition, and for a paused flow. If these ever diverge, that's a bug
/// in the shared-path refactor, not a test issue.
contract CanalisExecutorPreviewTest is Test {
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

    function _forwardFlow(FlowTypes.Trigger memory trigger, FlowTypes.Condition[] memory conditions)
        internal
        view
        returns (FlowTypes.Flow memory flow)
    {
        flow.owner = aliceAccount;
        flow.trigger = trigger;
        flow.conditions = conditions;

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

    function _noConditions() internal pure returns (FlowTypes.Condition[] memory) {
        return new FlowTypes.Condition[](0);
    }

    function _register(FlowTypes.Flow memory flow) internal returns (uint256 flowId) {
        vm.prank(alice);
        flowId = executor.registerFlow(flow);
    }

    // =======================================================================
    // OnSchedule
    // =======================================================================

    function test_Preview_OnSchedule_MatchesReality_NotDue() public {
        FlowTypes.Trigger memory trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.OnSchedule,
            scheduleAt: block.timestamp + 1000,
            scheduleInterval: 0,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
        uint256 flowId = _register(_forwardFlow(trigger, _noConditions()));

        (bool canRun, string memory reason) = executor.previewFlow(flowId);
        assertFalse(canRun);
        assertEq(reason, "CanalisExecutor: schedule not due");

        vm.prank(keeper);
        vm.expectRevert(bytes(reason));
        executor.executeFlow(flowId);
    }

    function test_Preview_OnSchedule_MatchesReality_Due() public {
        _fund(1_000_000);
        FlowTypes.Trigger memory trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.OnSchedule,
            scheduleAt: block.timestamp,
            scheduleInterval: 0,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
        uint256 flowId = _register(_forwardFlow(trigger, _noConditions()));

        (bool canRun, string memory reason) = executor.previewFlow(flowId);
        assertTrue(canRun);
        assertEq(reason, "");

        vm.prank(keeper);
        executor.executeFlow(flowId); // must not revert, confirming the preview was accurate
    }

    // =======================================================================
    // OnThreshold
    // =======================================================================

    function test_Preview_OnThreshold_MatchesReality_NotMet() public {
        _fund(100_000);
        FlowTypes.Trigger memory trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.OnThreshold,
            scheduleAt: 0,
            scheduleInterval: 0,
            thresholdAmount: 1_000_000,
            thresholdIsAbove: true
        });
        uint256 flowId = _register(_forwardFlow(trigger, _noConditions()));

        (bool canRun, string memory reason) = executor.previewFlow(flowId);
        assertFalse(canRun);
        assertEq(reason, "CanalisExecutor: threshold not met");

        vm.prank(keeper);
        vm.expectRevert(bytes(reason));
        executor.executeFlow(flowId);
    }

    function test_Preview_OnThreshold_MatchesReality_Met() public {
        _fund(1_000_000);
        FlowTypes.Trigger memory trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.OnThreshold,
            scheduleAt: 0,
            scheduleInterval: 0,
            thresholdAmount: 1_000_000,
            thresholdIsAbove: true
        });
        uint256 flowId = _register(_forwardFlow(trigger, _noConditions()));

        (bool canRun, string memory reason) = executor.previewFlow(flowId);
        assertTrue(canRun);
        assertEq(reason, "");

        vm.prank(keeper);
        executor.executeFlow(flowId);
    }

    // =======================================================================
    // OnReceive
    // =======================================================================

    function test_Preview_OnReceive_MatchesReality_NotArmed() public {
        FlowTypes.Trigger memory trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.OnReceive,
            scheduleAt: 0,
            scheduleInterval: 0,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
        uint256 flowId = _register(_forwardFlow(trigger, _noConditions()));

        (bool canRun, string memory reason) = executor.previewFlow(flowId);
        assertFalse(canRun);
        assertEq(reason, "CanalisExecutor: no new deposit to consume");

        vm.prank(keeper);
        vm.expectRevert(bytes(reason));
        executor.executeFlow(flowId);
    }

    function test_Preview_OnReceive_MatchesReality_Armed() public {
        FlowTypes.Trigger memory trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.OnReceive,
            scheduleAt: 0,
            scheduleInterval: 0,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
        uint256 flowId = _register(_forwardFlow(trigger, _noConditions()));
        _fund(1_000_000);

        (bool canRun, string memory reason) = executor.previewFlow(flowId);
        assertTrue(canRun);
        assertEq(reason, "");

        vm.prank(keeper);
        executor.executeFlow(flowId);
    }

    // =======================================================================
    // Manual — caller-dependent, exactly like executeFlow
    // =======================================================================

    function test_Preview_Manual_ReflectsCaller_Owner() public {
        _fund(1_000_000);
        FlowTypes.Trigger memory trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.Manual,
            scheduleAt: 0,
            scheduleInterval: 0,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
        uint256 flowId = _register(_forwardFlow(trigger, _noConditions()));

        vm.prank(alice);
        (bool canRun, string memory reason) = executor.previewFlow(flowId);
        assertTrue(canRun);
        assertEq(reason, "");
    }

    function test_Preview_Manual_ReflectsCaller_NonOwner() public {
        _fund(1_000_000);
        FlowTypes.Trigger memory trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.Manual,
            scheduleAt: 0,
            scheduleInterval: 0,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
        uint256 flowId = _register(_forwardFlow(trigger, _noConditions()));

        vm.prank(keeper);
        (bool canRun, string memory reason) = executor.previewFlow(flowId);
        assertFalse(canRun);
        assertEq(reason, "CanalisExecutor: caller is not flow owner");

        vm.prank(keeper);
        vm.expectRevert(bytes(reason));
        executor.executeFlow(flowId);
    }

    // =======================================================================
    // Conditions
    // =======================================================================

    function test_Preview_MatchesReality_FailingCondition() public {
        _fund(1_000_000);
        FlowTypes.Trigger memory trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.Manual,
            scheduleAt: 0,
            scheduleInterval: 0,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
        FlowTypes.Condition[] memory conditions = new FlowTypes.Condition[](1);
        conditions[0] = FlowTypes.Condition({
            minAmount: 0,
            maxAmount: 0,
            cooldownSeconds: 0,
            windowStart: 0,
            windowEnd: 0,
            minBalance: 5_000_000, // far above what's funded
            allowedRecipients: new address[](0),
            deniedRecipients: new address[](0)
        });
        uint256 flowId = _register(_forwardFlow(trigger, conditions));

        vm.prank(alice);
        (bool canRun, string memory reason) = executor.previewFlow(flowId);
        assertFalse(canRun);
        assertEq(reason, "CanalisExecutor: balance below minimum");

        vm.prank(alice);
        vm.expectRevert(bytes(reason));
        executor.executeFlow(flowId);
    }

    // =======================================================================
    // Paused flow
    // =======================================================================

    function test_Preview_MatchesReality_PausedFlow() public {
        _fund(1_000_000);
        FlowTypes.Trigger memory trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.Manual,
            scheduleAt: 0,
            scheduleInterval: 0,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
        uint256 flowId = _register(_forwardFlow(trigger, _noConditions()));

        vm.prank(alice);
        executor.setFlowActive(flowId, false);

        vm.prank(alice);
        (bool canRun, string memory reason) = executor.previewFlow(flowId);
        assertFalse(canRun);
        assertEq(reason, "CanalisExecutor: flow inactive");

        vm.prank(alice);
        vm.expectRevert(bytes(reason));
        executor.executeFlow(flowId);
    }

    // =======================================================================
    // Side-effect-free
    // =======================================================================

    function test_Preview_DoesNotMutateStateOrMoveFunds() public {
        _fund(1_000_000);
        FlowTypes.Trigger memory trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.Manual,
            scheduleAt: 0,
            scheduleInterval: 0,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
        uint256 flowId = _register(_forwardFlow(trigger, _noConditions()));

        vm.prank(alice);
        executor.previewFlow(flowId);
        vm.prank(alice);
        executor.previewFlow(flowId);
        vm.prank(alice);
        executor.previewFlow(flowId);

        assertEq(usdc.balanceOf(recipient), 0, "previewFlow must never move funds");
        assertEq(CanalisAccount(aliceAccount).balance(), 1_000_000, "previewFlow must never touch the account balance");
        assertEq(executor.getFlow(flowId).lastExecutedAt, 0, "previewFlow must never mutate flow state");
    }

    function test_Preview_RevertsForUnknownFlow() public {
        vm.expectRevert("CanalisExecutor: unknown flow");
        executor.previewFlow(999);
    }
}
