// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CanalisSwapPool
/// @notice A minimal, standalone constant-product (x*y=k) AMM for a single
/// USDC/EURC pair — Canalis's first Arc-native feature slice (spec section
/// 7.3 #1). DESIGN DECISION: rather than routing through a third-party DEX
/// (the spec's original plan was to verify Tower Exchange/ArcSwap), Canalis
/// deploys and owns this pool itself. Rationale: no third-party liquidity
/// or ABI to depend on/verify, the pool is small enough to build and test
/// properly in-slice, and "we built the AMM" is itself a genuine DeFi-track
/// artifact rather than just plumbing to someone else's contract. The
/// mainnet-roadmap tradeoff (no real liquidity depth, testnet-only
/// meaningful) is the same either way — see docs/canalis-spec.md section 8.
///
/// LIQUIDITY MODEL: no LP tokens — this is a single-owner-seeded pool for
/// the demo, not a public liquidity market. `addLiquidity`/`removeLiquidity`
/// are owner-gated (the deployer). A real multi-LP pool would mint/burn LP
/// shares; that's explicitly out of scope here (see docs/canalis-spec.md
/// section 8 — this whole pool is a testnet demo instrument, not a
/// production AMM).
///
/// RESERVE ACCOUNTING: reserves are tracked in explicit state
/// (`reserveUsdc`/`reserveEurc`), never read live via `balanceOf`. Reading
/// live balances would let anyone "donate" tokens directly to the pool
/// address to manipulate the constant-product price calculation out from
/// under a pending swap — explicit reserves close that off entirely.
contract CanalisSwapPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    IERC20 public immutable eurc;

    uint256 public reserveUsdc;
    uint256 public reserveEurc;

    /// @dev 0.30% swap fee, matching the industry-standard constant-product
    /// AMM fee (e.g. Uniswap v2). Charged on the input side; the fee stays
    /// in the pool's reserves (appreciating them) rather than being routed
    /// anywhere separately — there's no LP-token accounting to distribute
    /// it through in this owner-seeded slice.
    uint256 public constant FEE_BPS = 30;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    event LiquidityAdded(uint256 usdcAmount, uint256 eurcAmount);
    event LiquidityRemoved(address indexed to, uint256 usdcAmount, uint256 eurcAmount);
    event Swap(
        address indexed caller,
        address indexed tokenIn,
        uint256 amountIn,
        address indexed tokenOut,
        uint256 amountOut,
        address to
    );

    constructor(address owner_, address usdc_, address eurc_) Ownable(owner_) {
        require(usdc_ != address(0), "CanalisSwapPool: usdc required");
        require(eurc_ != address(0), "CanalisSwapPool: eurc required");
        require(usdc_ != eurc_, "CanalisSwapPool: tokens must differ");
        usdc = IERC20(usdc_);
        eurc = IERC20(eurc_);
    }

    /// @notice Owner-only: seed/add liquidity in both tokens at once. No
    /// ratio enforcement — the very first add sets the pool's initial
    /// price; the owner is trusted not to shift price via a lopsided
    /// follow-up add (this is a single-owner demo pool, not a public
    /// market where that would matter).
    function addLiquidity(uint256 usdcAmount, uint256 eurcAmount) external onlyOwner nonReentrant {
        require(usdcAmount > 0 && eurcAmount > 0, "CanalisSwapPool: zero amount");

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        eurc.safeTransferFrom(msg.sender, address(this), eurcAmount);

        reserveUsdc += usdcAmount;
        reserveEurc += eurcAmount;

        emit LiquidityAdded(usdcAmount, eurcAmount);
    }

    /// @notice Owner-only: withdraw liquidity back out to `to`. Either
    /// amount may be 0 to withdraw only the other token.
    function removeLiquidity(address to, uint256 usdcAmount, uint256 eurcAmount) external onlyOwner nonReentrant {
        require(to != address(0), "CanalisSwapPool: zero recipient");
        require(usdcAmount > 0 || eurcAmount > 0, "CanalisSwapPool: zero amount");
        require(usdcAmount <= reserveUsdc, "CanalisSwapPool: insufficient USDC reserve");
        require(eurcAmount <= reserveEurc, "CanalisSwapPool: insufficient EURC reserve");

        reserveUsdc -= usdcAmount;
        reserveEurc -= eurcAmount;

        if (usdcAmount > 0) usdc.safeTransfer(to, usdcAmount);
        if (eurcAmount > 0) eurc.safeTransfer(to, eurcAmount);

        emit LiquidityRemoved(to, usdcAmount, eurcAmount);
    }

    /// @notice Swap `amountIn` of `tokenIn` (must be `usdc` or `eurc`) for
    /// the other token, via the standard constant-product formula with the
    /// 0.30% fee applied on the input:
    ///   amountInWithFee = amountIn * (10000 - 30) / 10000
    ///   amountOut = reserveOut * amountInWithFee / (reserveIn + amountInWithFee)
    /// Reverts "insufficient output" if `amountOut < minAmountOut`
    /// (slippage protection) — callers (e.g. CanalisExecutor's Swap action)
    /// MUST pass a real `minAmountOut`, not 0, or they have no slippage
    /// protection at all. `msg.sender` must have approved this pool for
    /// `amountIn` beforehand.
    function swap(address tokenIn, uint256 amountIn, uint256 minAmountOut, address to)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        require(amountIn > 0, "CanalisSwapPool: zero amountIn");
        require(to != address(0), "CanalisSwapPool: zero recipient");
        require(tokenIn == address(usdc) || tokenIn == address(eurc), "CanalisSwapPool: unsupported token");
        require(reserveUsdc > 0 && reserveEurc > 0, "CanalisSwapPool: no liquidity");

        bool inIsUsdc = tokenIn == address(usdc);
        uint256 reserveIn = inIsUsdc ? reserveUsdc : reserveEurc;
        uint256 reserveOut = inIsUsdc ? reserveEurc : reserveUsdc;
        IERC20 tokenOutErc20 = inIsUsdc ? eurc : usdc;

        // Pull the input first (checks-effects-interactions: this is the
        // one external call before state changes; the payout below happens
        // strictly after reserves are updated).
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        uint256 amountInWithFee = (amountIn * (BPS_DENOMINATOR - FEE_BPS)) / BPS_DENOMINATOR;
        amountOut = (reserveOut * amountInWithFee) / (reserveIn + amountInWithFee);

        require(amountOut >= minAmountOut, "CanalisSwapPool: insufficient output");
        require(amountOut < reserveOut, "CanalisSwapPool: insufficient liquidity");

        if (inIsUsdc) {
            reserveUsdc += amountIn;
            reserveEurc -= amountOut;
        } else {
            reserveEurc += amountIn;
            reserveUsdc -= amountOut;
        }

        tokenOutErc20.safeTransfer(to, amountOut);

        emit Swap(msg.sender, tokenIn, amountIn, address(tokenOutErc20), amountOut, to);
    }

    /// @notice Read-only quote mirroring `swap`'s exact math, for UIs/callers
    /// to compute a sane `minAmountOut` before sending the real transaction.
    /// Reverts under the same conditions `swap` would (no liquidity,
    /// unsupported token) so a caller never gets a silently-wrong quote.
    function quote(address tokenIn, uint256 amountIn) external view returns (uint256 amountOut) {
        require(amountIn > 0, "CanalisSwapPool: zero amountIn");
        require(tokenIn == address(usdc) || tokenIn == address(eurc), "CanalisSwapPool: unsupported token");
        require(reserveUsdc > 0 && reserveEurc > 0, "CanalisSwapPool: no liquidity");

        bool inIsUsdc = tokenIn == address(usdc);
        uint256 reserveIn = inIsUsdc ? reserveUsdc : reserveEurc;
        uint256 reserveOut = inIsUsdc ? reserveEurc : reserveUsdc;

        uint256 amountInWithFee = (amountIn * (BPS_DENOMINATOR - FEE_BPS)) / BPS_DENOMINATOR;
        amountOut = (reserveOut * amountInWithFee) / (reserveIn + amountInWithFee);
    }
}
