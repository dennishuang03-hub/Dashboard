/**
 * Authentication core — the only place in this project that touches secrets.
 *
 * Everything here runs on Vercel's Node runtime, never in the browser. That
 * distinction is the entire point of the design: the dashboard used to ship its
 * workbook as a static asset, which meant "who may see the numbers" was a
 * question the client answered about itself. A client cannot answer that
 * question honestly — it is the thing being asked. So the password hash, the
 * signing key and the workbook bytes all live on this side of the wire, and the
 * browser is told nothing except yes or no.
 *
 * Three secrets come from Vercel environment variables and are never bundled:
 *
 *   AUTH_USERNAME       the team account's name
 *   AUTH_PASSWORD_HASH  scrypt digest of its password (see scripts/hash-password.mjs)
 *   SESSION_SECRET      HMAC key for session tokens, ≥32 random bytes
 *
 * If any is missing the module fails *closed* — every request is refused rather
 * than waved through. A misconfigured deploy that silently accepts all logins is
 * far worse than one that is visibly broken.
 */
import {
  createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual,
} from 'node:crypto'
import type { ScryptOptions } from 'node:crypto'

/**
 * Hand-wrapped rather than `promisify`d.
 *
 * `crypto.scrypt` is overloaded — with and without an options argument — and
 * `promisify` picks one of the overloads to describe the result, which under
 * `strict` turns a perfectly valid five-argument call into a compile error about
 * expecting three. Wrapping it directly costs four lines and removes the
 * ambiguity entirely.
 */
function scrypt(
  password: string, salt: Buffer, keylen: number, opts: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, opts, (err, dk) => {
      if (err) reject(err)
      else resolve(dk)
    })
  })
}

/* ------------------------------------------------------------------ config */

/** 8 hours — a shift, not a month. A stolen laptop stops being a key by morning. */
export const SESSION_TTL_S = 8 * 60 * 60

export const SESSION_COOKIE = 'jt_session'

/**
 * scrypt parameters. N=32768 puts a single guess at roughly 100 ms and ~34 MB
 * of memory on the server, which is invisible to one person logging in once a
 * shift and ruinous to anyone working through a password list. Node's default
 * `maxmem` is 32 MB — just under what these parameters need — so it is raised
 * explicitly here; without it scrypt throws instead of hashing.
 */
const SCRYPT = { N: 32768, r: 8, p: 1 }
const KEYLEN = 64
const MAXMEM = 96 * 1024 * 1024

/* ------------------------------------------------------------------- types */

export type Role = 'team' | 'agent'

export interface Session {
  /** username */
  u: string
  r: Role
  /** Kode Agent this session may see, or null for the whole region */
  a: string | null
  /** issued-at and expiry, seconds since epoch */
  iat: number
  exp: number
}

export interface EnvConfig {
  username: string
  passwordHash: string
  secret: string
}

/**
 * Read the three secrets, or explain exactly which one is missing.
 *
 * The message names the variable but never its value, and callers surface only
 * a generic 503 to the browser — a stranger probing the endpoint learns that
 * the server is unwell, not how it is unwell.
 */
export function readEnv(): { ok: true; env: EnvConfig } | { ok: false; missing: string[] } {
  const username = process.env.AUTH_USERNAME ?? ''
  const passwordHash = process.env.AUTH_PASSWORD_HASH ?? ''
  const secret = process.env.SESSION_SECRET ?? ''

  const missing: string[] = []
  if (!username) missing.push('AUTH_USERNAME')
  if (!passwordHash) missing.push('AUTH_PASSWORD_HASH')
  if (secret.length < 32) missing.push('SESSION_SECRET (min 32 characters)')

  if (missing.length) return { ok: false, missing }
  return { ok: true, env: { username, passwordHash, secret } }
}

/* --------------------------------------------------------- password hashing */

/**
 * `scrypt$N$r$p$salt$hash`, all base64url.
 *
 * The parameters travel with the digest so a hash made today still verifies
 * after they are raised tomorrow — the alternative is every stored password
 * becoming unverifiable the moment the cost is tuned.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const dk = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { ...SCRYPT, maxmem: MAXMEM })
  return [
    'scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p,
    salt.toString('base64url'), dk.toString('base64url'),
  ].join('$')
}

/**
 * Verify a candidate password against a stored digest.
 *
 * `timingSafeEqual` rather than `===`: a normal comparison returns as soon as
 * two bytes differ, and the microseconds it saves are a readable signal telling
 * an attacker how much of the digest they have guessed. Constant time removes
 * the signal. Any malformed digest is a `false`, never a throw — a corrupted
 * env var must not become a stack trace in the response.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const N = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3])
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false
  /* Bound the cost read out of the environment. These numbers are an
     instruction to allocate memory, and an env var edited to N=2^24 would be a
     denial-of-service switch on our own server rather than a stronger hash. */
  if (N < 1024 || N > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 16) return false

  let salt: Buffer, expected: Buffer
  try {
    salt = Buffer.from(parts[4], 'base64url')
    expected = Buffer.from(parts[5], 'base64url')
  } catch {
    return false
  }
  if (!salt.length || !expected.length) return false

  try {
    const dk = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N, r, p, maxmem: MAXMEM,
    })
    return dk.length === expected.length && timingSafeEqual(dk, expected)
  } catch {
    return false
  }
}

/**
 * Constant-time string compare, for the username.
 *
 * The username is not a secret, but comparing it with `===` would let someone
 * discover it character by character off the response time and halve the work
 * of a guessing attack. It costs nothing to close.
 */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8')
  const y = Buffer.from(b, 'utf8')
  if (x.length !== y.length) {
    /* Still do a comparison, so an early return on length is not itself the
       timing signal. The result is discarded. */
    timingSafeEqual(x, x)
    return false
  }
  return timingSafeEqual(x, y)
}

/* ------------------------------------------------------------ session token */

const b64u = (s: string) => Buffer.from(s, 'utf8').toString('base64url')

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

/**
 * `<payload>.<hmac>` — a signed statement, not an encrypted one.
 *
 * The payload is readable by whoever holds the cookie, which is fine: it says
 * only who they already know they are. What it cannot be is *edited* — flipping
 * `"r":"agent"` to `"r":"team"`, or moving `exp` into next year, invalidates the
 * signature, and the signature cannot be recomputed without SESSION_SECRET.
 *
 * Deliberately not a JWT. JWT's `alg` header is a well-known foot-gun (`alg:
 * none`, algorithm confusion) and this application needs exactly one algorithm,
 * so there is nothing to negotiate and nothing to get wrong.
 */
export function issueSession(s: Omit<Session, 'iat' | 'exp'>, secret: string): string {
  const now = Math.floor(Date.now() / 1000)
  const full: Session = { ...s, iat: now, exp: now + SESSION_TTL_S }
  const payload = b64u(JSON.stringify(full))
  return `${payload}.${sign(payload, secret)}`
}

/** A token that is malformed, mis-signed or expired all come back the same: null. */
export function readSession(token: string | undefined, secret: string): Session | null {
  if (!token) return null
  const dot = token.indexOf('.')
  if (dot < 1) return null

  const payload = token.slice(0, dot)
  const given = token.slice(dot + 1)
  const want = sign(payload, secret)

  const a = Buffer.from(given)
  const b = Buffer.from(want)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const s = parsed as Partial<Session>
  if (typeof s.u !== 'string' || (s.r !== 'team' && s.r !== 'agent')) return null
  if (typeof s.exp !== 'number' || typeof s.iat !== 'number') return null
  if (s.a != null && typeof s.a !== 'string') return null
  if (Math.floor(Date.now() / 1000) >= s.exp) return null

  return { u: s.u, r: s.r, a: s.a ?? null, iat: s.iat, exp: s.exp }
}

/* ------------------------------------------------------------------ cookies */

/** Parse a Cookie header. Values are percent-decoded; anything odd is skipped. */
export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(eq + 1).trim())
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * The four flags that make a session cookie a session cookie:
 *
 *   HttpOnly          JavaScript cannot read it, so an XSS hole cannot steal it.
 *                     This is why the token is not kept in localStorage — that
 *                     is precisely a token any injected script can read.
 *   Secure            never sent over plain HTTP, so it cannot be sniffed.
 *   SameSite=Strict   never sent on a request another site initiated, which is
 *                     what makes CSRF against these endpoints a non-event.
 *   Path=/            one cookie for the app and its API.
 */
export function sessionCookie(token: string, maxAgeS: number): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${maxAgeS}`,
  ].join('; ')
}

/** Same attributes, zero lifetime — the browser drops it immediately. */
export function clearedCookie(): string {
  return sessionCookie('', 0)
}
