import { handleGenerateFlowRequest } from "./_lib/generateFlow.ts";

/**
 * Vercel serverless function entry point (Web Fetch API handler — the
 * modern Vercel Functions signature, no @vercel/node dependency needed).
 * All the actual logic (Groq call, anti-abuse limits, address-safety
 * system prompt) lives in ./_lib/generateFlow.ts, shared with the local
 * Vite dev middleware in ../vite.config.ts so `npm run dev` behaves
 * exactly like a real deploy. See README.md "Natural-language flow
 * builder" for the full design and safety model.
 *
 * Deploy config: set GROQ_API_KEY (and optionally NL_ALLOWED_ORIGIN /
 * NL_RATE_LIMIT_PER_IP_PER_HOUR / NL_DAILY_GLOBAL_CAP / NL_MAX_PROMPT_CHARS
 * / GROQ_MODEL) as real Environment Variables in the Vercel project
 * dashboard — NOT in web/.env, which Vercel never reads for a deployed
 * function (that file is local-dev-only and gitignored).
 */
export async function POST(request: Request): Promise<Response> {
  return handleGenerateFlowRequest(request);
}
