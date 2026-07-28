// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {FlowTypes} from "./libraries/FlowTypes.sol";
import {ICanalisExecutor} from "./interfaces/ICanalisExecutor.sol";
import {CanalisAccount} from "./CanalisAccount.sol";
import {CanalisSwapPool} from "./CanalisSwapPool.sol";
import {IPyth, PythStructs} from "./interfaces/IPyth.sol";

/// @title CanalisExecutor
/// @notice The single generic "money interpreter" for Canalis. Instead of
/// deploying a new contract per flow, every user's flow is stored here as
/// data and interpreted on execution. This keeps the system to one audited
/// contract, gas-efficient, and easy to extend with new action types.
///
/// STATUS: slice 4 + engine-for-UI addendum. `flow.owner` is the
/// CanalisAccount the flow is registered against (see FlowTypes.Flow); the
/// human authorized to register/manually run/pause a flow is that
/// account's `owner()` (Ownable). All four triggers (Manual, OnSchedule,
/// OnThreshold, OnReceive) and all four actions (Forward, Split, Sweep,
/// LockRelease) are implemented; all Condition guard fields (balance floor,
/// time window, cooldown, allow/deny recipients, amount cap) are
/// implemented and enforced as a logical AND across every Condition entry
/// on a flow. See docs/canalis-spec.md section 7 for the full build
/// checklist.
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
/// trigger check passes. `setFlowActive` (pause/cancel) is checked before
/// any of this and blocks every trigger type identically, including
/// keeper-driven ones.
///
/// ENGINE-FOR-UI ADDENDUM: `_checkTrigger`/`_checkConditions` are the
/// single non-reverting source of truth both `executeFlow` (via thin
/// `require`-wrapping callers `_validateTrigger`/`_evaluateConditions`) and
/// `previewFlow` build on — the two paths cannot diverge because one calls
/// the other. `flowsOf` resolves the "no per-owner enumeration" gap flagged
/// in the slice-4 keeper design. `ActionExecuted` now carries the real
/// recipient/amount of each transfer (see each action handler's docs for
/// the exact per-type semantics).
///
/// ARC-NATIVE FEATURE: Swap. Rather than routing through a third-party DEX
/// (the spec's original plan), Canalis deploys and owns its own minimal
/// constant-product AMM (`CanalisSwapPool`, USDC/EURC) — see that
/// contract's docs for why. One pool is configured at construction
/// (`swapPool`, immutable) and every Swap action routes through it.
/// ACCOUNT-VS-RECIPIENT DESIGN DECISION: `CanalisAccount` is single-token
/// (USDC-custodying) by design — see its own docs. Rather than generalizing
/// it to hold arbitrary ERC20s (more powerful, more surface, more ways to
/// strand funds) for this slice, `_handleSwap` delivers the swapped-out
/// token directly to a recipient ADDRESS named in the action
/// (`recipients[0]`), the same convention Forward/Sweep/LockRelease already
/// use. "Swap and pay out" rather than "swap and hold" — simplest correct
/// path that needs zero CanalisAccount changes; see `_handleSwap` for the
/// exact custody path.
///
/// ARC-NATIVE FEATURE: Oracle price condition (spec section 7.3 #2). A
/// `Condition` can additionally require a live Pyth price to be
/// above/below a threshold (`FlowTypes.Condition.priceId`/`priceThreshold`/
/// `priceAbove`/`maxStaleness`). `oracle` (immutable, constructor-configured
/// like `swapPool`) is the real Pyth contract deployed on Arc testnet — see
/// `_checkOracleCondition`. This is a READ-ONLY consumer: CanalisExecutor
/// never calls `updatePriceFeeds` itself (that would make `_checkConditions`
/// — a `view` function shared by `previewFlow` — a state-mutating call);
/// keeping the stored price fresh is the off-chain keeper's job (see
/// keeper/README.md), exactly like OnSchedule/OnThreshold's precondition
/// re-checks are the keeper's job to poke, not decide.
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

    /// @dev owner (a CanalisAccount address, i.e. `flow.owner`) => flow ids
    /// registered against it, in registration order. Powers `flowsOf` —
    /// resolves the earlier "no per-owner enumeration" gap. Append-only:
    /// pausing/cancelling a flow (`setFlowActive`) does not remove it here,
    /// it stays listed with `active == false` (see `getFlow`).
    mapping(address => uint256[]) private _flowsByOwner;

    /// @dev flowId => the account's `depositNonce` value already consumed
    /// by an OnReceive execution of that flow. See `_validateTrigger`.
    mapping(uint256 => uint256) private _lastConsumedDepositNonce;

    /// @dev (flowId, actionIndex) => LockRelease escrow state for that
    /// specific action slot. See `_handleLockRelease`.
    mapping(uint256 => mapping(uint256 => LockState)) private _lockState;

    /// @dev The single CanalisSwapPool every Swap action routes through
    /// (see class docs "Arc-native feature: Swap"). One configured pool,
    /// not a per-action pool address — simpler, and matches this slice's
    /// single USDC/EURC pair.
    CanalisSwapPool public immutable swapPool;

    /// @dev The single Pyth oracle contract every oracle price condition
    /// reads from (see FlowTypes.Condition.priceId / class docs "ARC-NATIVE
    /// FEATURE: Oracle price condition" below). Configured at construction
    /// like `swapPool` — never hardcoded, never a mock: this must be the
    /// real Pyth contract deployed on Arc testnet.
    IPyth public immutable oracle;

    modifier flowExists(uint256 flowId) {
        require(_flows[flowId].owner != address(0), "CanalisExecutor: unknown flow");
        _;
    }

    constructor(address swapPool_, address oracle_) {
        require(swapPool_ != address(0), "CanalisExecutor: swapPool required");
        require(oracle_ != address(0), "CanalisExecutor: oracle required");
        swapPool = CanalisSwapPool(swapPool_);
        oracle = IPyth(oracle_);
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
        for (uint256 i = 0; i < flow.conditions.length; i++) {
            if (flow.conditions[i].priceId != bytes32(0)) {
                // Fail fast rather than registering a condition that would
                // reject on staleness at every evaluation (age > 0 always
                // exceeds a maxStaleness of 0).
                require(flow.conditions[i].maxStaleness > 0, "CanalisExecutor: maxStaleness required with priceId");
            }
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

        _flowsByOwner[flow.owner].push(flowId);

        emit FlowRegistered(flowId, flow.owner);
    }

    /// @inheritdoc ICanalisExecutor
    function setFlowActive(uint256 flowId, bool active) external flowExists(flowId) {
        FlowTypes.Flow storage flow = _flows[flowId];
        // Same auth model as executeFlow's Manual path: only the human
        // wallet that owns the flow's CanalisAccount may pause/unpause it,
        // regardless of the flow's trigger type.
        require(msg.sender == CanalisAccount(flow.owner).owner(), "CanalisExecutor: caller is not flow owner");
        flow.active = active;
        emit FlowActiveSet(flowId, active);
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

    /// @inheritdoc ICanalisExecutor
    function previewFlow(uint256 flowId) external view flowExists(flowId) returns (bool canRun, string memory reason) {
        FlowTypes.Flow storage flow = _flows[flowId];

        if (!flow.active) return (false, "CanalisExecutor: flow inactive");

        (canRun, reason) = _checkTrigger(flowId, flow);
        if (!canRun) return (canRun, reason);

        return _checkConditions(flowId, flow);
    }

    /// @inheritdoc ICanalisExecutor
    function flowsOf(address owner) external view returns (uint256[] memory) {
        return _flowsByOwner[owner];
    }

    // ---------------------------------------------------------------------
    // Internal: trigger validation
    // ---------------------------------------------------------------------

    /// @dev Reverting wrapper around `_checkTrigger`, used by `executeFlow`.
    /// See the class-level AUTH & FAILURE MODEL docs: Manual is
    /// caller-gated (owner only); OnSchedule/OnThreshold/OnReceive are
    /// caller-agnostic and instead re-verify their on-chain precondition,
    /// reverting with a specific reason when it doesn't hold rather than
    /// silently no-op'ing.
    function _validateTrigger(uint256 flowId, FlowTypes.Flow storage flow) internal view {
        (bool ok, string memory reason) = _checkTrigger(flowId, flow);
        require(ok, reason);
    }

    /// @dev Non-reverting trigger check — the single source of truth both
    /// `_validateTrigger` (executeFlow's revert path) and `previewFlow`
    /// build on, so the two can never diverge. See `_validateTrigger` for
    /// the per-trigger-type semantics; this returns the same verdict as a
    /// (bool, reason) pair instead of reverting.
    function _checkTrigger(uint256 flowId, FlowTypes.Flow storage flow) internal view returns (bool, string memory) {
        FlowTypes.TriggerType kind = flow.trigger.kind;

        if (kind == FlowTypes.TriggerType.Manual) {
            if (msg.sender != CanalisAccount(flow.owner).owner()) {
                return (false, "CanalisExecutor: caller is not flow owner");
            }
            return (true, "");
        }

        if (kind == FlowTypes.TriggerType.OnSchedule) {
            // `trigger.scheduleAt` doubles as "next run at" — see
            // `_advanceTrigger`, which mutates it forward on every
            // successful execution.
            if (block.timestamp < flow.trigger.scheduleAt) {
                return (false, "CanalisExecutor: schedule not due");
            }
            return (true, "");
        }

        if (kind == FlowTypes.TriggerType.OnThreshold) {
            // Direction is validated once at registration (only "at/above"
            // is supported this slice); re-check the live balance here.
            if (CanalisAccount(flow.owner).balance() < flow.trigger.thresholdAmount) {
                return (false, "CanalisExecutor: threshold not met");
            }
            return (true, "");
        }

        if (kind == FlowTypes.TriggerType.OnReceive) {
            // Deposits routed through CanalisAccount.deposit() bump
            // depositNonce; a flow is eligible exactly once per deposit
            // that arrived since this flow last consumed one. See
            // `_advanceTrigger` for the consuming side.
            uint256 depositNonce = CanalisAccount(flow.owner).depositNonce();
            if (depositNonce <= _lastConsumedDepositNonce[flowId]) {
                return (false, "CanalisExecutor: no new deposit to consume");
            }
            return (true, "");
        }

        return (false, "CanalisExecutor: unknown trigger type");
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

    /// @dev Reverting wrapper around `_checkConditions`, used by
    /// `executeFlow`.
    function _evaluateConditions(uint256 flowId, FlowTypes.Flow storage flow) internal view {
        (bool ok, string memory reason) = _checkConditions(flowId, flow);
        require(ok, reason);
    }

    /// @dev Non-reverting condition check — the single source of truth
    /// both `_evaluateConditions` (executeFlow's revert path) and
    /// `previewFlow` build on, so the two can never diverge. Evaluates
    /// every Condition entry on the flow as a logical AND — every field set
    /// on every entry must hold, in order: balance floor, time window,
    /// cooldown, allow/deny recipients, amount cap. Returns the first unmet
    /// field's reason, or (true, "") if every field on every entry passes.
    /// A flow with zero Condition entries has nothing to check and passes
    /// trivially.
    ///
    /// Each per-field check is a self-contained, side-effect-free `view`
    /// function keyed off `flow`/`condition` alone.
    function _checkConditions(uint256 flowId, FlowTypes.Flow storage flow) internal view returns (bool, string memory) {
        for (uint256 i = 0; i < flow.conditions.length; i++) {
            FlowTypes.Condition storage condition = flow.conditions[i];
            bool ok;
            string memory reason;

            (ok, reason) = _checkBalanceFloor(flow.owner, condition);
            if (!ok) return (false, reason);
            (ok, reason) = _checkTimeWindow(condition);
            if (!ok) return (false, reason);
            (ok, reason) = _checkCooldown(flow, condition);
            if (!ok) return (false, reason);
            (ok, reason) = _checkRecipients(flow, condition);
            if (!ok) return (false, reason);
            (ok, reason) = _checkAmountCap(flowId, flow.owner, flow, condition);
            if (!ok) return (false, reason);
            (ok, reason) = _checkOracleCondition(condition);
            if (!ok) return (false, reason);
        }
        return (true, "");
    }

    /// @dev Condition.minBalance: the account's live USDC balance must be
    /// at least `minBalance`. Sentinel: 0 = unset (no floor enforced).
    function _checkBalanceFloor(address account, FlowTypes.Condition storage condition)
        internal
        view
        returns (bool, string memory)
    {
        if (condition.minBalance == 0) return (true, "");
        if (CanalisAccount(account).balance() < condition.minBalance) {
            return (false, "CanalisExecutor: balance below minimum");
        }
        return (true, "");
    }

    /// @dev Condition.windowStart/windowEnd: block.timestamp must fall
    /// within [windowStart, windowEnd]. Each bound is independently
    /// optional — sentinel: 0 = unset for that bound, so a flow can be
    /// "no earlier than X" (windowEnd unset), "no later than Y" (windowStart
    /// unset), or a closed [X, Y] range (both set).
    function _checkTimeWindow(FlowTypes.Condition storage condition) internal view returns (bool, string memory) {
        if (condition.windowStart > 0 && block.timestamp < condition.windowStart) {
            return (false, "CanalisExecutor: before time window");
        }
        if (condition.windowEnd > 0 && block.timestamp > condition.windowEnd) {
            return (false, "CanalisExecutor: after time window");
        }
        return (true, "");
    }

    /// @dev Condition.cooldownSeconds: at least this many seconds must have
    /// elapsed since `flow.lastExecutedAt` (set by `executeFlow` on every
    /// successful run — see there). Sentinel: 0 = unset (no cooldown). A
    /// flow that has never executed (lastExecutedAt == 0) always passes:
    /// there is no prior run to cool down from.
    function _checkCooldown(FlowTypes.Flow storage flow, FlowTypes.Condition storage condition)
        internal
        view
        returns (bool, string memory)
    {
        if (condition.cooldownSeconds == 0) return (true, "");
        if (flow.lastExecutedAt == 0) return (true, "");
        if (block.timestamp - flow.lastExecutedAt < condition.cooldownSeconds) {
            return (false, "CanalisExecutor: cooldown not elapsed");
        }
        return (true, "");
    }

    /// @dev Condition.allowedRecipients/deniedRecipients: every recipient
    /// any action in this flow would pay out to (Forward: recipients[0];
    /// Split: all of recipients; Sweep: recipients[0]) must appear in
    /// allowedRecipients when that list is non-empty, and must never appear
    /// in deniedRecipients. Sentinel: empty array = no restriction for that
    /// list. The reason names the offending recipient's address.
    function _checkRecipients(FlowTypes.Flow storage flow, FlowTypes.Condition storage condition)
        internal
        view
        returns (bool, string memory)
    {
        bool hasAllowlist = condition.allowedRecipients.length > 0;
        bool hasDenylist = condition.deniedRecipients.length > 0;
        if (!hasAllowlist && !hasDenylist) return (true, "");

        for (uint256 a = 0; a < flow.actions.length; a++) {
            address[] storage recipients = flow.actions[a].recipients;
            for (uint256 r = 0; r < recipients.length; r++) {
                address recipient = recipients[r];

                if (hasDenylist && _containsAddress(condition.deniedRecipients, recipient)) {
                    return (false, string.concat("CanalisExecutor: recipient denied: ", Strings.toHexString(recipient)));
                }
                if (hasAllowlist && !_containsAddress(condition.allowedRecipients, recipient)) {
                    return (
                        false, string.concat("CanalisExecutor: recipient not allowed: ", Strings.toHexString(recipient))
                    );
                }
            }
        }
        return (true, "");
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
    ) internal view returns (bool, string memory) {
        if (condition.minAmount == 0 && condition.maxAmount == 0) return (true, "");

        uint256 total = _totalAmountMoved(flowId, account, flow);
        if (condition.minAmount > 0 && total < condition.minAmount) {
            return (false, "CanalisExecutor: amount below minimum");
        }
        if (condition.maxAmount > 0 && total > condition.maxAmount) {
            return (false, "CanalisExecutor: amount exceeds cap");
        }
        return (true, "");
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
            } else if (action.kind == FlowTypes.ActionType.Swap) {
                // Counts the amountIn actually taken from the account, not
                // the (variable, price-dependent) amountOut delivered.
                total += action.fixedAmount;
            }
        }
    }

    /// @dev Condition.priceId/priceThreshold/priceAbove/maxStaleness: a
    /// live Pyth price read, enforced against the flow's configured
    /// threshold. Sentinel: `priceId == bytes32(0)` = unset (no oracle
    /// constraint) — the common case, checked first so flows without an
    /// oracle condition pay nothing extra.
    ///
    /// Uses `oracle.getPriceUnsafe` (never reverts on staleness — only if
    /// the feed itself is unknown) and does the staleness comparison here
    /// against the flow's OWN `maxStaleness`, rather than
    /// `getPriceNoOlderThan`'s fixed bound baked into the call. Wrapped in
    /// try/catch so an oracle-side revert (e.g. unknown feed id) surfaces
    /// as a normal (false, reason) result — this function must never
    /// revert, since it's shared by `previewFlow`'s non-reverting
    /// dry-run contract.
    ///
    /// PRICE NORMALIZATION: Pyth prices are `price * 10**expo`; this
    /// contract normalizes every feed to an 18-decimal fixed-point USD
    /// value via `_normalizePrice18` so `priceThreshold` has one fixed,
    /// documented unit regardless of a feed's native `expo` (e.g. -5 for
    /// FX pairs, -8 for crypto pairs) — see FlowTypes.Condition docs.
    function _checkOracleCondition(FlowTypes.Condition storage condition) internal view returns (bool, string memory) {
        if (condition.priceId == bytes32(0)) return (true, "");

        try oracle.getPriceUnsafe(condition.priceId) returns (PythStructs.Price memory p) {
            if (p.price <= 0) return (false, "CanalisExecutor: oracle price invalid");

            uint256 age = block.timestamp >= p.publishTime ? block.timestamp - p.publishTime : 0;
            if (age > condition.maxStaleness) return (false, "CanalisExecutor: oracle price stale");

            uint256 normalized = _normalizePrice18(uint64(p.price), p.expo);
            if (condition.priceAbove) {
                if (normalized < condition.priceThreshold) return (false, "CanalisExecutor: price condition not met");
            } else {
                if (normalized > condition.priceThreshold) return (false, "CanalisExecutor: price condition not met");
            }
            return (true, "");
        } catch {
            return (false, "CanalisExecutor: oracle price unavailable");
        }
    }

    /// @dev Rescales a Pyth `(price, expo)` pair (real value = `price *
    /// 10**expo`) to an 18-decimal fixed-point uint256 (real value =
    /// `result / 1e18`). `expo` is virtually always negative for Pyth spot
    /// feeds (e.g. -5 FX, -8 crypto) but the positive/zero branch is
    /// handled too for completeness. Truncates (loses precision) only when
    /// `-expo > 18`, which no current Pyth feed exceeds.
    function _normalizePrice18(uint64 price, int32 expo) internal pure returns (uint256) {
        if (expo >= 0) {
            return uint256(price) * (10 ** uint32(expo)) * 1e18;
        }
        uint32 absExpo = uint32(-expo);
        if (absExpo <= 18) {
            return uint256(price) * (10 ** (18 - absExpo));
        }
        return uint256(price) / (10 ** (absExpo - 18));
    }

    // ---------------------------------------------------------------------
    // Internal: action dispatch
    // ---------------------------------------------------------------------

    /// @dev Routes a single action to its type-specific handler. `account`
    /// is the flow's CanalisAccount (flow.owner) — the vault a handler
    /// pulls funds from via its onlyExecutor-gated `executorTransfer`. Each
    /// handler emits its own `ActionExecuted` event(s) for the real
    /// transfer(s) it performs — see each handler's docs for the exact
    /// recipient/amount semantics (this varies for Split's N legs and
    /// LockRelease's two phases; see ICanalisExecutor's event docs for the
    /// summary).
    function _dispatchAction(uint256 flowId, uint256 actionIndex, address account, FlowTypes.Action storage action)
        internal
    {
        if (action.kind == FlowTypes.ActionType.Split) {
            _handleSplit(flowId, actionIndex, account, action);
        } else if (action.kind == FlowTypes.ActionType.Forward) {
            _handleForward(flowId, actionIndex, account, action);
        } else if (action.kind == FlowTypes.ActionType.Sweep) {
            _handleSweep(flowId, actionIndex, account, action);
        } else if (action.kind == FlowTypes.ActionType.LockRelease) {
            _handleLockRelease(flowId, actionIndex, account, action);
        } else if (action.kind == FlowTypes.ActionType.Swap) {
            _handleSwap(flowId, actionIndex, account, action);
        } else {
            revert("CanalisExecutor: unknown action type");
        }
    }

    /// @dev Distributes `action.fixedAmount` (the total) across
    /// `action.recipients` by `action.amountsOrBps` (basis points, 0-10000
    /// each, summing to at most 10000). `recipients[i]` gets
    /// `fixedAmount * amountsOrBps[i] / 10000`; integer-division remainder
    /// and any unallocated basis points simply stay in `account` — this is
    /// not a bug, there is nowhere else for a fractional/unassigned share
    /// to go. Recipients with a 0 bps share are skipped rather than making
    /// a zero-amount `executorTransfer` call (which would revert).
    ///
    /// EVENT SHAPE: emits one `ActionExecuted` per recipient that actually
    /// received a non-zero share (per-transfer, not a single aggregate
    /// event) — this lets the UI show each leg of a split individually,
    /// matching what real per-recipient transfers happened. A recipient
    /// whose share rounds to 0 gets no event, matching that nothing moved
    /// for it. If every share rounds to 0 (only possible with a very small
    /// `fixedAmount` and small bps), no `ActionExecuted` fires for this
    /// action at all — honest, since nothing moved.
    function _handleSplit(uint256 flowId, uint256 actionIndex, address account, FlowTypes.Action storage action)
        internal
    {
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
                emit ActionExecuted(flowId, actionIndex, FlowTypes.ActionType.Split, action.recipients[i], share);
            }
        }
    }

    /// @dev Moves `action.fixedAmount` USDC from `account` to
    /// `action.recipients[0]`, via CanalisAccount's onlyExecutor-gated
    /// `executorTransfer`.
    function _handleForward(uint256 flowId, uint256 actionIndex, address account, FlowTypes.Action storage action)
        internal
    {
        require(action.recipients.length == 1, "CanalisExecutor: Forward requires exactly one recipient");
        require(action.fixedAmount > 0, "CanalisExecutor: Forward amount must be positive");

        CanalisAccount(account).executorTransfer(action.recipients[0], action.fixedAmount);
        emit ActionExecuted(flowId, actionIndex, FlowTypes.ActionType.Forward, action.recipients[0], action.fixedAmount);
    }

    /// @dev Moves whatever `account` holds above `action.sweepThreshold` to
    /// `action.recipients[0]`. If the current balance is at or below the
    /// threshold there is nothing to sweep — this is an honest no-op (no
    /// `executorTransfer` call, no fake movement); `ActionExecuted` still
    /// fires either way (amount=0 in the no-op case, never a fake nonzero),
    /// since reaching this point without reverting is itself meaningful
    /// (the sweep ran, it just had nothing to do).
    function _handleSweep(uint256 flowId, uint256 actionIndex, address account, FlowTypes.Action storage action)
        internal
    {
        require(action.recipients.length >= 1, "CanalisExecutor: Sweep requires a destination");
        address destination = action.recipients[0];
        require(destination != address(0), "CanalisExecutor: Sweep destination cannot be zero address");

        uint256 currentBalance = CanalisAccount(account).balance();
        uint256 threshold = action.sweepThreshold;
        uint256 swept = 0;

        if (currentBalance > threshold) {
            swept = currentBalance - threshold;
            CanalisAccount(account).executorTransfer(destination, swept);
        }

        emit ActionExecuted(flowId, actionIndex, FlowTypes.ActionType.Sweep, destination, swept);
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
    ///
    /// EVENT SHAPE: `ActionExecuted.recipient` is the ACTUAL destination of
    /// THIS call's real transfer — `address(this)` (the executor) while
    /// locking, the flow's configured `action.recipients[0]` only once
    /// released. This is deliberately not always "the final recipient",
    /// because during the lock phase the funds genuinely have not gone to
    /// them yet; a UI can tell the two phases apart by comparing
    /// `recipient` against the executor's own address.
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
            emit ActionExecuted(flowId, actionIndex, FlowTypes.ActionType.LockRelease, address(this), action.fixedAmount);
            return;
        }

        require(state != LockState.Released, "CanalisExecutor: already released");
        require(block.timestamp >= action.unlockTime, "CanalisExecutor: still locked");

        _lockState[flowId][actionIndex] = LockState.Released;
        IERC20(CanalisAccount(account).usdc()).safeTransfer(recipient, action.fixedAmount);
        emit ActionExecuted(flowId, actionIndex, FlowTypes.ActionType.LockRelease, recipient, action.fixedAmount);
    }

    /// @dev Swaps `action.fixedAmount` of `action.tokenIn` for
    /// `action.tokenOut` via `swapPool`, delivering the output directly to
    /// `action.recipients[0]` (see class docs "ACCOUNT-VS-RECIPIENT DESIGN
    /// DECISION" — CanalisAccount stays USDC-only; the swap pays out to an
    /// address, it doesn't return funds into the account).
    ///
    /// Custody path: `account.executorTransfer` pulls `fixedAmount` of
    /// `tokenIn` from the flow's CanalisAccount into THIS contract (the
    /// executor), which then approves exactly that amount to `swapPool` and
    /// calls `swap(tokenIn, fixedAmount, minAmountOut, recipient)` — the
    /// pool pulls `tokenIn` from the executor and pays `tokenOut` straight
    /// to `recipient` itself, so the executor never custodies the output
    /// token at all (nothing to strand there). `minAmountOut` is enforced
    /// by the pool itself (reverts "insufficient output" below it); this
    /// handler adds no separate slippage check on top; it never allows an
    /// unprotected minAmountOut of 0 to be silently "fine" — that's simply
    /// the caller (flow author) choosing zero slippage protection, an
    /// honest reflection of what they configured, not a hidden default.
    function _handleSwap(uint256 flowId, uint256 actionIndex, address account, FlowTypes.Action storage action)
        internal
    {
        require(action.recipients.length >= 1, "CanalisExecutor: Swap requires a recipient");
        address recipient = action.recipients[0];
        require(recipient != address(0), "CanalisExecutor: Swap recipient cannot be zero address");
        require(action.fixedAmount > 0, "CanalisExecutor: Swap amountIn must be positive");

        address tokenIn = action.tokenIn;
        address tokenOut = action.tokenOut;
        address poolUsdc = address(swapPool.usdc());
        address poolEurc = address(swapPool.eurc());
        require(
            (tokenIn == poolUsdc && tokenOut == poolEurc) || (tokenIn == poolEurc && tokenOut == poolUsdc),
            "CanalisExecutor: Swap tokenIn/tokenOut must be the pool's USDC/EURC pair"
        );

        CanalisAccount(account).executorTransfer(address(this), action.fixedAmount);
        IERC20(tokenIn).forceApprove(address(swapPool), action.fixedAmount);

        uint256 amountOut = swapPool.swap(tokenIn, action.fixedAmount, action.minAmountOut, recipient);

        emit ActionExecuted(flowId, actionIndex, FlowTypes.ActionType.Swap, recipient, amountOut);
    }
}
