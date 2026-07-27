// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CanalisAccount} from "./CanalisAccount.sol";

/// @title CanalisAccountFactory
/// @notice Lets any wallet create its own CanalisAccount in a single
/// transaction — one account per owner, no manual per-user deployment.
/// Every account it creates trusts the same fixed `usdc`/`executor` pair.
contract CanalisAccountFactory {
    address public immutable usdc;
    address public immutable executor;

    /// @dev owner => their CanalisAccount, or address(0) if none yet.
    mapping(address => address) public accountOf;

    event AccountCreated(address indexed owner, address indexed account);

    constructor(address usdc_, address executor_) {
        require(usdc_ != address(0), "CanalisAccountFactory: usdc required");
        require(executor_ != address(0), "CanalisAccountFactory: executor required");
        usdc = usdc_;
        executor = executor_;
    }

    /// @notice Deploy a CanalisAccount owned by the caller. Reverts if the
    /// caller already has one — check `accountOf(msg.sender)` first.
    function createAccount() external returns (address account) {
        require(accountOf[msg.sender] == address(0), "CanalisAccountFactory: account exists");

        account = address(new CanalisAccount(msg.sender, usdc, executor));
        accountOf[msg.sender] = account;

        emit AccountCreated(msg.sender, account);
    }
}
