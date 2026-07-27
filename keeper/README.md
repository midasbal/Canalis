# Canalis keeper

A small, standalone off-chain service that pokes `CanalisExecutor.executeFlow`
for the caller-agnostic triggers — **OnSchedule**, **OnThreshold**, and
**OnReceive** — so those flows run autonomously without a human clicking
"run now" (Manual stays owner-only and is never touched by the keeper).

## Trust model

The keeper is **not** trusted to decide when a flow should run. It just
calls `executeFlow`, and `CanalisExecutor` re-verifies the real precondition
on-chain (schedule due? threshold met? new deposit to consume?) before doing
anything. If the keeper calls too early, the contract reverts with a clear
reason ("schedule not due", "threshold not met", "no new deposit to
consume") and no state changes — a normal, expected outcome the keeper just
logs and moves past, not an error.

The keeper's private key (`KEEPER_PRIVATE_KEY`) is a **hot key** that only
ever calls `executeFlow`. It cannot move user funds on its own — only the
executor contract's own logic can move money out of a `CanalisAccount`, and
that logic doesn't trust `msg.sender` for these trigger types, it trusts the
on-chain precondition. The key still needs a small amount of Arc's native
gas-USDC to pay for its own transactions.

## Flow discovery

`CanalisExecutor` has no on-chain "list every flow across every owner"
function, so this keeper services **one configured account**
(`CANALIS_ACCOUNT`) and discovers its flows via `flowsOf(CANALIS_ACCOUNT)` —
a single `eth_call`, not a log scan. On every poll, each returned flow ID
goes through `previewFlow(id)`; if `canRun` is `true`, the keeper sends
`executeFlow(id)`.

This is deliberately **not** event-log-based (an earlier version indexed
`FlowRegistered` via `eth_getLogs`). Free-tier RPCs cap `getLogs` far too
tight to scan reliably in practice (QuickNode as low as 5 blocks, Alchemy
10) — `flowsOf`/`previewFlow`/`executeFlow` are all plain `eth_call`s, so
this keeper is completely immune to that cap.

The tradeoff: servicing multiple accounts would mean either a second
on-chain enumeration mechanism (e.g. an `allAccounts()` view on the
factory) or a config list of accounts to poll — fine for the single-user
demo as-is; multi-account support is future work, not implemented here.

## Running it

```bash
cd keeper
npm install
cp .env.example .env
# edit .env: RPC_URL, EXECUTOR_ADDRESS, CANALIS_ACCOUNT, KEEPER_PRIVATE_KEY, POLL_INTERVAL_MS
npm start
```

Requires Node 24+ (runs the TypeScript source directly via Node's built-in
type stripping — no build step needed for local runs).

## Demo tip

For a live demo, set `POLL_INTERVAL_MS=60000` (or lower) and register a
short-interval `OnSchedule` flow (e.g. `scheduleInterval` of a minute or
two) — within one or two poll cycles you'll see the keeper log a
`executeFlow` transaction hash it sent on its own, with no human interaction,
linking straight to `testnet.arcscan.app`.

## What it does NOT do

- It does not decide amounts, recipients, or whether a flow *should* exist —
  it only pokes flows that are already registered on-chain.
- It never touches Manual-trigger flows.
- It does not retry failed sends beyond the next poll cycle; a transient RPC
  error is logged and the loop continues at the next interval.
- It does not enumerate flows across multiple CanalisAccounts — see "Flow
  discovery" above.
