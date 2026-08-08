/**
 * GET /api/health - a diagnostic that answers in prose instead of dying.
 *
 * Everything else here fails the way a locked door should: a bare status code
 * that tells an outsider nothing. That is right for a login, and useless when
 * the thing being debugged is the door itself. A 500 page with an opaque ID
 * costs a whole deploy cycle to learn one fact.
 *
 * So this route catches its own errors and reports them. It says which calling
 * convention the runtime used, whether the shared modules loaded, whether the
 * three environment variables arrived, and whether the workbook is on disk.
 *
 * What it never does is print a secret. Environment variables are reported as
 * present/absent and by length - enough to catch a value pasted truncated or
 * with a stray newline, never enough to reconstruct one. The password hash and
 * the session key are not echoed at any verbosity.
 *
 * Delete this file once the deployment is healthy. It is a stethoscope, not part
 * of the anatomy.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { adapt } from './_lib/adapt.js'

/** Present-or-not and how long. Never the value. */
function describeSecret(name: string): string {
  const v = process.env[name]
  if (v === undefined) return 'MISSING'
  if (v === '') return 'EMPTY'
  if (v.trim() !== v) return `set (${v.length} chars) - WARNING: leading/trailing whitespace`
  return `set (${v.length} chars)`
}

async function health(req: Request): Promise<Response> {
  const errors: string[] = []

  /* The username is not a secret - it is typed into a login box in the open -
     and seeing it is the difference between "my password is wrong" and "I am
     typing the wrong name". */
  const env: Record<string, string> = {
    AUTH_USERNAME: process.env.AUTH_USERNAME ? `"${process.env.AUTH_USERNAME}"` : 'MISSING',
    AUTH_PASSWORD_HASH: describeSecret('AUTH_PASSWORD_HASH'),
    SESSION_SECRET: describeSecret('SESSION_SECRET'),
  }

  const hash = process.env.AUTH_PASSWORD_HASH ?? ''
  if (hash && !hash.startsWith('scrypt$')) {
    errors.push('AUTH_PASSWORD_HASH does not start with "scrypt$" - wrong value pasted?')
  }
  if (hash && hash.split('$').length !== 6) {
    errors.push(`AUTH_PASSWORD_HASH has ${hash.split('$').length} segments, expected 6 - truncated?`)
  }

  /* Whether the shared modules resolved. If ESM extension handling is the
     problem, this import throws and the message names the missing specifier. */
  let sharedModules = 'not tested'
  try {
    const auth = await import('./_lib/auth.js')
    sharedModules = typeof auth.hashPassword === 'function' ? 'loaded' : 'loaded, unexpected shape'
  } catch (e) {
    sharedModules = 'FAILED'
    errors.push(`import ./_lib/auth.js failed: ${(e as Error).message}`)
  }

  /* Where the workbook is, and therefore whether /api/report can serve it. */
  const data: Record<string, string> = {}
  let foundWorkbook = false
  for (const dir of ['data', 'src/Data']) {
    try {
      const names = await readdir(join(process.cwd(), dir))
      const sheets = names.filter((n) => /\.(xlsx|xlsm|xls)$/i.test(n) && !n.startsWith('~$'))
      if (sheets.length) foundWorkbook = true
      data[dir] = sheets.length
        ? `${sheets.length} found: ${sheets.join(', ')}`
        : 'folder present, no workbook'
    } catch {
      data[dir] = 'not present in the deployment'
    }
  }
  if (!foundWorkbook) {
    errors.push('No workbook reached the server - /api/report will answer 404 even after login.')
  }

  const body = {
    ok: errors.length === 0,
    /* `adapt` stamps this header only on the path where it had to convert a
       legacy Node request, so its presence names the convention in use. */
    invokedAs: req.headers.get('x-vercel-adapted') === '1' ? 'legacy (req,res)' : 'web (Request)',
    node: process.version,
    cwd: process.cwd(),
    sharedModules,
    env,
    data,
    errors,
  }

  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

export const GET = adapt(health)
export default GET
