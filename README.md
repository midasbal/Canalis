<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/canalis-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="brand/canalis-logo-light.svg">
  <img alt="Canalis" src="brand/canalis-logo-dark.svg" width="210" height="64">
</picture>

**IFTTT for your money, on rails that settle in under a second.**

Built solo for the **Programmable Money Hackathon — Build on Arc**. Primary
track: **DeFi**. Secondary track: **Agentic Economy**, via a planned
natural-language flow builder (see [Next phase](#next-phase)) where an LLM
agent composes on-chain USDC flows from plain-English intent.
Canalis is a self-contained, single-user visual builder for programmable USDC
money-flows on [Arc](https://docs.arc.io), Circle's stablecoin-native L1.

> Status: a real subset of the MVP is deployed and proven end-to-end on Arc
> testnet — all four triggers (Manual, OnSchedule, OnThreshold, OnReceive)
> and all six actions (Forward, Split, Sweep, LockRelease, **Swap**,
> **Bridge**) work against a user's own on-chain account, gated by real
> condition guards (balance floor, time window, cooldown, allow/deny
> recipients, amount cap, **oracle price**), a real off-chain keeper
> autonomously drives the caller-agnostic triggers, flows can be
> paused/cancelled, dry-run previewed, and enumerated per-owner, and a real
> visual builder UI is live. All **five Arc-native feature slices** from
> the internal spec (§7.3) are done: (1) Swap routes through a **self-built
> constant-product AMM** (`CanalisSwapPool`, USDC/EURC) rather than a
> third-party DEX; (2) an **oracle price condition** reads Pyth's real, live
> IPyth contract on Arc testnet, kept fresh by the off-chain keeper; (3) a
> **CCTP Bridge action** burns USDC on Arc via Circle's real CCTP V2
> `TokenMessengerV2`, proven with a full round trip — a standalone
> completion script picked up the real attestation and minted the USDC on
> Ethereum Sepolia; (4) and (5) are one-click composite templates
> (treasury-rebalance, recurring DCA) built from (1)+(2), no new on-chain
> primitive. Everything else (Circle Wallet/Paymaster) is still stubbed.
> See [Status](#status) for the exact, honest breakdown.

---

## What it is

A user composes a **flow** — a chain of **trigger → condition(s) → action(s)**
— from a small set of blocks: *"when USDC arrives, and the balance is above
X, split it 70/30 between two addresses."* The flow is deployed to the
user's own on-chain account, funded with USDC, and from then on it fires
itself — routing, splitting, sweeping, or locking money automatically,
without the user writing any Solidity.

## Why Arc

Arc is a stablecoin-native L1 where **USDC is the gas token** and transactions
reach **sub-second finality** — which is what makes "money that moves itself"
feel instant rather than batched. Canalis is designed around the Circle
stack that ships with Arc:

- **USDC as gas** — no separate gas token to hold or reason about.
- **Sub-second finality** — a flow's execution and its confirmation are
  effectively simultaneous from the user's perspective.
- **Circle Wallets, Gas Station/Paymaster, App Kit, oracles** — the intended
  integration surface for wallet onboarding, sponsored gas, and
  price-conditioned flows. These are **not wired up in the code yet** (see
  Status) — the frontend currently connects via a plain injected wallet.

### Arc-specific gotcha worth knowing

Arc's USDC token calls a custom blocklist-check precompile on every
transfer. Foundry's local `revm` simulator does not implement that
precompile, so **`forge script` reverts locally on any call that touches a
real USDC transfer** — even with `--skip-simulation`, since Foundry always
executes the script body once locally to determine what to broadcast. The
real Arc node handles the precompile fine (confirmed via direct `cast
call`). Practical upshot: deployment (`Deploy.s.sol`, which never touches
USDC) still works fine via `forge script --broadcast`, but anything that
deposits, forwards, splits, or sweeps USDC has to be driven via `cast send`
against the live RPC instead — see `contracts/script/prove-*.sh` for the
pattern.

## Architecture

### Flows as data, one executor

Canalis does **not** deploy a new contract per flow. There is one generic
`CanalisExecutor` that interprets flows stored as data:

```
  Trigger              Condition(s)             Action(s)
 ┌────────────┐       ┌─────────────────┐      ┌──────────────┐
 │ OnReceive  │       │ amount cap      │      │ Split        │
 │ OnSchedule │  ───▶ │ cooldown        │ ───▶ │ Forward      │
 │ OnThreshold│       │ time window     │      │ Sweep        │
 │ Manual     │       │ balance check   │      │ LockRelease  │
 └────────────┘       │ allow/deny list │      └──────────────┘
                       └─────────────────┘
        all evaluated inside one executeFlow() transaction — atomic,
        all-or-nothing: if any step fails, the whole run reverts.
```

```
  Off-chain                      On-chain (Arc testnet)
 ┌────────────────┐             ┌───────────────────┐        ┌─────────────────┐
 │ Keeper (real)   │──pokes───▶ │  CanalisExecutor    │──moves──▶│  CanalisAccount  │
 │ polls schedule/ │             │  (flows as data,    │  USDC   │  (per-user USDC  │
 │ threshold flows │             │   one shared        │         │  vault, one per  │
 └────────────────┘             │   contract)         │         │  owner via       │
                                 └───────────────────┘         │  CanalisAccount   │
                                                                 │  Factory)         │
                                                                 └─────────────────┘
```

- **`CanalisExecutor`** — `registerFlow` stores a flow; `executeFlow`
  validates the trigger, evaluates every condition, then runs the action
  list atomically in a single transaction. One audited contract instead of
  one deployment per flow: cheaper, easier to secure, and new block types
  can be added as new handlers instead of new contracts.
- **`CanalisAccount`** — a per-user vault that custodies USDC. `executor` is
  a real trust boundary (`onlyExecutor` modifier + `executorTransfer`): only
  the configured `CanalisExecutor` can move funds out on the owner's
  behalf; the owner can also withdraw directly.
- **`CanalisAccountFactory`** — lets any wallet create its own
  `CanalisAccount` in one transaction (`createAccount()`), one per owner —
  no manual per-user deployment. The flow-registration/execution
  authorization model resolves the human owner via
  `CanalisAccount(flow.owner).owner()` (OpenZeppelin `Ownable`).
- **Keeper** (`keeper/`, real, see [Status](#status)) — for
  `OnSchedule`/`OnThreshold`/`OnReceive` triggers, an off-chain poller
  pokes the executor, which **re-verifies the condition on-chain** before
  acting, so the keeper can never fire a flow falsely.

## The flow model

Defined in `contracts/src/libraries/FlowTypes.sol` and mirrored in
`web/src/lib/flows.ts`. This is the MVP scope — a smaller set than the full
block catalogue in the project's internal spec (Stream, Swap, CCTP, oracle
conditions, etc. are extended/future scope, tracked privately).

**Triggers:** `OnReceive` · `OnSchedule` · `OnThreshold` · `Manual`

**Actions:** `Split` · `Forward` · `Sweep` · `LockRelease` · `Swap`

**Condition guard fields:** amount cap (min/max), cooldown, time window,
minimum balance, allow/deny recipient lists.

All triggers, all actions, and every condition guard field execute real
logic today — proven on Arc testnet, moving real USDC (and, for `Swap`,
real EURC) and genuinely blocking flows that violate a guard. Conditions
on a flow are evaluated as a logical AND (every field on every
`Condition` entry must hold) after trigger validation and before any
action runs; the first unmet field reverts with a specific reason (e.g.
`"CanalisExecutor: amount exceeds cap"`), never a silent skip. `Swap`
routes through `CanalisSwapPool`, a self-built constant-product AMM (see
[Status](#status)) — the account-vs-recipient design decision there is
that the swapped-out token pays out to a recipient address named in the
action, not back into the (USDC-only) `CanalisAccount`.

## Repo layout

```
canalis/
├── contracts/                     # Foundry project
│   ├── src/
│   │   ├── libraries/FlowTypes.sol         # trigger/action enums, Condition/Action/Flow structs
│   │   ├── interfaces/ICanalisExecutor.sol
│   │   ├── interfaces/IPyth.sol            # minimal hand-written IPyth read/update interface (Arc-native feature #2)
│   │   ├── interfaces/ITokenMessengerV2.sol # minimal hand-written CCTP V2 depositForBurn interface (Arc-native feature #3)
│   │   ├── CanalisExecutor.sol             # flows-as-data interpreter (all 4 triggers, all 6 actions incl. CCTP Bridge, 6 conditions incl. oracle price, pause, preview, enumeration)
│   │   ├── CanalisAccount.sol              # per-user USDC vault + onlyExecutor trust boundary + depositNonce
│   │   ├── CanalisAccountFactory.sol       # one CanalisAccount per owner, self-service
│   │   └── CanalisSwapPool.sol             # self-built constant-product USDC/EURC AMM (Arc-native feature #1)
│   ├── test/
│   │   ├── CanalisExecutor.t.sol           # registerFlow/executeFlow, Forward/Split/Sweep, fuzz
│   │   ├── CanalisExecutorConditions.t.sol # 5 amount/time/recipient Condition guard fields, multi-condition, fuzz
│   │   ├── CanalisExecutorOracleCondition.t.sol # oracle price condition vs. MockPyth: above/below, staleness, expo normalization, AND, preview parity
│   │   ├── CanalisExecutorTriggers.t.sol   # OnSchedule/OnThreshold/OnReceive, catch-up, fuzz
│   │   ├── CanalisExecutorLockRelease.t.sol # lock/release lifecycle, double-spend/double-release, fuzz
│   │   ├── CanalisExecutorPause.t.sol      # setFlowActive blocks every trigger type, owner-only, unpause
│   │   ├── CanalisExecutorEvents.t.sol     # ActionExecuted recipient/amount per action type, incl. Split legs
│   │   ├── CanalisExecutorPreview.t.sol    # previewFlow vs. real executeFlow, every trigger type + conditions
│   │   ├── CanalisExecutorEnumeration.t.sol # flowsOf per-owner, in order, doesn't mix owners
│   │   ├── CanalisExecutorSwap.t.sol       # Swap action: delivery, slippage, conditions/pause gating, previewFlow, fuzz
│   │   ├── CanalisExecutorBridge.t.sol     # Bridge action vs. MockTokenMessengerV2: correct depositForBurn args, account debited, conditions/pause gating, previewFlow
│   │   ├── CanalisSwapPool.t.sol           # x*y=k correctness, fee, minAmountOut, reserve accounting, fuzz
│   │   ├── CanalisAccount.t.sol            # executorTransfer trust boundary, fuzz
│   │   ├── CanalisAccountFactory.t.sol     # one-account-per-owner
│   │   └── mocks/MockERC20.sol, MockPyth.sol, MockTokenMessengerV2.sol # 6-decimal mock USDC/EURC + settable-price mock oracle + call-recording mock CCTP messenger for tests
│   ├── script/
│   │   ├── Deploy.s.sol                    # deploys SwapPool + Executor + Factory + deployer's account
│   │   ├── seed-swap-pool.sh               # owner-seeds CanalisSwapPool with USDC/EURC liquidity
│   │   ├── prove-forward-flow.sh           # live-testnet proof: Forward (cast-based, see gotcha above)
│   │   ├── prove-split-flow.sh             # live-testnet proof: Split
│   │   ├── prove-sweep-flow.sh             # live-testnet proof: Sweep
│   │   ├── prove-swap-flow.sh              # live-testnet proof: Swap (quote-matching output, reserve deltas)
│   │   ├── prove-amount-cap-condition.sh   # live-testnet proof: amount-cap condition (block + allow)
│   │   ├── prove-cooldown-condition.sh     # live-testnet proof: cooldown condition (block + allow)
│   │   ├── prove-onschedule-trigger.sh     # live-testnet proof: OnSchedule (due, catch-up, non-owner keeper caller)
│   │   ├── prove-onthreshold-trigger.sh    # live-testnet proof: OnThreshold (below blocked, at/above allowed)
│   │   ├── prove-onreceive-trigger.sh      # live-testnet proof: OnReceive (armed by deposit, no double-fire)
│   │   ├── prove-lockrelease.sh            # live-testnet proof: LockRelease (still-locked, release-once, no double-release)
│   │   ├── prove-pause.sh                  # live-testnet proof: pause blocks execution, unpause restores it
│   │   ├── prove-preview.sh                # live-testnet proof: previewFlow matches a real executeFlow call
│   │   ├── prove-flowsof.sh                # live-testnet proof: flowsOf lists the owner's registered flow ids
│   │   ├── prove-oracle-condition.sh       # live-testnet proof: real Pyth price update + block-then-allow oracle condition
│   │   └── prove-cctp-bridge.sh            # live-testnet proof: real CCTP V2 burn (DepositForBurn/MessageSent events, account debited)
│   └── .env.example                        # RPC_URL / PRIVATE_KEY placeholders
├── keeper/                         # standalone Node/TS + viem keeper service
│   ├── src/
│   │   ├── index.ts                        # poll loop: flowsOf + previewFlow (getLogs-free), poke executeFlow, refresh stale oracle prices, tolerate reverts
│   │   ├── abi.ts / chain.ts / config.ts    # minimal executor + IPyth ABI, Arc testnet chain def, env config
│   ├── scripts/
│   │   └── complete-cctp-bridge.ts         # standalone: polls Circle's real attestation API, completes the mint on Ethereum Sepolia
│   └── .env.example                        # RPC_URL / EXECUTOR_ADDRESS / CANALIS_ACCOUNT / KEEPER_PRIVATE_KEY / ORACLE_ADDRESS / HERMES_URL / POLL_INTERVAL_MS / SEPOLIA_RPC_URL / SEPOLIA_PRIVATE_KEY
└── web/                            # Vite + React + TS frontend
    ├── src/
    │   ├── chains.ts / wagmi.ts             # Arc testnet chain + rate-limit-aware wagmi transport
    │   ├── lib/
    │   │   ├── flows.ts                     # TS mirror of the Solidity flow model + encode/decode
    │   │   ├── oracleFeeds.ts                # curated real Pyth feed id catalog (production Hermes ids)
    │   │   ├── bridgeDestinations.ts          # curated CCTP V2 destination-chain catalog (Ethereum Sepolia)
    │   │   ├── abi.ts                       # hand-maintained ABI subset for the contracts above (incl. CanalisSwapPool, IPyth)
    │   │   ├── composer.ts                  # composer draft state -> Flow, validation
    │   │   ├── flowSummary.ts               # plain-English flow/action summaries
    │   │   ├── contracts.ts                 # deployed-address env lookup
    │   │   └── useCanalisAccount.ts         # resolves the connected wallet's CanalisAccount
    │   ├── components/
    │   │   ├── Header.tsx                   # wordmark + tab nav + wallet connect
    │   │   ├── WalletConnect.tsx             # injected-wallet connect/disconnect
    │   │   ├── BuilderCanvas.tsx             # hosts the flow composer
    │   │   ├── composer/                    # stepper composer: trigger/conditions/actions sections, templates
    │   │   ├── DeployedFlows.tsx / FlowRow.tsx # deployed-flows list, pause/run-now, live previewFlow status
    │   │   ├── RunLog.tsx                   # FlowExecuted/ActionExecuted history, "ran automatically" detection
    │   │   ├── Dashboard.tsx                # account/balance + deployed flows + run log
    │   │   └── ui/                          # Card, Badge, EmptyState, etc.
    │   └── index.css                       # Tailwind v4 theme (dark, "channel" palette)
    └── .env.example                         # RPC override + deployed-contract address placeholders
```

## Tech stack

| Layer | Choice |
|---|---|
| Contracts | Solidity + Foundry, OpenZeppelin (`ReentrancyGuard`, `Ownable`, `SafeERC20`) |
| Frontend | Vite + React + TypeScript + wagmi + viem |
| Styling | Tailwind CSS v4 |
| Chain | Arc testnet |

## Status

### Deployed addresses (Arc testnet)

- `CanalisExecutor`: `0x5C5E45cc991DaEc5657F3BDADC3De0Cea2f1E6Cc`
- `CanalisAccountFactory`: `0x16F9F6Ff9720B7BD6719e2C378619ce438cFB7E4`
- `CanalisSwapPool`: `0x86baad1c84751Ef31ca113E67E7C231CE2F18ca4` (USDC/EURC, owner-seeded)
- Pyth oracle (existing, not deployed by us): `0x2880aB155794e7179c9eE2e38200202908C17B43`
- CCTP V2 `TokenMessengerV2` (existing, not deployed by us): `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`

### Implemented (real, proven on Arc testnet)

- `CanalisAccount` — `deposit`, `withdraw`, `executorTransfer` (the
  `onlyExecutor`-gated trust boundary), `balance` all move real USDC via
  `SafeERC20`.
- `CanalisAccountFactory` — `createAccount()` provisions one real
  `CanalisAccount` per owner.
- `CanalisExecutor.registerFlow` / `getFlow` — store and read back a flow;
  caller must own the named `CanalisAccount`.
- `CanalisExecutor.executeFlow` for all four triggers — **`Manual`**
  (owner-gated), **`OnSchedule`** (due when `block.timestamp >=
  scheduleAt`; advances to the next interval boundary after "now" on
  success, catching up without looping if a keeper missed several
  periods; a one-shot schedule never fires again), **`OnThreshold`**
  (fires when the account's live USDC balance is at/above
  `thresholdAmount` — only this direction is implemented, enforced at
  registration), and **`OnReceive`** (armed by `CanalisAccount.deposit()`
  bumping a `depositNonce`; a flow consumes the nonce it's armed by, so
  the same deposit can't fire it twice). `OnSchedule`/`OnThreshold`/`OnReceive`
  are caller-agnostic — any address may call `executeFlow` — because the
  contract re-verifies the real precondition itself and reverts with a
  specific reason ("schedule not due" / "threshold not met" / "no new
  deposit to consume") rather than silently no-op'ing when it doesn't
  hold. All proven on-chain with a non-owner caller, see
  `contracts/script/prove-on{schedule,threshold,receive}-trigger.sh`.
- Actions: **`Forward`** (send a fixed amount to one recipient),
  **`Split`** (distribute a total across N recipients by basis points,
  remainder stays in the account), **`Sweep`** (move everything above a
  threshold to one destination; an honest no-op — no fake transfer — when
  balance is at or below the threshold), **`LockRelease`** (a
  two-phase action per flow/action slot: the first `executeFlow` call
  locks `fixedAmount` out of the `CanalisAccount` into the **executor's
  own custody** — not a separate ledger inside the account, so locked
  funds are structurally unreachable by any other action/flow reading
  `CanalisAccount.balance()` — a call before `unlockTime` reverts "still
  locked", and the first call at/after `unlockTime` releases to the
  recipient and permanently marks that slot released, so double-release
  is impossible by construction, not just guarded), and **`Swap`**
  (Canalis's first Arc-native feature — swaps `tokenIn` for `tokenOut` via
  `CanalisSwapPool`, a **self-built** constant-product USDC/EURC AMM
  rather than a third-party DEX; pulls `amountIn` from the account,
  delivers the output directly to a recipient address named in the
  action — `CanalisAccount` stays USDC-only, it doesn't custody the
  swapped-out token — and enforces `minAmountOut` slippage protection at
  the pool level), and **`Bridge`** (Canalis's third Arc-native feature —
  burns `fixedAmount` USDC on Arc via Circle's real CCTP V2
  `TokenMessengerV2`, to be minted to `mintRecipient` on
  `destinationDomain` once Circle's off-chain attestation service signs
  the burn message; same approve-then-call shape as `Swap`. This is a
  burn-ONLY action — the mint is a separate, asynchronous transaction on
  the destination chain, completed by a standalone script, not
  `CanalisExecutor` itself). All six proven with real transactions on Arc
  testnet (see `contracts/script/prove-*.sh`); `Bridge` additionally
  proven with a full burn-to-mint round trip across two real chains — see
  below.
- Conditions (all 5 guard fields): **balance floor** (`minBalance`),
  **time window** (`windowStart`/`windowEnd`, each independently
  open-ended), **cooldown** (`cooldownSeconds`, measured from
  `lastExecutedAt`), **allow/deny recipients** (checked against every
  action's outgoing recipient(s), revert names the offending address),
  and **amount cap** (`minAmount`/`maxAmount`, bounding the total moved
  across all of a flow's actions — Forward/Split contribute
  `fixedAmount`, Sweep contributes `balance - sweepThreshold`,
  LockRelease contributes `fixedAmount` whenever the call would still
  move money). Evaluated as a logical AND across every `Condition` entry
  on a flow; the first unmet field reverts with a specific reason.
  Amount cap and cooldown both proven live on Arc testnet
  (`contracts/script/prove-amount-cap-condition.sh`,
  `prove-cooldown-condition.sh`) — a flow that violates the guard is
  blocked with the exact revert reason, the same flow within the guard
  succeeds and moves USDC. A sixth condition — **oracle price**
  (`priceId`/`priceThreshold`/`priceAbove`/`maxStaleness`) — is Canalis's
  second Arc-native feature slice: reads a live price from Pyth's real
  `IPyth` contract on Arc testnet (`getPriceUnsafe`), enforces its own
  staleness check against `maxStaleness`, and normalizes every feed's
  Pyth `expo` to one documented 18-decimal fixed-point USD unit. The
  executor is read-only — it never calls `updatePriceFeeds` itself (see
  keeper below). Proven live with a real EUR/USD price read from the
  oracle: a flow whose threshold the current real price BLOCKS, then the
  same flow with a threshold the price satisfies, ALLOWS
  (`contracts/script/prove-oracle-condition.sh`).
- **CCTP V2 Bridge** — Canalis's third and final Arc-native feature slice
  (see `Bridge` action above). Fee/finality defaults for a CCTP V2
  "standard transfer": `destinationCaller = bytes32(0)` (permissionless),
  `minFinalityThreshold = 2000`, `maxFee = 0` (Arc testnet's live `minFee`
  is 0). Proven live in two stages: (1) the burn —
  `contracts/script/prove-cctp-bridge.sh` registers and executes a Manual +
  Bridge flow burning 1 USDC to Ethereum Sepolia, asserts the
  `CanalisAccount` was debited by exactly the burn amount, and decodes the
  real `DepositForBurn`/`MessageSent` events from the receipt; (2) the
  mint — `keeper/scripts/complete-cctp-bridge.ts` polled Circle's real
  testnet attestation API for that burn (ready within seconds), then
  submitted `MessageTransmitterV2.receiveMessage` on Ethereum Sepolia — the
  recipient's real Sepolia USDC balance went from `0` to `1000000`
  (1.000000 USDC). A genuine two-chain proof, not just a burn.
- A real off-chain **keeper** (`keeper/`, Node/TS + viem) — **entirely
  `getLogs`-free**: discovers a configured `CanalisAccount`'s flows via
  `flowsOf` (one `eth_call`), dry-runs each via `previewFlow`, and pokes
  `executeFlow` only when `canRun` — every step a plain `eth_call`, so it
  never hits free-tier RPC `getLogs` range caps (an earlier version
  indexed `FlowRegistered` via `getLogs` and was replaced for exactly this
  reason). Skips `Manual` flows entirely — `previewFlow`'s owner-only
  check naturally reports `canRun=false` for the keeper, since it's never
  the account owner. Proven live on Arc testnet driving a short-interval
  `OnSchedule` flow to fire with no human interaction; see
  `keeper/README.md` for how to run it and the trust model (a hot key
  that only ever calls `executeFlow`; the contract, not the caller, is
  what's trusted). Also keeps the oracle price condition's price fresh:
  before evaluating a flow that carries one, it checks the on-chain
  price's age against that flow's `maxStaleness` and, only if stale,
  fetches a real signed update from Pyth's production Hermes API and
  submits it (`updatePriceFeeds`, paying the real fee) — proven live: the
  keeper autonomously refreshed the on-chain EUR/USD price and executed
  an `OnSchedule` + oracle-conditioned flow with zero human interaction.
  Services one configured account — multi-account enumeration is future
  work.
- **Pause/cancel** — `setFlowActive(flowId, active)`, owner-only (same
  auth model as Manual's `executeFlow`), emits `FlowActiveSet`. Blocks
  execution for every trigger type identically — a paused flow's
  `executeFlow` reverts "flow inactive" whether it's the owner, a keeper,
  or anyone else calling it. Proven live on Arc testnet: pause → blocked,
  unpause → runs (`contracts/script/prove-pause.sh`).
- **Enriched `ActionExecuted`** — now carries the real `(recipient,
  amount)` moved by each call, so a run-log UI doesn't have to re-derive
  it from the action definition. Split emits one event per non-zero leg;
  Sweep emits an honest `amount == 0` on a no-op, never a fake nonzero;
  LockRelease's `recipient` is the executor itself while locking and the
  real recipient only once released.
- **`previewFlow(flowId) view returns (bool canRun, string reason)`** —
  non-reverting dry-run sharing the exact same internal check path as
  `executeFlow` (they literally call the same non-reverting helpers), so
  the two can never diverge. No state mutation, no transfers. Proven live
  on Arc testnet by cross-checking a preview's verdict against a real
  `executeFlow` call for both a not-due and a due flow
  (`contracts/script/prove-preview.sh`).
- **`flowsOf(address owner) view returns (uint256[])`** — per-owner flow
  enumeration (`owner` = the CanalisAccount address, matching `flow.owner`
  everywhere else), resolving the earlier "no on-chain per-owner
  enumeration" gap. Proven live on Arc testnet
  (`contracts/script/prove-flowsof.sh`).
- **`CanalisSwapPool`** — a self-built constant-product (x*y=k) AMM for a
  single USDC/EURC pair, 0.30% fee, explicit reserve accounting (never
  trusts raw `balanceOf`, closing off the donation-attack class),
  owner-seeded liquidity (no LP tokens — a demo instrument, not a public
  market). `swap()` enforces `minAmountOut`; `quote()` mirrors its exact
  math for callers/UIs to compute a sane minimum before sending a real
  transaction. Proven live on Arc testnet: swap output matches the pool's
  own quote exactly, reserves move by exactly the swap amounts
  (`contracts/script/prove-swap-flow.sh`).
  **Liquidity, plainly:** every Swap is a real, on-chain swap against this
  pool's real, owner-seeded reserves (~80/80 USDC/EURC as seeded, drifting
  with every swap) — not a mock. It's a small, self-seeded pool, not deep
  public liquidity, so a repeated one-directional flow (e.g. the recurring
  DCA template always swapping USDC→EURC) gradually shifts its price and
  will eventually hit its own `minAmountOut` slippage floor and start
  reverting — normal constant-product-AMM behavior on a small pool, not a
  bug. On mainnet, swaps would route through a real DEX or Circle's own FX
  infrastructure (App Kit Swap / StableFX), with liquidity deep enough that
  the same recurring flow runs indefinitely without moving the price.
- Foundry test suite: **200 passing tests** (17 fuzz tests, 256 runs each)
  across `CanalisExecutor`, its condition guards (including the oracle
  price condition against a `MockPyth`), its triggers, its LockRelease,
  Swap, and Bridge actions (the latter against a `MockTokenMessengerV2`),
  pause, enriched events, preview, per-owner enumeration, `CanalisSwapPool`,
  `CanalisAccount`, and `CanalisAccountFactory`.
- Frontend: a real visual flow **composer** (stepper: trigger → conditions
  → actions, including a Swap block with a live pool-quote-driven
  slippage control, an oracle price condition block showing the live
  Pyth price for the selected feed, and a Bridge block for burning USDC to
  Ethereum Sepolia via CCTP V2), a **deployed-flows list** with
  pause/resume and run-now (both real transactions, guarded against
  double-submit, with decoded on-chain revert reasons), live
  `previewFlow`-backed status per flow, and a **run log** built from real
  `FlowExecuted`/`ActionExecuted` events — including an honest "ran
  automatically" detection (compares each event's real `triggeredBy`
  against the connected wallet — an on-chain fact, not a guess). Reads go
  through a throttled/retrying RPC transport with a keyed-endpoint
  override, since the public Arc RPC (and most free-tier keyed ones) cap
  `eth_getLogs` hard.

### Stubbed (explicit reverts / honest "Coming soon" UI — never faked)

- Circle Wallet onboarding and Gas Station/Paymaster sponsorship — no
  Circle SDK integration; wagmi uses a plain injected connector.
- All five Arc-native feature slices from `docs/canalis-spec.md` §7.3 are
  now done.

## Getting started

**Prerequisites:** [Foundry](https://book.getfoundry.sh/getting-started/installation) and Node.js.

### Contracts

```bash
cd contracts
forge install foundry-rs/forge-std --no-git
forge install OpenZeppelin/openzeppelin-contracts --no-git
forge build
forge test
```

To deploy to Arc testnet, copy `.env.example` to `.env`, fill in `RPC_URL`
and `PRIVATE_KEY` (never commit real secrets), then:

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast
```

This deploys `CanalisSwapPool` + `CanalisExecutor` + `CanalisAccountFactory`
and creates the deployer's own `CanalisAccount` in the same run (the pool
starts empty — seed it with `./script/seed-swap-pool.sh <POOL>
<USDC_AMOUNT_6DP> <EURC_AMOUNT_6DP>`). **Note:** deployment itself works
fine via `forge script` because it never touches USDC. Any subsequent
script that deposits/forwards/splits/sweeps/swaps USDC needs the `cast
send` pattern instead — see the Arc-specific gotcha above and
`contracts/script/prove-*.sh` for working examples.

- Arc testnet chainId: `5042002`
- RPC: `https://rpc.testnet.arc.network/`
- Explorer: `https://testnet.arcscan.app`
- Faucet: `https://faucet.circle.com` (20 USDC / 2h per address; also EURC, cirBTC)
- USDC ERC-20 interface (system contract): `0x3600000000000000000000000000000000000000` (6 decimals — do not confuse with the 18-decimal native gas token)
- EURC ERC-20 interface: `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` (6 decimals)

### Web

```bash
cd web
npm install
npm run dev
```

Copy `web/.env.example` to `.env` and fill in the deployed
`VITE_CANALIS_EXECUTOR_ADDRESS` / `VITE_CANALIS_ACCOUNT_FACTORY_ADDRESS` /
`VITE_CANALIS_SWAP_POOL_ADDRESS` to point the frontend at your deployment
(see `web/.env.example` for the full list, including the RPC/`getLogs`
tuning vars).

## Next phase

Planned, **not built yet** — none of this exists in the code today:

- **Natural-language flow builder** — an LLM turns a plain-English intent
  into a valid flow struct that pre-fills the existing composer; a human
  still reviews and deploys, and the flow still passes the same on-chain
  validation as one built by hand. Purely additive, no contract changes.
  Kept free and non-abusable via a serverless proxy (Vercel/Cloudflare
  free tier) that holds the LLM key server-side and rate-limits requests,
  calling a free-tier LLM (Gemini/Groq). This is the piece that qualifies
  Canalis for the **Agentic Economy** track (Circle Agent Stack), alongside
  DeFi.
- **Telegram flow-run notifications** — keeper-side, pings a Telegram Bot
  API webhook on each `FlowExecuted`; free, bot token held server-side.
- **Security** — verify the deployed contracts on the Arc explorer
  (`testnet.arcscan.app`) and write a `SECURITY.md` threat-model doc.
- **Polish phase** — landing page, redesigned builder/dashboard, docs page;
  then final deploy, deck, and the 3-minute demo video.
- **Roadmap-only (mainnet/future)** — more CCTP destination chains, real
  yield/lending, institutional StableFX, opt-in privacy (see below).

## Mainnet roadmap

Beyond the MVP, there's a **mainnet roadmap** of things intentionally out of
scope on Arc testnet because testnet lacks the required markets, assets, or
liquidity: swaps into real volatile assets beyond cirBTC, true DCA into
major tokens, price-triggered trading with real economic outcomes,
institutional FX via StableFX, yield/lending actions, a generic "call any
DeFi protocol" action, full multi-chain Unified Balance, and opt-in privacy
for flows. The complete spec and build checklist are tracked in a private
internal document, not included in this repo.

## License

[MIT](LICENSE)
