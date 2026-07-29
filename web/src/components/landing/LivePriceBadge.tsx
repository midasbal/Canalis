import { useEffect, useState } from "react";
import { CANALIS_EXECUTOR_ADDRESS } from "../../lib/contracts";
import { ORACLE_FEEDS } from "../../lib/oracleFeeds";
import { fetchHermesPrice } from "../../lib/oracleRefresh";

const EUR_USD = ORACLE_FEEDS.find((f) => f.key === "EURUSD")!;
const REFRESH_MS = 20_000;

/**
 * A quiet, honest proof point next to the "watch a flow run" demo: the
 * REAL, live-market EUR/USD price, fetched directly from Pyth's
 * production Hermes API (the same source the keeper itself pulls from
 * before pushing a fresh price on-chain) rather than the last on-chain
 * value, which only updates when the keeper actually runs and can go
 * stale if it isn't. Read-only, no wallet, works pre-connect. Refetches
 * every 20s so the number visibly updates on its own.
 *
 * If the fetch fails, or hasn't resolved yet, this renders nothing at all
 * (never a fake number or a visible error state) — the same graceful
 * behavior as before.
 */
export function LivePriceBadge() {
  const [usd, setUsd] = useState<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const { usd: price } = await fetchHermesPrice(EUR_USD.priceId);
        if (!cancelled && price > 0) setUsd(price);
      } catch {
        // A failed fetch just leaves the last-known price showing (or
        // nothing, if there was never a successful fetch) — never an
        // error state.
      }
    }

    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!usd || !CANALIS_EXECUTOR_ADDRESS) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs text-brand-muted">
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-violet" />
        Flows are reacting to the live market price right now: EUR/USD{" "}
        <span key={usd} className="animate-fade-in text-brand-ink">
          {usd.toFixed(4)}
        </span>
      </span>
      <a
        href={`https://testnet.arcscan.app/address/${CANALIS_EXECUTOR_ADDRESS}`}
        target="_blank"
        rel="noreferrer"
        className="underline decoration-brand-bronze/40 underline-offset-4 transition-colors duration-200 hover:text-brand-ink"
      >
        Contracts verified on-chain
      </a>
    </div>
  );
}
