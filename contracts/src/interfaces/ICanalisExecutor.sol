// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FlowTypes} from "../libraries/FlowTypes.sol";

/// @notice Interface for the single generic "flows as data" interpreter.
/// One executor instance serves every user/flow — flows are stored data,
/// not separate deployed contracts.
interface ICanalisExecutor {
    event FlowRegistered(uint256 indexed flowId, address indexed owner);
    event FlowExecuted(uint256 indexed flowId, address indexed triggeredBy, uint256 timestamp);
    event ActionExecuted(uint256 indexed flowId, uint256 indexed actionIndex, FlowTypes.ActionType kind);

    /// @notice Register a new flow, owned by the caller's CanalisAccount.
    /// @return flowId The id assigned to the newly stored flow.
    function registerFlow(FlowTypes.Flow calldata flow) external returns (uint256 flowId);

    /// @notice Validate the trigger, evaluate all conditions, then run every
    /// action atomically (all-or-nothing) in a single transaction.
    function executeFlow(uint256 flowId) external;

    /// @notice Read back a stored flow definition.
    function getFlow(uint256 flowId) external view returns (FlowTypes.Flow memory);
}
