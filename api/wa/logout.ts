/**
 * POST /api/wa/logout — unlink the dashboard from the phone that scanned the QR.
 * Body: `{ state }`, the sealed login. Always answers ok: a login that has
 * already gone is the outcome being asked for.
 */
import { json, originAllowed, requireSession } from '../_lib/guard.js'
import { adapt } from '../_lib/adapt.js'
import { logout } from '../_lib/wa.js'

/** The route without the session check — the dev server calls this directly. */
export async function logoutCore(req: Request, user: string): Promise<Response> {
  const body = await req.json().catch(() => ({})) as { state?: string }
  if (body.state) await logout(user, body.state)
  return json({ ok: true })
}

async function waLogout(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Metode tidak diizinkan.' }, 405, { Allow: 'POST' })
  if (!originAllowed(req)) return json({ error: 'Permintaan ditolak.' }, 403)
  const guard = requireSession(req)
  if (!guard.ok) return guard.response
  return logoutCore(req, guard.session.u)
}

/* Both export shapes, both calling conventions — see api/_lib/adapt.ts. */
export const POST = adapt(waLogout)
export default POST
