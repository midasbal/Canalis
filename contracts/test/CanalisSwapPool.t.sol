// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CanalisSwapPool} from "../src/CanalisSwapPool.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @dev First Arc-native feature slice: a standalone constant-product
/// USDC/EURC AMM. Both tokens mocked at 6 decimals, mirroring Arc testnet's
/// real USDC/EURC ERC-20 interfaces.
contract CanalisSwapPoolTest is Test {
    CanalisSwapPool internal pool;
    MockERC20 internal usdc;
    MockERC20 internal eurc;

    address internal owner = address(0xA11CE);
    address internal trader = address(0xB0B);
    address internal recipient = address(0xC0C);

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        pool = new CanalisSwapPool(owner, address(usdc), address(eurc));
    }

    function _seed(uint256 usdcAmount, uint256 eurcAmount) internal {
        usdc.mint(owner, usdcAmount);
        eurc.mint(owner, eurcAmount);
        vm.startPrank(owner);
        usdc.approve(address(pool), usdcAmount);
        eurc.approve(address(pool), eurcAmount);
        pool.addLiquidity(usdcAmount, eurcAmount);
        vm.stopPrank();
    }

    function _fundTrader(uint256 usdcAmount, uint256 eurcAmount) internal {
        usdc.mint(trader, usdcAmount);
        eurc.mint(trader, eurcAmount);
        vm.startPrank(trader);
        usdc.approve(address(pool), type(uint256).max);
        eurc.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function _expectedOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        uint256 amountInWithFee = (amountIn * 9970) / 10_000;
        return (reserveOut * amountInWithFee) / (reserveIn + amountInWithFee);
    }

    // =======================================================================
    // Constructor
    // =======================================================================

    function test_Constructor_RevertsForZeroUsdc() public {
        vm.expectRevert("CanalisSwapPool: usdc required");
        new CanalisSwapPool(owner, address(0), address(eurc));
    }

    function test_Constructor_RevertsForZeroEurc() public {
        vm.expectRevert("CanalisSwapPool: eurc required");
        new CanalisSwapPool(owner, address(usdc), address(0));
    }

    function test_Constructor_RevertsForSameToken() public {
        vm.expectRevert("CanalisSwapPool: tokens must differ");
        new CanalisSwapPool(owner, address(usdc), address(usdc));
    }

    // =======================================================================
    // Liquidity
    // =======================================================================

    function test_AddLiquidity_UpdatesReservesAndPullsTokens() public {
        _seed(1_000_000_000, 900_000_000); // 1000 USDC / 900 EURC (6dp)

        assertEq(pool.reserveUsdc(), 1_000_000_000);
        assertEq(pool.reserveEurc(), 900_000_000);
        assertEq(usdc.balanceOf(address(pool)), 1_000_000_000);
        assertEq(eurc.balanceOf(address(pool)), 900_000_000);
    }

    function test_AddLiquidity_RevertsForNonOwner() public {
        usdc.mint(trader, 1_000_000);
        eurc.mint(trader, 1_000_000);
        vm.startPrank(trader);
        usdc.approve(address(pool), 1_000_000);
        eurc.approve(address(pool), 1_000_000);
        vm.expectRevert();
        pool.addLiquidity(1_000_000, 1_000_000);
        vm.stopPrank();
    }

    function test_AddLiquidity_RevertsForZeroAmount() public {
        usdc.mint(owner, 1_000_000);
        eurc.mint(owner, 1_000_000);
        vm.startPrank(owner);
        usdc.approve(address(pool), 1_000_000);
        eurc.approve(address(pool), 1_000_000);
        vm.expectRevert("CanalisSwapPool: zero amount");
        pool.addLiquidity(0, 1_000_000);
        vm.stopPrank();
    }

    function test_RemoveLiquidity_UpdatesReservesAndPaysOut() public {
        _seed(1_000_000_000, 1_000_000_000);

        vm.prank(owner);
        pool.removeLiquidity(recipient, 400_000_000, 300_000_000);

        assertEq(pool.reserveUsdc(), 600_000_000);
        assertEq(pool.reserveEurc(), 700_000_000);
        assertEq(usdc.balanceOf(recipient), 400_000_000);
        assertEq(eurc.balanceOf(recipient), 300_000_000);
    }

    function test_RemoveLiquidity_RevertsForNonOwner() public {
        _seed(1_000_000_000, 1_000_000_000);
        vm.expectRevert();
        pool.removeLiquidity(recipient, 100, 100);
    }

    function test_RemoveLiquidity_RevertsWhenExceedingReserves() public {
        _seed(1_000_000, 1_000_000);
        vm.prank(owner);
        vm.expectRevert("CanalisSwapPool: insufficient USDC reserve");
        pool.removeLiquidity(recipient, 2_000_000, 0);
    }

    // =======================================================================
    // Swap — correctness
    // =======================================================================

    function test_Swap_UsdcToEurc_MatchesConstantProductFormula() public {
        _seed(1_000_000_000, 1_000_000_000); // balanced 1:1 pool, 1000/1000
        _fundTrader(100_000_000, 0); // trader has 100 USDC

        uint256 amountIn = 100_000_000;
        uint256 expected = _expectedOut(amountIn, 1_000_000_000, 1_000_000_000);

        vm.prank(trader);
        uint256 amountOut = pool.swap(address(usdc), amountIn, 0, recipient);

        assertEq(amountOut, expected, "output must match x*y=k minus fee");
        assertEq(eurc.balanceOf(recipient), expected);
    }

    function test_Swap_EurcToUsdc_MatchesConstantProductFormula() public {
        _seed(1_000_000_000, 1_000_000_000);
        _fundTrader(0, 50_000_000);

        uint256 amountIn = 50_000_000;
        uint256 expected = _expectedOut(amountIn, 1_000_000_000, 1_000_000_000);

        vm.prank(trader);
        uint256 amountOut = pool.swap(address(eurc), amountIn, 0, recipient);

        assertEq(amountOut, expected);
        assertEq(usdc.balanceOf(recipient), expected);
    }

    function test_Swap_UnbalancedPool_MatchesFormula() public {
        _seed(2_000_000_000, 500_000_000); // 2000 USDC / 500 EURC — USDC is "cheap" here
        _fundTrader(200_000_000, 0);

        uint256 amountIn = 200_000_000;
        uint256 expected = _expectedOut(amountIn, 2_000_000_000, 500_000_000);

        vm.prank(trader);
        uint256 amountOut = pool.swap(address(usdc), amountIn, 0, recipient);

        assertEq(amountOut, expected);
    }

    function test_Swap_FeeReducesOutputVersusNoFee() public {
        _seed(1_000_000_000, 1_000_000_000);
        _fundTrader(100_000_000, 0);

        uint256 amountIn = 100_000_000;
        uint256 noFeeOut = (1_000_000_000 * amountIn) / (1_000_000_000 + amountIn);

        vm.prank(trader);
        uint256 amountOut = pool.swap(address(usdc), amountIn, 0, recipient);

        assertLt(amountOut, noFeeOut, "fee must strictly reduce output versus a fee-free quote");
    }

    function test_Swap_UpdatesReservesCorrectly() public {
        _seed(1_000_000_000, 1_000_000_000);
        _fundTrader(100_000_000, 0);

        uint256 amountIn = 100_000_000;
        uint256 expectedOut = _expectedOut(amountIn, 1_000_000_000, 1_000_000_000);

        vm.prank(trader);
        pool.swap(address(usdc), amountIn, 0, recipient);

        assertEq(pool.reserveUsdc(), 1_000_000_000 + amountIn);
        assertEq(pool.reserveEurc(), 1_000_000_000 - expectedOut);
    }

    function test_Quote_MatchesActualSwapOutput() public {
        _seed(1_000_000_000, 800_000_000);
        _fundTrader(100_000_000, 0);

        uint256 quoted = pool.quote(address(usdc), 100_000_000);

        vm.prank(trader);
        uint256 actual = pool.swap(address(usdc), 100_000_000, 0, recipient);

        assertEq(quoted, actual, "quote() must match the real swap output exactly");
    }

    // =======================================================================
    // Swap — guards / reverts
    // =======================================================================

    function test_Swap_RevertsOnZeroAmountIn() public {
        _seed(1_000_000, 1_000_000);
        vm.prank(trader);
        vm.expectRevert("CanalisSwapPool: zero amountIn");
        pool.swap(address(usdc), 0, 0, recipient);
    }

    function test_Swap_RevertsOnZeroRecipient() public {
        _seed(1_000_000, 1_000_000);
        _fundTrader(1_000, 0);
        vm.prank(trader);
        vm.expectRevert("CanalisSwapPool: zero recipient");
        pool.swap(address(usdc), 1_000, 0, address(0));
    }

    function test_Swap_RevertsOnUnsupportedToken() public {
        _seed(1_000_000, 1_000_000);
        MockERC20 other = new MockERC20("Other", "OTH", 18);
        other.mint(trader, 1_000);
        vm.startPrank(trader);
        other.approve(address(pool), 1_000);
        vm.expectRevert("CanalisSwapPool: unsupported token");
        pool.swap(address(other), 1_000, 0, recipient);
        vm.stopPrank();
    }

    function test_Swap_RevertsOnZeroReserves() public {
        _fundTrader(1_000, 0);
        vm.prank(trader);
        vm.expectRevert("CanalisSwapPool: no liquidity");
        pool.swap(address(usdc), 1_000, 0, recipient);
    }

    function test_Swap_RevertsWhenMinAmountOutNotMet() public {
        _seed(1_000_000_000, 1_000_000_000);
        _fundTrader(100_000_000, 0);

        uint256 amountIn = 100_000_000;
        uint256 expected = _expectedOut(amountIn, 1_000_000_000, 1_000_000_000);

        vm.prank(trader);
        vm.expectRevert("CanalisSwapPool: insufficient output");
        pool.swap(address(usdc), amountIn, expected + 1, recipient);
    }

    function test_Swap_SucceedsExactlyAtMinAmountOut() public {
        _seed(1_000_000_000, 1_000_000_000);
        _fundTrader(100_000_000, 0);

        uint256 amountIn = 100_000_000;
        uint256 expected = _expectedOut(amountIn, 1_000_000_000, 1_000_000_000);

        vm.prank(trader);
        uint256 amountOut = pool.swap(address(usdc), amountIn, expected, recipient);
        assertEq(amountOut, expected);
    }

    // =======================================================================
    // Fuzz
    // =======================================================================

    function testFuzz_Swap_OutputNeverExceedsReserveOut(uint256 seedUsdc, uint256 seedEurc, uint256 amountIn) public {
        seedUsdc = bound(seedUsdc, 1_000_000, 1_000_000_000_000); // 1 - 1,000,000 USDC (6dp)
        seedEurc = bound(seedEurc, 1_000_000, 1_000_000_000_000);
        amountIn = bound(amountIn, 1, 1_000_000_000_000);

        _seed(seedUsdc, seedEurc);
        _fundTrader(amountIn, 0);

        vm.prank(trader);
        uint256 amountOut = pool.swap(address(usdc), amountIn, 0, recipient);

        assertLt(amountOut, seedEurc, "output must never reach/exceed the pre-swap reserveOut");
        assertEq(pool.reserveEurc(), seedEurc - amountOut);
    }

    function testFuzz_Swap_KNeverDecreases(uint256 seedUsdc, uint256 seedEurc, uint256 amountIn) public {
        seedUsdc = bound(seedUsdc, 1_000_000, 1_000_000_000_000);
        seedEurc = bound(seedEurc, 1_000_000, 1_000_000_000_000);
        amountIn = bound(amountIn, 1, 1_000_000_000_000);

        _seed(seedUsdc, seedEurc);
        _fundTrader(amountIn, 0);

        uint256 kBefore = pool.reserveUsdc() * pool.reserveEurc();

        vm.prank(trader);
        pool.swap(address(usdc), amountIn, 0, recipient);

        uint256 kAfter = pool.reserveUsdc() * pool.reserveEurc();
        assertGe(kAfter, kBefore, "k must never decrease across a fee-charging swap");
    }

    function testFuzz_Swap_RevertsWhenMinAmountOutExceedsRealOutput(
        uint256 seedUsdc,
        uint256 seedEurc,
        uint256 amountIn,
        uint256 slack
    ) public {
        seedUsdc = bound(seedUsdc, 1_000_000, 1_000_000_000_000);
        seedEurc = bound(seedEurc, 1_000_000, 1_000_000_000_000);
        amountIn = bound(amountIn, 1, 1_000_000_000_000);
        slack = bound(slack, 1, 1_000_000_000_000);

        _seed(seedUsdc, seedEurc);
        _fundTrader(amountIn, 0);

        uint256 expected = _expectedOut(amountIn, seedUsdc, seedEurc);

        vm.prank(trader);
        vm.expectRevert("CanalisSwapPool: insufficient output");
        pool.swap(address(usdc), amountIn, expected + slack, recipient);
    }
}
