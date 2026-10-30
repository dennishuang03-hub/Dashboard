/**
 * POST /api/wa/send — one part of one agent's send (an album, or a PDF), using
 * the sealed login from /api/wa/link. Multipart: `state`, `meta` (JSON: agent,
 * kind, captions) and one or more `file`. Answers with what went, what did not,
 * and the login sealed again — WhatsApp updates its keys on every connection.
 *
 * The page keeps each request under Vercel's 4.5 MB body limit.
 */
import { json, originAllowed, requireSession } from '../_lib/guard.js'
import { adapt } from '../_lib/adapt.js'
import { sendPart } from '../_lib/wa.js'

/** The route without the session check — the dev server calls this directly. */
export async function sendCore(req: Request, user: string): Promise<Response> {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return json({ error: 'Permintaan tidak bisa dibaca.' }, 400)
  }
  try {
    return json(await sendPart(user, form))
  } catch (ex) {
    const code = (ex as { code?: number }).code
    return json({ error: (ex as Error).message }, code && code >= 400 && code < 600 ? code : 502)
  }
}

async function send(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Metode tidak diizinkan.' }, 405, { Allow: 'POST' })
  if (!originAllowed(req)) return json({ error: 'Permintaan ditolak.' }, 403)
  const guard = requireSession(req)
  if (!guard.ok) return guard.response
  return sendCore(req, guard.session.u)
}

/* Both export shapes, both calling conventions — see api/_lib/adapt.ts. */
export const POST = adapt(send)
export default POST
