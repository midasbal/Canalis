// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CanalisExecutor} from "../src/CanalisExecutor.sol";
import {FlowTypes} from "../src/libraries/FlowTypes.sol";
import {ICanalisExecutor} from "../src/interfaces/ICanalisExecutor.sol";

contract CanalisExecutorTest is Test {
    CanalisExecutor internal executor;
    address internal owner = address(0xABCD);

    function setUp() public {
        executor = new CanalisExecutor();
    }

    function _manualFlow() internal pure returns (FlowTypes.Flow memory flow) {
        flow.owner = address(0xABCD);
        flow.trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.Manual,
            scheduleAt: 0,
            scheduleInterval: 0,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
        // conditions/actions left empty for this basic registration test.
    }

    function test_RegisterFlow_StoresFlowAndEmitsEvent() public {
        FlowTypes.Flow memory flow = _manualFlow();

        vm.expectEmit(true, true, false, true, address(executor));
        emit ICanalisExecutor.FlowRegistered(0, owner);

        uint256 flowId = executor.registerFlow(flow);

        assertEq(flowId, 0, "first flow should get id 0");

        FlowTypes.Flow memory stored = executor.getFlow(flowId);
        assertEq(stored.owner, owner, "owner should match");
        assertTrue(stored.active, "flow should be active on registration");
        assertEq(uint8(stored.trigger.kind), uint8(FlowTypes.TriggerType.Manual), "trigger kind should match");
    }

    function test_RegisterFlow_RevertsWithoutOwner() public {
        FlowTypes.Flow memory flow = _manualFlow();
        flow.owner = address(0);

        vm.expectRevert("CanalisExecutor: owner required");
        executor.registerFlow(flow);
    }

    function test_GetFlow_RevertsForUnknownId() public {
        vm.expectRevert("CanalisExecutor: unknown flow");
        executor.getFlow(999);
    }

    /// @dev Trigger validation is unimplemented (see CanalisExecutor
    /// _validateTrigger). executeFlow must revert rather than silently
    /// succeed, even for a flow with no conditions or actions — otherwise
    /// unfinished functionality would appear to work.
    function test_ExecuteFlow_RevertsBecauseTriggerValidationUnimplemented() public {
        FlowTypes.Flow memory flow = _manualFlow();
        uint256 flowId = executor.registerFlow(flow);

        vm.expectRevert("CanalisExecutor: trigger validation not yet implemented");
        executor.executeFlow(flowId);
    }
}
