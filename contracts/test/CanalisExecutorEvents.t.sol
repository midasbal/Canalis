// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {CanalisExecutor} from "../src/CanalisExecutor.sol";
import {CanalisAccount} from "../src/CanalisAccount.sol";
import {CanalisAccountFactory} from "../src/CanalisAccountFactory.sol";
import {FlowTypes} from "../src/libraries/FlowTypes.sol";
import {ICanalisExecutor} from "../src/interfaces/ICanalisExecutor.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @dev Engine-for-UI addendum, capability 2: `ActionExecuted` now carries
/// `recipient`/`amount` reflecting the REAL transfer each call performed —
/// so a run-log UI can show what actually happened without re-deriving it
/// from action definitions. See CanalisExecutor's per-handler docs for the
/// exact per-ActionType semantics this suite pins down.
contract CanalisExecutorEventsTest is Test {
    CanalisExecutor internal executor;
    CanalisAccountFactory internal factory;
    MockERC20 internal usdc;

    address internal alice = address(0xA11CE);
    address internal recipient1 = address(0xB0B);
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

    function _manualTrigger() internal pure returns (FlowTypes.Trigger memory) {
        return FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.Manual,
            scheduleAt: 0,
            scheduleInterval: 0,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
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
    // Forward
    // =======================================================================

    function test_ActionExecuted_Forward_EmitsRealRecipientAndAmount() public {
        _fund(1_000_000);

        FlowTypes.Flow memory flow;
        flow.owner = aliceAccount;
        flow.trigger = _manualTrigger();
        address[] memory recipients = new address[](1);
        recipients[0] = recipient1;
        FlowTypes.Action[] memory actions = new FlowTypes.Action[](1);
        actions[0] = FlowTypes.Action({
            kind: FlowTypes.ActionType.Forward,
            recipients: recipients,
            amountsOrBps: new uint256[](0),
            fixedAmount: 400_000,
            sweepThreshold: 0,
            unlockTime: 0,
            tokenIn: address(0),
            tokenOut: address(0),
            minAmountOut: 0
        });
        flow.actions = actions;
        uint256 flowId = _register(flow);

        vm.expectEmit(true, true, false, true, address(executor));
        emit ICanalisExecutor.ActionExecuted(flowId, 0, FlowTypes.ActionType.Forward, recipient1, 400_000);
        _execute(flowId);
    }

    // =======================================================================
    // Split — one event per non-zero leg
    // =======================================================================

    function test_ActionExecuted_Split_EmitsOnePerNonZeroRecipient() public {
        _fund(1_000_000);

        FlowTypes.Flow memory flow;
        flow.owner = aliceAccount;
        flow.trigger = _manualTrigger();
        address[] memory recipients = new address[](2);
        recipients[0] = recipient1;
        recipients[1] = recipient2;
        uint256[] memory bps = new uint256[](2);
        bps[0] = 7_000;
        bps[1] = 3_000;
        FlowTypes.Action[] memory actions = new FlowTypes.Action[](1);
        actions[0] = FlowTypes.Action({
            kind: FlowTypes.ActionType.Split,
            recipients: recipients,
            amountsOrBps: bps,
            fixedAmount: 1_000_000,
            sweepThreshold: 0,
            unlockTime: 0,
            tokenIn: address(0),
            tokenOut: address(0),
            minAmountOut: 0
        });
        flow.actions = actions;
        uint256 flowId = _register(flow);

        vm.recordLogs();
        _execute(flowId);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 matchCount = 0;
        bytes32 topic0 = keccak256("ActionExecuted(uint256,uint256,uint8,address,uint256)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == topic0) {
                matchCount++;
                (FlowTypes.ActionType kind, address recipient, uint256 amount) =
                    abi.decode(logs[i].data, (FlowTypes.ActionType, address, uint256));
                assertEq(uint8(kind), uint8(FlowTypes.ActionType.Split), "kind should be Split");
                if (recipient == recipient1) {
                    assertEq(amount, 700_000, "recipient1 should get exactly its 70% leg");
                } else if (recipient == recipient2) {
                    assertEq(amount, 300_000, "recipient2 should get exactly its 30% leg");
                } else {
                    fail();
                }
            }
        }
        assertEq(matchCount, 2, "Split with two non-zero legs should emit exactly two ActionExecuted events");
    }

    function test_ActionExecuted_Split_SkipsZeroShareRecipient() public {
        _fund(1_000_000);

        FlowTypes.Flow memory flow;
        flow.owner = aliceAccount;
        flow.trigger = _manualTrigger();
        address[] memory recipients = new address[](2);
        recipients[0] = recipient1;
        recipients[1] = recipient2;
        uint256[] memory bps = new uint256[](2);
        bps[0] = 10_000;
        bps[1] = 0; // zero share -> no transfer, no event
        FlowTypes.Action[] memory actions = new FlowTypes.Action[](1);
        actions[0] = FlowTypes.Action({
            kind: FlowTypes.ActionType.Split,
            recipients: recipients,
            amountsOrBps: bps,
            fixedAmount: 1_000_000,
            sweepThreshold: 0,
            unlockTime: 0,
            tokenIn: address(0),
            tokenOut: address(0),
            minAmountOut: 0
        });
        flow.actions = actions;
        uint256 flowId = _register(flow);

        vm.recordLogs();
        _execute(flowId);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32 topic0 = keccak256("ActionExecuted(uint256,uint256,uint8,address,uint256)");
        uint256 matchCount = 0;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == topic0) matchCount++;
        }
        assertEq(matchCount, 1, "the zero-bps recipient must not produce an ActionExecuted event");
    }

    // =======================================================================
    // Sweep — honest amount=0 on no-op, never a fake nonzero
    // =======================================================================

    function test_ActionExecuted_Sweep_EmitsRealAmountAboveThreshold() public {
        _fund(1_000_000);

        FlowTypes.Flow memory flow;
        flow.owner = aliceAccount;
        flow.trigger = _manualTrigger();
        address[] memory recipients = new address[](1);
        recipients[0] = recipient1;
        FlowTypes.Action[] memory actions = new FlowTypes.Action[](1);
        actions[0] = FlowTypes.Action({
            kind: FlowTypes.ActionType.Sweep,
            recipients: recipients,
            amountsOrBps: new uint256[](0),
            fixedAmount: 0,
            sweepThreshold: 200_000,
            unlockTime: 0,
            tokenIn: address(0),
            tokenOut: address(0),
            minAmountOut: 0
        });
        flow.actions = actions;
        uint256 flowId = _register(flow);

        vm.expectEmit(true, true, false, true, address(executor));
        emit ICanalisExecutor.ActionExecuted(flowId, 0, FlowTypes.ActionType.Sweep, recipient1, 800_000);
        _execute(flowId);
    }

    function test_ActionExecuted_Sweep_EmitsHonestZeroAmountBelowThreshold() public {
        _fund(100_000);

        FlowTypes.Flow memory flow;
        flow.owner = aliceAccount;
        flow.trigger = _manualTrigger();
        address[] memory recipients = new address[](1);
        recipients[0] = recipient1;
        FlowTypes.Action[] memory actions = new FlowTypes.Action[](1);
        actions[0] = FlowTypes.Action({
            kind: FlowTypes.ActionType.Sweep,
            recipients: recipients,
            amountsOrBps: new uint256[](0),
            fixedAmount: 0,
            sweepThreshold: 200_000, // above current balance -> no-op
            unlockTime: 0,
            tokenIn: address(0),
            tokenOut: address(0),
            minAmountOut: 0
        });
        flow.actions = actions;
        uint256 flowId = _register(flow);

        vm.expectEmit(true, true, false, true, address(executor));
        emit ICanalisExecutor.ActionExecuted(flowId, 0, FlowTypes.ActionType.Sweep, recipient1, 0);
        _execute(flowId);

        assertEq(usdc.balanceOf(recipient1), 0, "no real transfer should have happened");
    }

    // =======================================================================
    // LockRelease — recipient differs by phase
    // =======================================================================

    function test_ActionExecuted_LockRelease_LockPhaseEmitsExecutorAsRecipient() public {
        _fund(1_000_000);

        FlowTypes.Flow memory flow;
        flow.owner = aliceAccount;
        flow.trigger = _manualTrigger();
        address[] memory recipients = new address[](1);
        recipients[0] = recipient1;
        FlowTypes.Action[] memory actions = new FlowTypes.Action[](1);
        actions[0] = FlowTypes.Action({
            kind: FlowTypes.ActionType.LockRelease,
            recipients: recipients,
            amountsOrBps: new uint256[](0),
            fixedAmount: 400_000,
            sweepThreshold: 0,
            unlockTime: block.timestamp + 1000,
            tokenIn: address(0),
            tokenOut: address(0),
            minAmountOut: 0
        });
        flow.actions = actions;
        uint256 flowId = _register(flow);

        vm.expectEmit(true, true, false, true, address(executor));
        emit ICanalisExecutor.ActionExecuted(flowId, 0, FlowTypes.ActionType.LockRelease, address(executor), 400_000);
        _execute(flowId);
    }

    function test_ActionExecuted_LockRelease_ReleasePhaseEmitsRealRecipient() public {
        _fund(1_000_000);
        uint256 unlockAt = block.timestamp + 1000;

        FlowTypes.Flow memory flow;
        flow.owner = aliceAccount;
        flow.trigger = _manualTrigger();
        address[] memory recipients = new address[](1);
        recipients[0] = recipient1;
        FlowTypes.Action[] memory actions = new FlowTypes.Action[](1);
        actions[0] = FlowTypes.Action({
            kind: FlowTypes.ActionType.LockRelease,
            recipients: recipients,
            amountsOrBps: new uint256[](0),
            fixedAmount: 400_000,
            sweepThreshold: 0,
            unlockTime: unlockAt,
            tokenIn: address(0),
            tokenOut: address(0),
            minAmountOut: 0
        });
        flow.actions = actions;
        uint256 flowId = _register(flow);

        _execute(flowId); // locks
        vm.warp(unlockAt);

        vm.expectEmit(true, true, false, true, address(executor));
        emit ICanalisExecutor.ActionExecuted(flowId, 0, FlowTypes.ActionType.LockRelease, recipient1, 400_000);
        _execute(flowId); // releases
    }
}
