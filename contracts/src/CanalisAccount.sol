// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title CanalisAccount
/// @notice A minimal per-user vault that custodies USDC. `executor` is a
/// real trust boundary (see `onlyExecutor`/`executorTransfer`): the shared
/// CanalisExecutor is the only address allowed to move funds out of this
/// account on the owner's behalf while running the owner's registered
/// flows. Normally created via CanalisAccountFactory, one per owner. Kept
/// intentionally a plain vault for the MVP — see docs/canalis-spec.md
/// section 4.2 for the eventual modular-smart-account direction
/// (ERC-4337/7579 + session keys for the keeper).
contract CanalisAccount is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    address public executor;

    /// @notice Increments on every successful `deposit()`. This is the
    /// on-chain signal CanalisExecutor's OnReceive trigger checks against —
    /// see CanalisExecutor for the full mechanism.
    uint256 public depositNonce;

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event ExecutorTransferred(address indexed to, uint256 amount);
    event ExecutorUpdated(address indexed previousExecutor, address indexed newExecutor);

    /// @dev The real trust boundary flow execution relies on: only the
    /// configured executor may move funds via `executorTransfer`.
    modifier onlyExecutor() {
        require(msg.sender == executor, "CanalisAccount: caller is not executor");
        _;
    }

    constructor(address owner_, address usdc_, address executor_) Ownable(owner_) {
        require(usdc_ != address(0), "CanalisAccount: usdc required");
        require(executor_ != address(0), "CanalisAccount: executor required");
        usdc = IERC20(usdc_);
        executor = executor_;
    }

    /// @notice Pull `amount` USDC from the caller into this account.
    /// Caller must have approved this contract beforehand.
    function deposit(uint256 amount) external {
        require(amount > 0, "CanalisAccount: zero amount");
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        depositNonce++;
        emit Deposited(msg.sender, amount);
    }

    /// @notice Owner-only withdrawal of USDC out of the account.
    function withdraw(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "CanalisAccount: zero recipient");
        require(amount > 0, "CanalisAccount: zero amount");
        usdc.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    /// @notice Executor-gated fund movement — the trust boundary flow
    /// execution relies on to actually move USDC out of this account.
    /// Only the configured `executor` can call this; the owner cannot call
    /// it directly (they use `withdraw` instead), and no one else can.
    function executorTransfer(address to, uint256 amount) external onlyExecutor {
        require(to != address(0), "CanalisAccount: zero recipient");
        require(amount > 0, "CanalisAccount: zero amount");
        usdc.safeTransfer(to, amount);
        emit ExecutorTransferred(to, amount);
    }

    /// @notice Owner-only rotation of the executor this account trusts.
    function setExecutor(address newExecutor) external onlyOwner {
        require(newExecutor != address(0), "CanalisAccount: executor required");
        emit ExecutorUpdated(executor, newExecutor);
        executor = newExecutor;
    }

    function balance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}
