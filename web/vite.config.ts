import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Loads EVERY var from web/.env (third arg "" = no VITE_ prefix filter),
  // so the natural-language proxy's server-only vars (GROQ_API_KEY,
  // NL_ALLOWED_ORIGIN, etc. — see api/_lib/generateFlow.ts) reach
  // process.env for `npm run dev`, the same way they'd reach process.env
  // via real Environment Variables on Vercel in production. This never
  // exposes anything to the CLIENT bundle — only Vite's own import.meta.env
  // (VITE_-prefixed vars) is inlined into browser code; process.env here is
  // Node-side only, read by the dev middleware below and by api/ at
  // request time.
  const env = loadEnv(mode, process.cwd(), '')
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value
  }

  return {
    plugins: [react(), tailwindcss(), nlProxyDevPlugin()],
  }
})

/**
 * Dev-only equivalent of the Vercel serverless function at
 * api/generate-flow.ts — so `npm run dev` exercises the exact same proxy
 * logic (anti-abuse limits, Groq call, address-safety system prompt) as a
 * real deploy, not a stubbed-out version. Adapts Vite's Connect-style
 * (req, res) dev-server middleware to the Web-standard Request/Response
 * api/_lib/generateFlow.ts is written against.
 */
function nlProxyDevPlugin(): Plugin {
  return {
    name: 'canalis-nl-proxy-dev',
    async configureServer(server) {
      // Dynamic import so this only runs (and only reads process.env for
      // its module-scope config constants) AFTER the env-loading loop
      // above has already populated process.env — configureServer always
      // fires after defineConfig's function body has returned.
      const { handleGenerateFlowRequest } = await import('./api/_lib/generateFlow.ts')

      server.middlewares.use('/api/generate-flow', async (req, res) => {
        try {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const bodyText = Buffer.concat(chunks).toString('utf8')

          const headers = new Headers()
          for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'string') headers.set(key, value)
            else if (Array.isArray(value)) headers.set(key, value.join(', '))
          }

          const request = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers,
            body: bodyText || undefined,
          })

          const response = await handleGenerateFlowRequest(request)
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(await response.text())
        } catch (err) {
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: `Dev proxy error: ${err instanceof Error ? err.message : String(err)}` }))
        }
      })
    },
  }
}
