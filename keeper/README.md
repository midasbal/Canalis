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

`CanalisExecutor` has no on-chain "list all flows for owner X" function, so
the keeper indexes `FlowRegistered` events directly from the executor
contract (across every owner, not just one) to build its working set of
flow IDs, then re-reads each flow's current state via `getFlow` on every
poll.

## Running it

```bash
cd keeper
npm install
cp .env.example .env
# edit .env: RPC_URL, EXECUTOR_ADDRESS, KEEPER_PRIVATE_KEY, POLL_INTERVAL_MS
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
