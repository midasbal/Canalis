# Security

Canalis is a hackathon project running on **Arc testnet** — no real value is
at stake today. This document is a genuine threat model derived from the
actual code (`contracts/src/`), written honestly: what's protected, what's
deliberately out of scope, and what a real weakness looks like if one
exists. It is **not** a substitute for a professional third-party review —
see [Testing posture](#testing-posture) for exactly what has and hasn't
been done.

---

## Trust model & boundaries

### `CanalisAccount` is the only place funds live

Each user's `CanalisAccount` is a minimal USDC vault (`CanalisAccount.sol`).
Two ways money leaves it:
- `withdraw(to, amount)` — **owner-only** (`Ownable.onlyOwner`), the human
  wallet pulling their own funds out directly.
- `executorTransfer(to, amount)` — **`onlyExecutor`-gated**: only the
  address currently stored in `executor` may call this, moving *any*
  amount to *any* address, with **no other check**.

### Executor rotation (`setExecutor`) — a known, owner-signed trust boundary

`CanalisAccount.executorTransfer` doesn't know anything about flows,
conditions, or caps — all of that logic lives in `CanalisExecutor`, which
is just whichever address the account's `executor` field currently points
to. `setExecutor(newExecutor)` (owner-only) is how an account repoints
itself at a new one, and this is a **known, intentional property** of the
design, not an oversight: `CanalisExecutor` is immutable and not
upgradeable (see [No admin key](#no-admin-key-on-canalisexecutor-itself)),
so `setExecutor` is the account's *only* mechanism for adopting a fixed
bug or a new executor version after deploy. That flexibility is the
tradeoff — the same field that lets an owner upgrade also lets them (or
someone impersonating them) repoint to any address, and whatever address
`executor` names gets unconditional, uncapped `executorTransfer` rights
over the account's balance, with no timelock or secondary confirmation —
conceptually the same shape as an unlimited ERC-20 `approve()` to a single
spender, or a standard upgradeable-proxy admin key.

This is an **owner-signed trust assumption, not an attacker-triggerable
vulnerability**: the same trust class as any admin key or upgradeable
proxy — it requires the account's own owner to sign a `setExecutor`
transaction (e.g. via a phishing attempt), not something a third party can
invoke unilaterally. `ExecutorUpdated` is emitted on every rotation so at
least it's observable on-chain after the fact.

**Planned hardening:** make `executor` immutable — set once, by
`CanalisAccountFactory`, at account creation, with `setExecutor` removed
entirely — or, if in-place rotation is kept, add a timelock between
calling `setExecutor` and the new executor taking effect. Tracked as a
documented design consideration for a future revision, not an open bug.

### `CanalisAccountFactory` and per-owner isolation

`CanalisAccountFactory` deploys one `CanalisAccount` per caller
(`accountOf[msg.sender]`), reverting if one already exists. Every account
it creates is wired to the same `usdc`/`executor` pair at construction —
there's no way to create a factory-issued account pointed at a different
executor than the one the factory itself was deployed with.

**Known limitation:** `CanalisExecutor.registerFlow` does **not** verify
that `flow.owner` was actually created by `CanalisAccountFactory` — it
only requires `msg.sender == CanalisAccount(flow.owner).owner()`, which
will happily call `.owner()` on *any* address the caller supplies. This
isn't exploitable for fund loss (a bogus "account" contract still can't
grant itself `executorTransfer` rights on a real `CanalisAccount` it
doesn't control), but it means a UI reading `flowsOf`/`getFlow` should not
assume `flow.owner` is a genuine, factory-issued vault without checking
`CanalisAccountFactory.accountOf` separately.

### Access control, precisely

| Action | Who can call it |
|---|---|
| `CanalisAccount.withdraw` | the account's `Ownable` owner only |
| `CanalisAccount.executorTransfer` | only the current `executor` |
| `CanalisAccount.setExecutor` | the account's `Ownable` owner only |
| `CanalisExecutor.registerFlow` | must be `CanalisAccount(flow.owner).owner()` |
| `CanalisExecutor.setFlowActive` (pause/cancel) | must be `CanalisAccount(flow.owner).owner()` |
| `CanalisExecutor.executeFlow`, Manual trigger | must be `CanalisAccount(flow.owner).owner()` |
| `CanalisExecutor.executeFlow`, OnSchedule/OnThreshold/OnReceive | **anyone** — see below |
| `CanalisSwapPool.addLiquidity`/`removeLiquidity` | the pool's `Ownable` owner only |

### The keeper is trust-minimized, not trusted

`OnSchedule`/`OnThreshold`/`OnReceive` triggers are deliberately
caller-agnostic — the off-chain keeper (or literally anyone) may call
`executeFlow` for them. The trust boundary is **not** who calls it; it's
that `CanalisExecutor` re-verifies the real on-chain precondition itself
(`_checkTrigger`) every single call and reverts with a specific reason
("schedule not due", "threshold not met", "no new deposit to consume")
rather than silently no-op'ing. Practical consequence: **the keeper can
never make a flow do anything `CanalisExecutor`'s own logic wouldn't
already allow** — a malicious or buggy keeper can only waste its own gas
speculatively poking flows that aren't due, never force an early or
unauthorized execution. It also structurally cannot touch `Manual` flows,
since it is never the account's `owner()`.

### No admin key on `CanalisExecutor` itself

`CanalisExecutor` has no `Ownable`, no pause switch, no upgrade path — its
three external dependencies (`swapPool`, `oracle`, `cctpTokenMessenger`)
are `immutable`, set once at construction and never changeable. There is
no function on `CanalisExecutor` that can withdraw its own held USDC
outside of the `_handleLockRelease`/`_handleSwap`/`_handleBridge` code
paths — meaning the transient/locked balances it holds mid-flow can't be
swept out through any privileged backdoor. The tradeoff is the flip side
of "not upgradeable": a genuine bug fix requires a full redeploy, and
every existing `CanalisAccount` owner has to manually call `setExecutor`
to adopt the new one — old accounts otherwise stay pointed at the old
executor forever (see [Known limitations](#deliberate-scope-cuts--known-limitations)).

---

## Protections actually in the code

- **Reentrancy.** `executeFlow` is `nonReentrant` (OpenZeppelin
  `ReentrancyGuard`) — the one function that dispatches every fund-moving
  action (Forward/Split/Sweep/LockRelease/Swap/Bridge), each of which
  makes external calls (`executorTransfer`, `CanalisSwapPool.swap`,
  `depositForBurn`). `CanalisSwapPool.swap`/`addLiquidity`/
  `removeLiquidity` carry their own independent `nonReentrant` guard too.
  **Honest gap:** `registerFlow` and `setFlowActive` are **not**
  `nonReentrant`, and both make an external call
  (`CanalisAccount(flow.owner).owner()`) to a caller-supplied address
  before their own state writes complete. Reviewed for an exploitable
  path and found none — `_nextFlowId++` isn't corruptible by simple
  reentrant registration, no value is moved by either function, and the
  actual value-moving path (`executeFlow`) has its own independent guard
  regardless — but it's a real gap in defense-in-depth, noted rather than
  hidden.
- **Swap slippage protection.** `CanalisSwapPool.swap` enforces
  `require(amountOut >= minAmountOut, "insufficient output")` itself —
  `CanalisExecutor._handleSwap` adds no separate check and cannot
  override it. A `minAmountOut` of `0` is the flow author's own honest
  choice to accept unlimited slippage, never a silent default the
  contract picks for them.
- **Oracle staleness + normalization.** `_checkOracleCondition` compares
  `block.timestamp - publishTime` against the flow's own `maxStaleness`
  (not a fixed, contract-wide bound), and normalizes every Pyth feed's
  native `expo` to one documented 18-decimal fixed-point unit
  (`_normalizePrice18`) so a feed's exponent convention (-5 for FX, -8 for
  crypto) can't silently misprice a threshold comparison. The executor is
  strictly read-only against the oracle (`getPriceUnsafe`, never
  `updatePriceFeeds`) so `_checkConditions`/`previewFlow` stay pure
  `view` — keeping the price fresh is the keeper's job, not something the
  executor can be tricked into paying for or gating on a stale push.
- **`CanalisSwapPool` reserve accounting.** Reserves are tracked in
  explicit state (`reserveUsdc`/`reserveEurc`), never read live via
  `balanceOf`. This closes the classic donation attack against naive
  constant-product pools — where anyone transfers tokens directly to the
  pool address to distort the price calculation out from under a pending
  swap.
- **`SafeERC20`/`forceApprove` throughout.** Every token movement
  (`CanalisAccount`, `CanalisSwapPool`, `CanalisExecutor`'s
  Swap/Bridge/LockRelease handlers) uses OpenZeppelin's `SafeERC20`;
  `forceApprove` (not raw `approve`) is used before every Swap/Bridge
  handoff, which correctly resets a non-zero existing allowance first —
  needed for tokens that revert on a non-zero→non-zero `approve` (not a
  known USDC/EURC behavior on Arc, but defensive regardless).
- **CCTP V2 standard-transfer parameters.** `destinationCaller =
  bytes32(0)` is the documented *permissionless* convention (anyone may
  submit the mint), not a missing access check; `minFinalityThreshold =
  2000` ("Standard") waits for real source-chain finality rather than
  CCTP V2's faster/riskier "Fast Transfer" tier; `maxFee = 0` was verified
  against Arc testnet's live `minFee()` (confirmed `0` via `cast call`)
  before being hardcoded, not guessed.
- **`LockRelease` double-release is structurally impossible.** A
  three-state enum (`None`/`Locked`/`Released`) per `(flowId,
  actionIndex)`, not just a boolean guard — once `Released`, every future
  call for that slot reverts unconditionally; there is no code path back
  to a payable state.
- **Honest no-ops, not fake success.** `Sweep` emits a real
  `ActionExecuted` with `amount == 0` when there's nothing above the
  threshold — never a fabricated nonzero. `Split`'s basis-point rounding
  remainder simply stays in the account (documented, not lost, not
  siphoned anywhere).

---

## Arc-specific handling

- **The blocklist precompile (`0x1800…0001`).** Every Arc USDC transfer
  calls this precompile; Foundry's local `revm` can't execute it, so
  `forge script` reverts locally on *any* USDC-touching call — even with
  `--skip-simulation`. Unit tests use `MockERC20` and are unaffected; every
  on-chain proof (`contracts/script/prove-*.sh`) uses `cast send`/`cast
  call` against the live RPC instead, specifically because of this.
- **USDC (6 decimals) vs. the native gas token (18 decimals).** Arc's USDC
  ERC-20 interface (`0x3600…0000`) and Arc's native *gas* USDC are
  different decimal conventions entirely. Every USDC-denominated value in
  this codebase is explicitly reasoned about in 6dp; nothing mixes the
  two. The same discipline extends to Pyth's per-feed `expo` — see
  oracle normalization above — treating "another system's own numeric
  convention" as something to normalize explicitly, not assume.

---

## Deliberate scope cuts & known limitations

Stated plainly, not buried:

- **Bridge's `mintRecipient` bypasses recipient allow/deny conditions.**
  `_checkRecipients` only walks `action.recipients[]`; a `Bridge` action's
  cross-chain destination is a separate `bytes32 mintRecipient` field,
  chain-agnostic and explicitly not checked against
  `allowedRecipients`/`deniedRecipients`. **Use the amount-cap condition**
  to bound a Bridge action's exposure instead.
- **Single-account keeper.** The keeper (`keeper/`) services exactly one
  configured `CANALIS_ACCOUNT` via `flowsOf` — there's no on-chain "every
  account, every flow" enumeration function. Multi-account support is
  roadmap, not implemented (would need either a new factory-side view or
  an off-chain list of accounts to poll).
- **NL-proxy rate limits are in-memory.** The natural-language flow
  builder's anti-abuse counters (`web/api/_lib/generateFlow.ts`) are
  plain module-scope state — real, and verified live, but they reset on
  every process restart / serverless cold start. Not a durable,
  cross-instance limiter.
- **`CanalisSwapPool` is a thin, self-owned demo pool, not a market.** No
  LP tokens; a single owner can add/remove liquidity at will; reserves are
  small and self-seeded. This is stated in the pool's own docs as
  deliberate — the mainnet plan routes Swap through a real DEX or Circle's
  own FX infrastructure, not this pool.
- **`LockRelease` custody is pooled, not per-flow.** Locked funds
  physically move into `CanalisExecutor`'s own balance (not a separate
  per-flow ledger) so that `CanalisAccount.balance()` stays an honest
  "spendable" number everywhere else (balance floor, amount cap, Sweep)
  without those call sites needing to learn about locked amounts. This
  means the executor holds a commingled pool across every user's
  in-flight/locked funds; correctness relies on the invariant that only
  `_handleLockRelease`/`_handleSwap`/`_handleBridge` ever move funds
  through it — which holds today since the executor has no owner, admin,
  or withdraw function of its own (see above).
- **No bound on array lengths at registration.** `conditions.length`,
  `actions.length`, and `recipients.length` are unbounded in
  `registerFlow`. A flow registered with an enormous array could become
  unexecutable under the block gas limit — self-inflicted (only harms
  that flow's own owner; no other user's flows or funds are affected),
  and not currently guarded against by the frontend composer either.
- **Bridge's `destinationDomain` isn't validated on-chain.** Circle's
  `TokenMessengerV2.depositForBurn` is called with whatever domain the
  flow was registered with; there's no on-chain check that the domain is
  a real, wired CCTP destination. That curation lives only in the
  frontend's catalog (`web/src/lib/bridgeDestinations.ts`). A flow
  registered directly against `registerFlow` (bypassing the UI) could
  target an unwired domain — the burn still succeeds, but the
  corresponding mint could never complete.
- **No modular smart account / session keys.** The keeper's hot key is a
  plain EOA restricted only by *what it's useful for calling*
  (`executeFlow`, `updatePriceFeeds`) — not a scoped ERC-4337/7579 session
  key with an on-chain-enforced permission set. Documented in
  `keeper/README.md`.
- **Not upgradeable.** Every contract's dependencies are `immutable`; a
  genuine logic fix needs a full redeploy, and each existing
  `CanalisAccount` owner must individually call `setExecutor` to adopt
  it — see the `setExecutor` section above for what that call actually
  grants.

---

## Testing posture

- **200 passing Foundry tests** across 14 test suites (confirmed via
  `forge test --summary`), **17 of them fuzz tests** (256 runs each,
  Foundry's default) — covering `CanalisExecutor`, every condition guard
  field (including the oracle price condition against a `MockPyth`),
  every trigger type, `LockRelease`'s full lifecycle, `Swap` (against the
  real pool math) and `Bridge` (against a `MockTokenMessengerV2`), pause,
  enriched events, `previewFlow`/`executeFlow` parity, per-owner
  enumeration, `CanalisSwapPool`'s own `x*y=k` math, `CanalisAccount`, and
  `CanalisAccountFactory`.
- **Real on-chain proofs**, not just local tests — every trigger,
  condition, and action has a corresponding `contracts/script/prove-*.sh`
  that exercises it with a live transaction against Arc testnet (`cast
  send`/`cast call`), including a full CCTP burn-to-mint round trip across
  two real chains (Arc → Ethereum Sepolia).
- **What this is *not*:** this project has **not** been reviewed by a
  professional third-party security firm. It is thoroughly unit- and
  fuzz-tested, and built with the documented, conscious threat model in
  this file — that is a meaningfully different (and lower) bar than an
  independent audit, and should be treated as such before any real value
  is ever put behind these contracts.

---

## Reporting a vulnerability

This is a solo hackathon project on Arc **testnet** — no real funds are at
risk today. If you find a genuine issue anyway, please open a
[GitHub Security Advisory](https://github.com/midasbal/Canalis/security/advisories/new)
on this repo (preferred, keeps it private until resolved) or a regular
GitHub issue for anything non-sensitive. Responsible disclosure is
appreciated even though the stakes here are currently zero.
