// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {FlowTypes} from "./libraries/FlowTypes.sol";
import {ICanalisExecutor} from "./interfaces/ICanalisExecutor.sol";
import {CanalisAccount} from "./CanalisAccount.sol";

/// @title CanalisExecutor
/// @notice The single generic "money interpreter" for Canalis. Instead of
/// deploying a new contract per flow, every user's flow is stored here as
/// data and interpreted on execution. This keeps the system to one audited
/// contract, gas-efficient, and easy to extend with new action types.
///
/// STATUS: slice 4. `flow.owner` is the CanalisAccount the flow is
/// registered against (see FlowTypes.Flow); the human authorized to
/// register/manually run a flow is that account's `owner()` (Ownable).
/// All four triggers (Manual, OnSchedule, OnThreshold, OnReceive) and all
/// four actions (Forward, Split, Sweep, LockRelease) are implemented; all
/// Condition guard fields (balance floor, time window, cooldown, allow/deny
/// recipients, amount cap) are implemented and enforced as a logical AND
/// across every Condition entry on a flow. See docs/canalis-spec.md
/// section 7 for the full build checklist.
///
/// AUTH & FAILURE MODEL for non-Manual triggers (slice 4 design decision):
/// Manual stays owner-only (`msg.sender == account.owner()`). OnSchedule,
/// OnThreshold, and OnReceive are caller-agnostic — ANY address (in
/// practice, an off-chain keeper) may call `executeFlow` for these — because
/// the trust boundary is the on-chain precondition re-check performed here,
/// not who calls it. If that precondition doesn't hold (schedule not due,
/// threshold not met, no new deposit to consume), `executeFlow` REVERTS
/// with a specific reason rather than silently no-op'ing, so a keeper can
/// call it speculatively, eat a cheap revert, and move on — it never looks
/// like a flow "ran" when it didn't. Conditions (the Condition[] guard list)
/// are evaluated identically regardless of trigger type, always AFTER the
/// trigger check passes.
contract CanalisExecutor is ICanalisExecutor, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Tracks a LockRelease action's escrow lifecycle. Funds are held
    /// by THIS contract (the executor), not the CanalisAccount, between
    /// lock and release — see `_handleLockRelease` for why.
    enum LockState {
        None,
        Locked,
        Released
    }

    /// @dev flowId => Flow definition.
    mapping(uint256 => FlowTypes.Flow) private _flows;
    uint256 private _nextFlowId;

    /// @dev flowId => the account's `depositNonce` value already consumed
    /// by an OnReceive execution of that flow. See `_validateTrigger`.
    mapping(uint256 => uint256) private _lastConsumedDepositNonce;

    /// @dev (flowId, actionIndex) => LockRelease escrow state for that
    /// specific action slot. See `_handleLockRelease`.
    mapping(uint256 => mapping(uint256 => LockState)) private _lockState;

    modifier flowExists(uint256 flowId) {
        require(_flows[flowId].owner != address(0), "CanalisExecutor: unknown flow");
        _;
    }

    /// @inheritdoc ICanalisExecutor
    function registerFlow(FlowTypes.Flow calldata flow) external returns (uint256 flowId) {
        require(flow.owner != address(0), "CanalisExecutor: owner required");
        require(msg.sender == CanalisAccount(flow.owner).owner(), "CanalisExecutor: caller is not flow owner");
        if (flow.trigger.kind == FlowTypes.TriggerType.OnThreshold) {
            // Slice 4 scope: only the "fires at/above threshold" direction
            // is implemented (see class docs / spec section 7). Fail fast
            // at registration rather than letting a "below" flow sit
            // forever unable to fire.
            require(flow.trigger.thresholdIsAbove, "CanalisExecutor: only at/above threshold supported");
        }

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

        if (flow.trigger.kind == FlowTypes.TriggerType.OnReceive) {
            // Snapshot the account's current depositNonce as this flow's
            // baseline, so deposits that already happened before this flow
            // existed don't count as a "new" one — only deposits strictly
            // after registration make an OnReceive flow eligible.
            _lastConsumedDepositNonce[flowId] = CanalisAccount(flow.owner).depositNonce();
        }

        emit FlowRegistered(flowId, flow.owner);
    }

    /// @inheritdoc ICanalisExecutor
    function executeFlow(uint256 flowId) external nonReentrant flowExists(flowId) {
        FlowTypes.Flow storage flow = _flows[flowId];
        require(flow.active, "CanalisExecutor: flow inactive");

        _validateTrigger(flowId, flow);
        _evaluateConditions(flowId, flow);

        for (uint256 i = 0; i < flow.actions.length; i++) {
            _dispatchAction(flowId, i, flow.owner, flow.actions[i]);
        }

        _advanceTrigger(flowId, flow);
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

    /// @dev Confirms the flow's trigger currently permits execution. See
    /// the class-level AUTH & FAILURE MODEL docs: Manual is caller-gated
    /// (owner only); OnSchedule/OnThreshold/OnReceive are caller-agnostic
    /// and instead re-verify their on-chain precondition, reverting with a
    /// specific reason when it doesn't hold rather than silently no-op'ing.
    function _validateTrigger(uint256 flowId, FlowTypes.Flow storage flow) internal view {
        FlowTypes.TriggerType kind = flow.trigger.kind;

        if (kind == FlowTypes.TriggerType.Manual) {
            require(msg.sender == CanalisAccount(flow.owner).owner(), "CanalisExecutor: caller is not flow owner");
            return;
        }

        if (kind == FlowTypes.TriggerType.OnSchedule) {
            // `trigger.scheduleAt` doubles as "next run at" — see
            // `_advanceTrigger`, which mutates it forward on every
            // successful execution.
            require(block.timestamp >= flow.trigger.scheduleAt, "CanalisExecutor: schedule not due");
            return;
        }

        if (kind == FlowTypes.TriggerType.OnThreshold) {
            // Direction is validated once at registration (only "at/above"
            // is supported this slice); re-check the live balance here.
            require(
                CanalisAccount(flow.owner).balance() >= flow.trigger.thresholdAmount,
                "CanalisExecutor: threshold not met"
            );
            return;
        }

        if (kind == FlowTypes.TriggerType.OnReceive) {
            // Deposits routed through CanalisAccount.deposit() bump
            // depositNonce; a flow is eligible exactly once per deposit
            // that arrived since this flow last consumed one. See
            // `_advanceTrigger` for the consuming side.
            uint256 depositNonce = CanalisAccount(flow.owner).depositNonce();
            require(depositNonce > _lastConsumedDepositNonce[flowId], "CanalisExecutor: no new deposit to consume");
            return;
        }

        revert("CanalisExecutor: unknown trigger type");
    }

    /// @dev Advances trigger-specific state after a successful execution
    /// (actions already ran atomically by the time this is called). Manual
    /// and OnThreshold need nothing here — they re-derive their check from
    /// live state every call.
    function _advanceTrigger(uint256 flowId, FlowTypes.Flow storage flow) internal {
        FlowTypes.TriggerType kind = flow.trigger.kind;

        if (kind == FlowTypes.TriggerType.OnSchedule) {
            uint256 interval = flow.trigger.scheduleInterval;
            if (interval == 0) {
                // One-shot: never due again. A sentinel far beyond any real
                // timestamp, rather than a magic "inactive" flag reused
                // from elsewhere.
                flow.trigger.scheduleAt = type(uint256).max;
            } else {
                // Catch-up without looping: jump directly to the next
                // interval boundary strictly after "now", so a keeper that
                // missed several periods fires once, not once per missed
                // period.
                uint256 scheduleAt = flow.trigger.scheduleAt;
                uint256 elapsed = block.timestamp - scheduleAt;
                flow.trigger.scheduleAt = scheduleAt + (elapsed / interval + 1) * interval;
            }
            return;
        }

        if (kind == FlowTypes.TriggerType.OnReceive) {
            _lastConsumedDepositNonce[flowId] = CanalisAccount(flow.owner).depositNonce();
        }
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
    function _evaluateConditions(uint256 flowId, FlowTypes.Flow storage flow) internal view {
        for (uint256 i = 0; i < flow.conditions.length; i++) {
            FlowTypes.Condition storage condition = flow.conditions[i];

            _checkBalanceFloor(flow.owner, condition);
            _checkTimeWindow(condition);
            _checkCooldown(flow, condition);
            _checkRecipients(flow, condition);
            _checkAmountCap(flowId, flow.owner, flow, condition);
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
    /// it runs; LockRelease = `action.fixedAmount` whenever this call would
    /// still move money (locking in or releasing out), 0 once already
    /// released (a further call reverts in the handler regardless).
    function _checkAmountCap(
        uint256 flowId,
        address account,
        FlowTypes.Flow storage flow,
        FlowTypes.Condition storage condition
    ) internal view {
        if (condition.minAmount == 0 && condition.maxAmount == 0) return;

        uint256 total = _totalAmountMoved(flowId, account, flow);
        if (condition.minAmount > 0) {
            require(total >= condition.minAmount, "CanalisExecutor: amount below minimum");
        }
        if (condition.maxAmount > 0) {
            require(total <= condition.maxAmount, "CanalisExecutor: amount exceeds cap");
        }
    }

    function _totalAmountMoved(uint256 flowId, address account, FlowTypes.Flow storage flow)
        internal
        view
        returns (uint256 total)
    {
        for (uint256 i = 0; i < flow.actions.length; i++) {
            FlowTypes.Action storage action = flow.actions[i];
            if (action.kind == FlowTypes.ActionType.Forward || action.kind == FlowTypes.ActionType.Split) {
                total += action.fixedAmount;
            } else if (action.kind == FlowTypes.ActionType.Sweep) {
                uint256 currentBalance = CanalisAccount(account).balance();
                if (currentBalance > action.sweepThreshold) {
                    total += currentBalance - action.sweepThreshold;
                }
            } else if (action.kind == FlowTypes.ActionType.LockRelease) {
                if (_lockState[flowId][i] != LockState.Released) {
                    total += action.fixedAmount;
                }
            }
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
            _handleLockRelease(flowId, actionIndex, account, action);
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

    /// @dev Two-phase escrow keyed by (flowId, actionIndex):
    ///
    /// FUND TRACKING DECISION: locked funds are held by the EXECUTOR
    /// contract itself, not the CanalisAccount. The lock phase moves
    /// `action.fixedAmount` out of `account` via `executorTransfer` into
    /// this contract's own USDC balance; the release phase pays it out
    /// directly from here. Rationale: `CanalisAccount.balance()` is what
    /// every other condition/action (balance floor, amount cap, Sweep) reads
    /// as "spendable" — if locked funds stayed in the account under a
    /// separate ledger, every one of those call sites would need to learn
    /// to subtract them out, or risk a Sweep silently carrying away funds
    /// that are supposed to be locked. Physically relocating them removes
    /// that whole class of double-spend bug for free.
    ///
    /// - First call for a given (flowId, actionIndex) (state == None): locks
    ///   — pulls `action.fixedAmount` from `account` into the executor and
    ///   marks state Locked. Does not check `unlockTime` yet; the lock
    ///   itself is unconditional once dispatched.
    /// - A later call while Locked and `block.timestamp < action.unlockTime`:
    ///   reverts "still locked" — no funds move.
    /// - A later call while Locked and `block.timestamp >= action.unlockTime`:
    ///   releases — pays `action.fixedAmount` to `action.recipients[0]` from
    ///   the executor's own balance and marks state Released.
    /// - Any call once Released: reverts "already released" — release can
    ///   only ever happen once per (flowId, actionIndex), so double-release
    ///   is structurally impossible, not just guarded against.
    function _handleLockRelease(uint256 flowId, uint256 actionIndex, address account, FlowTypes.Action storage action)
        internal
    {
        require(action.recipients.length >= 1, "CanalisExecutor: LockRelease requires a recipient");
        address recipient = action.recipients[0];
        require(recipient != address(0), "CanalisExecutor: LockRelease recipient cannot be zero address");
        require(action.fixedAmount > 0, "CanalisExecutor: LockRelease amount must be positive");
        require(action.unlockTime > 0, "CanalisExecutor: LockRelease unlockTime required");

        LockState state = _lockState[flowId][actionIndex];

        if (state == LockState.None) {
            _lockState[flowId][actionIndex] = LockState.Locked;
            CanalisAccount(account).executorTransfer(address(this), action.fixedAmount);
            return;
        }

        require(state != LockState.Released, "CanalisExecutor: already released");
        require(block.timestamp >= action.unlockTime, "CanalisExecutor: still locked");

        _lockState[flowId][actionIndex] = LockState.Released;
        IERC20(CanalisAccount(account).usdc()).safeTransfer(recipient, action.fixedAmount);
    }
}
