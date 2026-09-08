/**
 * GET /api/report — the workbook itself, to a signed-in browser only.
 *
 * This route is the reason the login is worth anything. Before it existed, the
 * spreadsheet was a Vite asset with a public URL: the dashboard could be gated
 * all it liked and the numbers were still one Network-tab click away. Now the
 * bytes exist in exactly one place the internet can reach, and that place checks
 * the cookie before it opens the file.
 *
 * The workbook lives in `/data` at the repo root — outside `src/`, so Vite never
 * sees it, and outside `public/`, so it is never copied into `dist/`. It reaches
 * the function through `includeFiles` in vercel.json.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { json, requireSession } from './_lib/guard.js'
import { adapt } from './_lib/adapt.js'
import { partOf, splitWorkbook } from './_lib/xlsxsplit.js'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * Where to look for `/data`.
 *
 * `process.cwd()` is the project root for a Vercel function and for `vercel dev`,
 * but a locally-run script or a future move of the project root would break a
 * single hardcoded guess, and the failure would look like "the dashboard is
 * empty" rather than "the file moved". Trying the obvious places costs one
 * `readdir` on a cold start.
 */
const ROOTS = [
  join(process.cwd(), 'data'),
  join(process.cwd(), '..', 'data'),
  /* Where the workbook used to live. Kept as a fallback so that pulling this
     change does not blank the dashboard before the file has been moved — but it
     is a fallback, not a home. `src/` is the folder Vite compiles; a stray
     `import.meta.glob` added there in future would publish the workbook again,
     which is the exact hole this route was built to close. */
  join(process.cwd(), 'src', 'Data'),
]

const SPREADSHEET = /\.(xlsx|xlsm|xls)$/i

interface Found { path: string; name: string; mtime: number }

/**
 * The newest spreadsheet in `/data`.
 *
 * Newest rather than "the one named in a config" so that publishing next week's
 * report is dropping a file in a folder and pushing — the same one-step habit
 * the bundled version had. Files starting with `~$` are Excel's lock files,
 * left behind whenever the workbook is open in Excel while it is copied; they
 * are not readable spreadsheets and picking one up would break the dashboard
 * with a parse error that has nothing to do with the data.
 */
async function newestWorkbook(): Promise<Found | null> {
  for (const dir of ROOTS) {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      continue
    }

    let best: Found | null = null
    for (const name of names) {
      if (name.startsWith('~$') || name.startsWith('.')) continue
      if (!SPREADSHEET.test(name)) continue
      const path = join(dir, name)
      try {
        const s = await stat(path)
        if (!s.isFile()) continue
        if (!best || s.mtimeMs > best.mtime) best = { path, name, mtime: s.mtimeMs }
      } catch {
        /* unreadable entry — skip it rather than fail the whole request */
      }
    }
    if (best) return best
  }
  return null
}

async function report(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return json({ error: 'Metode tidak diizinkan.' }, 405, { Allow: 'GET' })
  }

  const guard = requireSession(req)
  if (!guard.ok) return guard.response

  /*
   * Per-agent scoping goes here, not in the browser.
   *
   * When the ten agent accounts arrive, `guard.session.a` holds the Kode Agent
   * that session is allowed to see, and this route will open the workbook, drop
   * every row belonging to anyone else, and send back only what remains. Doing
   * it in the client instead would mean shipping all ten agents' numbers to all
   * ten agents and asking the page not to draw nine of them — which is not a
   * restriction, just a rendering choice the viewer can undo.
   */

  const found = await newestWorkbook()
  if (!found) {
    console.error('[report] no workbook found in', ROOTS.join(' | '))
    return json({ error: 'Data laporan belum tersedia di server.' }, 404)
  }

  let bytes: Buffer
  try {
    bytes = await readFile(found.path)
  } catch (e) {
    console.error('[report] unreadable:', found.path, e)
    return json({ error: 'Data laporan tidak dapat dibaca.' }, 500)
  }

  /*
   * Half a workbook, unless the caller asks otherwise.
   *
   * The dashboard opens on the daily report and reads the OTPU tabs only when
   * somebody goes looking for them — so sending those tabs to every visitor is
   * several megabytes spent on a page most of them never open. `?part=otpu`
   * fetches the other half when they do, and `?part=full` still sends the file
   * entire, which is what an export or a debugging session wants.
   *
   * `splitWorkbook` returns the original bytes for anything it cannot split
   * safely, so the worst case here is the traffic this route already had.
   */
  const part = partOf(new URL(req.url).searchParams.get('part'))
  const body = splitWorkbook(bytes, part)

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      'Content-Type': XLSX_MIME,
      'Content-Length': String(body.byteLength),
      /* Which half this is, so a reader of the Network tab is not left
         wondering why the file is smaller than the one on the server. */
      'X-Report-Part': part,
      /* `private` keeps Vercel's shared CDN from ever holding a copy: this body
         is the answer to "who is asking", and a cached one would be served to
         someone who never asked. */
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      /* The dashboard names its PNG and Excel exports after the source file, so
         the original filename has to survive the trip. */
      'X-Report-Filename': encodeURIComponent(found.name),
    },
  })
}

/* Both export shapes, both calling conventions — see api/_lib/adapt.ts. */
export const GET = adapt(report)
export default GET
