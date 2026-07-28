// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CanalisExecutor} from "../src/CanalisExecutor.sol";
import {CanalisAccount} from "../src/CanalisAccount.sol";
import {CanalisAccountFactory} from "../src/CanalisAccountFactory.sol";
import {ICanalisExecutor} from "../src/interfaces/ICanalisExecutor.sol";
import {FlowTypes} from "../src/libraries/FlowTypes.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockTokenMessengerV2} from "./mocks/MockTokenMessengerV2.sol";

/// @dev Arc-native feature slice: the CCTP Bridge action (spec section 7.3
/// #3, fifth and final slice). CanalisExecutor calls a real CCTP V2
/// TokenMessengerV2; these unit tests mock that EXTERNAL contract the same
/// way MockERC20/MockPyth stand in for their real counterparts elsewhere —
/// the deployed feature calls the real TokenMessengerV2 on Arc testnet (see
/// script/Deploy.s.sol / script/prove-cctp-bridge.sh for the live proof).
contract CanalisExecutorBridgeTest is Test {
    CanalisExecutor internal executor;
    CanalisAccountFactory internal factory;
    MockERC20 internal usdc;
    MockTokenMessengerV2 internal tokenMessenger;

    address internal alice = address(0xA11CE);
    address internal aliceAccount;

    uint32 internal constant SEPOLIA_DOMAIN = 0;
    bytes32 internal constant RECIPIENT_BYTES32 = bytes32(uint256(uint160(address(0xB0B))));

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        tokenMessenger = new MockTokenMessengerV2();
        executor = new CanalisExecutor(makeAddr("swapPool"), makeAddr("oracle"), address(tokenMessenger));
        factory = new CanalisAccountFactory(address(usdc), address(executor));

        vm.prank(alice);
        aliceAccount = factory.createAccount();
    }

    function _fund(uint256 amount) internal {
        usdc.mint(alice, amount);
        vm.prank(alice);
        usdc.approve(aliceAccount, amount);
        vm.prank(alice);
        CanalisAccount(aliceAccount).deposit(amount);
    }

    function _bridgeFlow(uint256 amount, bytes32 mintRecipient, FlowTypes.Condition[] memory conditions)
        internal
        view
        returns (FlowTypes.Flow memory flow)
    {
        flow.owner = aliceAccount;
        flow.trigger = FlowTypes.Trigger({
            kind: FlowTypes.TriggerType.Manual,
            scheduleAt: 0,
            scheduleInterval: 0,
            thresholdAmount: 0,
            thresholdIsAbove: false
        });
        flow.conditions = conditions;

        FlowTypes.Action[] memory actions = new FlowTypes.Action[](1);
        actions[0] = FlowTypes.Action({
            kind: FlowTypes.ActionType.Bridge,
            recipients: new address[](0),
            amountsOrBps: new uint256[](0),
            fixedAmount: amount,
            sweepThreshold: 0,
            unlockTime: 0,
            tokenIn: address(0),
            tokenOut: address(0),
            minAmountOut: 0,
            destinationDomain: SEPOLIA_DOMAIN,
            mintRecipient: mintRecipient
        });
        flow.actions = actions;
    }

    function _noConditions() internal pure returns (FlowTypes.Condition[] memory) {
        return new FlowTypes.Condition[](0);
    }

    function _minBalanceCondition(uint256 minBalance) internal pure returns (FlowTypes.Condition[] memory arr) {
        arr = new FlowTypes.Condition[](1);
        arr[0] = FlowTypes.Condition({
            minAmount: 0,
            maxAmount: 0,
            cooldownSeconds: 0,
            windowStart: 0,
            windowEnd: 0,
            minBalance: minBalance,
            allowedRecipients: new address[](0),
            deniedRecipients: new address[](0),
            priceId: bytes32(0),
            priceThreshold: 0,
            priceAbove: false,
            maxStaleness: 0
        });
    }

    function _amountCapCondition(uint256 maxAmount) internal pure returns (FlowTypes.Condition[] memory arr) {
        arr = new FlowTypes.Condition[](1);
        arr[0] = FlowTypes.Condition({
            minAmount: 0,
            maxAmount: maxAmount,
            cooldownSeconds: 0,
            windowStart: 0,
            windowEnd: 0,
            minBalance: 0,
            allowedRecipients: new address[](0),
            deniedRecipients: new address[](0),
            priceId: bytes32(0),
            priceThreshold: 0,
            priceAbove: false,
            maxStaleness: 0
        });
    }

    function _register(FlowTypes.Flow memory flow) internal returns (uint256 flowId) {
        vm.prank(alice);
        flowId = executor.registerFlow(flow);
    }

    function _execute(uint256 flowId) internal {
        vm.prank(alice);
        executor.executeFlow(flowId);
    }

    // =========================================================================
    // Constructor
    // =========================================================================

    function test_Constructor_RevertsForZeroCctpTokenMessenger() public {
        vm.expectRevert("CanalisExecutor: cctpTokenMessenger required");
        new CanalisExecutor(makeAddr("swapPool"), makeAddr("oracle"), address(0));
    }

    // =========================================================================
    // Basic burn
    // =========================================================================

    function test_Bridge_CallsDepositForBurnWithCorrectArgs() public {
        _fund(1_000_000_000); // 1000 USDC
        uint256 amount = 100_000_000; // 100 USDC

        uint256 flowId = _register(_bridgeFlow(amount, RECIPIENT_BYTES32, _noConditions()));
        _execute(flowId);

        assertEq(tokenMessenger.callCount(), 1);
        (
            uint256 calledAmount,
            uint32 destinationDomain,
            bytes32 mintRecipient,
            address burnToken,
            bytes32 destinationCaller,
            uint256 maxFee,
            uint32 minFinalityThreshold
        ) = tokenMessenger.calls(0);

        assertEq(calledAmount, amount, "amount must match the action's fixedAmount");
        assertEq(destinationDomain, SEPOLIA_DOMAIN, "destinationDomain must match the action");
        assertEq(mintRecipient, RECIPIENT_BYTES32, "mintRecipient must match the action");
        assertEq(burnToken, address(usdc), "burnToken must be the account's USDC");
        assertEq(destinationCaller, bytes32(0), "standard transfer: destinationCaller must be bytes32(0)");
        assertEq(maxFee, 0, "standard transfer: maxFee must be 0 (Arc testnet minFee is 0)");
        assertEq(minFinalityThreshold, 2000, "standard transfer: minFinalityThreshold must be 2000");
    }

    function test_Bridge_DebitsAccountByExactlyTheBurnAmount() public {
        _fund(1_000_000_000);
        uint256 amount = 250_000_000;

        uint256 flowId = _register(_bridgeFlow(amount, RECIPIENT_BYTES32, _noConditions()));
        _execute(flowId);

        assertEq(CanalisAccount(aliceAccount).balance(), 1_000_000_000 - amount, "account should drop by exactly the burn amount");
    }

    function test_Bridge_ExecutorNeverEndsUpHoldingUsdc() public {
        _fund(1_000_000_000);
        uint256 amount = 100_000_000;

        uint256 flowId = _register(_bridgeFlow(amount, RECIPIENT_BYTES32, _noConditions()));
        _execute(flowId);

        assertEq(usdc.balanceOf(address(executor)), 0, "executor must not strand USDC (the mock pulls it via transferFrom, mirroring the real contract)");
        assertEq(usdc.balanceOf(address(tokenMessenger)), amount, "the (mock) TokenMessengerV2 should hold the burned USDC");
    }

    function test_Bridge_ApprovesTokenMessengerForExactlyTheAmount() public {
        _fund(1_000_000_000);
        uint256 amount = 100_000_000;

        uint256 flowId = _register(_bridgeFlow(amount, RECIPIENT_BYTES32, _noConditions()));
        _execute(flowId);

        // forceApprove sets, then the mock's transferFrom consumes the
        // allowance down via SafeERC20's internal accounting — down to 0
        // after a full pull, proving the executor approved exactly enough
        // (not an unlimited/max approval left dangling).
        assertEq(usdc.allowance(address(executor), address(tokenMessenger)), 0);
    }

    // =========================================================================
    // ActionExecuted event
    // =========================================================================

    function test_ActionExecuted_Bridge_EmitsMintRecipientMarkerAndRealAmount() public {
        _fund(1_000_000_000);
        uint256 amount = 100_000_000;

        uint256 flowId = _register(_bridgeFlow(amount, RECIPIENT_BYTES32, _noConditions()));

        vm.expectEmit(true, true, false, true, address(executor));
        emit ICanalisExecutor.ActionExecuted(flowId, 0, FlowTypes.ActionType.Bridge, address(0xB0B), amount);
        _execute(flowId);
    }

    // =========================================================================
    // Validation
    // =========================================================================

    function test_Bridge_RevertsOnZeroAmount() public {
        _fund(1_000_000_000);
        uint256 flowId = _register(_bridgeFlow(0, RECIPIENT_BYTES32, _noConditions()));

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: Bridge amount must be positive");
        executor.executeFlow(flowId);
    }

    function test_Bridge_RevertsOnZeroMintRecipient() public {
        _fund(1_000_000_000);
        uint256 flowId = _register(_bridgeFlow(100_000_000, bytes32(0), _noConditions()));

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: Bridge mintRecipient cannot be zero");
        executor.executeFlow(flowId);
    }

    function test_Bridge_RevertsWhenTokenMessengerReverts() public {
        _fund(1_000_000_000);
        tokenMessenger.setShouldRevert(true);
        uint256 flowId = _register(_bridgeFlow(100_000_000, RECIPIENT_BYTES32, _noConditions()));

        vm.prank(alice);
        vm.expectRevert("MockTokenMessengerV2: forced revert");
        executor.executeFlow(flowId);

        assertEq(CanalisAccount(aliceAccount).balance(), 1_000_000_000, "a reverted burn must move nothing");
    }

    // =========================================================================
    // Conditions still gate a Bridge action
    // =========================================================================

    function test_Bridge_GatedByMinBalanceCondition() public {
        _fund(300_000); // below the 500,000 floor below
        uint256 flowId = _register(_bridgeFlow(100_000, RECIPIENT_BYTES32, _minBalanceCondition(500_000)));

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: balance below minimum");
        executor.executeFlow(flowId);

        assertEq(tokenMessenger.callCount(), 0, "the condition must block the burn entirely");
    }

    function test_Bridge_PassesMinBalanceConditionWhenMet() public {
        _fund(1_000_000);
        uint256 flowId = _register(_bridgeFlow(100_000, RECIPIENT_BYTES32, _minBalanceCondition(500_000)));
        _execute(flowId);

        assertEq(tokenMessenger.callCount(), 1);
    }

    function test_Bridge_ContributesToAmountCapCondition() public {
        _fund(1_000_000_000);
        // Bridge burn of 100 USDC exceeds a 50 USDC cap.
        uint256 flowId = _register(_bridgeFlow(100_000_000, RECIPIENT_BYTES32, _amountCapCondition(50_000_000)));

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: amount exceeds cap");
        executor.executeFlow(flowId);
    }

    // =========================================================================
    // Pause still gates a Bridge action
    // =========================================================================

    function test_Bridge_BlockedWhilePaused() public {
        _fund(1_000_000_000);
        uint256 flowId = _register(_bridgeFlow(100_000_000, RECIPIENT_BYTES32, _noConditions()));

        vm.prank(alice);
        executor.setFlowActive(flowId, false);

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: flow inactive");
        executor.executeFlow(flowId);

        assertEq(tokenMessenger.callCount(), 0);
    }

    // =========================================================================
    // previewFlow parity
    // =========================================================================

    function test_PreviewFlow_MatchesExecuteFlow_ForBridge() public {
        _fund(300_000);
        uint256 flowId = _register(_bridgeFlow(100_000, RECIPIENT_BYTES32, _minBalanceCondition(500_000)));

        vm.prank(alice);
        (bool canRun, string memory reason) = executor.previewFlow(flowId);
        assertFalse(canRun);
        assertEq(reason, "CanalisExecutor: balance below minimum");

        vm.prank(alice);
        vm.expectRevert(bytes(reason));
        executor.executeFlow(flowId);
    }
}
