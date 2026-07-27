import { http, type EIP1193RequestFn, type Transport } from "viem";

/**
 * Wraps viem's `http` transport with a concurrency limiter + retry-with-
 * backoff. The public Arc testnet RPC rate-limits bursts of parallel
 * calls — the same limit that forced the keeper service (keeper/) to
 * self-pace its own poll loop. Rendering N flow rows fires ~2N reads
 * (getFlow + previewFlow) at once; without this, throttled calls would
 * hang indefinitely (see FlowRow's isError handling for the other half of
 * that fix — this is what makes the request actually settle instead of
 * silently stalling forever).
 *
 * Applies to every READ (getFlow/previewFlow/flowsOf, getLogs, watch
 * polling) since they all share one wagmi public-client transport.
 * Wallet-signed writes go through the injected connector's own provider,
 * never this transport, so retries here can never cause a duplicate
 * transaction submission.
 */

const MAX_CONCURRENT = 3;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 400;

let active = 0;
const queue: (() => void)[] = [];

function runQueued<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const task = () => {
      active += 1;
      fn()
        .then(resolve, reject)
        .finally(() => {
          active -= 1;
          const next = queue.shift();
          if (next) next();
        });
    };
    if (active < MAX_CONCURRENT) task();
    else queue.push(task);
  });
}

function isRetryable(error: unknown): boolean {
  const err = error as { status?: number; cause?: { status?: number }; message?: string; details?: string } | undefined;
  const status = err?.status ?? err?.cause?.status;
  if (status === 429 || status === 503) return true;

  const message = `${err?.message ?? ""} ${err?.details ?? ""}`.toLowerCase();
  return (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("fetch failed") ||
    message.includes("network")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt > MAX_RETRIES || !isRetryable(error)) throw error;
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 200;
      await sleep(delay);
    }
  }
}

/** Rate-limited drop-in replacement for viem's `http(url)` transport. */
export function rateLimitedHttp(url: string): Transport {
  // Own retries handled above (backoff-aware); disable viem's built-in
  // retry so failures reach our retry logic immediately instead of being
  // silently retried twice over.
  const base = http(url, { retryCount: 0 });

  return (params) => {
    const inner = base(params);
    const limitedRequest: EIP1193RequestFn = (args, options) => runQueued(() => withRetry(() => inner.request(args, options)));

    return { ...inner, request: limitedRequest };
  };
}
