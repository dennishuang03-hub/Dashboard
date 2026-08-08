/**
 * POST /api/logout — drop the session cookie.
 *
 * Unconditionally successful. There is nothing to protect here: the worst a
 * stranger can do by calling it is log themselves out, and refusing the request
 * when the cookie is already invalid would only make the client handle a failure
 * that means "you are in the state you asked for".
 */
import { clearedCookie } from './_lib/auth.js'
import { json, originAllowed } from './_lib/guard.js'

/* Exported as both a named method and a default — see the note in login.ts. */
export async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Metode tidak diizinkan.' }, 405, { Allow: 'POST' })
  }
  if (!originAllowed(req)) {
    return json({ error: 'Permintaan ditolak.' }, 403)
  }
  return json({ ok: true }, 200, { 'Set-Cookie': clearedCookie() })
}

export const POST = handler
export default handler
