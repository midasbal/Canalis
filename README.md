<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/canalis-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="brand/canalis-logo-light.svg">
  <img alt="Canalis" src="brand/canalis-logo-dark.svg" width="210" height="64">
</picture>

**IFTTT for your money, on rails that settle in under a second.**

Built solo for the **Programmable Money Hackathon — Build on Arc** (DeFi track).
Canalis is a self-contained, single-user visual builder for programmable USDC
money-flows on [Arc](https://docs.arc.io), Circle's stablecoin-native L1.

> Status: a real subset of the MVP is deployed and proven end-to-end on Arc
> testnet — all four triggers (Manual, OnSchedule, OnThreshold, OnReceive)
> and all four actions (Forward, Split, Sweep, LockRelease) work against a
> user's own on-chain account, gated by real condition guards (balance
> floor, time window, cooldown, allow/deny recipients, amount cap), a real
> off-chain keeper autonomously drives the caller-agnostic triggers, and
> flows can be paused/cancelled, dry-run previewed, and enumerated
> per-owner — the contract-side building blocks the upcoming builder UI
> needs. Everything else (the visual builder canvas itself, most of the
> dashboard, Circle Wallet/Paymaster) is still stubbed. See
> [Status](#status) for the exact, honest breakdown.

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
 │ Keeper (planned)│──pokes───▶ │  CanalisExecutor    │──moves──▶│  CanalisAccount  │
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
- **Keeper (planned, not built)** — for `OnSchedule`/`OnThreshold` triggers,
  an off-chain poller pokes the executor, which **re-verifies the condition
  on-chain** before acting, so the keeper can never fire a flow falsely.
  `OnReceive` is meant to be event-driven from the account instead of
  keeper-polled.

## The flow model

Defined in `contracts/src/libraries/FlowTypes.sol` and mirrored in
`web/src/lib/flows.ts`. This is the MVP scope — a smaller set than the full
block catalogue in the project's internal spec (Stream, Swap, CCTP, oracle
conditions, etc. are extended/future scope, tracked privately).

**Triggers:** `OnReceive` · `OnSchedule` · `OnThreshold` · `Manual`

**Actions:** `Split` · `Forward` · `Sweep` · `LockRelease`

**Condition guard fields:** amount cap (min/max), cooldown, time window,
minimum balance, allow/deny recipient lists.

All of the above exist as on-chain data types. **`Manual` (trigger),
`Forward`/`Split`/`Sweep` (actions), and every Condition guard field
execute real logic today** — proven on Arc testnet, moving real USDC and
genuinely blocking flows that violate a guard. Conditions on a flow are
evaluated as a logical AND (every field on every `Condition` entry must
hold) after trigger validation and before any action runs; the first
unmet field reverts with a specific reason (e.g. `"CanalisExecutor:
amount exceeds cap"`), never a silent skip. Everything else — the other
three trigger types and `LockRelease` — is an explicit, tested
`revert("... not yet implemented")`, never a silent no-op. See
[Status](#status) for the precise breakdown.

## Repo layout

```
canalis/
├── contracts/                     # Foundry project
│   ├── src/
│   │   ├── libraries/FlowTypes.sol         # trigger/action enums, Condition/Action/Flow structs
│   │   ├── interfaces/ICanalisExecutor.sol
│   │   ├── CanalisExecutor.sol             # flows-as-data interpreter (all 4 triggers, all 4 actions, pause, preview, enumeration)
│   │   ├── CanalisAccount.sol              # per-user USDC vault + onlyExecutor trust boundary + depositNonce
│   │   └── CanalisAccountFactory.sol       # one CanalisAccount per owner, self-service
│   ├── test/
│   │   ├── CanalisExecutor.t.sol           # registerFlow/executeFlow, Forward/Split/Sweep, fuzz
│   │   ├── CanalisExecutorConditions.t.sol # all 5 Condition guard fields, multi-condition, fuzz
│   │   ├── CanalisExecutorTriggers.t.sol   # OnSchedule/OnThreshold/OnReceive, catch-up, fuzz
│   │   ├── CanalisExecutorLockRelease.t.sol # lock/release lifecycle, double-spend/double-release, fuzz
│   │   ├── CanalisExecutorPause.t.sol      # setFlowActive blocks every trigger type, owner-only, unpause
│   │   ├── CanalisExecutorEvents.t.sol     # ActionExecuted recipient/amount per action type, incl. Split legs
│   │   ├── CanalisExecutorPreview.t.sol    # previewFlow vs. real executeFlow, every trigger type + conditions
│   │   ├── CanalisExecutorEnumeration.t.sol # flowsOf per-owner, in order, doesn't mix owners
│   │   ├── CanalisAccount.t.sol            # executorTransfer trust boundary, fuzz
│   │   ├── CanalisAccountFactory.t.sol     # one-account-per-owner
│   │   └── mocks/MockERC20.sol             # 6-decimal mock USDC for tests
│   ├── script/
│   │   ├── Deploy.s.sol                    # deploys Executor + Factory + deployer's account
│   │   ├── prove-forward-flow.sh           # live-testnet proof: Forward (cast-based, see gotcha above)
│   │   ├── prove-split-flow.sh             # live-testnet proof: Split
│   │   ├── prove-sweep-flow.sh             # live-testnet proof: Sweep
│   │   ├── prove-amount-cap-condition.sh   # live-testnet proof: amount-cap condition (block + allow)
│   │   ├── prove-cooldown-condition.sh     # live-testnet proof: cooldown condition (block + allow)
│   │   ├── prove-onschedule-trigger.sh     # live-testnet proof: OnSchedule (due, catch-up, non-owner keeper caller)
│   │   ├── prove-onthreshold-trigger.sh    # live-testnet proof: OnThreshold (below blocked, at/above allowed)
│   │   ├── prove-onreceive-trigger.sh      # live-testnet proof: OnReceive (armed by deposit, no double-fire)
│   │   ├── prove-lockrelease.sh            # live-testnet proof: LockRelease (still-locked, release-once, no double-release)
│   │   ├── prove-pause.sh                  # live-testnet proof: pause blocks execution, unpause restores it
│   │   ├── prove-preview.sh                # live-testnet proof: previewFlow matches a real executeFlow call
│   │   └── prove-flowsof.sh                # live-testnet proof: flowsOf lists the owner's registered flow ids
│   └── .env.example                        # RPC_URL / PRIVATE_KEY placeholders
├── keeper/                         # standalone Node/TS + viem keeper service
│   ├── src/
│   │   ├── index.ts                        # poll loop: discover flows, poke executeFlow, tolerate reverts
│   │   ├── abi.ts / chain.ts / config.ts    # minimal executor ABI, Arc testnet chain def, env config
│   └── .env.example                        # RPC_URL / EXECUTOR_ADDRESS / KEEPER_PRIVATE_KEY / POLL_INTERVAL_MS
└── web/                            # Vite + React + TS frontend
    ├── src/
    │   ├── chains.ts / wagmi.ts             # Arc testnet chain + wagmi config
    │   ├── lib/
    │   │   ├── flows.ts                     # TS mirror of the Solidity flow model + encode/decode
    │   │   ├── abi.ts                       # hand-maintained ABI subset for the contracts above
    │   │   ├── contracts.ts                 # deployed-address env lookup
    │   │   └── useCanalisAccount.ts         # resolves the connected wallet's CanalisAccount
    │   ├── components/
    │   │   ├── Header.tsx                   # wordmark + tab nav + wallet connect
    │   │   ├── WalletConnect.tsx             # injected-wallet connect/disconnect
    │   │   ├── BuilderCanvas.tsx             # trigger/condition/action block palette (static)
    │   │   ├── DeployForwardFlow.tsx         # the one real Builder path: create account, deploy+run a Forward flow
    │   │   ├── Dashboard.tsx                 # account/balance (live) + flows/run-log (placeholder) cards
    │   │   └── ui/                          # Card, Badge, EmptyState, FlowBlock, etc.
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
  balance is at or below the threshold), and **`LockRelease`** (a
  two-phase action per flow/action slot: the first `executeFlow` call
  locks `fixedAmount` out of the `CanalisAccount` into the **executor's
  own custody** — not a separate ledger inside the account, so locked
  funds are structurally unreachable by any other action/flow reading
  `CanalisAccount.balance()` — a call before `unlockTime` reverts "still
  locked", and the first call at/after `unlockTime` releases to the
  recipient and permanently marks that slot released, so double-release
  is impossible by construction, not just guarded). All four proven with
  real transactions on Arc testnet (see `contracts/script/prove-*.sh`).
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
  succeeds and moves USDC.
- A real off-chain **keeper** (`keeper/`, Node/TS + viem) that indexes
  `FlowRegistered` events across all owners, re-reads each flow's live
  state, and pokes `executeFlow` for anything due/eligible — skipping
  `Manual` flows entirely, since those stay owner-only. Proven live on
  Arc testnet driving a short-interval `OnSchedule` flow to fire with no
  human interaction; see `keeper/README.md` for how to run it and the
  trust model (a hot key that only ever calls `executeFlow`; the contract,
  not the caller, is what's trusted).
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
- Foundry test suite: **129 passing tests** (13 fuzz tests, 256 runs each)
  across `CanalisExecutor`, its condition guards, its triggers, its
  LockRelease action, pause, enriched events, preview, per-owner
  enumeration, `CanalisAccount`, and `CanalisAccountFactory`.
- Frontend: wagmi/viem configured for Arc testnet (chainId `5042002`),
  injected-wallet connect/disconnect, live `CanalisAccount.balance` read on
  the Dashboard, and one real end-to-end Builder path
  (`DeployForwardFlow.tsx`: create account → compose a Manual+Forward flow
  → `registerFlow` → `executeFlow`, all against the deployed contracts).
  **Not extended this slice or the engine-for-UI addendum** — no
  trigger/keeper/pause/preview UI was added; everything above is proven
  via `cast`/tests/the keeper service itself, not the frontend. The
  addendum exists specifically so the next slice can build the visual
  builder against a frozen, UI-ready engine.

### Stubbed (explicit reverts / honest "Coming soon" UI — never faked)

- Flow builder drag-and-drop composition — `BuilderCanvas.tsx`'s palette is
  static; the "Deploy from canvas" button is disabled by design. Only the
  Forward-flow form (`DeployForwardFlow.tsx`) is wired to
  `registerFlow`/`executeFlow` today — Split/Sweep and every Condition
  guard are real in the contract but not yet exposed as Builder UI (the
  deploy form always registers a zero-condition flow).
- Dashboard "Deployed flows" and "Run log" cards — placeholder `EmptyState`,
  zero event indexing behind them. Balance is the only live read.
- Circle Wallet onboarding and Gas Station/Paymaster sponsorship — no
  Circle SDK integration; wagmi uses a plain injected connector.
- 2–3 demo templates (income-splitter, savings-sweep, scheduled payout).

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

This deploys `CanalisExecutor` + `CanalisAccountFactory` and creates the
deployer's own `CanalisAccount` in the same run. **Note:** this works fine
via `forge script` because deployment never touches USDC. Any subsequent
script that deposits/forwards/splits/sweeps USDC needs the `cast send`
pattern instead — see the Arc-specific gotcha above and
`contracts/script/prove-*.sh` for working examples.

- Arc testnet chainId: `5042002`
- RPC: `https://rpc.testnet.arc.network/`
- Explorer: `https://testnet.arcscan.app`
- Faucet: `https://faucet.circle.com` (20 USDC / 2h per address; also EURC, cirBTC)
- USDC ERC-20 interface (system contract): `0x3600000000000000000000000000000000000000` (6 decimals — do not confuse with the 18-decimal native gas token)

### Web

```bash
cd web
npm install
npm run dev
```

Copy `web/.env.example` to `.env` and fill in the deployed
`VITE_CANALIS_EXECUTOR_ADDRESS` / `VITE_CANALIS_ACCOUNT_FACTORY_ADDRESS` to
point the frontend at your deployment.

## Roadmap

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
