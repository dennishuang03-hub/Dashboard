/**
 * GET /api/session — "am I still signed in, and as whom?"
 *
 * The app asks this once on load, before it renders anything. It is the reason
 * a refresh does not throw the user back to the login form, and the reason the
 * front end never has to store or reason about the token itself: the cookie is
 * HttpOnly, so the only way for the page to learn its own state is to ask the
 * server, which is exactly the arrangement we want.
 */
import { json, requireSession } from './_lib/guard.js'
import { adapt } from './_lib/adapt.js'

async function session(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return json({ error: 'Metode tidak diizinkan.' }, 405, { Allow: 'GET' })
  }

  const guard = requireSession(req)
  if (!guard.ok) return guard.response

  const { u, r, a, exp } = guard.session
  return json({ user: u, role: r, agent: a, expiresAt: exp })
}

/* Both export shapes, both calling conventions — see api/_lib/adapt.ts. */
export const GET = adapt(session)
export default GET
