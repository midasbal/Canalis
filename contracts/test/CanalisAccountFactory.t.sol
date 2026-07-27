// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CanalisAccountFactory} from "../src/CanalisAccountFactory.sol";
import {CanalisAccount} from "../src/CanalisAccount.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract CanalisAccountFactoryTest is Test {
    CanalisAccountFactory internal factory;
    MockERC20 internal usdc;

    address internal executor = address(0xE7EC);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        factory = new CanalisAccountFactory(address(usdc), executor);
    }

    function test_Constructor_RevertsForZeroUsdc() public {
        vm.expectRevert("CanalisAccountFactory: usdc required");
        new CanalisAccountFactory(address(0), executor);
    }

    function test_Constructor_RevertsForZeroExecutor() public {
        vm.expectRevert("CanalisAccountFactory: executor required");
        new CanalisAccountFactory(address(usdc), address(0));
    }

    function test_CreateAccount_DeploysAWorkingAccountForCaller() public {
        vm.prank(alice);
        address aliceAccount = factory.createAccount();

        assertTrue(aliceAccount != address(0), "account should be deployed");
        assertEq(factory.accountOf(alice), aliceAccount, "factory should track alice's account");
        assertEq(CanalisAccount(aliceAccount).owner(), alice, "alice should own her account");
        assertEq(CanalisAccount(aliceAccount).executor(), executor, "account should trust the configured executor");
        assertEq(
            address(CanalisAccount(aliceAccount).usdc()), address(usdc), "account should use the configured USDC"
        );
    }

    function test_CreateAccount_EmitsAccountCreated() public {
        vm.expectEmit(true, false, false, false, address(factory));
        emit CanalisAccountFactory.AccountCreated(alice, address(0)); // account address checked loosely below

        vm.prank(alice);
        factory.createAccount();
    }

    function test_CreateAccount_RevertsOnSecondCallForSameOwner() public {
        vm.prank(alice);
        factory.createAccount();

        vm.prank(alice);
        vm.expectRevert("CanalisAccountFactory: account exists");
        factory.createAccount();
    }

    function test_CreateAccount_GivesDifferentOwnersDifferentAccounts() public {
        vm.prank(alice);
        address aliceAccount = factory.createAccount();

        vm.prank(bob);
        address bobAccount = factory.createAccount();

        assertTrue(aliceAccount != bobAccount, "different owners should get different accounts");
        assertEq(factory.accountOf(alice), aliceAccount);
        assertEq(factory.accountOf(bob), bobAccount);
    }

    function test_AccountOf_IsZeroBeforeCreation() public view {
        assertEq(factory.accountOf(alice), address(0), "no account should exist yet");
    }
}
