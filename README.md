<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/canalis-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="brand/canalis-logo-light.svg">
  <img alt="Canalis" src="brand/canalis-logo-dark.svg" width="210" height="64">
</picture>

**IFTTT for your money, on rails that settle in under a second.**

Built solo for the **Programmable Money Hackathon — Build on Arc** (DeFi track).
Canalis is a self-contained, single-user visual builder for programmable USDC
money-flows on [Arc](https://docs.arc.io), Circle's stablecoin-native L1.

> Status: early MVP skeleton, not yet functional end-to-end. See
> [Status](#status) below for exactly what runs today versus what's stubbed.

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
 │ threshold flows │             │   one shared        │         │  vault)          │
 └────────────────┘             │   contract)         │         └─────────────────┘
                                 └───────────────────┘
```

- **`CanalisExecutor`** — `registerFlow` stores a flow; `executeFlow`
  validates the trigger, evaluates every condition, then runs the action
  list atomically in a single transaction. One audited contract instead of
  one deployment per flow: cheaper, easier to secure, and new block types
  can be added as new handlers instead of new contracts.
- **`CanalisAccount`** — a minimal per-user vault that custodies USDC and
  points at the executor it trusts.
- **Keeper (planned, not built)** — for `OnSchedule`/`OnThreshold` triggers,
  an off-chain poller pokes the executor, which **re-verifies the condition
  on-chain** before acting, so the keeper can never fire a flow falsely.
  `OnReceive` is meant to be event-driven from the account instead of
  keeper-polled.

## The flow model

Defined today in `contracts/src/libraries/FlowTypes.sol` and mirrored in
`web/src/lib/flows.ts`. This is the MVP scope — a smaller set than the full
block catalogue in the project's internal spec (Stream, Swap, CCTP, oracle
conditions, etc. are extended/future scope, tracked privately).

**Triggers:** `OnReceive` · `OnSchedule` · `OnThreshold` · `Manual`

**Actions:** `Split` · `Forward` · `Sweep` · `LockRelease`

**Condition guard fields:** amount cap (min/max), cooldown, time window,
minimum balance, allow/deny recipient lists.

All of the above exist as on-chain data types today and are exercised by
the Foundry test suite. **None of them execute real logic yet** — trigger
validation, condition evaluation, and every action handler are explicit,
tested `revert("... not yet implemented")` stubs. Nothing here silently
"succeeds" without doing anything; see [Status](#status).

## Repo layout

```
canalis/
├── contracts/                     # Foundry project
│   ├── src/
│   │   ├── libraries/FlowTypes.sol      # trigger/action enums, Condition/Action/Flow structs
│   │   ├── interfaces/ICanalisExecutor.sol
│   │   ├── CanalisExecutor.sol          # flows-as-data interpreter (stubbed execution)
│   │   └── CanalisAccount.sol           # per-user USDC vault (deposit/withdraw — implemented)
│   ├── test/CanalisExecutor.t.sol       # 4 passing tests
│   ├── script/Deploy.s.sol              # deploy script for Arc testnet
│   └── .env.example                     # RPC_URL / PRIVATE_KEY placeholders
└── web/                            # Vite + React + TS frontend
    ├── src/
    │   ├── chains.ts / wagmi.ts          # Arc testnet chain + wagmi config
    │   ├── lib/flows.ts                  # TS mirror of the Solidity flow model
    │   ├── components/
    │   │   ├── Header.tsx                # wordmark + tab nav + wallet connect
    │   │   ├── WalletConnect.tsx          # injected-wallet connect/disconnect
    │   │   ├── BuilderCanvas.tsx          # trigger/condition/action block palette
    │   │   ├── Dashboard.tsx              # account/balance/flows/run-log cards
    │   │   └── ui/                        # Card, Badge, EmptyState, FlowBlock, etc.
    │   └── index.css                     # Tailwind v4 theme (dark, "channel" palette)
    └── .env.example                       # RPC override + deployed-contract address placeholders
```

## Tech stack

| Layer | Choice |
|---|---|
| Contracts | Solidity + Foundry, OpenZeppelin (`ReentrancyGuard`, `Ownable`, `SafeERC20`) |
| Frontend | Vite + React + TypeScript + wagmi + viem |
| Styling | Tailwind CSS v4 |
| Chain | Arc testnet |

## Status

### Implemented

- `FlowTypes.sol` data model — the full MVP trigger/action/condition set,
  matching the spec.
- `CanalisExecutor.registerFlow` / `getFlow` — store and read back a flow;
  `executeFlow` runs the full validate → evaluate → dispatch → emit
  pipeline structurally, with a reentrancy guard. Every unimplemented step
  (trigger validation, condition evaluation, all four action handlers)
  reverts explicitly rather than silently no-op'ing.
- `CanalisAccount` — a real, working USDC vault: `deposit`, `withdraw`,
  `balance` all move actual tokens via `SafeERC20`.
- Foundry test suite (4 passing tests) covering registration, read-back,
  and the honest-revert behavior of `executeFlow`.
- Deploy script for Arc testnet (`script/Deploy.s.sol`) — USDC address is a
  placeholder pending confirmation against Arc's contract-address docs.
- Frontend scaffold: Vite + React + TS, wagmi/viem configured for Arc
  testnet (chainId `5042002`), injected-wallet connect/disconnect, a
  Builder/Dashboard tab layout, and a Tailwind-based UI where every
  not-yet-working piece is an explicit "Coming soon" state rather than
  fake data.

### TODO (tracking the internal build checklist)

- Trigger validation logic (on-receive hook, schedule/threshold
  re-verification, manual-run authorization).
- Condition evaluation logic (cap/cooldown/time-window/balance/allow-deny
  checks).
- Action execution logic — `Split`/`Forward`/`Sweep`/`LockRelease` actually
  moving USDC out of `CanalisAccount`.
- Keeper service for `OnSchedule`/`OnThreshold` triggers with on-chain
  re-verification.
- Flow builder drag-and-drop composition, wired to `registerFlow` (the
  Deploy button is currently disabled by design).
- Live dashboard reads: balance, deployed flows, and a run log indexed from
  `FlowExecuted`/`ActionExecuted` events, linked to arcscan.
- `encodeFlow` / `decodeFlow` in `web/src/lib/flows.ts`.
- Circle Wallet onboarding and Gas Station/Paymaster sponsorship.
- 2–3 demo templates (income-splitter, savings-sweep, scheduled payout).
- Fuzz tests on the executor.

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

- Arc testnet chainId: `5042002`
- RPC: `https://rpc.testnet.arc.network/`
- Explorer: `https://testnet.arcscan.app`
- Faucet: `https://faucet.circle.com` (20 USDC / 2h per address; also EURC, cirBTC)

### Web

```bash
cd web
npm install
npm run dev
```

Copy `web/.env.example` to `.env` if you want to override the default RPC
or point the frontend at deployed contract addresses.

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
