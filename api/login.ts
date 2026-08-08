/**
 * POST /api/login — the only place a password is ever checked.
 *
 * The browser sends `{ username, password }` over HTTPS and gets back a session
 * cookie or a refusal. It never receives the hash, the salt, the signing key, or
 * any hint about which half of the pair was wrong.
 */
import {
  issueSession, readEnv, safeEqual, sessionCookie, verifyPassword, SESSION_TTL_S,
} from './_lib/auth'
import {
  BAD_CREDENTIALS, clientKey, json, lockedFor, noteFailure, noteSuccess, originAllowed,
} from './_lib/guard'

/**
 * Every login answer takes at least this long.
 *
 * Without it the shape of the response time is a side channel: a wrong username
 * returns immediately, a wrong password returns after scrypt has run. Padding
 * both to the same floor means the two are indistinguishable from outside, and
 * it costs a real user a quarter of a second once per shift.
 */
const FLOOR_MS = 250

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function settle<T>(started: number, value: T): Promise<T> {
  const left = FLOOR_MS - (Date.now() - started)
  if (left > 0) await sleep(left)
  return value
}

/**
 * Exported three ways on purpose.
 *
 * Vercel's Node runtime accepts both the legacy `(req, res)` signature and the
 * web-standard `Request → Response` one used here, and it works out which it is
 * looking at from the shape of the export. A named `POST` is the least ambiguous
 * form of that signal; the default export is the widely-documented one. Giving
 * it both costs a line and removes an entire class of "works locally, 500s on
 * Vercel" from the table.
 */
export async function handler(req: Request): Promise<Response> {
  const started = Date.now()

  if (req.method !== 'POST') {
    return json({ error: 'Metode tidak diizinkan.' }, 405, { Allow: 'POST' })
  }
  if (!originAllowed(req)) {
    return json({ error: 'Permintaan ditolak.' }, 403)
  }

  const env = readEnv()
  if (!env.ok) {
    /* Logged for whoever deployed it; the caller is told nothing useful. */
    console.error('[login] missing configuration:', env.missing.join(', '))
    return json({ error: 'Server belum dikonfigurasi.' }, 503)
  }

  const who = clientKey(req)
  const locked = lockedFor(who)
  if (locked > 0) {
    const mins = Math.ceil(locked / 60000)
    return json(
      { error: `Terlalu banyak percobaan. Coba lagi dalam ${mins} menit.` },
      429,
      { 'Retry-After': String(Math.ceil(locked / 1000)) },
    )
  }

  let username = ''
  let password = ''
  try {
    const body = (await req.json()) as { username?: unknown; password?: unknown }
    if (typeof body.username === 'string') username = body.username
    if (typeof body.password === 'string') password = body.password
  } catch {
    return json({ error: 'Permintaan tidak valid.' }, 400)
  }

  /* Bound the work before doing any. scrypt hashes whatever it is handed, so an
     unbounded field is an invitation to send a megabyte and watch the server
     spend a second on it. */
  if (!username || !password || username.length > 128 || password.length > 512) {
    noteFailure(who)
    return settle(started, json({ error: BAD_CREDENTIALS }, 401))
  }

  /* Both checks always run. Short-circuiting on a bad username would skip
     scrypt and hand back the timing difference the FLOOR is there to hide. */
  const userOk = safeEqual(username.trim(), env.env.username)
  const passOk = await verifyPassword(password, env.env.passwordHash)

  if (!userOk || !passOk) {
    noteFailure(who)
    return settle(started, json({ error: BAD_CREDENTIALS }, 401))
  }

  noteSuccess(who)

  /* One account for now. `role` and `agent` are already carried in the token so
     that adding per-agent logins later is a change to this line and to the data
     route's filter — not a redesign of the session format. */
  const token = issueSession({ u: env.env.username, r: 'team', a: null }, env.env.secret)

  return settle(started, json(
    { user: env.env.username, role: 'team', agent: null, expiresIn: SESSION_TTL_S },
    200,
    { 'Set-Cookie': sessionCookie(token, SESSION_TTL_S) },
  ))
}

export const POST = handler
export default handler
