# Canalis Roadmap

**Vision:** money that runs itself — a visual and AI-assisted builder that turns Arc's programmable-money stack into flows anyone can compose, deploy, and trust, without writing Solidity.

This document is the single, public source of truth for where Canalis is and where it's headed. It's split clearly into what's **shipped** (real, proven on Arc testnet) and what's **planned** (not yet built) — nothing here should be read as already working unless it's under "Where Canalis is today."

---

## Where Canalis is today (shipped)

A visual + AI-assisted builder for programmable USDC money-flows on Arc, with a real flows-as-data engine behind it:

- **Per-user on-chain vaults** (`CanalisAccount`, one per owner via `CanalisAccountFactory`) — funds move only through the configured executor's `onlyExecutor`-gated `executorTransfer`.
- **Triggers:** `Manual`, `OnSchedule`, `OnThreshold`, `OnReceive` — the last three are caller-agnostic (a keeper or anyone may poke them), because `CanalisExecutor` re-verifies the real on-chain precondition every call rather than trusting the caller.
- **Conditions:** amount cap, minimum balance, cooldown, time window, allow/deny recipients, and a **live Pyth oracle price condition** — evaluated as a logical AND, sharing the exact same non-reverting check path `previewFlow` uses.
- **Actions:** Forward, Split, Sweep, Lock/Release, Swap, Bridge.
- **The 5 Arc-native features** (spec §7.3, all done and proven on-chain):
  1. A self-built constant-product AMM (`CanalisSwapPool`) powering an in-flow USDC↔EURC **Swap** action.
  2. A **live-oracle price condition** reading Pyth's real, production-guardian-verified feed on Arc testnet.
  3. A **CCTP V2 Bridge action** — proven with a full round trip, burn on Arc → real Circle attestation → mint on Ethereum Sepolia.
  4. & 5. **Treasury-rebalance** and **recurring-DCA** one-click composite templates, built from (1) + (2).
- **An autonomous off-chain keeper** (`keeper/`) driving the caller-agnostic triggers and keeping the on-chain oracle price fresh, plus **Telegram flow-run notifications** on every confirmed successful execution.
- **A natural-language (AI) flow builder** — an LLM (Groq) drafts a flow from plain English into the existing composer for a human to review and deploy; the key stays server-side, four anti-abuse limits are enforced, and the model never invents addresses or auto-deploys.
- **200 Foundry tests** (17 fuzz), all three deployed contracts **verified** (full match) on the Arc explorer, and a real [SECURITY.md](SECURITY.md) threat model — never claimed "audited."
- **Dual-track fit:** DeFi (primary) + Agentic Economy (secondary, via the AI flow builder).

See [README.md](README.md) for the full architecture, repo layout, and exact "Status" breakdown, and [SECURITY.md](SECURITY.md) for the threat model.

---

## Next: productionizing for a public multi-user launch

- **Multi-account keeper** — autonomous execution for every user's flows, not just the operator's. Keeper-only change (a new enumeration path or a config list of accounts to poll); no contract change needed.
- **Per-user notifications** — a "connect your Telegram" flow so each user gets their own pings, instead of today's single operator chat.
- **Flow management** — delete/archive, clone/duplicate, and per-flow run stats.
- **A consolidated home/treasury dashboard** — balances, active flows, and next-run-at, all at a glance.
- **Hosted deployment** — frontend + AI proxy on a static host (e.g. Vercel), keeper on an always-on host.

---

## Security hardening (planned)

- **Make the account's executor immutable** (set once at creation by `CanalisAccountFactory`) **or add a timelock on rotation** — hardening the documented, owner-signed `setExecutor` trust boundary (see [SECURITY.md](SECURITY.md#executor-rotation-setexecutor--a-known-owner-signed-trust-boundary)).
- **Add `nonReentrant` to `registerFlow`/`setFlowActive`** — defense-in-depth, closing the gap noted in SECURITY.md even though no exploitable path was found.
- **A professional third-party audit** before any mainnet deployment.

---

## Mainnet & ecosystem depth (vision)

- **Deploy to Arc mainnet.**
- **Route swaps through deep real liquidity** (a real DEX or Circle StableFX) instead of the self-seeded testnet pool — so flows like recurring DCA run indefinitely without moving the price.
- **More CCTP destinations** (Base, Arbitrum, Optimism, …) beyond Ethereum Sepolia.
- **Real yield / lending actions** — put idle USDC to work instead of letting it sit.
- **Circle Wallets onboarding** — email/social sign-in (no seed phrase) + Paymaster gasless transactions, so "set up money automation" needs nothing but an email.
- **Opt-in privacy** (as it lands on Arc's own roadmap).
- **Institutional treasury & FX flows.**

---

*For the exact, field-by-field breakdown of what's implemented today, see [README.md § Status](README.md#status). For the threat model and known scope cuts, see [SECURITY.md](SECURITY.md).*
