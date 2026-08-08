import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

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

        if (path === '/api/report') {
          const found = newestWorkbook()
          if (!found) {
            return send({
              error: 'Tidak ada workbook di folder data/ (atau src/Data/) pada mesin ini.',
            }, 404)
          }
          const bytes = readFileSync(found.path)
          res.statusCode = 200
          res.setHeader('Content-Type', XLSX_MIME)
          res.setHeader('Cache-Control', 'no-store')
          res.setHeader('X-Report-Filename', encodeURIComponent(found.name))
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
