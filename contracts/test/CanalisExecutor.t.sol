// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CanalisExecutor} from "../src/CanalisExecutor.sol";
import {CanalisAccount} from "../src/CanalisAccount.sol";
import {CanalisAccountFactory} from "../src/CanalisAccountFactory.sol";
import {FlowTypes} from "../src/libraries/FlowTypes.sol";
import {ICanalisExecutor} from "../src/interfaces/ICanalisExecutor.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract CanalisExecutorTest is Test {
    CanalisExecutor internal executor;
    CanalisAccountFactory internal factory;
    MockERC20 internal usdc;

    address internal alice = address(0xA11CE);
    address internal recipient = address(0xB0B);
    address internal recipient2 = address(0xC0C);
    address internal aliceAccount;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        executor = new CanalisExecutor();
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

    /// @dev A Manual-trigger, single-Forward-action flow with zero
    /// conditions — the exact shape this vertical slice targets.
    function _manualForwardFlow(uint256 amount) internal view returns (FlowTypes.Flow memory flow) {
        flow.owner = aliceAccount;
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
            fixedAmount: amount,
            sweepThreshold: 0,
            unlockTime: 0
        });
        flow.actions = actions;
    }

    /// @dev A Manual-trigger, single-Split-action flow with zero
    /// conditions, splitting `total` across `recipients` by `bps`.
    function _manualSplitFlow(uint256 total, address[] memory recipients, uint256[] memory bps)
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

        FlowTypes.Action[] memory actions = new FlowTypes.Action[](1);
        actions[0] = FlowTypes.Action({
            kind: FlowTypes.ActionType.Split,
            recipients: recipients,
            amountsOrBps: bps,
            fixedAmount: total,
            sweepThreshold: 0,
            unlockTime: 0
        });
        flow.actions = actions;
    }

    /// @dev A Manual-trigger, single-Sweep-action flow with zero
    /// conditions: moves whatever is above `threshold` to `destination`.
    function _manualSweepFlow(uint256 threshold, address destination)
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

        address[] memory recipients = new address[](1);
        recipients[0] = destination;

        FlowTypes.Action[] memory actions = new FlowTypes.Action[](1);
        actions[0] = FlowTypes.Action({
            kind: FlowTypes.ActionType.Sweep,
            recipients: recipients,
            amountsOrBps: new uint256[](0),
            fixedAmount: 0,
            sweepThreshold: threshold,
            unlockTime: 0
        });
        flow.actions = actions;
    }

    /// @dev Same as `_manualSweepFlow` but with an empty recipients array,
    /// for testing the "no destination" revert path.
    function _manualSweepFlowNoRecipients(uint256 threshold) internal view returns (FlowTypes.Flow memory flow) {
        flow.owner = aliceAccount;
        flow.trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.Manual,
            scheduleAt: 0,
            scheduleInterval: 0,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });

        FlowTypes.Action[] memory actions = new FlowTypes.Action[](1);
        actions[0] = FlowTypes.Action({
            kind: FlowTypes.ActionType.Sweep,
            recipients: new address[](0),
            amountsOrBps: new uint256[](0),
            fixedAmount: 0,
            sweepThreshold: threshold,
            unlockTime: 0
        });
        flow.actions = actions;
    }

    // ---------------------------------------------------------------------
    // registerFlow
    // ---------------------------------------------------------------------

    function test_RegisterFlow_StoresFlowAndEmitsEvent() public {
        FlowTypes.Flow memory flow = _manualForwardFlow(1_000_000);

        vm.expectEmit(true, true, false, true, address(executor));
        emit ICanalisExecutor.FlowRegistered(0, aliceAccount);

        vm.prank(alice);
        uint256 flowId = executor.registerFlow(flow);

        assertEq(flowId, 0, "first flow should get id 0");

        FlowTypes.Flow memory stored = executor.getFlow(flowId);
        assertEq(stored.owner, aliceAccount, "owner should match");
        assertTrue(stored.active, "flow should be active on registration");
        assertEq(uint8(stored.trigger.kind), uint8(FlowTypes.TriggerType.Manual), "trigger kind should match");
    }

    function test_RegisterFlow_RevertsWithoutOwner() public {
        FlowTypes.Flow memory flow = _manualForwardFlow(1_000_000);
        flow.owner = address(0);

        vm.expectRevert("CanalisExecutor: owner required");
        executor.registerFlow(flow);
    }

    /// @dev The core access-control fix for this slice: registering a flow
    /// requires the caller to actually be the named CanalisAccount's owner
    /// — not an arbitrary address claiming ownership.
    function test_RegisterFlow_RevertsForNonOwnerCaller() public {
        FlowTypes.Flow memory flow = _manualForwardFlow(1_000_000);

        // Called without pranking as alice, so msg.sender is this test
        // contract, not alice — must be rejected.
        vm.expectRevert("CanalisExecutor: caller is not flow owner");
        executor.registerFlow(flow);
    }

    function test_GetFlow_RevertsForUnknownId() public {
        vm.expectRevert("CanalisExecutor: unknown flow");
        executor.getFlow(999);
    }

    // ---------------------------------------------------------------------
    // executeFlow — trigger validation
    // ---------------------------------------------------------------------

    /// @dev Every trigger type besides Manual must stay an explicit,
    /// honest revert in this slice.
    function test_ExecuteFlow_RevertsForUnimplementedTriggerType() public {
        FlowTypes.Flow memory flow = _manualForwardFlow(1_000_000);
        flow.trigger.kind = FlowTypes.TriggerType.OnSchedule;

        vm.prank(alice);
        uint256 flowId = executor.registerFlow(flow);

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: trigger validation not yet implemented");
        executor.executeFlow(flowId);
    }

    /// @dev Manual trigger is owner-only: a non-owner caller must be
    /// rejected even though the flow itself is valid and funded.
    function test_ExecuteFlow_RevertsForNonOwnerCaller() public {
        FlowTypes.Flow memory flow = _manualForwardFlow(1_000_000);

        vm.prank(alice);
        uint256 flowId = executor.registerFlow(flow);

        _fund(1_000_000);

        vm.expectRevert("CanalisExecutor: caller is not flow owner");
        executor.executeFlow(flowId);
    }

    // ---------------------------------------------------------------------
    // executeFlow — Manual + Forward happy path (the vertical slice)
    // ---------------------------------------------------------------------

    function test_ExecuteFlow_ManualForward_MovesRealUsdc() public {
        uint256 amount = 750_000; // 0.75 USDC at 6 decimals
        _fund(2_000_000);

        FlowTypes.Flow memory flow = _manualForwardFlow(amount);
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(flow);

        vm.prank(alice);
        executor.executeFlow(flowId);

        assertEq(usdc.balanceOf(recipient), amount, "recipient should receive the forwarded amount");
        assertEq(CanalisAccount(aliceAccount).balance(), 2_000_000 - amount, "account should be debited");

        FlowTypes.Flow memory stored = executor.getFlow(flowId);
        assertGt(stored.lastExecutedAt, 0, "lastExecutedAt should be updated");
    }

    function test_ExecuteFlow_ManualForward_RevertsWhenExceedingBalance() public {
        _fund(500_000);

        FlowTypes.Flow memory flow = _manualForwardFlow(500_001);
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(flow);

        vm.prank(alice);
        vm.expectRevert();
        executor.executeFlow(flowId);
    }

    function testFuzz_ExecuteFlow_ManualForward_NeverMovesMoreThanFunded(uint256 fundAmount, uint256 forwardAmount)
        public
    {
        fundAmount = bound(fundAmount, 1, 1_000_000_000_000); // up to 1,000,000 USDC (6dp)
        forwardAmount = bound(forwardAmount, 1, fundAmount);

        _fund(fundAmount);

        FlowTypes.Flow memory flow = _manualForwardFlow(forwardAmount);
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(flow);

        vm.prank(alice);
        executor.executeFlow(flowId);

        assertEq(usdc.balanceOf(recipient), forwardAmount, "recipient should receive exactly the forwarded amount");
        assertEq(
            CanalisAccount(aliceAccount).balance(),
            fundAmount - forwardAmount,
            "account balance should decrease accordingly"
        );
        assertLe(forwardAmount, fundAmount, "forward must never exceed funded balance");
    }

    // ---------------------------------------------------------------------
    // executeFlow — Manual + Split (slice 2)
    // ---------------------------------------------------------------------

    function test_ExecuteFlow_ManualSplit_UnevenDistribution() public {
        uint256 total = 1_000_000; // 1.0 USDC
        _fund(total);

        address[] memory recipients = new address[](2);
        recipients[0] = recipient;
        recipients[1] = recipient2;
        uint256[] memory bps = new uint256[](2);
        bps[0] = 7_000; // 70%
        bps[1] = 3_000; // 30%

        FlowTypes.Flow memory flow = _manualSplitFlow(total, recipients, bps);
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(flow);

        vm.prank(alice);
        executor.executeFlow(flowId);

        assertEq(usdc.balanceOf(recipient), 700_000, "recipient should get 70%");
        assertEq(usdc.balanceOf(recipient2), 300_000, "recipient2 should get 30%");
        assertEq(CanalisAccount(aliceAccount).balance(), 0, "account should be fully drained when bps sum to 10000");
    }

    function test_ExecuteFlow_ManualSplit_PartialBpsLeavesRemainderInAccount() public {
        uint256 total = 1_000_000; // 1.0 USDC
        _fund(total);

        address[] memory recipients = new address[](2);
        recipients[0] = recipient;
        recipients[1] = recipient2;
        uint256[] memory bps = new uint256[](2);
        bps[0] = 5_000; // 50%
        bps[1] = 2_000; // 20% — only 70% allocated, 30% (300000) should stay in the account

        FlowTypes.Flow memory flow = _manualSplitFlow(total, recipients, bps);
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(flow);

        vm.prank(alice);
        executor.executeFlow(flowId);

        assertEq(usdc.balanceOf(recipient), 500_000, "recipient should get 50%");
        assertEq(usdc.balanceOf(recipient2), 200_000, "recipient2 should get 20%");
        assertEq(CanalisAccount(aliceAccount).balance(), 300_000, "unallocated 30% should remain in the account");
    }

    function test_ExecuteFlow_ManualSplit_RevertsWhenBpsExceed10000() public {
        _fund(1_000_000);

        address[] memory recipients = new address[](2);
        recipients[0] = recipient;
        recipients[1] = recipient2;
        uint256[] memory bps = new uint256[](2);
        bps[0] = 6_000;
        bps[1] = 5_000; // sum = 11000 > 10000

        FlowTypes.Flow memory flow = _manualSplitFlow(1_000_000, recipients, bps);
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(flow);

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: Split basis points exceed 100%");
        executor.executeFlow(flowId);
    }

    function test_ExecuteFlow_ManualSplit_RevertsOnLengthMismatch() public {
        _fund(1_000_000);

        address[] memory recipients = new address[](2);
        recipients[0] = recipient;
        recipients[1] = recipient2;
        uint256[] memory bps = new uint256[](1);
        bps[0] = 10_000;

        FlowTypes.Flow memory flow = _manualSplitFlow(1_000_000, recipients, bps);
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(flow);

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: Split recipients/bps length mismatch");
        executor.executeFlow(flowId);
    }

    function test_ExecuteFlow_ManualSplit_RevertsOnZeroTotal() public {
        _fund(1_000_000);

        address[] memory recipients = new address[](1);
        recipients[0] = recipient;
        uint256[] memory bps = new uint256[](1);
        bps[0] = 10_000;

        FlowTypes.Flow memory flow = _manualSplitFlow(0, recipients, bps);
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(flow);

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: Split total must be positive");
        executor.executeFlow(flowId);
    }

    function test_ExecuteFlow_ManualSplit_RevertsOnZeroAddressRecipient() public {
        _fund(1_000_000);

        address[] memory recipients = new address[](1);
        recipients[0] = address(0);
        uint256[] memory bps = new uint256[](1);
        bps[0] = 10_000;

        FlowTypes.Flow memory flow = _manualSplitFlow(1_000_000, recipients, bps);
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(flow);

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: Split recipient cannot be zero address");
        executor.executeFlow(flowId);
    }

    function testFuzz_ExecuteFlow_ManualSplit_NeverDistributesMoreThanTotal(uint256 total, uint256 bps1, uint256 bps2)
        public
    {
        total = bound(total, 1, 1_000_000_000_000); // up to 1,000,000 USDC (6dp)
        bps1 = bound(bps1, 0, 10_000);
        bps2 = bound(bps2, 0, 10_000 - bps1); // ensures bps1 + bps2 <= 10000

        _fund(total);

        address[] memory recipients = new address[](2);
        recipients[0] = recipient;
        recipients[1] = recipient2;
        uint256[] memory bps = new uint256[](2);
        bps[0] = bps1;
        bps[1] = bps2;

        FlowTypes.Flow memory flow = _manualSplitFlow(total, recipients, bps);
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(flow);

        vm.prank(alice);
        executor.executeFlow(flowId);

        uint256 expectedShare1 = (total * bps1) / 10_000;
        uint256 expectedShare2 = (total * bps2) / 10_000;

        assertEq(usdc.balanceOf(recipient), expectedShare1, "recipient share should match bps1");
        assertEq(usdc.balanceOf(recipient2), expectedShare2, "recipient2 share should match bps2");
        assertLe(
            expectedShare1 + expectedShare2, total, "split must never distribute more than the total being split"
        );
        assertEq(
            CanalisAccount(aliceAccount).balance(),
            total - expectedShare1 - expectedShare2,
            "account should retain exactly the undistributed remainder"
        );
    }

    function testFuzz_ExecuteFlow_ManualSplit_RevertsWhenBpsSumExceeds10000(uint256 bps1, uint256 bps2) public {
        bps1 = bound(bps1, 1, 10_000); // >= 1 so that (10001 - bps1) is a valid lower bound below
        bps2 = bound(bps2, 10_001 - bps1, 10_000); // forces bps1 + bps2 > 10000, each still <= 10000

        _fund(1_000_000);

        address[] memory recipients = new address[](2);
        recipients[0] = recipient;
        recipients[1] = recipient2;
        uint256[] memory bps = new uint256[](2);
        bps[0] = bps1;
        bps[1] = bps2;

        FlowTypes.Flow memory flow = _manualSplitFlow(1_000_000, recipients, bps);
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(flow);

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: Split basis points exceed 100%");
        executor.executeFlow(flowId);
    }

    // ---------------------------------------------------------------------
    // executeFlow — Manual + Sweep (slice 2)
    // ---------------------------------------------------------------------

    function test_ExecuteFlow_ManualSweep_TransfersExactlyAboveThreshold() public {
        _fund(1_000_000); // 1.0 USDC
        uint256 threshold = 400_000; // 0.4 USDC

        FlowTypes.Flow memory flow = _manualSweepFlow(threshold, recipient);
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(flow);

        vm.prank(alice);
        executor.executeFlow(flowId);

        assertEq(usdc.balanceOf(recipient), 600_000, "recipient should get everything above the threshold");
        assertEq(CanalisAccount(aliceAccount).balance(), threshold, "account should retain exactly the threshold");
    }

    function test_ExecuteFlow_ManualSweep_NoOpAtThreshold() public {
        uint256 threshold = 1_000_000;
        _fund(threshold); // balance == threshold exactly

        FlowTypes.Flow memory flow = _manualSweepFlow(threshold, recipient);
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(flow);

        vm.prank(alice);
        executor.executeFlow(flowId);

        assertEq(usdc.balanceOf(recipient), 0, "nothing should move when balance == threshold");
        assertEq(CanalisAccount(aliceAccount).balance(), threshold, "account balance should be untouched");
    }

    function test_ExecuteFlow_ManualSweep_NoOpBelowThreshold() public {
        _fund(300_000); // below the threshold
        uint256 threshold = 1_000_000;

        FlowTypes.Flow memory flow = _manualSweepFlow(threshold, recipient);
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(flow);

        vm.prank(alice);
        executor.executeFlow(flowId); // must not revert, must not underflow, must not fake a transfer

        assertEq(usdc.balanceOf(recipient), 0, "nothing should move when balance is below the threshold");
        assertEq(CanalisAccount(aliceAccount).balance(), 300_000, "account balance should be untouched");
    }

    function test_ExecuteFlow_ManualSweep_RevertsOnZeroDestination() public {
        _fund(1_000_000);

        FlowTypes.Flow memory flow = _manualSweepFlow(400_000, address(0));
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(flow);

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: Sweep destination cannot be zero address");
        executor.executeFlow(flowId);
    }

    function test_ExecuteFlow_ManualSweep_RevertsWithNoRecipients() public {
        _fund(1_000_000);

        FlowTypes.Flow memory flow = _manualSweepFlowNoRecipients(400_000);
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(flow);

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: Sweep requires a destination");
        executor.executeFlow(flowId);
    }

    function testFuzz_ExecuteFlow_ManualSweep_NeverUnderflowsAndTransfersExactDelta(
        uint256 fundAmount,
        uint256 threshold
    ) public {
        fundAmount = bound(fundAmount, 0, 1_000_000_000_000); // up to 1,000,000 USDC (6dp); 0 is a valid balance
        threshold = bound(threshold, 0, 1_000_000_000_000);

        if (fundAmount > 0) {
            _fund(fundAmount);
        }

        FlowTypes.Flow memory flow = _manualSweepFlow(threshold, recipient);
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(flow);

        vm.prank(alice);
        executor.executeFlow(flowId); // must never revert/underflow regardless of balance vs. threshold

        uint256 expectedSwept = fundAmount > threshold ? fundAmount - threshold : 0;
        uint256 expectedRemaining = fundAmount - expectedSwept;

        assertEq(usdc.balanceOf(recipient), expectedSwept, "swept amount should equal balance minus threshold");
        assertEq(CanalisAccount(aliceAccount).balance(), expectedRemaining, "account should retain the rest");
    }
}
