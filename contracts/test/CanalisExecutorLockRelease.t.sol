// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CanalisExecutor} from "../src/CanalisExecutor.sol";
import {CanalisAccount} from "../src/CanalisAccount.sol";
import {CanalisAccountFactory} from "../src/CanalisAccountFactory.sol";
import {FlowTypes} from "../src/libraries/FlowTypes.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @dev Slice 4: the LockRelease action. Fund tracking decision — see
/// `_handleLockRelease` in CanalisExecutor.sol — is that locked funds move
/// out of the CanalisAccount into the executor's own custody at lock time,
/// so they can never be double-spent by another action/flow reading
/// `CanalisAccount.balance()`.
contract CanalisExecutorLockReleaseTest is Test {
    CanalisExecutor internal executor;
    CanalisAccountFactory internal factory;
    MockERC20 internal usdc;

    address internal alice = address(0xA11CE);
    address internal recipient = address(0xB0B);
    address internal aliceAccount;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        executor = new CanalisExecutor(makeAddr("swapPool"), makeAddr("oracle"), makeAddr("cctpTokenMessenger"));
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

    function _lockReleaseFlow(uint256 amount, uint256 unlockTime)
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
        recipients[0] = recipient;

        FlowTypes.Action[] memory actions = new FlowTypes.Action[](1);
        actions[0] = FlowTypes.Action({
            kind: FlowTypes.ActionType.LockRelease,
            recipients: recipients,
            amountsOrBps: new uint256[](0),
            fixedAmount: amount,
            sweepThreshold: 0,
            unlockTime: unlockTime,
            tokenIn: address(0),
            tokenOut: address(0),
            minAmountOut: 0,
            destinationDomain: 0,
            mintRecipient: bytes32(0)
        });
        flow.actions = actions;
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
    // Basic lock -> release lifecycle
    // =======================================================================

    function test_LockRelease_FirstCallLocksFundsIntoExecutor() public {
        _fund(1_000_000);
        uint256 flowId = _register(_lockReleaseFlow(400_000, block.timestamp + 1000));

        _execute(flowId);

        assertEq(usdc.balanceOf(address(executor)), 400_000, "locked funds should sit in the executor");
        assertEq(CanalisAccount(aliceAccount).balance(), 600_000, "account balance should drop by the locked amount");
        assertEq(usdc.balanceOf(recipient), 0, "recipient must not receive anything yet");
    }

    function test_LockRelease_RevertsBeforeReleaseTime() public {
        _fund(1_000_000);
        uint256 unlockAt = block.timestamp + 1000;
        uint256 flowId = _register(_lockReleaseFlow(400_000, unlockAt));

        _execute(flowId); // locks

        vm.warp(unlockAt - 1);
        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: still locked");
        executor.executeFlow(flowId);

        assertEq(usdc.balanceOf(recipient), 0, "still-locked call must not move funds");
    }

    function test_LockRelease_TransfersExactlyOnceAtOrAfterReleaseTime() public {
        _fund(1_000_000);
        uint256 unlockAt = block.timestamp + 1000;
        uint256 flowId = _register(_lockReleaseFlow(400_000, unlockAt));

        _execute(flowId); // locks

        vm.warp(unlockAt); // exactly at release time
        _execute(flowId); // releases

        assertEq(usdc.balanceOf(recipient), 400_000, "recipient should receive exactly the locked amount");
        assertEq(usdc.balanceOf(address(executor)), 0, "executor should hold nothing after release");
    }

    function test_LockRelease_NoDoubleRelease() public {
        _fund(1_000_000);
        uint256 unlockAt = block.timestamp + 1000;
        uint256 flowId = _register(_lockReleaseFlow(400_000, unlockAt));

        _execute(flowId); // locks
        vm.warp(unlockAt);
        _execute(flowId); // releases

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: already released");
        executor.executeFlow(flowId);

        assertEq(usdc.balanceOf(recipient), 400_000, "balance must not change on the blocked re-run");
    }

    // =======================================================================
    // Double-spend protection: locked funds are out of reach
    // =======================================================================

    function test_LockRelease_LockedFundsCannotBeSweptByAnotherFlow() public {
        _fund(1_000_000);
        uint256 lockFlowId = _register(_lockReleaseFlow(700_000, block.timestamp + 1000));
        _execute(lockFlowId); // locks 700k, leaving 300k in the account

        // A separate Sweep-everything flow on the SAME account can only
        // ever touch what's actually still in the account.
        FlowTypes.Flow memory sweepFlow;
        sweepFlow.owner = aliceAccount;
        sweepFlow.trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.Manual,
            scheduleAt: 0,
            scheduleInterval: 0,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
        address[] memory recipients = new address[](1);
        recipients[0] = address(0xD00D);
        FlowTypes.Action[] memory actions = new FlowTypes.Action[](1);
        actions[0] = FlowTypes.Action({
            kind: FlowTypes.ActionType.Sweep,
            recipients: recipients,
            amountsOrBps: new uint256[](0),
            fixedAmount: 0,
            sweepThreshold: 0,
            unlockTime: 0,
            tokenIn: address(0),
            tokenOut: address(0),
            minAmountOut: 0,
            destinationDomain: 0,
            mintRecipient: bytes32(0)
        });
        sweepFlow.actions = actions;
        uint256 sweepFlowId = _register(sweepFlow);
        _execute(sweepFlowId);

        assertEq(usdc.balanceOf(address(0xD00D)), 300_000, "sweep can only move the unlocked remainder");
        assertEq(usdc.balanceOf(address(executor)), 700_000, "locked funds remain untouched in the executor");
    }

    // =======================================================================
    // Input validation
    // =======================================================================

    function test_LockRelease_RevertsForZeroRecipient() public {
        _fund(1_000_000);
        FlowTypes.Flow memory flow = _lockReleaseFlow(400_000, block.timestamp + 1000);
        flow.actions[0].recipients[0] = address(0);
        uint256 flowId = _register(flow);

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: LockRelease recipient cannot be zero address");
        executor.executeFlow(flowId);
    }

    function test_LockRelease_RevertsForZeroAmount() public {
        _fund(1_000_000);
        uint256 flowId = _register(_lockReleaseFlow(0, block.timestamp + 1000));

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: LockRelease amount must be positive");
        executor.executeFlow(flowId);
    }

    function test_LockRelease_RevertsForZeroUnlockTime() public {
        _fund(1_000_000);
        uint256 flowId = _register(_lockReleaseFlow(400_000, 0));

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: LockRelease unlockTime required");
        executor.executeFlow(flowId);
    }

    // =======================================================================
    // Fuzz
    // =======================================================================

    function testFuzz_LockRelease_NeverReleasesBeforeUnlockTime(uint256 unlockDelay, uint256 warpDelay) public {
        unlockDelay = bound(unlockDelay, 1, 10_000_000);
        warpDelay = bound(warpDelay, 0, unlockDelay - 1); // strictly before unlock

        _fund(1_000_000);
        uint256 unlockAt = block.timestamp + unlockDelay;
        uint256 flowId = _register(_lockReleaseFlow(400_000, unlockAt));
        _execute(flowId); // locks

        vm.warp(block.timestamp + warpDelay);
        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: still locked");
        executor.executeFlow(flowId);

        assertEq(usdc.balanceOf(recipient), 0);
    }

    function testFuzz_LockRelease_AlwaysReleasesAtOrAfterUnlockTime(uint256 unlockDelay, uint256 extraWait) public {
        unlockDelay = bound(unlockDelay, 1, 10_000_000);
        extraWait = bound(extraWait, 0, 10_000_000);

        _fund(1_000_000);
        uint256 unlockAt = block.timestamp + unlockDelay;
        uint256 flowId = _register(_lockReleaseFlow(400_000, unlockAt));
        _execute(flowId); // locks

        vm.warp(unlockAt + extraWait);
        _execute(flowId); // releases

        assertEq(usdc.balanceOf(recipient), 400_000, "release must happen exactly once the unlock time is reached");
    }
}
