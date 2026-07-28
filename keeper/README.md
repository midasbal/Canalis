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
ever calls `executeFlow` on the executor and `updatePriceFeeds` on the Pyth
oracle (see "Oracle price updates" below) — it cannot move user funds on
its own. Only the executor contract's own logic can move money out of a
`CanalisAccount`, and that logic doesn't trust `msg.sender` for these
trigger types, it trusts the on-chain precondition; `updatePriceFeeds` only
ever pushes a Pyth-signed price value, it has no path to touch account
funds either. The key still needs a small amount of Arc's native gas-USDC
to pay for its own transactions (plus Pyth's update fee, also paid in the
native gas token, when it refreshes a price).

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

## Oracle price updates

Arc-native feature slice (spec section 7.3 #2): a flow's Condition can
require a live Pyth price to be above/below a threshold. `CanalisExecutor`
is a **read-only** consumer of the oracle — it never calls
`updatePriceFeeds` itself, since that would make the `view`-only
`_checkConditions`/`previewFlow` path a state-mutating call. Keeping the
stored price fresh is this keeper's job instead, on the same
"caller-agnostic precondition, not a decision" model as
OnSchedule/OnThreshold.

**Important — production Hermes, not testnet/beta Hermes:** Arc testnet's
deployed Pyth contract (`0x2880aB155794e7179c9eE2e38200202908C17B43`)
verifies price updates against the REAL production Wormhole guardian set
(confirmed on-chain: guardian_set_index 7, 13-of-19 signatures on a
successful update we observed). It rejects updates signed by
`hermes-beta.pyth.network` (Pyth's testnet Hermes, which signs with a
single dev guardian, index 0) with `InvalidWormholeVaa`. So this keeper —
and the composer's feed catalog (`web/src/lib/oracleFeeds.ts`) — use
`hermes.pyth.network` (production Hermes) and PRODUCTION feed ids
throughout. This means the price CanalisExecutor reads is a genuinely real,
live market price, not a synthetic testnet one — a stronger result than
the spec anticipated ("testnet prices may be synthetic/stale... the
mechanism must still be real"), discovered by testing both variants
directly against the deployed contract rather than assuming the docs'
"testnet API" pointer would work.

Each poll (`pollOnce`):

1. Reads every candidate flow's conditions (`getFlow`) and collects the
   distinct oracle `priceId`s referenced, each mapped to the **strictest**
   `maxStaleness` any of those flows requires for that feed.
2. For each distinct `priceId`, reads the oracle's currently stored price
   (`getPriceUnsafe`) and checks its age against that requirement.
3. Only for feeds that are actually stale (or have never been pushed
   on-chain at all) does it fetch a fresh signed update from Pyth's Hermes
   API (`HERMES_URL`, default `https://hermes-beta.pyth.network`) and
   submit it via `oracle.updatePriceFeeds(updateData)`, paying
   `oracle.getUpdateFee(updateData)` in the chain's native gas token.
4. Then proceeds with the normal `previewFlow` → `executeFlow` loop as
   before.

A poll with no oracle-conditioned flows costs nothing extra — the
`priceId` collection step is a no-op. A poll with one already-fresh feed
also spends nothing beyond the one `getPriceUnsafe` read. **Extra gas**:
`updatePriceFeeds` is itself a paid on-chain transaction (native gas token,
plus Pyth's own update fee in the same token) — only sent when a feed is
actually stale, not every poll. An oracle-refresh failure (Hermes down, a
bad update payload, insufficient fee) is logged and the poll continues
without it — flows needing that price just fail their own staleness check
downstream with a clear on-chain reason, the same as any other unmet
precondition, rather than taking the whole keeper down.

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
