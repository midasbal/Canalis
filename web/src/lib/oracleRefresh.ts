import type { Hex } from "viem";

/**
 * Production Hermes — Pyth's real price-update API. NOT hermes-beta: Arc
 * testnet's deployed Pyth contract verifies updates against the real
 * production Wormhole guardian set and rejects hermes-beta-signed updates
 * with "InvalidWormholeVaa" (confirmed on-chain — see keeper/README.md
 * "Oracle price updates" / docs/canalis-spec.md section 7.3 #2). The
 * keeper uses this same endpoint; this mirrors it for manual "Run now".
 */
const HERMES_URL = "https://hermes.pyth.network";

/**
 * Fetches a real signed price update for `priceIds` from Pyth's production
 * Hermes API — the exact same source the keeper pushes on-chain before
 * poking an oracle-conditioned flow (keeper/src/index.ts's
 * `fetchHermesUpdate`). Throws on any non-2xx response or malformed body
 * rather than returning something that looks like data but isn't.
 */
export async function fetchHermesUpdate(priceIds: Hex[]): Promise<Hex[]> {
  const params = priceIds.map((id) => `ids[]=${id}`).join("&");
  const res = await fetch(`${HERMES_URL}/v2/updates/price/latest?${params}`);
  if (!res.ok) {
    throw new Error(`Hermes request failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { binary: { data: string[] } };
  return body.binary.data.map((hex) => (hex.startsWith("0x") ? (hex as Hex) : (`0x${hex}` as Hex)));
}

export interface HermesPrice {
  /** Real USD value, already rescaled by the feed's own expo. */
  usd: number;
  /** Unix seconds Hermes says this price was published. */
  publishTime: number;
}

/**
 * Fetches the current PARSED price for a single feed straight from Pyth's
 * production Hermes API — a plain, read-only, no-wallet-needed call. Used
 * by the landing's live price badge so the number reflects the real-time
 * market price Hermes is serving right now, not whatever was last pushed
 * on-chain (which only updates when the keeper runs, and can go stale if
 * it isn't). Throws on any non-2xx response or a missing/malformed body
 * rather than returning something that looks like a price but isn't.
 */
export async function fetchHermesPrice(priceId: Hex): Promise<HermesPrice> {
  const res = await fetch(`${HERMES_URL}/v2/updates/price/latest?ids[]=${priceId}&parsed=true`);
  if (!res.ok) {
    throw new Error(`Hermes request failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as {
    parsed?: { price: { price: string; expo: number; publish_time: number } }[];
  };
  const parsed = body.parsed?.[0]?.price;
  if (!parsed) {
    throw new Error("Hermes response had no parsed price");
  }
  return { usd: Number(parsed.price) * 10 ** parsed.expo, publishTime: parsed.publish_time };
}
