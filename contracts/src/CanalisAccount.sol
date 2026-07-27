// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title CanalisAccount
/// @notice A minimal per-user vault that custodies USDC and points at the
/// shared CanalisExecutor that is allowed to act on its behalf via the
/// user's registered flows. Kept intentionally small for the MVP — see
/// docs/canalis-spec.md section 4.2 for the eventual modular-smart-account
/// direction (ERC-4337/7579 + session keys for the keeper).
contract CanalisAccount is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    address public executor;

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event ExecutorUpdated(address indexed previousExecutor, address indexed newExecutor);

    constructor(address owner_, address usdc_, address executor_) Ownable(owner_) {
        require(usdc_ != address(0), "CanalisAccount: usdc required");
        usdc = IERC20(usdc_);
        executor = executor_;
    }

    /// @notice Pull `amount` USDC from the caller into this account.
    /// Caller must have approved this contract beforehand.
    function deposit(uint256 amount) external {
        require(amount > 0, "CanalisAccount: zero amount");
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Owner-only withdrawal of USDC out of the account.
    function withdraw(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "CanalisAccount: zero recipient");
        require(amount > 0, "CanalisAccount: zero amount");
        usdc.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    /// @notice Owner-only rotation of the executor this account trusts.
    /// TODO: once the executor calls into this account to move funds during
    /// flow execution, gate that call path to `executor` specifically.
    function setExecutor(address newExecutor) external onlyOwner {
        emit ExecutorUpdated(executor, newExecutor);
        executor = newExecutor;
    }

    function balance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}
