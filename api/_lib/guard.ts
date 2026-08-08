/**
 * Request-side defences shared by every route: JSON replies that never leak,
 * an origin check, and a best-effort brute-force brake.
 */
/*
 * `.js`, not `.ts` and not bare — and this is not a typo.
 *
 * package.json says `"type": "module"`, so Vercel loads these routes as real ES
 * modules. Node's ESM resolver does no extension guessing whatsoever: an import
 * of `'./auth'` is a file literally named `auth`, which does not exist, and the
 * function dies on load with FUNCTION_INVOCATION_FAILED before a single line of
 * ours runs. Bare specifiers are a bundler convenience, and nothing bundles this.
 *
 * TypeScript's rule for ESM is to write the extension the *output* will have, so
 * `./auth.js` here resolves to `auth.ts` at compile time and to `auth.js` at run
 * time. `tsconfig.api.json` uses `moduleResolution: nodenext`, which makes the
 * compiler enforce this rather than let it fail silently in production again.
 */
import { readEnv, readCookie, readSession, SESSION_COOKIE } from './auth.js'
import type { Session } from './auth.js'

/* ------------------------------------------------------------- responses */

/**
 * Every response carries `no-store`.
 *
 * Vercel sits behind a CDN, and a cached 200 from `/api/report` or `/api/session`
 * would be a copy of one person's answer handed to the next request that asked.
 * For an endpoint whose whole job is to answer differently depending on who is
 * asking, no cache is the only correct cache.
 */
const BASE_HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}

export function json(
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, ...extra },
  })
}

/**
 * One phrase for every way a login can fail.
 *
 * "User not found" and "wrong password" are the same sentence here on purpose:
 * told apart, they turn the login form into a tool for discovering which
 * usernames exist, and confirming a username is most of the work in attacking
 * an account.
 */
export const BAD_CREDENTIALS = 'Nama pengguna atau kata sandi salah.'

/* ------------------------------------------------------------ origin check */

/**
 * Reject writes that another site initiated.
 *
 * `SameSite=Strict` on the session cookie already means a cross-site request
 * arrives with no cookie and so cannot act as the user — this is the second
 * lock on the same door, for the browsers and edge cases where the first is not
 * enough. Requests with no Origin at all (curl, a health check) are allowed
 * through: they carry no ambient cookie either, so they can only ever act as an
 * anonymous stranger.
 */
export function originAllowed(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true

  let from: string
  try {
    from = new URL(origin).host
  } catch {
    return false
  }

  /* Vercel is a proxy, so the host the browser addressed can arrive in either
     header depending on the hop. Accepting both is not a weakening — a mismatch
     against *every* name the request claims is still a rejection. */
  const claimed = [
    req.headers.get('host'),
    req.headers.get('x-forwarded-host'),
  ].filter((h): h is string => !!h)

  return claimed.some((h) => h === from)
}

/* --------------------------------------------------------- rate limiting */

interface Bucket { fails: number; until: number }

/**
 * Per-instance, in-memory throttle.
 *
 * Be clear about what this is and is not. A serverless deployment runs many
 * instances and recycles them, so this counter is neither shared nor durable —
 * an attacker who reconnects enough times will land on a cold instance with a
 * clean slate. It is a speed bump, not a wall.
 *
 * The actual wall is scrypt: ~100 ms and ~34 MB per guess means a list of ten
 * million passwords takes about eleven CPU-days *per instance*, and Vercel
 * charges for every second of it. Combined with a long random password, that is
 * the defence. This map exists to make the cheap, obvious attack unrewarding
 * without adding a database to the project.
 *
 * If this dashboard ever holds something worth a determined attempt, the
 * upgrade is Vercel KV or Upstash — see SECURITY-SETUP.md.
 */
const buckets = new Map<string, Bucket>()

const LOCK_AFTER = 5
const LOCK_MS = 15 * 60 * 1000
const SWEEP_AT = 5000

/** Best-effort client identity. Spoofable, which is why it only gates a delay. */
export function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') ?? ''
  return (fwd.split(',')[0] || req.headers.get('x-real-ip') || 'unknown').trim()
}

/** Milliseconds still to wait, or 0 when the caller may try. */
export function lockedFor(key: string): number {
  const b = buckets.get(key)
  if (!b) return 0
  const left = b.until - Date.now()
  if (left <= 0) {
    buckets.delete(key)
    return 0
  }
  return b.fails >= LOCK_AFTER ? left : 0
}

export function noteFailure(key: string): void {
  /* Unbounded growth would be its own denial of service, so the map is swept
     of expired entries whenever it gets large rather than on a timer — a
     serverless instance may be frozen between requests, and a timer that never
     fires is not a cleanup strategy. */
  if (buckets.size > SWEEP_AT) {
    const now = Date.now()
    for (const [k, v] of buckets) if (v.until <= now) buckets.delete(k)
  }
  const b = buckets.get(key)
  const fails = (b && b.until > Date.now() ? b.fails : 0) + 1
  buckets.set(key, { fails, until: Date.now() + LOCK_MS })
}

export function noteSuccess(key: string): void {
  buckets.delete(key)
}

/* ------------------------------------------------------------ session gate */

export type Guard =
  | { ok: true; session: Session }
  | { ok: false; response: Response }

/**
 * The one function every protected route calls first.
 *
 * It fails closed on a missing environment as firmly as it does on a missing
 * cookie: a deploy where `SESSION_SECRET` never got set must serve nothing at
 * all, because unsigned sessions would be forgeable by anyone.
 */
export function requireSession(req: Request): Guard {
  const env = readEnv()
  if (!env.ok) {
    return {
      ok: false,
      response: json({ error: 'Server belum dikonfigurasi.' }, 503),
    }
  }

  const token = readCookie(req.headers.get('cookie'), SESSION_COOKIE)
  const session = readSession(token, env.env.secret)
  if (!session) {
    return {
      ok: false,
      response: json({ error: 'Sesi tidak valid atau sudah berakhir.' }, 401),
    }
  }

  return { ok: true, session }
}
