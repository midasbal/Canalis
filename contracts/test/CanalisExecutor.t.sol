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
}
