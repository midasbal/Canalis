// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CanalisExecutor} from "../src/CanalisExecutor.sol";
import {CanalisAccount} from "../src/CanalisAccount.sol";
import {CanalisAccountFactory} from "../src/CanalisAccountFactory.sol";
import {FlowTypes} from "../src/libraries/FlowTypes.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @dev Slice 4: exercises the three keeper-driven, caller-agnostic
/// triggers — OnSchedule, OnThreshold, OnReceive — against a Forward
/// action. Manual trigger coverage lives in CanalisExecutor.t.sol.
contract CanalisExecutorTriggersTest is Test {
    CanalisExecutor internal executor;
    CanalisAccountFactory internal factory;
    MockERC20 internal usdc;

    address internal alice = address(0xA11CE);
    address internal recipient = address(0xB0B);
    address internal keeper = address(0xCAFE); // deliberately NOT alice/owner
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

    function _forwardFlow(FlowTypes.Trigger memory trigger, uint256 amount)
        internal
        view
        returns (FlowTypes.Flow memory flow)
    {
        flow.owner = aliceAccount;
        flow.trigger = trigger;

        address[] memory recipients = new address[](1);
        recipients[0] = recipient;

        FlowTypes.Action[] memory actions = new FlowTypes.Action[](1);
        actions[0] = FlowTypes.Action({
            kind: FlowTypes.ActionType.Forward,
            recipients: recipients,
            amountsOrBps: new uint256[](0),
            fixedAmount: amount,
            sweepThreshold: 0,
            unlockTime: 0,
            tokenIn: address(0),
            tokenOut: address(0),
            minAmountOut: 0
        });
        flow.actions = actions;
    }

    function _register(FlowTypes.Flow memory flow) internal returns (uint256 flowId) {
        vm.prank(alice);
        flowId = executor.registerFlow(flow);
    }

    // =======================================================================
    // OnSchedule
    // =======================================================================

    function test_OnSchedule_RevertsBeforeDue() public {
        _fund(1_000_000);
        FlowTypes.Trigger memory trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.OnSchedule,
            scheduleAt: block.timestamp + 1000,
            scheduleInterval: 0,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
        uint256 flowId = _register(_forwardFlow(trigger, 500_000));

        vm.prank(keeper);
        vm.expectRevert("CanalisExecutor: schedule not due");
        executor.executeFlow(flowId);

        assertEq(usdc.balanceOf(recipient), 0, "nothing should have moved");
    }

    function test_OnSchedule_RunsWhenDue_CallableByAnyone() public {
        _fund(1_000_000);
        FlowTypes.Trigger memory trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.OnSchedule,
            scheduleAt: block.timestamp,
            scheduleInterval: 0,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
        uint256 flowId = _register(_forwardFlow(trigger, 500_000));

        vm.prank(keeper);
        executor.executeFlow(flowId);

        assertEq(usdc.balanceOf(recipient), 500_000, "due schedule should execute for a non-owner keeper caller");
    }

    function test_OnSchedule_OneShot_NeverDueAgainAfterFiring() public {
        _fund(2_000_000);
        FlowTypes.Trigger memory trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.OnSchedule,
            scheduleAt: block.timestamp,
            scheduleInterval: 0, // one-shot
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
        uint256 flowId = _register(_forwardFlow(trigger, 500_000));

        vm.prank(keeper);
        executor.executeFlow(flowId);

        vm.warp(block.timestamp + 365 days);
        vm.prank(keeper);
        vm.expectRevert("CanalisExecutor: schedule not due");
        executor.executeFlow(flowId);

        assertEq(usdc.balanceOf(recipient), 500_000, "one-shot must not fire a second time, ever");
    }

    function test_OnSchedule_Interval_AdvancesToNextRunAt() public {
        _fund(3_000_000);
        uint256 start = 1_000_000;
        vm.warp(start);
        FlowTypes.Trigger memory trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.OnSchedule,
            scheduleAt: start,
            scheduleInterval: 100,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
        uint256 flowId = _register(_forwardFlow(trigger, 500_000));

        vm.prank(keeper);
        executor.executeFlow(flowId);
        assertEq(usdc.balanceOf(recipient), 500_000);

        // Immediately after: not due again (interval hasn't elapsed).
        vm.prank(keeper);
        vm.expectRevert("CanalisExecutor: schedule not due");
        executor.executeFlow(flowId);

        // Exactly at the next boundary: due again.
        vm.warp(start + 100);
        vm.prank(keeper);
        executor.executeFlow(flowId);
        assertEq(usdc.balanceOf(recipient), 1_000_000, "second run should have executed exactly at nextRunAt");
    }

    /// @dev Catch-up behavior: if far more time than one interval has
    /// elapsed since the last run (a keeper was offline, e.g.), the flow
    /// still only fires ONCE per call and lands on the next interval
    /// boundary strictly after "now" — not once-per-missed-period.
    function test_OnSchedule_CatchUp_FiresOnceAndLandsOnNextFutureBoundary() public {
        _fund(3_000_000);
        uint256 start = 1_000_000;
        vm.warp(start);
        FlowTypes.Trigger memory trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.OnSchedule,
            scheduleAt: start,
            scheduleInterval: 100,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
        uint256 flowId = _register(_forwardFlow(trigger, 500_000));

        // Jump forward by 10.5 intervals' worth of time before the keeper
        // ever calls in.
        vm.warp(start + 1050);
        vm.prank(keeper);
        executor.executeFlow(flowId);
        assertEq(usdc.balanceOf(recipient), 500_000, "must fire exactly once despite missed periods");

        // Immediately after, still not due (we landed on a boundary after
        // "now", not the boundary right after the original scheduleAt).
        vm.prank(keeper);
        vm.expectRevert("CanalisExecutor: schedule not due");
        executor.executeFlow(flowId);
    }

    function testFuzz_OnSchedule_DueIffTimestampReached(uint256 scheduleAt, uint256 warpTo) public {
        scheduleAt = bound(scheduleAt, 1, 10_000_000);
        warpTo = bound(warpTo, 1, 20_000_000);

        _fund(1_000_000);
        FlowTypes.Trigger memory trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.OnSchedule,
            scheduleAt: scheduleAt,
            scheduleInterval: 0,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
        uint256 flowId = _register(_forwardFlow(trigger, 500_000));

        vm.warp(warpTo);
        vm.prank(keeper);
        if (warpTo >= scheduleAt) {
            executor.executeFlow(flowId);
            assertEq(usdc.balanceOf(recipient), 500_000);
        } else {
            vm.expectRevert("CanalisExecutor: schedule not due");
            executor.executeFlow(flowId);
        }
    }

    function testFuzz_OnSchedule_IntervalAdvancesPastNow(uint256 interval, uint256 skipPeriods) public {
        interval = bound(interval, 1, 100_000);
        skipPeriods = bound(skipPeriods, 0, 50);

        _fund(1_000_000);
        uint256 start = 1_000_000;
        vm.warp(start);
        FlowTypes.Trigger memory trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.OnSchedule,
            scheduleAt: start,
            scheduleInterval: interval,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
        uint256 flowId = _register(_forwardFlow(trigger, 100_000));

        vm.warp(start + interval * skipPeriods);
        vm.prank(keeper);
        executor.executeFlow(flowId);

        FlowTypes.Flow memory stored = executor.getFlow(flowId);
        assertGt(stored.trigger.scheduleAt, block.timestamp, "next run must always land strictly after now");
        assertEq((stored.trigger.scheduleAt - start) % interval, 0, "next run must stay aligned to the schedule");
    }

    // =======================================================================
    // OnThreshold
    // =======================================================================

    function _thresholdTrigger(uint256 amount) internal pure returns (FlowTypes.Trigger memory) {
        return FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.OnThreshold,
            scheduleAt: 0,
            scheduleInterval: 0,
            thresholdAmount: amount,
            thresholdIsAbove: true
        });
    }

    function test_OnThreshold_RevertsAtRegistrationForBelowDirection() public {
        FlowTypes.Trigger memory trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.OnThreshold,
            scheduleAt: 0,
            scheduleInterval: 0,
            thresholdAmount: 1_000_000,
            thresholdIsAbove: false
        });
        FlowTypes.Flow memory flow = _forwardFlow(trigger, 100_000);

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: only at/above threshold supported");
        executor.registerFlow(flow);
    }

    function test_OnThreshold_RevertsWhenBalanceBelowThreshold() public {
        _fund(500_000);
        uint256 flowId = _register(_forwardFlow(_thresholdTrigger(1_000_000), 100_000));

        vm.prank(keeper);
        vm.expectRevert("CanalisExecutor: threshold not met");
        executor.executeFlow(flowId);
    }

    function test_OnThreshold_RunsAtOrAboveThreshold_CallableByAnyone() public {
        _fund(1_000_000);
        uint256 flowId = _register(_forwardFlow(_thresholdTrigger(1_000_000), 100_000));

        vm.prank(keeper);
        executor.executeFlow(flowId);

        assertEq(usdc.balanceOf(recipient), 100_000, "threshold met exactly (>=) should execute");
    }

    function testFuzz_OnThreshold_PassesIffBalanceAtOrAboveThreshold(uint256 fundAmount, uint256 threshold) public {
        fundAmount = bound(fundAmount, 0, 1_000_000_000_000);
        threshold = bound(threshold, 1, 1_000_000_000_000);

        if (fundAmount > 0) _fund(fundAmount);
        uint256 flowId = _register(_forwardFlow(_thresholdTrigger(threshold), 1));

        vm.prank(keeper);
        if (fundAmount >= threshold && fundAmount >= 1) {
            executor.executeFlow(flowId);
        } else {
            vm.expectRevert();
            executor.executeFlow(flowId);
        }
    }

    // =======================================================================
    // OnReceive
    // =======================================================================

    function _receiveTrigger() internal pure returns (FlowTypes.Trigger memory) {
        return FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.OnReceive,
            scheduleAt: 0,
            scheduleInterval: 0,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
    }

    function test_OnReceive_RevertsBeforeAnyDeposit() public {
        uint256 flowId = _register(_forwardFlow(_receiveTrigger(), 100_000));

        vm.prank(keeper);
        vm.expectRevert("CanalisExecutor: no new deposit to consume");
        executor.executeFlow(flowId);
    }

    function test_OnReceive_DepositMakesFlowRunnable_CallableByAnyone() public {
        uint256 flowId = _register(_forwardFlow(_receiveTrigger(), 100_000));

        _fund(1_000_000);

        vm.prank(keeper);
        executor.executeFlow(flowId);

        assertEq(usdc.balanceOf(recipient), 100_000, "deposit should have made the OnReceive flow runnable");
    }

    function test_OnReceive_RunningConsumesEligibility_NoDoubleFire() public {
        uint256 flowId = _register(_forwardFlow(_receiveTrigger(), 100_000));
        _fund(1_000_000);

        vm.prank(keeper);
        executor.executeFlow(flowId);

        vm.prank(keeper);
        vm.expectRevert("CanalisExecutor: no new deposit to consume");
        executor.executeFlow(flowId);

        assertEq(usdc.balanceOf(recipient), 100_000, "second call must not move funds again");
    }

    function test_OnReceive_SecondDeposit_MakesEligibleAgain() public {
        uint256 flowId = _register(_forwardFlow(_receiveTrigger(), 100_000));
        _fund(1_000_000);

        vm.prank(keeper);
        executor.executeFlow(flowId);

        _fund(1_000_000); // new deposit -> new eligibility
        vm.prank(keeper);
        executor.executeFlow(flowId);

        assertEq(usdc.balanceOf(recipient), 200_000, "a fresh deposit should re-arm the OnReceive flow");
    }

    function test_OnReceive_RegisteringAfterExistingDeposits_IsNotRetroactivelyEligible() public {
        // Deposits happen BEFORE the flow is even registered; a freshly
        // registered OnReceive flow must not treat prior deposits as new.
        _fund(1_000_000);
        uint256 flowId = _register(_forwardFlow(_receiveTrigger(), 100_000));

        vm.prank(keeper);
        vm.expectRevert("CanalisExecutor: no new deposit to consume");
        executor.executeFlow(flowId);
    }
}
