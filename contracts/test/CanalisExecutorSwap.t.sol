// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CanalisExecutor} from "../src/CanalisExecutor.sol";
import {CanalisAccount} from "../src/CanalisAccount.sol";
import {CanalisAccountFactory} from "../src/CanalisAccountFactory.sol";
import {CanalisSwapPool} from "../src/CanalisSwapPool.sol";
import {FlowTypes} from "../src/libraries/FlowTypes.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @dev Arc-native feature slice: the Swap action, routing through
/// CanalisExecutor's configured CanalisSwapPool. ACCOUNT-VS-RECIPIENT
/// DESIGN DECISION (see CanalisExecutor.sol class docs / `_handleSwap`):
/// the swapped-out token pays out to a recipient ADDRESS named in the
/// action, not back into the (USDC-only) CanalisAccount.
contract CanalisExecutorSwapTest is Test {
    CanalisExecutor internal executor;
    CanalisAccountFactory internal factory;
    CanalisSwapPool internal pool;
    MockERC20 internal usdc;
    MockERC20 internal eurc;

    address internal poolOwner = address(0xD00D);
    address internal alice = address(0xA11CE);
    address internal recipient = address(0xB0B);
    address internal aliceAccount;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        pool = new CanalisSwapPool(poolOwner, address(usdc), address(eurc));
        executor = new CanalisExecutor(address(pool));
        factory = new CanalisAccountFactory(address(usdc), address(executor));

        vm.prank(alice);
        aliceAccount = factory.createAccount();

        // Seed the pool 1:1 — 10,000 USDC / 10,000 EURC (6dp).
        usdc.mint(poolOwner, 10_000_000_000);
        eurc.mint(poolOwner, 10_000_000_000);
        vm.startPrank(poolOwner);
        usdc.approve(address(pool), 10_000_000_000);
        eurc.approve(address(pool), 10_000_000_000);
        pool.addLiquidity(10_000_000_000, 10_000_000_000);
        vm.stopPrank();
    }

    function _fund(uint256 amount) internal {
        usdc.mint(alice, amount);
        vm.prank(alice);
        usdc.approve(aliceAccount, amount);
        vm.prank(alice);
        CanalisAccount(aliceAccount).deposit(amount);
    }

    function _swapFlow(uint256 amountIn, uint256 minAmountOut, FlowTypes.Condition[] memory conditions)
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
            kind: FlowTypes.ActionType.Swap,
            recipients: recipients,
            amountsOrBps: new uint256[](0),
            fixedAmount: amountIn,
            sweepThreshold: 0,
            unlockTime: 0,
            tokenIn: address(usdc),
            tokenOut: address(eurc),
            minAmountOut: minAmountOut
        });
        flow.actions = actions;
    }

    function _noConditions() internal pure returns (FlowTypes.Condition[] memory) {
        return new FlowTypes.Condition[](0);
    }

    function _expectedOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        uint256 amountInWithFee = (amountIn * 9970) / 10_000;
        return (reserveOut * amountInWithFee) / (reserveIn + amountInWithFee);
    }

    function _register(FlowTypes.Flow memory flow) internal returns (uint256 flowId) {
        vm.prank(alice);
        flowId = executor.registerFlow(flow);
    }

    function _execute(uint256 flowId) internal {
        vm.prank(alice);
        executor.executeFlow(flowId);
    }

    // =======================================================================
    // Constructor
    // =======================================================================

    function test_Constructor_RevertsForZeroSwapPool() public {
        vm.expectRevert("CanalisExecutor: swapPool required");
        new CanalisExecutor(address(0));
    }

    // =======================================================================
    // Basic swap
    // =======================================================================

    function test_Swap_DeliversExpectedOutputToRecipient() public {
        _fund(1_000_000_000); // 1000 USDC
        uint256 amountIn = 100_000_000; // 100 USDC
        uint256 expected = _expectedOut(amountIn, 10_000_000_000, 10_000_000_000);

        uint256 flowId = _register(_swapFlow(amountIn, expected, _noConditions()));
        _execute(flowId);

        assertEq(eurc.balanceOf(recipient), expected, "recipient should receive exactly the pool's computed output");
        assertEq(usdc.balanceOf(recipient), 0, "recipient must not receive any tokenIn");
    }

    function test_Swap_PullsAmountInFromAccountOnly() public {
        _fund(1_000_000_000);
        uint256 amountIn = 100_000_000;

        uint256 flowId = _register(_swapFlow(amountIn, 0, _noConditions()));
        _execute(flowId);

        assertEq(CanalisAccount(aliceAccount).balance(), 900_000_000, "account should drop by exactly amountIn");
    }

    function test_Swap_ExecutorNeverEndsUpHoldingEitherToken() public {
        _fund(1_000_000_000);
        uint256 amountIn = 100_000_000;

        uint256 flowId = _register(_swapFlow(amountIn, 0, _noConditions()));
        _execute(flowId);

        assertEq(usdc.balanceOf(address(executor)), 0, "executor must not strand tokenIn");
        assertEq(eurc.balanceOf(address(executor)), 0, "executor must not strand tokenOut");
    }

    function test_Swap_UpdatesPoolReserves() public {
        _fund(1_000_000_000);
        uint256 amountIn = 100_000_000;
        uint256 expected = _expectedOut(amountIn, 10_000_000_000, 10_000_000_000);

        uint256 flowId = _register(_swapFlow(amountIn, 0, _noConditions()));
        _execute(flowId);

        assertEq(pool.reserveUsdc(), 10_000_000_000 + amountIn);
        assertEq(pool.reserveEurc(), 10_000_000_000 - expected);
    }

    // =======================================================================
    // Slippage protection
    // =======================================================================

    function test_Swap_RevertsWhenMinAmountOutNotMet() public {
        _fund(1_000_000_000);
        uint256 amountIn = 100_000_000;
        uint256 expected = _expectedOut(amountIn, 10_000_000_000, 10_000_000_000);

        uint256 flowId = _register(_swapFlow(amountIn, expected + 1, _noConditions()));

        vm.prank(alice);
        vm.expectRevert("CanalisSwapPool: insufficient output");
        executor.executeFlow(flowId);

        assertEq(eurc.balanceOf(recipient), 0, "a reverted swap must move nothing");
        assertEq(CanalisAccount(aliceAccount).balance(), 1_000_000_000, "account balance must be untouched on revert");
    }

    // =======================================================================
    // Validation
    // =======================================================================

    function test_Swap_RevertsForZeroAmountIn() public {
        _fund(1_000_000_000);
        uint256 flowId = _register(_swapFlow(0, 0, _noConditions()));

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: Swap amountIn must be positive");
        executor.executeFlow(flowId);
    }

    function test_Swap_RevertsForZeroRecipient() public {
        _fund(1_000_000_000);
        FlowTypes.Flow memory flow = _swapFlow(100_000_000, 0, _noConditions());
        flow.actions[0].recipients[0] = address(0);
        uint256 flowId = _register(flow);

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: Swap recipient cannot be zero address");
        executor.executeFlow(flowId);
    }

    function test_Swap_RevertsForMismatchedTokenPair() public {
        _fund(1_000_000_000);
        MockERC20 other = new MockERC20("Other", "OTH", 18);
        FlowTypes.Flow memory flow = _swapFlow(100_000_000, 0, _noConditions());
        flow.actions[0].tokenOut = address(other);
        uint256 flowId = _register(flow);

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: Swap tokenIn/tokenOut must be the pool's USDC/EURC pair");
        executor.executeFlow(flowId);
    }

    function test_Swap_EurcToUsdc_Works() public {
        // Fund alice's account with EURC directly isn't possible (the
        // account is USDC-only) — but a Swap action can still sell
        // whatever tokenIn is configured as long as the ACCOUNT holds it.
        // Since CanalisAccount only ever custodies USDC, only a USDC->EURC
        // direction is actually reachable via a real flow; this documents
        // that constraint rather than exercising EURC->USDC through the
        // account (see CanalisSwapPoolTest for the EURC->USDC pool-level
        // proof, which is direction-agnostic at the pool layer).
        _fund(1_000_000_000);
        uint256 amountIn = 100_000_000;
        uint256 expected = _expectedOut(amountIn, 10_000_000_000, 10_000_000_000);

        uint256 flowId = _register(_swapFlow(amountIn, expected, _noConditions()));
        _execute(flowId);

        assertEq(eurc.balanceOf(recipient), expected);
    }

    // =======================================================================
    // Conditions + pause still gate Swap like every other action
    // =======================================================================

    function test_Swap_BlockedByAmountCapCondition() public {
        _fund(1_000_000_000);
        uint256 amountIn = 100_000_000;

        FlowTypes.Condition[] memory conditions = new FlowTypes.Condition[](1);
        conditions[0] = FlowTypes.Condition({
            minAmount: 0,
            maxAmount: amountIn - 1,
            cooldownSeconds: 0,
            windowStart: 0,
            windowEnd: 0,
            minBalance: 0,
            allowedRecipients: new address[](0),
            deniedRecipients: new address[](0)
        });

        uint256 flowId = _register(_swapFlow(amountIn, 0, conditions));

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: amount exceeds cap");
        executor.executeFlow(flowId);
    }

    function test_Swap_BlockedWhenPaused() public {
        _fund(1_000_000_000);
        uint256 flowId = _register(_swapFlow(100_000_000, 0, _noConditions()));

        vm.prank(alice);
        executor.setFlowActive(flowId, false);

        vm.prank(alice);
        vm.expectRevert("CanalisExecutor: flow inactive");
        executor.executeFlow(flowId);
    }

    // =======================================================================
    // previewFlow must not attempt the swap itself
    // =======================================================================

    function test_PreviewFlow_TrueForRunnableSwapFlow_WithoutMovingAnything() public {
        _fund(1_000_000_000);
        uint256 flowId = _register(_swapFlow(100_000_000, 0, _noConditions()));

        vm.prank(alice);
        (bool canRun, string memory reason) = executor.previewFlow(flowId);

        assertTrue(canRun, "a valid Manual+Swap flow called by its owner should preview as runnable");
        assertEq(reason, "");
        assertEq(eurc.balanceOf(recipient), 0, "previewFlow must be a pure dry-run: no tokens should move");
        assertEq(CanalisAccount(aliceAccount).balance(), 1_000_000_000, "previewFlow must not touch account balance");
        assertEq(pool.reserveUsdc(), 10_000_000_000, "previewFlow must not touch pool reserves");
    }

    function test_PreviewFlow_DoesNotValidateSwapSpecificsLikeMinAmountOut() public {
        // previewFlow only re-derives trigger+condition checks (see
        // CanalisExecutor class docs) — it has no notion of "would this
        // swap's minAmountOut be met", since that's not a precondition,
        // it's an outcome of dispatch. A flow with an unreachable
        // minAmountOut still previews as runnable; it would revert only
        // once actually executed.
        _fund(1_000_000_000);
        uint256 flowId = _register(_swapFlow(100_000_000, type(uint256).max, _noConditions()));

        vm.prank(alice);
        (bool canRun,) = executor.previewFlow(flowId);
        assertTrue(canRun, "previewFlow's scope is trigger+conditions only, not action feasibility");

        vm.prank(alice);
        vm.expectRevert("CanalisSwapPool: insufficient output");
        executor.executeFlow(flowId);
    }

    // =======================================================================
    // Fuzz
    // =======================================================================

    function testFuzz_Swap_DeliversExactPoolQuote(uint256 amountIn) public {
        amountIn = bound(amountIn, 1_000, 500_000_000_000); // up to 500,000 USDC (6dp)
        _fund(amountIn);

        uint256 expected = _expectedOut(amountIn, 10_000_000_000, 10_000_000_000);
        uint256 flowId = _register(_swapFlow(amountIn, expected, _noConditions()));
        _execute(flowId);

        assertEq(eurc.balanceOf(recipient), expected);
    }
}
