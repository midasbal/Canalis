// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FlowTypes} from "./libraries/FlowTypes.sol";
import {ICanalisExecutor} from "./interfaces/ICanalisExecutor.sol";
import {CanalisAccount} from "./CanalisAccount.sol";

/// @title CanalisExecutor
/// @notice The single generic "money interpreter" for Canalis. Instead of
/// deploying a new contract per flow, every user's flow is stored here as
/// data and interpreted on execution. This keeps the system to one audited
/// contract, gas-efficient, and easy to extend with new action types.
///
/// STATUS: first vertical slice. `flow.owner` is the CanalisAccount the flow
/// is registered against (see FlowTypes.Flow); the human authorized to
/// register/manually run a flow is that account's `owner()` (Ownable).
/// Only TriggerType.Manual and ActionType.Forward are implemented — every
/// other trigger/action explicitly reverts. See docs/canalis-spec.md
/// section 7 for the full build checklist.
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
        require(msg.sender == CanalisAccount(flow.owner).owner(), "CanalisExecutor: caller is not flow owner");

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
            _dispatchAction(flowId, i, flow.owner, flow.actions[i]);
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
    /// Manual is implemented: only the CanalisAccount owner (the human
    /// wallet, via Ownable) may fire it. Every other trigger type still
    /// explicitly reverts rather than silently passing — see the TODOs
    /// below for their intended (future) authorization model.
    function _validateTrigger(FlowTypes.Flow storage flow) internal view {
        if (flow.trigger.kind == FlowTypes.TriggerType.Manual) {
            require(msg.sender == CanalisAccount(flow.owner).owner(), "CanalisExecutor: caller is not flow owner");
            return;
        }

        // TODO: OnReceive — event-driven from CanalisAccount on inbound
        // transfer; not caller-gated the way Manual is.
        // TODO: OnSchedule / OnThreshold — caller-agnostic (a keeper may
        // call executeFlow on anyone's behalf), but re-verify the schedule
        // time / balance threshold on-chain right here before proceeding,
        // so an untrusted keeper can never fire the flow falsely.
        revert("CanalisExecutor: trigger validation not yet implemented");
    }

    // ---------------------------------------------------------------------
    // Internal: condition evaluation
    // ---------------------------------------------------------------------

    /// @dev Evaluates every Condition as a logical AND before actions run.
    /// TODO: implement cap/cooldown/time-window/balance/allow-deny checks.
    /// Explicitly reverts whenever conditions are attached until implemented
    /// — must not silently pass, since that would let executeFlow "succeed"
    /// without ever enforcing the flow's guards. This slice only targets
    /// flows with zero conditions, which fall through untouched.
    function _evaluateConditions(FlowTypes.Flow storage flow) internal view {
        if (flow.conditions.length > 0) {
            revert("CanalisExecutor: condition evaluation not yet implemented");
        }
    }

    // ---------------------------------------------------------------------
    // Internal: action dispatch
    // ---------------------------------------------------------------------

    /// @dev Routes a single action to its type-specific handler. `account`
    /// is the flow's CanalisAccount (flow.owner) — the vault a handler
    /// pulls funds from via its onlyExecutor-gated `executorTransfer`.
    function _dispatchAction(uint256 flowId, uint256 actionIndex, address account, FlowTypes.Action storage action)
        internal
    {
        if (action.kind == FlowTypes.ActionType.Split) {
            _handleSplit(account, action);
        } else if (action.kind == FlowTypes.ActionType.Forward) {
            _handleForward(account, action);
        } else if (action.kind == FlowTypes.ActionType.Sweep) {
            _handleSweep(account, action);
        } else if (action.kind == FlowTypes.ActionType.LockRelease) {
            _handleLockRelease(account, action);
        } else {
            revert("CanalisExecutor: unknown action type");
        }

        emit ActionExecuted(flowId, actionIndex, action.kind);
    }

    /// TODO: pull USDC from `account` and distribute it across
    /// action.recipients by action.amountsOrBps (basis points or fixed
    /// amounts). Not implemented in this slice.
    function _handleSplit(address, /* account */ FlowTypes.Action storage /* action */ ) internal pure {
        revert("CanalisExecutor: Split not yet implemented");
    }

    /// @dev Moves `action.fixedAmount` USDC from `account` to
    /// `action.recipients[0]`, via CanalisAccount's onlyExecutor-gated
    /// `executorTransfer`. This is the only action implemented in this
    /// slice.
    function _handleForward(address account, FlowTypes.Action storage action) internal {
        require(action.recipients.length == 1, "CanalisExecutor: Forward requires exactly one recipient");
        require(action.fixedAmount > 0, "CanalisExecutor: Forward amount must be positive");

        CanalisAccount(account).executorTransfer(action.recipients[0], action.fixedAmount);
    }

    /// TODO: move balance above action.sweepThreshold from `account` to
    /// action.recipients[0]. Not implemented in this slice.
    function _handleSweep(address, /* account */ FlowTypes.Action storage /* action */ ) internal pure {
        revert("CanalisExecutor: Sweep not yet implemented");
    }

    /// TODO: lock funds until action.unlockTime, then release from
    /// `account` to recipients. Not implemented in this slice.
    function _handleLockRelease(address, /* account */ FlowTypes.Action storage /* action */ ) internal pure {
        revert("CanalisExecutor: LockRelease not yet implemented");
    }
}
