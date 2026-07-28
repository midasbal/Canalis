// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CanalisExecutor} from "../src/CanalisExecutor.sol";
import {CanalisAccount} from "../src/CanalisAccount.sol";
import {CanalisAccountFactory} from "../src/CanalisAccountFactory.sol";
import {FlowTypes} from "../src/libraries/FlowTypes.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @dev Engine-for-UI addendum, capability 4: `flowsOf(address owner)`
/// enumerates flow ids registered against a CanalisAccount — `owner` here
/// IS the CanalisAccount address (i.e. `flow.owner`), consistent with
/// every other use of "owner" in the Flow model, NOT the human EOA that
/// controls that account via Ownable.
contract CanalisExecutorEnumerationTest is Test {
    CanalisExecutor internal executor;
    CanalisAccountFactory internal factory;
    MockERC20 internal usdc;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B1);
    address internal recipient = address(0xC0C);
    address internal aliceAccount;
    address internal bobAccount;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        executor = new CanalisExecutor(makeAddr("swapPool"), makeAddr("oracle"));
        factory = new CanalisAccountFactory(address(usdc), address(executor));

        vm.prank(alice);
        aliceAccount = factory.createAccount();
        vm.prank(bob);
        bobAccount = factory.createAccount();
    }

    function _flow(address owner) internal view returns (FlowTypes.Flow memory flow) {
        flow.owner = owner;
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
            fixedAmount: 1,
            sweepThreshold: 0,
            unlockTime: 0,
            tokenIn: address(0),
            tokenOut: address(0),
            minAmountOut: 0
        });
        flow.actions = actions;
    }

    function test_FlowsOf_EmptyBeforeAnyRegistration() public view {
        assertEq(executor.flowsOf(aliceAccount).length, 0);
    }

    function test_FlowsOf_ReturnsExactlyTheOwnersFlowIds_InOrder() public {
        vm.prank(alice);
        uint256 id0 = executor.registerFlow(_flow(aliceAccount));
        vm.prank(alice);
        uint256 id1 = executor.registerFlow(_flow(aliceAccount));
        vm.prank(alice);
        uint256 id2 = executor.registerFlow(_flow(aliceAccount));

        uint256[] memory ids = executor.flowsOf(aliceAccount);
        assertEq(ids.length, 3, "should have exactly 3 flows");
        assertEq(ids[0], id0);
        assertEq(ids[1], id1);
        assertEq(ids[2], id2);
    }

    function test_FlowsOf_DoesNotMixDifferentOwners() public {
        vm.prank(alice);
        uint256 aliceFlow = executor.registerFlow(_flow(aliceAccount));
        vm.prank(bob);
        uint256 bobFlow1 = executor.registerFlow(_flow(bobAccount));
        vm.prank(bob);
        uint256 bobFlow2 = executor.registerFlow(_flow(bobAccount));

        uint256[] memory aliceIds = executor.flowsOf(aliceAccount);
        uint256[] memory bobIds = executor.flowsOf(bobAccount);

        assertEq(aliceIds.length, 1);
        assertEq(aliceIds[0], aliceFlow);

        assertEq(bobIds.length, 2);
        assertEq(bobIds[0], bobFlow1);
        assertEq(bobIds[1], bobFlow2);
    }

    function test_FlowsOf_UnknownOwnerReturnsEmpty() public view {
        assertEq(executor.flowsOf(address(0xDEAD)).length, 0);
    }

    /// @dev Pausing/cancelling a flow does not remove it from enumeration —
    /// it stays listed, just with `active == false` (checkable via
    /// getFlow), so a UI can still show a cancelled flow in the list.
    function test_FlowsOf_StillListsPausedFlows() public {
        vm.prank(alice);
        uint256 flowId = executor.registerFlow(_flow(aliceAccount));
        vm.prank(alice);
        executor.setFlowActive(flowId, false);

        uint256[] memory ids = executor.flowsOf(aliceAccount);
        assertEq(ids.length, 1);
        assertEq(ids[0], flowId);
        assertFalse(executor.getFlow(flowId).active);
    }
}
