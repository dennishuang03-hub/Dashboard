import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { partOf, sheetNamesOf, sheetsHeader, splitWorkbook } from './api/_lib/xlsxsplit.js'

/**
 * The API, stood in for while developing.
 *
 * `npm run dev` serves the front end and nothing else: the routes under `api/`
 * are Vercel functions and there is no Vercel here. Without this the dashboard
 * boots, asks `/api/report` for the workbook, gets Vite's own 404, and shows an
 * error — which makes the whole thing undevelopable locally, whether or not the
 * login screen is skipped.
 *
 * So the dev server answers those four paths itself, reading the same workbook
 * off disk that the real route reads.
 *
 * This cannot reach production, for two reasons that do not depend on anyone
 * remembering:
 *
 *   · `apply: 'serve'` — Vite only loads the plugin for the dev server, never
 *     for `vite build`.
 *   · vite.config.ts is build tooling. It is never bundled into the client and
 *     never deployed; Vercel runs the real functions in `api/`.
 *
 * It is deliberately not an imitation of the security. `/api/login` here accepts
 * anything, because a fake password check that ran only on your own machine
 * would test nothing and could only mislead. To exercise the real sign-in, use
 * `vercel dev`, which runs the actual functions.
 */
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const SHEET_RE = /\.(xlsx|xlsm|xls)$/i

/** Newest spreadsheet in `data/`, falling back to the old `src/Data/`. */
function newestWorkbook(): { path: string; name: string } | null {
  for (const dir of ['data', 'src/Data']) {
    try {
      const full = join(process.cwd(), dir)
      const hits = readdirSync(full)
        .filter((n) => SHEET_RE.test(n) && !n.startsWith('~$') && !n.startsWith('.'))
        .map((n) => ({ name: n, path: join(full, n), at: statSync(join(full, n)).mtimeMs }))
        .sort((a, b) => b.at - a.at)
      if (hits.length) return hits[0]
    } catch {
      /* folder not there — try the next one */
    }
  }
  return null
}

/** the WhatsApp routes, by path → the route's function without its session check */
const WA_ROUTES: Record<string, string> = {
  '/api/wa/link': 'linkCore',
  '/api/wa/send': 'sendCore',
  '/api/wa/logout': 'logoutCore',
}

const DEV_SESSION = { user: 'dev', role: 'team', agent: null, expiresAt: 0 }

function devApi(): Plugin {
  return {
    name: 'jnt-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]
        if (!path.startsWith('/api/')) return next()

        const send = (body: unknown, status = 200) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(body))
        }

        if (path === '/api/session' || path === '/api/login') return send(DEV_SESSION)
        if (path === '/api/logout') return send({ ok: true })

        /* WhatsApp: the real route code, minus the session check (there is no
           sign-in here — see the note at the top). Run through Vite so the
           TypeScript loads as is, and the QR stream is passed on line by line
           rather than buffered, the way Vercel streams it. */
        if (path in WA_ROUTES) {
          if (req.method !== 'POST') return send({ error: 'Metode tidak diizinkan.' }, 405)
          void (async () => {
            try {
              /* the login is sealed with SESSION_SECRET; a dev-only one when unset */
              if ((process.env.SESSION_SECRET ?? '').length < 32) {
                process.env.SESSION_SECRET = 'dev-only-secret-never-used-in-production-0000'
              }
              const mod = await server.ssrLoadModule(`${path}.ts`)
              const chunks: Buffer[] = []
              for await (const c of req) chunks.push(c as Buffer)
              const headers = new Headers()
              for (const [k, v] of Object.entries(req.headers)) {
                if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v)
              }
              const request = new Request(`http://localhost${req.url}`, {
                method: 'POST', headers, body: chunks.length ? Buffer.concat(chunks) : undefined,
              })
              const out: Response = path === '/api/wa/link'
                ? mod.linkCore(DEV_SESSION.user)
                : await mod[WA_ROUTES[path]](request, DEV_SESSION.user)
              res.statusCode = out.status
              out.headers.forEach((v, k) => res.setHeader(k, v))
              if (out.body) {
                const reader = out.body.getReader()
                res.on('close', () => { if (!res.writableEnded) void reader.cancel() })
                for (;;) {
                  const { value, done } = await reader.read()
                  if (done) break
                  res.write(value)
                }
              }
              res.end()
            } catch (e) {
              if (!res.headersSent) send({ error: (e as Error).message }, 500)
              else res.end()
            }
          })()
          return
        }

        if (path === '/api/report') {
          const found = newestWorkbook()
          if (!found) {
            return send({
              error: 'Tidak ada workbook di folder data/ (atau src/Data/) pada mesin ini.',
            }, 404)
          }
          /* Split exactly as the real route splits it, by the same function.
             A dev server that always sent the whole workbook would hide the one
             thing worth watching locally: whether the page still has everything
             it needs when half the file does not arrive. */
          const part = partOf(new URL(req.url ?? '/', 'http://localhost').searchParams.get('part'))
          const { body: bytes, sent } = splitWorkbook(readFileSync(found.path), part)
          res.statusCode = 200
          res.setHeader('Content-Type', XLSX_MIME)
          res.setHeader('Cache-Control', 'no-store')
          res.setHeader('X-Report-Part', sent)
          res.setHeader('X-Report-Filename', encodeURIComponent(found.name))
          const sheets = sheetsHeader(sheetNamesOf(bytes))
          if (sheets) res.setHeader('X-Report-Sheets', sheets)
          return res.end(bytes)
        }

        return next()
      })

      const found = newestWorkbook()
      server.config.logger.info(
        found
          ? `  ➜  dev API: serving “${found.name}” at /api/report`
          : '  ➜  dev API: no workbook found in data/ or src/Data/',
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), devApi()],
})
