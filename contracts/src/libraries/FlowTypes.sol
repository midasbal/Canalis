// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Shared enums and structs for the Canalis "flows as data" model.
/// A Flow is trigger -> condition(s) -> action(s), stored as encoded data and
/// interpreted by a single generic CanalisExecutor rather than deployed as its
/// own contract. MVP scope only — see docs/canalis-spec.md for the full model.
library FlowTypes {
    /// @notice What causes a flow to become eligible for execution.
    enum TriggerType {
        OnReceive, // fires when USDC lands in the owning CanalisAccount
        OnSchedule, // fires on/after a timestamp, optionally recurring
        OnThreshold, // fires when account balance crosses a threshold
        Manual // fires only via an explicit "run now" call
    }

    /// @notice What a flow does once its trigger and conditions are satisfied.
    enum ActionType {
        Split, // distribute to N recipients by basis points or fixed amounts
        Forward, // send the full/partial amount to a single recipient
        Sweep, // move balance above a threshold to a savings sub-account
        LockRelease, // time-lock an amount, released after `unlockTime`
        Swap, // swap tokenIn -> tokenOut via CanalisExecutor's configured CanalisSwapPool
        Bridge // burn USDC on Arc via CCTP V2 TokenMessengerV2; mint completes async on destinationDomain
    }

    /// @notice A single trigger definition attached to a flow.
    struct Trigger {
        TriggerType kind;
        uint256 scheduleAt; // OnSchedule: unix timestamp of (first) execution
        uint256 scheduleInterval; // OnSchedule: 0 = one-shot, >0 = recurring seconds
        uint256 thresholdAmount; // OnThreshold: balance level that trips the trigger
        bool thresholdIsAbove; // OnThreshold: true = fires when balance >= threshold
    }

    /// @notice A guard evaluated before a flow's actions are allowed to run.
    /// All fields are optional constraints; a zero value means "no constraint".
    struct Condition {
        uint256 minAmount; // per-run minimum amount, 0 = unset
        uint256 maxAmount; // per-run cap, 0 = unset
        uint256 cooldownSeconds; // minimum time since this flow's last execution
        uint256 windowStart; // time-of-day / date window start (unix), 0 = unset
        uint256 windowEnd; // time-of-day / date window end (unix), 0 = unset
        uint256 minBalance; // account must hold at least this much USDC
        address[] allowedRecipients; // empty = no allowlist restriction
        address[] deniedRecipients; // empty = no denylist restriction
        // Oracle price condition (Arc-native feature slice, spec §7.3 #2).
        // Reads CanalisExecutor's configured Pyth oracle — see
        // CanalisExecutor._checkOracleCondition. bytes32(0) = unset (no
        // constraint); when set, priceThreshold/priceAbove/maxStaleness all
        // become meaningful together.
        bytes32 priceId; // Pyth price feed id, bytes32(0) = unset
        uint256 priceThreshold; // 18-decimal fixed-point USD price (e.g. 1.08 => 1_080000000000000000)
        bool priceAbove; // true = price must be >= threshold, false = price must be <= threshold
        uint256 maxStaleness; // seconds; stored oracle price older than this is rejected
    }

    /// @notice A single action step. Not every field applies to every ActionType;
    /// unused fields are ignored by the handler for that type.
    struct Action {
        ActionType kind;
        address[] recipients; // Split: N destinations; Forward/Sweep/Swap: recipients[0] is the one destination
        uint256[] amountsOrBps; // Split: per-recipient basis points (0-10000 each, sum <= 10000) of `fixedAmount`
        uint256 fixedAmount; // Forward: flat amount to send; Split: total amount being distributed; Swap: amountIn
        uint256 sweepThreshold; // Sweep: leave this much behind, sweep the rest to recipients[0]
        uint256 unlockTime; // LockRelease: unix timestamp funds become releasable
        address tokenIn; // Swap: token sold from the account (must be the pool's USDC or EURC)
        address tokenOut; // Swap: token bought and delivered to recipients[0] (the pool's other token)
        uint256 minAmountOut; // Swap: slippage floor — CanalisSwapPool.swap reverts "insufficient output" below this
        // Bridge (CCTP V2, Arc-native feature slice, spec §7.3 #3). Uses
        // `fixedAmount` for the burn amount (same field Forward/Split/Swap
        // already use) — does NOT use `recipients[]`; the cross-chain
        // recipient is `mintRecipient` below, a bytes32 (not an
        // address[]) since CCTP's mint recipient is chain-agnostic and
        // doesn't participate in Condition.allowedRecipients/
        // deniedRecipients (see CanalisExecutor._checkRecipients docs).
        uint32 destinationDomain; // Bridge: CCTP destination domain id (0 = Ethereum Sepolia)
        bytes32 mintRecipient; // Bridge: recipient on the destination domain, as bytes32 (EVM address left-padded)
    }

    /// @notice A complete flow: one trigger, any number of conditions/actions.
    /// Conditions are evaluated as a logical AND; actions run atomically in order.
    struct Flow {
        address owner; // the CanalisAccount this flow is registered against
        Trigger trigger;
        Condition[] conditions;
        Action[] actions;
        bool active;
        uint256 lastExecutedAt;
    }
}
