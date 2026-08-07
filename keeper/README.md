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

`CanalisExecutor` assigns every flow id from one sequential counter shared
across every `CanalisAccount` (`registerFlow` does `flowId = _nextFlowId++`
regardless of which account owns the flow), and `getFlow`/`previewFlow`/
`executeFlow` all take a bare `flowId`, no owner parameter. That means
every account's flows can be found directly, with no need to enumerate
accounts at all: this keeper scans the executor's flow-id space itself,
watching every account automatically, not just one.

It keeps a remembered `knownFlowCount` in memory and extends it forward on
startup and on every poll, calling `getFlow(id)` for successive ids
starting exactly where the last scan stopped. `getFlow` reverts with
"CanalisExecutor: unknown flow" the moment `id` hasn't been registered
yet; that revert is the expected end-of-scan signal, not an error, and the
scan simply stops there for this poll. Flow slots are never deleted
(`setFlowActive` only flips a boolean), so once an id is confirmed valid
it never needs checking again, `knownFlowCount` only ever grows. Every id
in `[0, knownFlowCount)` then goes through `previewFlow(id)`, same as
before; if `canRun` is `true`, the keeper sends `executeFlow(id)`.

This is entirely `eth_call`-based (`getFlow`/`previewFlow`/`executeFlow`),
so it stays just as immune to tight `getLogs` block-range caps as the
single-account version before it. This is deliberately **not**
event-log-based (an earlier version indexed `FlowRegistered` via
`eth_getLogs`) since free-tier RPCs cap `getLogs` far too tight to scan
reliably in practice (QuickNode as low as 5 blocks, Alchemy 10).

`CANALIS_ACCOUNT` is no longer used for flow discovery and is optional;
`flowsOf(owner)` is still available on the contract for targeting one
account manually, just not part of the poll loop anymore.

**Tradeoff at scale.** Every poll re-checks `previewFlow` for every flow
ever registered, system-wide, and extending the frontier costs one
`eth_call` per newly discovered flow id. Fine at demo scale (single-digit
or low-double-digit flow counts); a real multi-user deployment would want
to batch these calls (e.g. `multicall`) or add a proper on-chain
`totalFlows()`/pagination view instead of one call per flow, per poll,
forever (see ROADMAP.md's "productionizing for a public multi-user
launch").

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

## Completing a CCTP bridge

Arc-native feature slice (spec section 7.3 #3): a flow's `Bridge` action
burns USDC on Arc via Circle's real CCTP V2 `TokenMessengerV2` —
`CanalisExecutor` only ever proves that burn (see its "ARC-NATIVE FEATURE:
CCTP Bridge" docs). The mint on the destination chain is a separate,
asynchronous transaction that needs Circle's off-chain attestation service
to sign the burn message first — `scripts/complete-cctp-bridge.ts` is that
second leg, run standalone (it is NOT part of the poll loop above; a
bridge completion isn't a flow to poke, it's a one-shot follow-up to one
specific burn transaction).

```bash
cd keeper
npm install
# add SEPOLIA_RPC_URL and SEPOLIA_PRIVATE_KEY to .env (see .env.example) —
# a Sepolia wallet funded with a small amount of Sepolia ETH for gas; it
# does NOT need to be the wallet that burned the USDC or the mint
# recipient, since CCTP's destinationCaller is bytes32(0) (permissionless)
node --env-file=.env scripts/complete-cctp-bridge.ts <arcBurnTxHash>
```

What it does:

1. Polls Circle's real testnet CCTP V2 attestation API (Iris,
   `https://iris-api-sandbox.circle.com` — NOT the production
   `iris-api.circle.com`) for the burn transaction, until it reports
   `status: "complete"` (Circle has signed it). In practice this has been
   near-instant (seconds) on testnet, but standard transfers wait for
   source-chain finality first, so budget a few minutes.
2. Reads the recipient's Sepolia USDC balance before.
3. Calls `MessageTransmitterV2.receiveMessage(message, attestation)` on
   Ethereum Sepolia with the real message + attestation Circle returned.
4. Reads the recipient's Sepolia USDC balance after and prints the delta,
   plus the mint tx as a `sepolia.etherscan.io` link.

Proven live: a 1 USDC burn on Arc was picked up by Circle's real
attestation service and minted on Ethereum Sepolia — recipient balance
went from `0` to `1000000` (1.000000 USDC). See
`contracts/script/prove-cctp-bridge.sh` for the burn-leg proof this
completion script picks up after.

## Telegram notifications

Optional, additive, keeper-side only — no contract or frontend changes.
Whenever the keeper **autonomously executes a flow successfully**
(`executeFlow` confirms with `status: "success"`), it sends a Telegram
message so the user gets pinged that their money moved. Skips/`"not due"`
reverts and failed executions are never notified — only real, confirmed
successes.

**Setup:**

1. Message [@BotFather](https://t.me/BotFather) on Telegram, send `/newbot`,
   follow the prompts — it gives you a bot token
   (`123456789:ABC-...`).
2. Message [@userinfobot](https://t.me/userinfobot) (or start a chat with
   your new bot and check its `getUpdates` API response) to get your numeric
   chat ID.
3. Add both to `keeper/.env` (never commit real values — `.env.example`
   only ever holds placeholders):
   ```
   TELEGRAM_BOT_TOKEN=123456789:ABC-your-real-token
   TELEGRAM_CHAT_ID=123456789
   ```
4. Start a chat with your bot first (send it any message) — Telegram
   otherwise rejects `sendMessage` to a chat that's never messaged the bot.

**If either var is unset**, notifications are silently disabled — the
keeper logs this once on startup and runs exactly as before otherwise; it
is never a hard requirement.

**What you'll see:**
- On startup (if enabled): `🟢 Canalis keeper started, watching N flow(s) across all accounts`.
- On every successful autonomous execution:
  ```
  ✅ Flow #6 ran automatically
  OnSchedule — Swap 3 USDC→EURC
  https://testnet.arcscan.app/tx/0x...
  ```

Uses the free Telegram Bot API directly via `fetch` (no new dependency,
no cost, no rate-limit risk beyond Telegram's own generous free limits). A
failed send (bad token, Telegram down, network hiccup) is logged and
swallowed — it can never crash or stall the poll loop (see `src/notify.ts`).

## What it does NOT do

- It does not decide amounts, recipients, or whether a flow *should* exist —
  it only pokes flows that are already registered on-chain.
- It never touches Manual-trigger flows.
- It does not retry failed sends beyond the next poll cycle; a transient RPC
  error is logged and the loop continues at the next interval.
- It does not route Telegram notifications per user; every autonomous run
  across every account still pings the same single operator chat.
- It does not notify on skips, "not due" reverts, or failed executions —
  only on a confirmed successful `executeFlow` (see "Telegram
  notifications" above).
