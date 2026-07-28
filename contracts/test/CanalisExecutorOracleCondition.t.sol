// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CanalisExecutor} from "../src/CanalisExecutor.sol";
import {CanalisAccount} from "../src/CanalisAccount.sol";
import {CanalisAccountFactory} from "../src/CanalisAccountFactory.sol";
import {FlowTypes} from "../src/libraries/FlowTypes.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPyth} from "./mocks/MockPyth.sol";

/// @dev Arc-native feature slice: the oracle price condition (spec section
/// 7.3 #2). CanalisExecutor reads a real Pyth-shaped oracle; these unit
/// tests mock the EXTERNAL oracle contract (MockPyth) the same way
/// MockERC20 stands in for USDC/EURC elsewhere — the deployed feature reads
/// the real Pyth contract on Arc testnet (see script/Deploy.s.sol /
/// script/prove-oracle-condition.sh for the live proof).
contract CanalisExecutorOracleConditionTest is Test {
    CanalisExecutor internal executor;
    CanalisAccountFactory internal factory;
    MockERC20 internal usdc;
    MockPyth internal oracle;

    address internal alice = address(0xA11CE);
    address internal recipient = address(0xB0B);
    address internal aliceAccount;

    // A stand-in EUR/USD-shaped feed id (Pyth ids are opaque bytes32; unit
    // tests don't need the real one, only realistic expo behavior).
    bytes32 internal constant EUR_USD = keccak256("FX.EUR/USD");
    int32 internal constant EUR_USD_EXPO = -5; // matches the real Pyth FX feed's expo

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        oracle = new MockPyth();
        executor = new CanalisExecutor(makeAddr("swapPool"), address(oracle), makeAddr("cctpTokenMessenger"));
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

    function _forwardFlow(uint256 amount, FlowTypes.Condition[] memory conditions)
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

        address[] memory recipients = new address[](1);
        recipients[0] = recipient;

        FlowTypes.Action[] memory actions = new FlowTypes.Action[](1);
        actions[0] = FlowTypes.Action({
            kind: FlowTypes.ActionType.Forward,
            recipients: recipients,
            amountsOrBps: new uint256[](0),
            fixedAmount: amount,
            sweepThreshold: 0,
            unlockTime: 0,
            tokenIn: address(0),
            tokenOut: address(0),
            minAmountOut: 0,
            destinationDomain: 0,
            mintRecipient: bytes32(0)
        });
        flow.actions = actions;
    }

    function _priceCondition(bytes32 priceId, uint256 priceThreshold, bool priceAbove, uint256 maxStaleness)
        internal
        pure
        returns (FlowTypes.Condition memory)
    {
        return FlowTypes.Condition({
            minAmount: 0,
            maxAmount: 0,
            cooldownSeconds: 0,
            windowStart: 0,
            windowEnd: 0,
            minBalance: 0,
            allowedRecipients: new address[](0),
            deniedRecipients: new address[](0),
            priceId: priceId,
            priceThreshold: priceThreshold,
            priceAbove: priceAbove,
            maxStaleness: maxStaleness
        });
    }

    function _one(FlowTypes.Condition memory c) internal pure returns (FlowTypes.Condition[] memory arr) {
        arr = new FlowTypes.Condition[](1);
        arr[0] = c;
    }

    function _register(FlowTypes.Flow memory flow) internal returns (uint256 flowId) {
        vm.prank(alice);
        flowId = executor.registerFlow(flow);
    }

    // =========================================================================
    // Registration validation
    // =========================================================================

    function test_RegisterFlow_RevertsWhenPriceIdSetWithoutMaxStaleness() public {
        FlowTypes.Condition[] memory conditions = _one(_priceCondition(EUR_USD, 1e18, true, 0));
        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: maxStaleness required with priceId");
        executor.registerFlow(_forwardFlow(1_000_000, conditions));
    }

    function test_RegisterFlow_AllowsUnsetPriceCondition() public {
        FlowTypes.Condition[] memory conditions = _one(_priceCondition(bytes32(0), 0, false, 0));
        uint256 flowId = _register(_forwardFlow(1_000_000, conditions));
        assertTrue(executor.getFlow(flowId).active);
    }

    // =========================================================================
    // Below-threshold ("priceAbove = false")
    // =========================================================================

    function test_Below_PassesWhenPriceAtOrBelowThreshold() public {
        _fund(1_000_000);
        oracle.setPrice(EUR_USD, 108_000, 10, EUR_USD_EXPO, block.timestamp); // 1.08000
        FlowTypes.Condition[] memory conditions = _one(_priceCondition(EUR_USD, 1.08e18, false, 300));
        uint256 flowId = _register(_forwardFlow(1_000_000, conditions));

        vm.prank(alice);
        executor.executeFlow(flowId);
        assertEq(usdc.balanceOf(recipient), 1_000_000);
    }

    function test_Below_FailsWhenPriceAboveThreshold() public {
        _fund(1_000_000);
        oracle.setPrice(EUR_USD, 109_000, 10, EUR_USD_EXPO, block.timestamp); // 1.09000
        FlowTypes.Condition[] memory conditions = _one(_priceCondition(EUR_USD, 1.08e18, false, 300));
        uint256 flowId = _register(_forwardFlow(1_000_000, conditions));

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: price condition not met");
        executor.executeFlow(flowId);
    }

    // =========================================================================
    // Above-threshold ("priceAbove = true")
    // =========================================================================

    function test_Above_PassesWhenPriceAtOrAboveThreshold() public {
        _fund(1_000_000);
        oracle.setPrice(EUR_USD, 109_000, 10, EUR_USD_EXPO, block.timestamp); // 1.09000
        FlowTypes.Condition[] memory conditions = _one(_priceCondition(EUR_USD, 1.08e18, true, 300));
        uint256 flowId = _register(_forwardFlow(1_000_000, conditions));

        vm.prank(alice);
        executor.executeFlow(flowId);
        assertEq(usdc.balanceOf(recipient), 1_000_000);
    }

    function test_Above_FailsWhenPriceBelowThreshold() public {
        _fund(1_000_000);
        oracle.setPrice(EUR_USD, 107_000, 10, EUR_USD_EXPO, block.timestamp); // 1.07000
        FlowTypes.Condition[] memory conditions = _one(_priceCondition(EUR_USD, 1.08e18, true, 300));
        uint256 flowId = _register(_forwardFlow(1_000_000, conditions));

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: price condition not met");
        executor.executeFlow(flowId);
    }

    // =========================================================================
    // Staleness
    // =========================================================================

    function test_RevertsWhenStoredPriceOlderThanMaxStaleness() public {
        _fund(1_000_000);
        uint256 publishedAt = block.timestamp;
        oracle.setPrice(EUR_USD, 108_000, 10, EUR_USD_EXPO, publishedAt);
        FlowTypes.Condition[] memory conditions = _one(_priceCondition(EUR_USD, 2e18, false, 60));
        uint256 flowId = _register(_forwardFlow(1_000_000, conditions));

        vm.warp(publishedAt + 61);

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: oracle price stale");
        executor.executeFlow(flowId);
    }

    function test_PassesWhenStoredPriceExactlyAtMaxStaleness() public {
        _fund(1_000_000);
        uint256 publishedAt = block.timestamp;
        oracle.setPrice(EUR_USD, 108_000, 10, EUR_USD_EXPO, publishedAt);
        FlowTypes.Condition[] memory conditions = _one(_priceCondition(EUR_USD, 2e18, false, 60));
        uint256 flowId = _register(_forwardFlow(1_000_000, conditions));

        vm.warp(publishedAt + 60);

        vm.prank(alice);
        executor.executeFlow(flowId);
        assertEq(usdc.balanceOf(recipient), 1_000_000);
    }

    // =========================================================================
    // Decimals / expo handling
    // =========================================================================

    function test_NegativeExpoBeyond18DecimalsTruncatesRatherThanReverting() public {
        _fund(1_000_000);
        bytes32 btcUsd = keccak256("Crypto.BTC/USD");
        // expo -8, price = 6,500,000,000,00 (i.e. 65000.00000000) -> 65000e18 normalized
        oracle.setPrice(btcUsd, 6_500_000_000_000, 1000, -8, block.timestamp);
        FlowTypes.Condition[] memory conditions = _one(_priceCondition(btcUsd, 64_000e18, true, 300));
        uint256 flowId = _register(_forwardFlow(1_000_000, conditions));

        vm.prank(alice);
        executor.executeFlow(flowId);
        assertEq(usdc.balanceOf(recipient), 1_000_000);
    }

    function test_PositiveExpoNormalizesCorrectly() public {
        _fund(1_000_000);
        bytes32 feed = keccak256("Test.WHOLE/USD");
        // expo = 0, raw price 5 -> 5e18 normalized
        oracle.setPrice(feed, 5, 0, 0, block.timestamp);
        FlowTypes.Condition[] memory conditions = _one(_priceCondition(feed, 5e18, true, 300));
        uint256 flowId = _register(_forwardFlow(1_000_000, conditions));

        vm.prank(alice);
        executor.executeFlow(flowId);
        assertEq(usdc.balanceOf(recipient), 1_000_000);
    }

    function test_RevertsWhenPriceIsZeroOrNegative() public {
        _fund(1_000_000);
        oracle.setPrice(EUR_USD, 0, 0, EUR_USD_EXPO, block.timestamp);
        FlowTypes.Condition[] memory conditions = _one(_priceCondition(EUR_USD, 1e18, false, 300));
        uint256 flowId = _register(_forwardFlow(1_000_000, conditions));

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: oracle price invalid");
        executor.executeFlow(flowId);
    }

    function test_RevertsWhenPriceIdUnknownToOracle() public {
        _fund(1_000_000);
        bytes32 unknownFeed = keccak256("nonexistent");
        FlowTypes.Condition[] memory conditions = _one(_priceCondition(unknownFeed, 1e18, false, 300));
        uint256 flowId = _register(_forwardFlow(1_000_000, conditions));

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: oracle price unavailable");
        executor.executeFlow(flowId);
    }

    // =========================================================================
    // Combined with other conditions (AND)
    // =========================================================================

    function test_CombinedWithMinBalance_BothMustPass() public {
        _fund(1_000_000);
        oracle.setPrice(EUR_USD, 108_000, 10, EUR_USD_EXPO, block.timestamp);

        FlowTypes.Condition memory priceOk = _priceCondition(EUR_USD, 1.08e18, false, 300);
        FlowTypes.Condition memory balanceTooHigh = FlowTypes.Condition({
            minAmount: 0,
            maxAmount: 0,
            cooldownSeconds: 0,
            windowStart: 0,
            windowEnd: 0,
            minBalance: 5_000_000, // account only has 1_000_000
            allowedRecipients: new address[](0),
            deniedRecipients: new address[](0),
            priceId: bytes32(0),
            priceThreshold: 0,
            priceAbove: false,
            maxStaleness: 0
        });

        FlowTypes.Condition[] memory conditions = new FlowTypes.Condition[](2);
        conditions[0] = priceOk;
        conditions[1] = balanceTooHigh;

        uint256 flowId = _register(_forwardFlow(1_000_000, conditions));

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: balance below minimum");
        executor.executeFlow(flowId);
    }

    function test_CombinedWithMinBalance_PassesWhenBothPass() public {
        _fund(1_000_000);
        oracle.setPrice(EUR_USD, 108_000, 10, EUR_USD_EXPO, block.timestamp);

        FlowTypes.Condition memory priceOk = _priceCondition(EUR_USD, 1.08e18, false, 300);
        FlowTypes.Condition memory balanceOk = FlowTypes.Condition({
            minAmount: 0,
            maxAmount: 0,
            cooldownSeconds: 0,
            windowStart: 0,
            windowEnd: 0,
            minBalance: 500_000,
            allowedRecipients: new address[](0),
            deniedRecipients: new address[](0),
            priceId: bytes32(0),
            priceThreshold: 0,
            priceAbove: false,
            maxStaleness: 0
        });

        FlowTypes.Condition[] memory conditions = new FlowTypes.Condition[](2);
        conditions[0] = priceOk;
        conditions[1] = balanceOk;

        uint256 flowId = _register(_forwardFlow(1_000_000, conditions));

        vm.prank(alice);
        executor.executeFlow(flowId);
        assertEq(usdc.balanceOf(recipient), 1_000_000);
    }

    // =========================================================================
    // previewFlow parity
    // =========================================================================

    function test_PreviewFlow_MatchesExecuteFlow_WhenPriceConditionFails() public {
        _fund(1_000_000);
        oracle.setPrice(EUR_USD, 109_000, 10, EUR_USD_EXPO, block.timestamp);
        FlowTypes.Condition[] memory conditions = _one(_priceCondition(EUR_USD, 1.08e18, false, 300));
        uint256 flowId = _register(_forwardFlow(1_000_000, conditions));

        vm.prank(alice);
        (bool canRun, string memory reason) = executor.previewFlow(flowId);
        assertFalse(canRun);
        assertEq(reason, "CanalisExecutor: price condition not met");

        vm.prank(alice);
        vm.expectRevert(bytes(reason));
        executor.executeFlow(flowId);
    }

    function test_PreviewFlow_MatchesExecuteFlow_WhenPriceConditionPasses() public {
        _fund(1_000_000);
        oracle.setPrice(EUR_USD, 107_000, 10, EUR_USD_EXPO, block.timestamp);
        FlowTypes.Condition[] memory conditions = _one(_priceCondition(EUR_USD, 1.08e18, false, 300));
        uint256 flowId = _register(_forwardFlow(1_000_000, conditions));

        vm.prank(alice);
        (bool canRun, string memory reason) = executor.previewFlow(flowId);
        assertTrue(canRun);
        assertEq(reason, "");

        vm.prank(alice);
        executor.executeFlow(flowId);
        assertEq(usdc.balanceOf(recipient), 1_000_000);
    }

    function test_PreviewFlow_MatchesExecuteFlow_WhenStale() public {
        _fund(1_000_000);
        uint256 publishedAt = block.timestamp;
        oracle.setPrice(EUR_USD, 108_000, 10, EUR_USD_EXPO, publishedAt);
        FlowTypes.Condition[] memory conditions = _one(_priceCondition(EUR_USD, 2e18, false, 60));
        uint256 flowId = _register(_forwardFlow(1_000_000, conditions));

        vm.warp(publishedAt + 120);

        vm.prank(alice);
        (bool canRun, string memory reason) = executor.previewFlow(flowId);
        assertFalse(canRun);
        assertEq(reason, "CanalisExecutor: oracle price stale");

        vm.prank(alice);
        vm.expectRevert(bytes(reason));
        executor.executeFlow(flowId);
    }
}
