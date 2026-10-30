/**
 * POST /api/wa/link — show a QR, wait for a phone to scan it, hand back the
 * sealed login. Streams one JSON object per line; see `linkStream`.
 *
 * Only `POST` is exported, never a default: a default export may be called the
 * old (req, res) way, which buffers the whole response — and a QR that arrives
 * only after the phone has scanned it is no QR at all.
 */
import QRCode from 'qrcode'
import { json, originAllowed, requireSession } from '../_lib/guard.js'
import { linkStream } from '../_lib/wa.js'

/** The route without the session check — the dev server calls this directly. */
export function linkCore(user: string): Response {
  return linkStream(user, (qr) => QRCode.toDataURL(qr, { margin: 2, width: 300 }))
}

export async function POST(req: Request): Promise<Response> {
  if (!originAllowed(req)) return json({ error: 'Permintaan ditolak.' }, 403)
  const guard = requireSession(req)
  if (!guard.ok) return guard.response
  return linkCore(guard.session.u)
}
