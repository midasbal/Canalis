// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {FlowTypes} from "./libraries/FlowTypes.sol";
import {ICanalisExecutor} from "./interfaces/ICanalisExecutor.sol";
import {CanalisAccount} from "./CanalisAccount.sol";

/// @title CanalisExecutor
/// @notice The single generic "money interpreter" for Canalis. Instead of
/// deploying a new contract per flow, every user's flow is stored here as
/// data and interpreted on execution. This keeps the system to one audited
/// contract, gas-efficient, and easy to extend with new action types.
///
/// STATUS: slice 3. `flow.owner` is the CanalisAccount the flow is
/// registered against (see FlowTypes.Flow); the human authorized to
/// register/manually run a flow is that account's `owner()` (Ownable).
/// Only TriggerType.Manual is implemented as a trigger; ActionType.Forward,
/// .Split, and .Sweep are implemented as actions; all Condition guard
/// fields (balance floor, time window, cooldown, allow/deny recipients,
/// amount cap) are implemented and enforced as a logical AND across every
/// Condition entry on a flow. OnReceive/OnSchedule/OnThreshold triggers and
/// LockRelease still explicitly revert. See docs/canalis-spec.md section 7
/// for the full build checklist.
contract CanalisExecutor is ICanalisExecutor, ReentrancyGuard {
    /// @dev flowId => Flow definition.
    mapping(uint256 => FlowTypes.Flow) private _flows;
    uint256 private _nextFlowId;

    modifier flowExists(uint256 flowId) {
        require(_flows[flowId].owner != address(0), "CanalisExecutor: unknown flow");
        _;
    }

    /// @inheritdoc ICanalisExecutor
    function registerFlow(FlowTypes.Flow calldata flow) external returns (uint256 flowId) {
        require(flow.owner != address(0), "CanalisExecutor: owner required");
        require(msg.sender == CanalisAccount(flow.owner).owner(), "CanalisExecutor: caller is not flow owner");

        flowId = _nextFlowId++;
        FlowTypes.Flow storage stored = _flows[flowId];

        stored.owner = flow.owner;
        stored.trigger = flow.trigger;
        stored.active = true;
        stored.lastExecutedAt = 0;

        for (uint256 i = 0; i < flow.conditions.length; i++) {
            stored.conditions.push(flow.conditions[i]);
        }
        for (uint256 i = 0; i < flow.actions.length; i++) {
            stored.actions.push(flow.actions[i]);
        }

        emit FlowRegistered(flowId, flow.owner);
    }

    /// @inheritdoc ICanalisExecutor
    function executeFlow(uint256 flowId) external nonReentrant flowExists(flowId) {
        FlowTypes.Flow storage flow = _flows[flowId];
        require(flow.active, "CanalisExecutor: flow inactive");

        _validateTrigger(flow);
        _evaluateConditions(flow);

        for (uint256 i = 0; i < flow.actions.length; i++) {
            _dispatchAction(flowId, i, flow.owner, flow.actions[i]);
        }

        flow.lastExecutedAt = block.timestamp;
        emit FlowExecuted(flowId, msg.sender, block.timestamp);
    }

    /// @inheritdoc ICanalisExecutor
    function getFlow(uint256 flowId) external view flowExists(flowId) returns (FlowTypes.Flow memory) {
        return _flows[flowId];
    }

    // ---------------------------------------------------------------------
    // Internal: trigger validation
    // ---------------------------------------------------------------------

    /// @dev Confirms the flow's trigger currently permits execution.
    /// Manual is implemented: only the CanalisAccount owner (the human
    /// wallet, via Ownable) may fire it. Every other trigger type still
    /// explicitly reverts rather than silently passing — see the TODOs
    /// below for their intended (future) authorization model.
    function _validateTrigger(FlowTypes.Flow storage flow) internal view {
        if (flow.trigger.kind == FlowTypes.TriggerType.Manual) {
            require(msg.sender == CanalisAccount(flow.owner).owner(), "CanalisExecutor: caller is not flow owner");
            return;
        }

        // TODO: OnReceive — event-driven from CanalisAccount on inbound
        // transfer; not caller-gated the way Manual is.
        // TODO: OnSchedule / OnThreshold — caller-agnostic (a keeper may
        // call executeFlow on anyone's behalf), but re-verify the schedule
        // time / balance threshold on-chain right here before proceeding,
        // so an untrusted keeper can never fire the flow falsely.
        revert("CanalisExecutor: trigger validation not yet implemented");
    }

    // ---------------------------------------------------------------------
    // Internal: condition evaluation
    // ---------------------------------------------------------------------

    /// @dev Evaluates every Condition entry on the flow as a logical AND —
    /// every field set on every entry must hold, in order: balance floor,
    /// time window, cooldown, allow/deny recipients, amount cap. The first
    /// field that fails reverts immediately with a specific reason; nothing
    /// here ever silently passes an unmet guard. A flow with zero Condition
    /// entries has nothing to check and falls through.
    ///
    /// Each check is a self-contained, side-effect-free `view` function
    /// keyed off `flow`/`condition` alone — this is a deliberate seam so a
    /// future keeper-driven "skip rather than revert" path can reuse the
    /// same per-field logic without restructuring it.
    function _evaluateConditions(FlowTypes.Flow storage flow) internal view {
        for (uint256 i = 0; i < flow.conditions.length; i++) {
            FlowTypes.Condition storage condition = flow.conditions[i];

            _checkBalanceFloor(flow.owner, condition);
            _checkTimeWindow(condition);
            _checkCooldown(flow, condition);
            _checkRecipients(flow, condition);
            _checkAmountCap(flow.owner, flow, condition);
        }
    }

    /// @dev Condition.minBalance: the account's live USDC balance must be
    /// at least `minBalance`. Sentinel: 0 = unset (no floor enforced).
    function _checkBalanceFloor(address account, FlowTypes.Condition storage condition) internal view {
        if (condition.minBalance == 0) return;
        require(
            CanalisAccount(account).balance() >= condition.minBalance, "CanalisExecutor: balance below minimum"
        );
    }

    /// @dev Condition.windowStart/windowEnd: block.timestamp must fall
    /// within [windowStart, windowEnd]. Each bound is independently
    /// optional — sentinel: 0 = unset for that bound, so a flow can be
    /// "no earlier than X" (windowEnd unset), "no later than Y" (windowStart
    /// unset), or a closed [X, Y] range (both set).
    function _checkTimeWindow(FlowTypes.Condition storage condition) internal view {
        if (condition.windowStart > 0) {
            require(block.timestamp >= condition.windowStart, "CanalisExecutor: before time window");
        }
        if (condition.windowEnd > 0) {
            require(block.timestamp <= condition.windowEnd, "CanalisExecutor: after time window");
        }
    }

    /// @dev Condition.cooldownSeconds: at least this many seconds must have
    /// elapsed since `flow.lastExecutedAt` (set by `executeFlow` on every
    /// successful run — see there). Sentinel: 0 = unset (no cooldown). A
    /// flow that has never executed (lastExecutedAt == 0) always passes:
    /// there is no prior run to cool down from.
    function _checkCooldown(FlowTypes.Flow storage flow, FlowTypes.Condition storage condition) internal view {
        if (condition.cooldownSeconds == 0) return;
        if (flow.lastExecutedAt == 0) return;
        require(
            block.timestamp - flow.lastExecutedAt >= condition.cooldownSeconds,
            "CanalisExecutor: cooldown not elapsed"
        );
    }

    /// @dev Condition.allowedRecipients/deniedRecipients: every recipient
    /// any action in this flow would pay out to (Forward: recipients[0];
    /// Split: all of recipients; Sweep: recipients[0]) must appear in
    /// allowedRecipients when that list is non-empty, and must never appear
    /// in deniedRecipients. Sentinel: empty array = no restriction for that
    /// list. Reverts name the offending recipient's address.
    function _checkRecipients(FlowTypes.Flow storage flow, FlowTypes.Condition storage condition) internal view {
        bool hasAllowlist = condition.allowedRecipients.length > 0;
        bool hasDenylist = condition.deniedRecipients.length > 0;
        if (!hasAllowlist && !hasDenylist) return;

        for (uint256 a = 0; a < flow.actions.length; a++) {
            address[] storage recipients = flow.actions[a].recipients;
            for (uint256 r = 0; r < recipients.length; r++) {
                address recipient = recipients[r];

                if (hasDenylist) {
                    require(
                        !_containsAddress(condition.deniedRecipients, recipient),
                        string.concat("CanalisExecutor: recipient denied: ", Strings.toHexString(recipient))
                    );
                }
                if (hasAllowlist) {
                    require(
                        _containsAddress(condition.allowedRecipients, recipient),
                        string.concat("CanalisExecutor: recipient not allowed: ", Strings.toHexString(recipient))
                    );
                }
            }
        }
    }

    function _containsAddress(address[] storage list, address target) internal view returns (bool) {
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == target) return true;
        }
        return false;
    }

    /// @dev Condition.minAmount/maxAmount bound the TOTAL amount moved by
    /// ALL actions in the flow, summed together — not enforced per-action.
    /// Sentinel: 0 = unset for each bound independently. Each action type's
    /// contribution to the total, per `_totalAmountMoved`: Forward/Split =
    /// `action.fixedAmount` (Forward's flat send / Split's distribution
    /// total); Sweep = `max(0, live account balance - action.sweepThreshold)`
    /// at evaluation time, mirroring exactly what `_handleSweep` will move if
    /// it runs; LockRelease contributes 0 (not implemented — its handler
    /// reverts on dispatch regardless of this check).
    function _checkAmountCap(address account, FlowTypes.Flow storage flow, FlowTypes.Condition storage condition)
        internal
        view
    {
        if (condition.minAmount == 0 && condition.maxAmount == 0) return;

        uint256 total = _totalAmountMoved(account, flow);
        if (condition.minAmount > 0) {
            require(total >= condition.minAmount, "CanalisExecutor: amount below minimum");
        }
        if (condition.maxAmount > 0) {
            require(total <= condition.maxAmount, "CanalisExecutor: amount exceeds cap");
        }
    }

    function _totalAmountMoved(address account, FlowTypes.Flow storage flow) internal view returns (uint256 total) {
        for (uint256 i = 0; i < flow.actions.length; i++) {
            FlowTypes.Action storage action = flow.actions[i];
            if (action.kind == FlowTypes.ActionType.Forward || action.kind == FlowTypes.ActionType.Split) {
                total += action.fixedAmount;
            } else if (action.kind == FlowTypes.ActionType.Sweep) {
                uint256 currentBalance = CanalisAccount(account).balance();
                if (currentBalance > action.sweepThreshold) {
                    total += currentBalance - action.sweepThreshold;
                }
            }
            // ActionType.LockRelease: not yet implemented, contributes 0.
        }
    }

    // ---------------------------------------------------------------------
    // Internal: action dispatch
    // ---------------------------------------------------------------------

    /// @dev Routes a single action to its type-specific handler. `account`
    /// is the flow's CanalisAccount (flow.owner) — the vault a handler
    /// pulls funds from via its onlyExecutor-gated `executorTransfer`.
    function _dispatchAction(uint256 flowId, uint256 actionIndex, address account, FlowTypes.Action storage action)
        internal
    {
        if (action.kind == FlowTypes.ActionType.Split) {
            _handleSplit(account, action);
        } else if (action.kind == FlowTypes.ActionType.Forward) {
            _handleForward(account, action);
        } else if (action.kind == FlowTypes.ActionType.Sweep) {
            _handleSweep(account, action);
        } else if (action.kind == FlowTypes.ActionType.LockRelease) {
            _handleLockRelease(account, action);
        } else {
            revert("CanalisExecutor: unknown action type");
        }

        emit ActionExecuted(flowId, actionIndex, action.kind);
    }

    /// @dev Distributes `action.fixedAmount` (the total) across
    /// `action.recipients` by `action.amountsOrBps` (basis points, 0-10000
    /// each, summing to at most 10000). `recipients[i]` gets
    /// `fixedAmount * amountsOrBps[i] / 10000`; integer-division remainder
    /// and any unallocated basis points simply stay in `account` — this is
    /// not a bug, there is nowhere else for a fractional/unassigned share
    /// to go. Recipients with a 0 bps share are skipped rather than making
    /// a zero-amount `executorTransfer` call (which would revert).
    function _handleSplit(address account, FlowTypes.Action storage action) internal {
        uint256 n = action.recipients.length;
        require(n >= 1, "CanalisExecutor: Split requires at least one recipient");
        require(n == action.amountsOrBps.length, "CanalisExecutor: Split recipients/bps length mismatch");
        require(action.fixedAmount > 0, "CanalisExecutor: Split total must be positive");

        uint256 totalBps = 0;
        for (uint256 i = 0; i < n; i++) {
            require(action.recipients[i] != address(0), "CanalisExecutor: Split recipient cannot be zero address");
            totalBps += action.amountsOrBps[i];
        }
        require(totalBps <= 10_000, "CanalisExecutor: Split basis points exceed 100%");

        for (uint256 i = 0; i < n; i++) {
            uint256 share = (action.fixedAmount * action.amountsOrBps[i]) / 10_000;
            if (share > 0) {
                CanalisAccount(account).executorTransfer(action.recipients[i], share);
            }
        }
    }

    /// @dev Moves `action.fixedAmount` USDC from `account` to
    /// `action.recipients[0]`, via CanalisAccount's onlyExecutor-gated
    /// `executorTransfer`. This is the only action implemented in this
    /// slice.
    function _handleForward(address account, FlowTypes.Action storage action) internal {
        require(action.recipients.length == 1, "CanalisExecutor: Forward requires exactly one recipient");
        require(action.fixedAmount > 0, "CanalisExecutor: Forward amount must be positive");

        CanalisAccount(account).executorTransfer(action.recipients[0], action.fixedAmount);
    }

    /// @dev Moves whatever `account` holds above `action.sweepThreshold` to
    /// `action.recipients[0]`. If the current balance is at or below the
    /// threshold there is nothing to sweep — this is an honest no-op (no
    /// `executorTransfer` call, no fake movement); `ActionExecuted` still
    /// fires from `_dispatchAction` either way, since reaching that point
    /// without reverting is itself meaningful (the sweep ran, it just had
    /// nothing to do).
    function _handleSweep(address account, FlowTypes.Action storage action) internal {
        require(action.recipients.length >= 1, "CanalisExecutor: Sweep requires a destination");
        address destination = action.recipients[0];
        require(destination != address(0), "CanalisExecutor: Sweep destination cannot be zero address");

        uint256 currentBalance = CanalisAccount(account).balance();
        uint256 threshold = action.sweepThreshold;

        if (currentBalance > threshold) {
            CanalisAccount(account).executorTransfer(destination, currentBalance - threshold);
        }
    }

    /// TODO: lock funds until action.unlockTime, then release from
    /// `account` to recipients. Not implemented in this slice.
    function _handleLockRelease(address, /* account */ FlowTypes.Action storage /* action */ ) internal pure {
        revert("CanalisExecutor: LockRelease not yet implemented");
    }
}
