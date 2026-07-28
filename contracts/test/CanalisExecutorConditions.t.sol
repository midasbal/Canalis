// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {CanalisExecutor} from "../src/CanalisExecutor.sol";
import {CanalisAccount} from "../src/CanalisAccount.sol";
import {CanalisAccountFactory} from "../src/CanalisAccountFactory.sol";
import {FlowTypes} from "../src/libraries/FlowTypes.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @dev Slice 3: exercises every Condition guard field
/// (`_evaluateConditions` and its per-field helpers in CanalisExecutor.sol)
/// against a Manual + Forward flow — the same proven shape from slices 1-2,
/// now with conditions attached.
contract CanalisExecutorConditionsTest is Test {
    CanalisExecutor internal executor;
    CanalisAccountFactory internal factory;
    MockERC20 internal usdc;

    address internal alice = address(0xA11CE);
    address internal recipient = address(0xB0B);
    address internal recipient2 = address(0xC0C);
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

    /// @dev Manual-trigger, single-Forward-action flow to `recipient`, with
    /// `conditions` attached.
    function _forwardFlow(uint256 amount, FlowTypes.Condition[] memory conditions)
        internal
        view
        returns (FlowTypes.Flow memory flow)
    {
        return _forwardFlowTo(recipient, amount, conditions);
    }

    function _forwardFlowTo(address to, uint256 amount, FlowTypes.Condition[] memory conditions)
        internal
        view
        returns (FlowTypes.Flow memory flow)
    {
        flow.owner = aliceAccount;
        flow.trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.Manual,
            scheduleAt: 0,
            scheduleInterval: 0,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
        flow.conditions = conditions;

        address[] memory recipients = new address[](1);
        recipients[0] = to;

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

    function _emptyAddresses() internal pure returns (address[] memory) {
        return new address[](0);
    }

    /// @dev A Condition with only the given field(s) set, everything else
    /// at its "unset" sentinel (0 / empty array).
    function _condition(
        uint256 minAmount,
        uint256 maxAmount,
        uint256 cooldownSeconds,
        uint256 windowStart,
        uint256 windowEnd,
        uint256 minBalance,
        address[] memory allowedRecipients,
        address[] memory deniedRecipients
    ) internal pure returns (FlowTypes.Condition memory) {
        return FlowTypes.Condition({
            minAmount: minAmount,
            maxAmount: maxAmount,
            cooldownSeconds: cooldownSeconds,
            windowStart: windowStart,
            windowEnd: windowEnd,
            minBalance: minBalance,
            allowedRecipients: allowedRecipients,
            deniedRecipients: deniedRecipients
        });
    }

    function _one(FlowTypes.Condition memory c) internal pure returns (FlowTypes.Condition[] memory arr) {
        arr = new FlowTypes.Condition[](1);
        arr[0] = c;
    }

    function _register(FlowTypes.Flow memory flow) internal returns (uint256 flowId) {
        vm.prank(alice);
        flowId = executor.registerFlow(flow);
    }

    function _execute(uint256 flowId) internal {
        vm.prank(alice);
        executor.executeFlow(flowId);
    }

    // =======================================================================
    // 1. Balance floor (minBalance)
    // =======================================================================

    function test_BalanceFloor_PassesWhenBalanceAtOrAboveFloor() public {
        _fund(1_000_000);
        FlowTypes.Condition[] memory conditions =
            _one(_condition(0, 0, 0, 0, 0, 500_000, _emptyAddresses(), _emptyAddresses()));

        uint256 flowId = _register(_forwardFlow(100_000, conditions));
        _execute(flowId);

        assertEq(usdc.balanceOf(recipient), 100_000, "forward should have moved funds");
    }

    function test_BalanceFloor_RevertsWhenBalanceBelowFloor() public {
        _fund(300_000); // below the 500,000 floor
        FlowTypes.Condition[] memory conditions =
            _one(_condition(0, 0, 0, 0, 0, 500_000, _emptyAddresses(), _emptyAddresses()));

        uint256 flowId = _register(_forwardFlow(100_000, conditions));

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: balance below minimum");
        executor.executeFlow(flowId);
    }

    function testFuzz_BalanceFloor_PassesIffBalanceMeetsFloor(uint256 fundAmount, uint256 minBalance) public {
        fundAmount = bound(fundAmount, 1, 1_000_000_000_000);
        minBalance = bound(minBalance, 1, 1_000_000_000_000);
        _fund(fundAmount);

        FlowTypes.Condition[] memory conditions =
            _one(_condition(0, 0, 0, 0, 0, minBalance, _emptyAddresses(), _emptyAddresses()));
        // Forward 1 unit so the action itself never fails independently of the floor check.
        uint256 flowId = _register(_forwardFlow(1, conditions));

        if (fundAmount >= minBalance) {
            _execute(flowId);
            assertEq(usdc.balanceOf(recipient), 1, "forward should succeed when balance meets the floor");
        } else {
            vm.prank(alice);
            vm.expectRevert("CanalisExecutor: balance below minimum");
            executor.executeFlow(flowId);
        }
    }

    // =======================================================================
    // 2. Time window (windowStart / windowEnd)
    // =======================================================================

    function test_TimeWindow_PassesWithinClosedRange() public {
        vm.warp(1_000_000);
        _fund(1_000_000);
        FlowTypes.Condition[] memory conditions =
            _one(_condition(0, 0, 0, 999_000, 1_001_000, 0, _emptyAddresses(), _emptyAddresses()));

        uint256 flowId = _register(_forwardFlow(100_000, conditions));
        _execute(flowId);

        assertEq(usdc.balanceOf(recipient), 100_000);
    }

    function test_TimeWindow_RevertsBeforeWindowStart() public {
        vm.warp(1_000_000);
        _fund(1_000_000);
        FlowTypes.Condition[] memory conditions =
            _one(_condition(0, 0, 0, 1_500_000, 0, 0, _emptyAddresses(), _emptyAddresses()));

        uint256 flowId = _register(_forwardFlow(100_000, conditions));

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: before time window");
        executor.executeFlow(flowId);
    }

    function test_TimeWindow_RevertsAfterWindowEnd() public {
        vm.warp(1_000_000);
        _fund(1_000_000);
        FlowTypes.Condition[] memory conditions =
            _one(_condition(0, 0, 0, 0, 500_000, 0, _emptyAddresses(), _emptyAddresses()));

        uint256 flowId = _register(_forwardFlow(100_000, conditions));

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: after time window");
        executor.executeFlow(flowId);
    }

    function test_TimeWindow_OpenEndedStartOnly_PassesArbitrarilyFarInFuture() public {
        vm.warp(1_000_000);
        _fund(1_000_000);
        // Only windowStart set — no upper bound at all.
        FlowTypes.Condition[] memory conditions =
            _one(_condition(0, 0, 0, 500_000, 0, 0, _emptyAddresses(), _emptyAddresses()));

        uint256 flowId = _register(_forwardFlow(100_000, conditions));
        vm.warp(50_000_000); // far beyond windowStart, still valid since windowEnd is unset
        _execute(flowId);

        assertEq(usdc.balanceOf(recipient), 100_000);
    }

    function test_TimeWindow_OpenEndedEndOnly_PassesArbitrarilyFarInPast() public {
        vm.warp(1_000);
        _fund(1_000_000);
        // Only windowEnd set — no lower bound at all.
        FlowTypes.Condition[] memory conditions =
            _one(_condition(0, 0, 0, 0, 50_000_000, 0, _emptyAddresses(), _emptyAddresses()));

        uint256 flowId = _register(_forwardFlow(100_000, conditions));
        _execute(flowId); // block.timestamp (1000) is well before windowEnd, and windowStart is unset

        assertEq(usdc.balanceOf(recipient), 100_000);
    }

    // =======================================================================
    // 3. Cooldown (cooldownSeconds)
    // =======================================================================

    function test_Cooldown_FirstEverExecutionAlwaysPasses() public {
        vm.warp(1_000_000);
        _fund(1_000_000);
        FlowTypes.Condition[] memory conditions =
            _one(_condition(0, 0, 100, 0, 0, 0, _emptyAddresses(), _emptyAddresses()));

        uint256 flowId = _register(_forwardFlow(100_000, conditions));
        _execute(flowId); // lastExecutedAt starts at 0 -> no prior run to cool down from

        assertEq(usdc.balanceOf(recipient), 100_000);
    }

    function test_Cooldown_RevertsOnImmediateReRun() public {
        vm.warp(1_000_000);
        _fund(1_000_000);
        FlowTypes.Condition[] memory conditions =
            _one(_condition(0, 0, 100, 0, 0, 0, _emptyAddresses(), _emptyAddresses()));

        uint256 flowId = _register(_forwardFlow(100_000, conditions));
        _execute(flowId);

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: cooldown not elapsed");
        executor.executeFlow(flowId);
    }

    function test_Cooldown_PassesAfterElapsing() public {
        vm.warp(1_000_000);
        _fund(1_000_000);
        FlowTypes.Condition[] memory conditions =
            _one(_condition(0, 0, 100, 0, 0, 0, _emptyAddresses(), _emptyAddresses()));

        uint256 flowId = _register(_forwardFlow(100_000, conditions));
        _execute(flowId);

        vm.warp(block.timestamp + 100); // exactly the cooldown
        _execute(flowId);

        assertEq(usdc.balanceOf(recipient), 200_000, "both executions should have moved funds");
    }

    function testFuzz_Cooldown_RevertsIffElapsedTimeInsufficient(uint256 cooldownSeconds, uint256 elapsed) public {
        cooldownSeconds = bound(cooldownSeconds, 1, 365 days);
        elapsed = bound(elapsed, 0, 365 days);

        vm.warp(1_000_000);
        _fund(1_000_000);
        FlowTypes.Condition[] memory conditions =
            _one(_condition(0, 0, cooldownSeconds, 0, 0, 0, _emptyAddresses(), _emptyAddresses()));

        uint256 flowId = _register(_forwardFlow(1, conditions));
        _execute(flowId); // first run always passes

        vm.warp(block.timestamp + elapsed);

        if (elapsed >= cooldownSeconds) {
            _execute(flowId);
            assertEq(usdc.balanceOf(recipient), 2, "second run should succeed once cooldown has elapsed");
        } else {
            vm.prank(alice);
            vm.expectRevert("CanalisExecutor: cooldown not elapsed");
            executor.executeFlow(flowId);
        }
    }

    // =======================================================================
    // 4. Allow / deny recipients
    // =======================================================================

    function test_Allowlist_PassesWhenRecipientListed() public {
        _fund(1_000_000);
        address[] memory allowed = new address[](1);
        allowed[0] = recipient;
        FlowTypes.Condition[] memory conditions = _one(_condition(0, 0, 0, 0, 0, 0, allowed, _emptyAddresses()));

        uint256 flowId = _register(_forwardFlow(100_000, conditions));
        _execute(flowId);

        assertEq(usdc.balanceOf(recipient), 100_000);
    }

    function test_Allowlist_RevertsWhenRecipientNotListed() public {
        _fund(1_000_000);
        address[] memory allowed = new address[](1);
        allowed[0] = recipient2; // recipient (the actual Forward target) is not on this list
        FlowTypes.Condition[] memory conditions = _one(_condition(0, 0, 0, 0, 0, 0, allowed, _emptyAddresses()));

        uint256 flowId = _register(_forwardFlow(100_000, conditions));

        vm.prank(alice);
        vm.expectRevert(
            bytes(string.concat("CanalisExecutor: recipient not allowed: ", Strings.toHexString(recipient)))
        );
        executor.executeFlow(flowId);
    }

    function test_Denylist_PassesWhenRecipientNotListed() public {
        _fund(1_000_000);
        address[] memory denied = new address[](1);
        denied[0] = recipient2;
        FlowTypes.Condition[] memory conditions = _one(_condition(0, 0, 0, 0, 0, 0, _emptyAddresses(), denied));

        uint256 flowId = _register(_forwardFlow(100_000, conditions));
        _execute(flowId);

        assertEq(usdc.balanceOf(recipient), 100_000);
    }

    function test_Denylist_RevertsWhenRecipientListed() public {
        _fund(1_000_000);
        address[] memory denied = new address[](1);
        denied[0] = recipient;
        FlowTypes.Condition[] memory conditions = _one(_condition(0, 0, 0, 0, 0, 0, _emptyAddresses(), denied));

        uint256 flowId = _register(_forwardFlow(100_000, conditions));

        vm.prank(alice);
        vm.expectRevert(bytes(string.concat("CanalisExecutor: recipient denied: ", Strings.toHexString(recipient))));
        executor.executeFlow(flowId);
    }

    // =======================================================================
    // 5. Amount cap (minAmount / maxAmount)
    // =======================================================================

    function test_AmountCap_PassesAtOrBelowMax() public {
        _fund(1_000_000);
        FlowTypes.Condition[] memory conditions =
            _one(_condition(0, 500_000, 0, 0, 0, 0, _emptyAddresses(), _emptyAddresses()));

        uint256 flowId = _register(_forwardFlow(500_000, conditions)); // exactly at the cap
        _execute(flowId);

        assertEq(usdc.balanceOf(recipient), 500_000);
    }

    function test_AmountCap_RevertsAboveMax() public {
        _fund(1_000_000);
        FlowTypes.Condition[] memory conditions =
            _one(_condition(0, 500_000, 0, 0, 0, 0, _emptyAddresses(), _emptyAddresses()));

        uint256 flowId = _register(_forwardFlow(500_001, conditions));

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: amount exceeds cap");
        executor.executeFlow(flowId);
    }

    function test_AmountCap_PassesAtOrAboveMin() public {
        _fund(1_000_000);
        FlowTypes.Condition[] memory conditions =
            _one(_condition(200_000, 0, 0, 0, 0, 0, _emptyAddresses(), _emptyAddresses()));

        uint256 flowId = _register(_forwardFlow(200_000, conditions)); // exactly at the minimum
        _execute(flowId);

        assertEq(usdc.balanceOf(recipient), 200_000);
    }

    function test_AmountCap_RevertsBelowMin() public {
        _fund(1_000_000);
        FlowTypes.Condition[] memory conditions =
            _one(_condition(200_000, 0, 0, 0, 0, 0, _emptyAddresses(), _emptyAddresses()));

        uint256 flowId = _register(_forwardFlow(199_999, conditions));

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: amount below minimum");
        executor.executeFlow(flowId);
    }

    function testFuzz_AmountCap_PassesIffWithinMax(uint256 fundAmount, uint256 maxAmount, uint256 forwardAmount)
        public
    {
        maxAmount = bound(maxAmount, 1, 1_000_000_000_000);
        forwardAmount = bound(forwardAmount, 1, 1_000_000_000_000);
        fundAmount = bound(fundAmount, forwardAmount, 1_000_000_000_000 + forwardAmount); // always enough to cover the forward itself
        _fund(fundAmount);

        FlowTypes.Condition[] memory conditions =
            _one(_condition(0, maxAmount, 0, 0, 0, 0, _emptyAddresses(), _emptyAddresses()));
        uint256 flowId = _register(_forwardFlow(forwardAmount, conditions));

        if (forwardAmount <= maxAmount) {
            _execute(flowId);
            assertEq(usdc.balanceOf(recipient), forwardAmount, "forward should succeed within the cap");
        } else {
            vm.prank(alice);
            vm.expectRevert("CanalisExecutor: amount exceeds cap");
            executor.executeFlow(flowId);
        }
    }

    /// @dev Confirms the cap's Split contribution is `fixedAmount` (the
    /// split total), matching `_totalAmountMoved`'s documented definition.
    function test_AmountCap_AppliesToSplitTotal() public {
        _fund(1_000_000);

        address[] memory recipients = new address[](2);
        recipients[0] = recipient;
        recipients[1] = recipient2;
        uint256[] memory bps = new uint256[](2);
        bps[0] = 7_000;
        bps[1] = 3_000;

        FlowTypes.Flow memory flow;
        flow.owner = aliceAccount;
        flow.trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.Manual,
            scheduleAt: 0,
            scheduleInterval: 0,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
        flow.conditions = _one(_condition(0, 500_000, 0, 0, 0, 0, _emptyAddresses(), _emptyAddresses()));

        FlowTypes.Action[] memory actions = new FlowTypes.Action[](1);
        actions[0] = FlowTypes.Action({
            kind: FlowTypes.ActionType.Split,
            recipients: recipients,
            amountsOrBps: bps,
            fixedAmount: 1_000_000, // split total exceeds the 500,000 cap
            sweepThreshold: 0,
            unlockTime: 0,
            tokenIn: address(0),
            tokenOut: address(0),
            minAmountOut: 0
        });
        flow.actions = actions;

        uint256 flowId = _register(flow);

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: amount exceeds cap");
        executor.executeFlow(flowId);
    }

    /// @dev Confirms the cap's Sweep contribution is `balance - sweepThreshold`
    /// at evaluation time, matching `_totalAmountMoved`'s documented definition.
    function test_AmountCap_AppliesToSweepAmountAboveThreshold() public {
        _fund(1_000_000); // sweeping down to a 400,000 threshold would move 600,000

        FlowTypes.Flow memory flow;
        flow.owner = aliceAccount;
        flow.trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.Manual,
            scheduleAt: 0,
            scheduleInterval: 0,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
        flow.conditions = _one(_condition(0, 500_000, 0, 0, 0, 0, _emptyAddresses(), _emptyAddresses()));

        address[] memory recipients = new address[](1);
        recipients[0] = recipient;
        FlowTypes.Action[] memory actions = new FlowTypes.Action[](1);
        actions[0] = FlowTypes.Action({
            kind: FlowTypes.ActionType.Sweep,
            recipients: recipients,
            amountsOrBps: new uint256[](0),
            fixedAmount: 0,
            sweepThreshold: 400_000,
            unlockTime: 0,
            tokenIn: address(0),
            tokenOut: address(0),
            minAmountOut: 0
        });
        flow.actions = actions;

        uint256 flowId = _register(flow);

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: amount exceeds cap");
        executor.executeFlow(flowId);
    }

    // =======================================================================
    // Multi-condition composition
    // =======================================================================

    function test_MultiCondition_AllFieldsPassTogether() public {
        vm.warp(1_000_000);
        _fund(1_000_000);

        // One Condition entry with several fields set at once — all must hold together.
        FlowTypes.Condition[] memory conditions =
            _one(_condition(50_000, 500_000, 10, 999_000, 1_001_000, 200_000, _emptyAddresses(), _emptyAddresses()));

        uint256 flowId = _register(_forwardFlow(100_000, conditions));
        _execute(flowId);

        assertEq(usdc.balanceOf(recipient), 100_000);
    }

    function test_MultiCondition_TwoEntries_BothMustPass() public {
        vm.warp(1_000_000);
        _fund(1_000_000);

        FlowTypes.Condition[] memory conditions = new FlowTypes.Condition[](2);
        conditions[0] = _condition(0, 0, 0, 0, 0, 200_000, _emptyAddresses(), _emptyAddresses()); // balance floor
        conditions[1] = _condition(0, 500_000, 0, 0, 0, 0, _emptyAddresses(), _emptyAddresses()); // amount cap

        uint256 flowId = _register(_forwardFlow(100_000, conditions));
        _execute(flowId);

        assertEq(usdc.balanceOf(recipient), 100_000);
    }

    /// @dev The first entry's balance floor passes, but the second entry's
    /// amount cap fails — proves every entry is actually evaluated (not just
    /// the first) and the specific failing reason is surfaced.
    function test_MultiCondition_LaterEntryFailsRevertsWithItsReason() public {
        vm.warp(1_000_000);
        _fund(1_000_000);

        FlowTypes.Condition[] memory conditions = new FlowTypes.Condition[](2);
        conditions[0] = _condition(0, 0, 0, 0, 0, 200_000, _emptyAddresses(), _emptyAddresses()); // balance floor: passes
        conditions[1] = _condition(0, 50_000, 0, 0, 0, 0, _emptyAddresses(), _emptyAddresses()); // amount cap: fails

        uint256 flowId = _register(_forwardFlow(100_000, conditions));

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: amount exceeds cap");
        executor.executeFlow(flowId);
    }
}
