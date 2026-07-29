/**
 * Core of the natural-language flow-builder proxy — the ONLY place the Groq
 * API key is read or used. Shared by the production Vercel function
 * (../generate-flow.ts) and the local Vite dev middleware (../../vite.config.ts)
 * so `npm run dev` behaves exactly like a real deploy. This file must NEVER
 * be imported from anything under src/ (the browser bundle) — see
 * README.md "Natural-language flow builder" for the full safety model.
 *
 * The browser never talks to Groq directly, never sees GROQ_API_KEY (not a
 * VITE_-prefixed var, so Vite never inlines it into client code), and the
 * LLM never auto-deploys anything — it only ever drafts JSON that a human
 * reviews inside the existing composer (see src/lib/nlDraft.ts).
 *
 * ANTI-ABUSE — all four enforced here, in order:
 *   1. Origin check — only requests carrying an allowed Origin header (or
 *      none at all, e.g. server-side curl/testing) are served.
 *   2. Input length cap (NL_MAX_PROMPT_CHARS, default 500 chars).
 *   3. Per-IP rate limit (NL_RATE_LIMIT_PER_IP_PER_HOUR, default 10/hour).
 *   4. A GLOBAL daily cap across every user (NL_DAILY_GLOBAL_CAP, default
 *      300/day) — once hit, this stops calling Groq entirely for the rest
 *      of the day and returns a friendly "try later" message instead.
 *
 * Counters 3 and 4 are plain module-scope, in-memory state — fine for a
 * single-user hackathon demo, but NOT a durable, cross-instance limiter:
 * they reset whenever the process restarts (a Vite dev-server reload, a
 * fresh Vercel cold start / new region instance).
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// llama-3.3-70b-versatile: a current (2026), live Groq production model in
// the llama-3.x-70b class, and JSON mode (`response_format: json_object`)
// is supported on every Groq model per Groq's structured-outputs docs — no
// need for the stricter json_schema mode (Groq currently limits guaranteed
// schema-matching "strict" mode to the gpt-oss family), since the proxy
// itself does a defensive shape check below and the composer's own
// validateComposerDraft() is the real gate before anything can deploy.
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

const MAX_PROMPT_CHARS = positiveIntEnv("NL_MAX_PROMPT_CHARS", 500);
const RATE_LIMIT_PER_IP_PER_HOUR = positiveIntEnv("NL_RATE_LIMIT_PER_IP_PER_HOUR", 10);
const DAILY_GLOBAL_CAP = positiveIntEnv("NL_DAILY_GLOBAL_CAP", 300);

// Comma-separated list of allowed browser Origins. Defaults to Vite's dev
// port so local `npm run dev` works out of the box; set NL_ALLOWED_ORIGIN
// to the real deployed origin (e.g. https://canalis.vercel.app) in
// production — see .env.example.
const ALLOWED_ORIGINS = (process.env.NL_ALLOWED_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function positiveIntEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// --- anti-abuse counters (module-scope, in-memory — see file header) ---

const perIpRequestTimes = new Map<string, number[]>();
let dailyCount = 0;
let dailyDayKey = utcDayKey();

function utcDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function withinPerIpLimit(ip: string): boolean {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const recent = (perIpRequestTimes.get(ip) ?? []).filter((t) => t > hourAgo);
  perIpRequestTimes.set(ip, recent);
  return recent.length < RATE_LIMIT_PER_IP_PER_HOUR;
}

function recordPerIpRequest(ip: string) {
  const times = perIpRequestTimes.get(ip) ?? [];
  times.push(Date.now());
  perIpRequestTimes.set(ip, times);
}

function withinDailyGlobalCap(): boolean {
  const key = utcDayKey();
  if (key !== dailyDayKey) {
    dailyDayKey = key;
    dailyCount = 0;
  }
  return dailyCount < DAILY_GLOBAL_CAP;
}

function recordGlobalRequest() {
  dailyCount += 1;
}

// --- request handling ---

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Best-effort client IP from the standard proxy header — good enough for an in-memory, best-effort rate limit, not a security boundary on its own. */
function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return "unknown"; // no proxy chain (e.g. local dev middleware) — falls back to one shared bucket, see README.md
}

function isAllowedOrigin(origin: string | null): boolean {
  // No Origin header at all (server-to-server curl, some local testing) —
  // not a browser cross-site call, so it isn't what this check guards
  // against; the rate limit / daily cap still apply regardless.
  if (!origin) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

export async function handleGenerateFlowRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }
  if (!isAllowedOrigin(request.headers.get("origin"))) {
    return jsonResponse(403, { error: "Forbidden origin." });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  const prompt = (body as { prompt?: unknown } | null)?.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    return jsonResponse(400, { error: 'Missing "prompt".' });
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return jsonResponse(400, { error: `Prompt too long (max ${MAX_PROMPT_CHARS} characters).` });
  }

  const ip = clientIp(request);
  if (!withinPerIpLimit(ip)) {
    return jsonResponse(429, {
      error: `Rate limit exceeded (${RATE_LIMIT_PER_IP_PER_HOUR} requests/hour per IP). Try again later, or use the manual composer.`,
    });
  }
  if (!withinDailyGlobalCap()) {
    return jsonResponse(429, { error: "AI builder busy right now — try later, or use the manual composer." });
  }

  if (!process.env.GROQ_API_KEY) {
    return jsonResponse(500, { error: "AI builder isn't configured on the server (missing GROQ_API_KEY)." });
  }

  // Only requests that actually reach Groq spend quota — anything rejected
  // above (bad origin, bad/oversized prompt, already at a limit) doesn't
  // count against either counter.
  recordPerIpRequest(ip);
  recordGlobalRequest();

  try {
    const draft = await callGroq(prompt.trim());
    return jsonResponse(200, draft);
  } catch {
    return jsonResponse(502, {
      error: "AI builder is temporarily unavailable. Try again later, or use the manual composer.",
    });
  }
}

async function callGroq(prompt: string): Promise<unknown> {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      max_tokens: 1024,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Groq request failed: ${res.status} ${res.statusText}`);
  }

  const payload = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("Groq response had no content");

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { error: "The AI returned something that wasn't valid JSON. Try rephrasing your request." };
  }

  if (!isPlausibleShape(parsed)) {
    return { error: "The AI's response didn't match the expected flow shape. Try rephrasing your request." };
  }
  return parsed;
}

/**
 * Loose shape check only — NOT full validation. The real gate is the
 * composer's own validateComposerDraft(), which every draft (AI-built or
 * hand-built) must pass before deploy is even clickable. This just avoids
 * relaying obvious garbage back to the frontend as if it were a draft.
 */
function isPlausibleShape(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.error === "string") return true;
  return typeof v.trigger === "object" && v.trigger !== null && Array.isArray(v.actions);
}

function buildSystemPrompt(): string {
  const nowIso = new Date().toISOString();
  return `You are a strict JSON compiler that turns a plain-English description of a USDC money-flow into a JSON draft for "Canalis", a visual flow builder on Arc (Circle's stablecoin L1). You NEVER deploy anything yourself — a human reviews and edits your draft in an existing UI before deploying. Output ONLY a single JSON object, nothing else (no markdown fences, no commentary).

Current UTC time: ${nowIso}. Tokens: USDC and EURC (both 6-decimal). All USDC/EURC amounts in your output are plain decimal numbers (e.g. 12.5), not on-chain integers.

=== OUTPUT SHAPE (on success) ===
{
  "trigger": {
    "kind": "Manual" | "OnSchedule" | "OnThreshold" | "OnReceive",
    "scheduleIntervalSeconds": number,   // OnSchedule only: seconds between runs, 0 = one-shot. 0 otherwise.
    "thresholdAmountUsdc": number        // OnThreshold only: balance level that fires it. 0 otherwise.
  },
  "conditions": [ ...zero or more of the objects below... ],
  "actions": [ ...one or more of the objects below... ]
}

Trigger notes: "Manual" = only runs when the human clicks "run now". "OnSchedule" = runs on/after now, then every scheduleIntervalSeconds (0 = once). "OnThreshold" = runs once the account's USDC balance is at/above thresholdAmountUsdc. "OnReceive" = runs whenever new USDC lands in the account. Only ever set the ONE field that trigger kind actually uses; leave the others at 0.

=== CONDITIONS (zero or more; all must hold — logical AND) ===
{ "kind": "amountCap", "minUsdc": number, "maxUsdc": number }              // per-run amount must be within this range; 0 = no bound on that side
{ "kind": "minBalance", "minBalanceUsdc": number }                          // account must hold at least this much
{ "kind": "cooldown", "cooldownSeconds": number }                          // minimum time since this flow last ran
{ "kind": "timeWindow", "windowStartIso": string, "windowEndIso": string } // ISO 8601 UTC; "" = open-ended on that side
{ "kind": "allowList", "addresses": string[] }                              // only these recipients allowed
{ "kind": "denyList", "addresses": string[] }                               // these recipients blocked
{ "kind": "oraclePrice", "feed": "EUR/USD" | "BTC/USD" | "ETH/USD", "direction": "above" | "below", "thresholdUsd": number, "maxStalenessSeconds": number } // maxStalenessSeconds: how old the on-chain price may be; default 300 if the user doesn't say

=== ACTIONS (one or more, run in order) ===
{ "kind": "Forward", "recipient": string, "amountUsdc": number }                                        // send a fixed amount to one address
{ "kind": "Split", "totalUsdc": number, "recipients": [{ "recipient": string, "bps": number }] }         // distribute a FIXED total by basis points (100 bps = 1%; all "bps" together must be <= 10000). This does NOT mean "% of whatever arrives" — it is always a fixed total you (or the human) set.
{ "kind": "Sweep", "destination": string, "thresholdUsdc": number }                                      // move everything above thresholdUsdc to destination
{ "kind": "LockRelease", "recipient": string, "amountUsdc": number, "releaseAtIso": string }             // lock amountUsdc, releasable to recipient at/after releaseAtIso (ISO 8601 UTC)
{ "kind": "Swap", "tokenIn": "USDC" | "EURC", "amountIn": number, "recipient": string }                  // swaps into the OTHER token automatically; delivered to recipient
{ "kind": "Bridge", "destination": "Ethereum Sepolia", "amountUsdc": number, "recipient": string }        // burns USDC on Arc via CCTP; "Ethereum Sepolia" is the only supported destination today — never invent another chain name

=== ADDRESS SAFETY (critical, non-negotiable) ===
Every "recipient"/"destination"/"addresses" field above refers to an EVM address. You must NEVER invent, guess, or hallucinate an address.
- If the user gives no address for a field, or you are not certain, output "" (empty string) and let the human fill it in.
- If the user clearly means themselves ("to me", "my wallet", "back to myself"), output the literal string "SELF" — the app resolves this to the user's own connected wallet address itself; you never see or choose that address.
- If the user pastes/types an actual "0x…" address in their prompt, copy it EXACTLY as given, character for character. Never alter, guess, or complete a partial address.
The same "don't invent" rule applies to amounts: if the user doesn't give a specific number for a required amount field, output 0 rather than guessing a number — a human will fill it in.

=== WHEN TO REFUSE ===
If the request needs something Canalis doesn't support (e.g. yield/lending, arbitrary DeFi protocols, tokens other than USDC/EURC, chains other than Ethereum Sepolia, anything not in the trigger/condition/action lists above), or the request is too vague to build a specific flow from, output ONLY:
{ "error": "<one clear sentence explaining what's missing or unsupported, and suggesting the manual composer if nothing here applies>" }
Do not guess your way around an unsupported request — refuse honestly instead.

=== EXAMPLES ===

User: "When USDC arrives, split 100 USDC 70/30 between 0x1111111111111111111111111111111111111111 and 0x2222222222222222222222222222222222222222."
Output:
{"trigger":{"kind":"OnReceive","scheduleIntervalSeconds":0,"thresholdAmountUsdc":0},"conditions":[],"actions":[{"kind":"Split","totalUsdc":100,"recipients":[{"recipient":"0x1111111111111111111111111111111111111111","bps":7000},{"recipient":"0x2222222222222222222222222222222222222222","bps":3000}]}]}

User: "Every 10 minutes, if EUR/USD is below 1.10, swap 5 USDC into EURC and send it to me."
Output:
{"trigger":{"kind":"OnSchedule","scheduleIntervalSeconds":600,"thresholdAmountUsdc":0},"conditions":[{"kind":"oraclePrice","feed":"EUR/USD","direction":"below","thresholdUsd":1.10,"maxStalenessSeconds":300}],"actions":[{"kind":"Swap","tokenIn":"USDC","amountIn":5,"recipient":"SELF"}]}

User: "Forward 20 USDC to my friend every day."
Output:
{"trigger":{"kind":"OnSchedule","scheduleIntervalSeconds":86400,"thresholdAmountUsdc":0},"conditions":[],"actions":[{"kind":"Forward","recipient":"","amountUsdc":20}]}

User: "Automatically invest my USDC into the highest-yielding lending protocol."
Output:
{"error":"Canalis doesn't support yield/lending actions — only Forward, Split, Sweep, Lock/Release, Swap (USDC/EURC), and Bridge (to Ethereum Sepolia) are available. Try describing one of those, or use the manual composer."}

Now read the user's request and output ONLY the JSON object.`;
}
