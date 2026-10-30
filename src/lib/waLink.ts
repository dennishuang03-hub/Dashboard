/**
 * Sending the RM pictures to WhatsApp through the dashboard's own functions
 * (api/wa/*). See api/_lib/wa.ts for how the link works.
 *
 * The page's part: show the QR as it arrives, keep the sealed login in memory
 * for as long as the dialog is open, and cut each agent's send into requests
 * that fit Vercel's 4.5 MB request limit — the pictures go as JPEGs at
 * WhatsApp's own resolution, a few hundred KB each instead of the PNG's
 * megabyte, and an agent with many RMs becomes two albums. Nothing is ever
 * written to storage: a refresh forgets the login, by design.
 */
import { WA_AGENTS as AGENTS } from '../../api/_lib/waAgents'

/** The agents that have a WhatsApp group to send to (the ids stay on the server). */
export const WA_AGENTS: ReadonlySet<string> = new Set(AGENTS)

export interface WaGroupCheck {
  agent: string
  /** the group's name, or null when the scanned number is not a member */
  name: string | null
}

export interface WaLinked {
  name: string
  number: string
  groups: WaGroupCheck[]
  state: string
}

/** "6285110539089" → "+62 851-1053-9089" */
export function fmtWaNumber(n: string): string {
  const d = n.replace(/\D/g, '')
  const m = d.match(/^62(\d{3})(\d{3,4})(\d{3,5})$/)
  return m ? `+62 ${m[1]}-${m[2]}-${m[3]}` : d ? `+${d}` : ''
}

async function failure(res: Response): Promise<Error> {
  const body = await res.json().catch(() => ({})) as { error?: string }
  if (res.status === 401 && !body.error) return new Error('Sesi dashboard berakhir. Login ulang.')
  return new Error(body.error || `Server menjawab HTTP ${res.status}`)
}

/**
 * Ask for a QR and wait for the scan. `onQr` gets each code as an image URL —
 * WhatsApp replaces it every twenty seconds or so. Abort the signal to give up.
 */
export async function linkWhatsApp(onQr: (dataUrl: string) => void, signal: AbortSignal): Promise<WaLinked> {
  const res = await fetch('/api/wa/link', { method: 'POST', credentials: 'same-origin', signal })
  if (!res.ok || !res.body) throw await failure(res)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (value) buf += dec.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      const ev = JSON.parse(line) as { type: string; qr?: string; error?: string } & Partial<WaLinked>
      if (ev.type === 'qr' && ev.qr) onQr(ev.qr)
      else if (ev.type === 'linked') return ev as WaLinked
      else if (ev.type === 'error') throw new Error(ev.error || 'WhatsApp gagal tertaut.')
    }
    if (done) throw new Error('Koneksi ke server terputus sebelum WhatsApp tertaut.')
  }
}

export interface PartResult {
  sent: string[]
  failed: { name: string; error: string }[]
  state: string
}

/** One request: an album of pictures, or one or more PDFs, for one agent's group. */
export async function sendWaPart(
  state: string, agent: string, kind: 'album' | 'pdf', files: File[], captions: string[],
): Promise<PartResult> {
  const form = new FormData()
  form.set('state', state)
  form.set('meta', JSON.stringify({ agent, kind, captions }))
  for (const f of files) form.append('file', f, f.name)
  const res = await fetch('/api/wa/send', { method: 'POST', body: form, credentials: 'same-origin' })
  if (!res.ok) throw await failure(res)
  return res.json() as Promise<PartResult>
}

/**
 * Unlink the phone. `keepalive` so it still goes out when the page is closing;
 * best effort either way — the device can always be removed on the phone.
 */
export function logoutWhatsApp(state: string): Promise<void> {
  return fetch('/api/wa/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
    keepalive: state.length < 60_000,
  }).then(() => undefined, () => undefined)
}

/* ------------------------------------------------------------ the payload */

/** WhatsApp shows pictures at most this wide; anything larger is wasted bytes. */
const MAX_W = 1600
/** each request's files stay under this — Vercel refuses a body over 4.5 MB, and the login rides along */
export const PART_BUDGET = 3_600_000

/** A PNG from the capture → a JPEG WhatsApp will not need to shrink further. */
export async function toWaJpeg(png: File, quality = 0.85): Promise<File> {
  const bmp = await createImageBitmap(png)
  const scale = Math.min(1, MAX_W / bmp.width)
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'   // JPEG has no transparency
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality))
  if (!blob) throw new Error('Gambar tidak bisa dikonversi.')
  return new File([blob], png.name.replace(/\.png$/i, '.jpg'), { type: 'image/jpeg' })
}

/** Files in order, cut into runs whose total stays under the budget. */
export function packBySize(files: File[], budget = PART_BUDGET): File[][] {
  const out: File[][] = []
  let run: File[] = [], size = 0
  for (const f of files) {
    if (run.length && size + f.size > budget) { out.push(run); run = []; size = 0 }
    run.push(f)
    size += f.size
  }
  if (run.length) out.push(run)
  return out
}

/** Pictures → one PDF, a page each, every page the size of its picture. */
export async function jpegsToPdf(files: File[]): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  let doc: InstanceType<typeof jsPDF> | null = null
  for (const f of files) {
    const bmp = await createImageBitmap(f)
    const size: [number, number] = [bmp.width, bmp.height]
    bmp.close()
    const orientation = size[0] > size[1] ? 'landscape' : 'portrait'
    if (!doc) doc = new jsPDF({ unit: 'px', format: size, orientation, hotfixes: ['px_scaling'], compress: true })
    else doc.addPage(size, orientation)
    doc.addImage(new Uint8Array(await f.arrayBuffer()), 'JPEG', 0, 0, size[0], size[1], undefined, 'FAST')
  }
  if (!doc) throw new Error('Tidak ada gambar untuk PDF.')
  return doc.output('blob')
}

/** "01 AGISTA PRIYANTONO - JAKARTA.jpg" → "AGISTA PRIYANTONO" */
export const rmOfFile = (file: string) =>
  file.replace(/\.(png|jpe?g)$/i, '').replace(/^\d+\s+/, '').replace(/\s+-\s+[^-]+$/, '')
