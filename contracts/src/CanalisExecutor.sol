// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FlowTypes} from "./libraries/FlowTypes.sol";
import {ICanalisExecutor} from "./interfaces/ICanalisExecutor.sol";

/// @title CanalisExecutor
/// @notice The single generic "money interpreter" for Canalis. Instead of
/// deploying a new contract per flow, every user's flow is stored here as
/// data and interpreted on execution. This keeps the system to one audited
/// contract, gas-efficient, and easy to extend with new action types.
///
/// STATUS: MVP skeleton. Trigger validation, condition evaluation, and the
/// actual USDC transfers in each action handler are stubbed with `TODO`s —
/// see docs/canalis-spec.md section 7 for the build checklist.
contract CanalisExecutor is ICanalisExecutor, ReentrancyGuard {
    /// @dev flowId => Flow definition.
    mapping(uint256 => FlowTypes.Flow) private _flows;
    uint256 private _nextFlowId;

    modifier flowExists(uint256 flowId) {
        require(_flows[flowId].owner != address(0), "CanalisExecutor: unknown flow");
        _;
    }

    /// @inheritdoc ICanalisExecutor
    function registerFlow(FlowTypes.Flow calldata flow) external returns (uint256 flowId) {
        require(flow.owner != address(0), "CanalisExecutor: owner required");

        flowId = _nextFlowId++;
        FlowTypes.Flow storage stored = _flows[flowId];

        stored.owner = flow.owner;
        stored.trigger = flow.trigger;
        stored.active = true;
        stored.lastExecutedAt = 0;

        for (uint256 i = 0; i < flow.conditions.length; i++) {
            stored.conditions.push(flow.conditions[i]);
        }
        for (uint256 i = 0; i < flow.actions.length; i++) {
            stored.actions.push(flow.actions[i]);
        }

        emit FlowRegistered(flowId, flow.owner);
    }

    /// @inheritdoc ICanalisExecutor
    function executeFlow(uint256 flowId) external nonReentrant flowExists(flowId) {
        FlowTypes.Flow storage flow = _flows[flowId];
        require(flow.active, "CanalisExecutor: flow inactive");

        _validateTrigger(flow);
        _evaluateConditions(flow);

        for (uint256 i = 0; i < flow.actions.length; i++) {
            _dispatchAction(flowId, i, flow.actions[i]);
        }

        flow.lastExecutedAt = block.timestamp;
        emit FlowExecuted(flowId, msg.sender, block.timestamp);
    }

    /// @inheritdoc ICanalisExecutor
    function getFlow(uint256 flowId) external view flowExists(flowId) returns (FlowTypes.Flow memory) {
        return _flows[flowId];
    }

    // ---------------------------------------------------------------------
    // Internal: trigger validation
    // ---------------------------------------------------------------------

    /// @dev Confirms the flow's trigger currently permits execution.
    /// TODO: implement per-TriggerType checks (OnReceive is event-driven from
    /// CanalisAccount, OnSchedule/OnThreshold are re-verified here when a
    /// keeper pokes the executor, Manual is always allowed to the owner).
    /// Explicitly reverts until implemented — must not silently pass, since
    /// that would let executeFlow "succeed" without ever checking the trigger.
    function _validateTrigger(FlowTypes.Flow storage flow) internal view {
        flow.trigger.kind; // silence unused-var warning until implemented
        revert("CanalisExecutor: trigger validation not yet implemented");
    }

    // ---------------------------------------------------------------------
    // Internal: condition evaluation
    // ---------------------------------------------------------------------

    /// @dev Evaluates every Condition as a logical AND before actions run.
    /// TODO: implement cap/cooldown/time-window/balance/allow-deny checks.
    /// Explicitly reverts whenever conditions are attached until implemented
    /// — must not silently pass, since that would let executeFlow "succeed"
    /// without ever enforcing the flow's guards. A flow with zero conditions
    /// has nothing to evaluate, so it falls through (still gated by
    /// _validateTrigger and the action handlers, which are also unimplemented).
    function _evaluateConditions(FlowTypes.Flow storage flow) internal view {
        if (flow.conditions.length > 0) {
            revert("CanalisExecutor: condition evaluation not yet implemented");
        }
    }

    // ---------------------------------------------------------------------
    // Internal: action dispatch
    // ---------------------------------------------------------------------

    /// @dev Routes a single action to its type-specific handler.
    function _dispatchAction(uint256 flowId, uint256 actionIndex, FlowTypes.Action storage action) internal {
        if (action.kind == FlowTypes.ActionType.Split) {
            _handleSplit(action);
        } else if (action.kind == FlowTypes.ActionType.Forward) {
            _handleForward(action);
        } else if (action.kind == FlowTypes.ActionType.Sweep) {
            _handleSweep(action);
        } else if (action.kind == FlowTypes.ActionType.LockRelease) {
            _handleLockRelease(action);
        } else {
            revert("CanalisExecutor: unknown action type");
        }

        emit ActionExecuted(flowId, actionIndex, action.kind);
    }

    /// TODO: pull USDC from the owning CanalisAccount and distribute it across
    /// action.recipients by action.amountsOrBps (basis points or fixed amounts).
    function _handleSplit(FlowTypes.Action storage /* action */ ) internal pure {
        revert("CanalisExecutor: Split not yet implemented");
    }

    /// TODO: transfer action.fixedAmount of USDC to action.recipients[0].
    function _handleForward(FlowTypes.Action storage /* action */ ) internal pure {
        revert("CanalisExecutor: Forward not yet implemented");
    }

    /// TODO: move balance above action.sweepThreshold to action.recipients[0].
    function _handleSweep(FlowTypes.Action storage /* action */ ) internal pure {
        revert("CanalisExecutor: Sweep not yet implemented");
    }

    /// TODO: lock funds until action.unlockTime, then release to recipients.
    function _handleLockRelease(FlowTypes.Action storage /* action */ ) internal pure {
        revert("CanalisExecutor: LockRelease not yet implemented");
    }
}
