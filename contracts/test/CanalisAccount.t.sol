// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CanalisAccount} from "../src/CanalisAccount.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract CanalisAccountTest is Test {
    CanalisAccount internal account;
    MockERC20 internal usdc;

    address internal owner = address(0xA11CE);
    address internal executor = address(0xE7EC);
    address internal recipient = address(0xB0B);

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        account = new CanalisAccount(owner, address(usdc), executor);
    }

    function _fund(uint256 amount) internal {
        usdc.mint(owner, amount);
        vm.prank(owner);
        usdc.approve(address(account), amount);
        vm.prank(owner);
        account.deposit(amount);
    }

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    function test_Constructor_RevertsForZeroUsdc() public {
        vm.expectRevert("CanalisAccount: usdc required");
        new CanalisAccount(owner, address(0), executor);
    }

    function test_Constructor_RevertsForZeroExecutor() public {
        vm.expectRevert("CanalisAccount: executor required");
        new CanalisAccount(owner, address(usdc), address(0));
    }

    // ---------------------------------------------------------------------
    // executorTransfer — the onlyExecutor trust boundary
    // ---------------------------------------------------------------------

    function test_ExecutorTransfer_MovesFundsWhenCalledByExecutor() public {
        _fund(1_000_000); // 1.0 USDC at 6 decimals

        vm.prank(executor);
        account.executorTransfer(recipient, 400_000);

        assertEq(usdc.balanceOf(recipient), 400_000, "recipient should receive the transferred amount");
        assertEq(account.balance(), 600_000, "account should retain the remainder");
    }

    function test_ExecutorTransfer_RevertsForNonExecutor() public {
        _fund(1_000_000);

        vm.expectRevert("CanalisAccount: caller is not executor");
        account.executorTransfer(recipient, 400_000);
    }

    function test_ExecutorTransfer_RevertsForOwnerToo() public {
        // Even the account owner cannot call the executor-gated path
        // directly — money only moves via CanalisExecutor.
        _fund(1_000_000);

        vm.prank(owner);
        vm.expectRevert("CanalisAccount: caller is not executor");
        account.executorTransfer(recipient, 400_000);
    }

    function test_ExecutorTransfer_RevertsForZeroRecipient() public {
        _fund(1_000_000);

        vm.prank(executor);
        vm.expectRevert("CanalisAccount: zero recipient");
        account.executorTransfer(address(0), 400_000);
    }

    function test_ExecutorTransfer_RevertsForZeroAmount() public {
        _fund(1_000_000);

        vm.prank(executor);
        vm.expectRevert("CanalisAccount: zero amount");
        account.executorTransfer(recipient, 0);
    }

    function test_ExecutorTransfer_RevertsWhenExceedingBalance() public {
        _fund(500_000);

        vm.prank(executor);
        vm.expectRevert();
        account.executorTransfer(recipient, 500_001);
    }

    function testFuzz_ExecutorTransfer_NeverExceedsFundedBalance(uint256 fundAmount, uint256 transferAmount)
        public
    {
        fundAmount = bound(fundAmount, 1, 1_000_000_000_000); // up to 1,000,000 USDC (6dp)
        transferAmount = bound(transferAmount, 1, fundAmount);

        _fund(fundAmount);

        vm.prank(executor);
        account.executorTransfer(recipient, transferAmount);

        assertEq(usdc.balanceOf(recipient), transferAmount, "recipient balance should equal transferred amount");
        assertEq(account.balance(), fundAmount - transferAmount, "account balance should decrease accordingly");
        assertLe(transferAmount, fundAmount, "transfer must never exceed funded balance");
    }

    // ---------------------------------------------------------------------
    // setExecutor
    // ---------------------------------------------------------------------

    function test_SetExecutor_UpdatesExecutorWhenCalledByOwner() public {
        address newExecutor = address(0xBEEF);

        vm.prank(owner);
        account.setExecutor(newExecutor);

        assertEq(account.executor(), newExecutor, "executor should be updated");
    }

    function test_SetExecutor_RevertsForNonOwner() public {
        vm.expectRevert();
        account.setExecutor(address(0xBEEF));
    }

    function test_SetExecutor_RevertsForZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert("CanalisAccount: executor required");
        account.setExecutor(address(0));
    }

    // ---------------------------------------------------------------------
    // deposit / withdraw (existing behavior, kept covered)
    // ---------------------------------------------------------------------

    function test_Deposit_PullsFundsFromCaller() public {
        _fund(1_000_000);
        assertEq(account.balance(), 1_000_000, "account should hold the deposited amount");
    }

    function test_Withdraw_RevertsForNonOwner() public {
        _fund(1_000_000);
        vm.expectRevert();
        account.withdraw(recipient, 1_000_000);
    }
}
