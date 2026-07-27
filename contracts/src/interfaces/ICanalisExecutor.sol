// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FlowTypes} from "../libraries/FlowTypes.sol";

/// @notice Interface for the single generic "flows as data" interpreter.
/// One executor instance serves every user/flow — flows are stored data,
/// not separate deployed contracts.
interface ICanalisExecutor {
    event FlowRegistered(uint256 indexed flowId, address indexed owner);
    event FlowExecuted(uint256 indexed flowId, address indexed triggeredBy, uint256 timestamp);
    /// @notice Fired once per real fund movement caused by an action.
    /// `recipient`/`amount` reflect what ACTUALLY moved in this specific
    /// call — see CanalisExecutor's per-handler docs for the exact
    /// semantics per ActionType (Split emits one event per non-zero leg;
    /// Sweep emits amount=0, no fake nonzero, when there was nothing to
    /// sweep; LockRelease's `recipient` is the executor itself while
    /// locking and the real recipient only once released).
    event ActionExecuted(
        uint256 indexed flowId, uint256 indexed actionIndex, FlowTypes.ActionType kind, address recipient, uint256 amount
    );
    event FlowActiveSet(uint256 indexed flowId, bool active);

    /// @notice Register a new flow against `flow.owner` (a CanalisAccount).
    /// Caller must be that account's owner.
    /// @return flowId The id assigned to the newly stored flow.
    function registerFlow(FlowTypes.Flow calldata flow) external returns (uint256 flowId);

    /// @notice Validate the trigger, evaluate all conditions, then run every
    /// action atomically (all-or-nothing) in a single transaction.
    function executeFlow(uint256 flowId) external;

    /// @notice Owner-only pause/unpause. A paused (`active == false`) flow
    /// makes `executeFlow` revert "flow inactive" regardless of trigger
    /// type — including keeper-driven ones, so a keeper just skips it
    /// cheaply rather than treating the pause as any kind of error.
    function setFlowActive(uint256 flowId, bool active) external;

    /// @notice Non-reverting dry-run of the exact same trigger + condition
    /// checks `executeFlow` uses — shares the identical internal check
    /// path, so this can never diverge from what a real `executeFlow` call
    /// would do. Performs no state mutation and no transfers. `canRun`
    /// reflects conditions as of the current block only — a "true" result
    /// can go stale by the time a real transaction lands (a schedule can
    /// pass its window, a balance can move, another caller can consume an
    /// OnReceive deposit first, etc.).
    /// @return canRun Whether `executeFlow(flowId)` would succeed right now.
    /// @return reason Empty when `canRun`; otherwise the exact revert
    /// reason `executeFlow` would produce.
    function previewFlow(uint256 flowId) external view returns (bool canRun, string memory reason);

    /// @notice All flow ids registered against `owner`, in registration
    /// order. `owner` here is a CanalisAccount address (i.e. `flow.owner`
    /// as stored/emitted elsewhere in this interface) — NOT the human EOA
    /// that owns that account. To go from a human wallet to this parameter,
    /// resolve their CanalisAccount first (e.g. via
    /// CanalisAccountFactory.accountOf).
    function flowsOf(address owner) external view returns (uint256[] memory);

    /// @notice Read back a stored flow definition.
    function getFlow(uint256 flowId) external view returns (FlowTypes.Flow memory);
}
