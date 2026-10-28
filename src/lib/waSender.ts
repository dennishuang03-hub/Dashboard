/**
 * Talking to wa-sender — the small program on the user's own computer that is
 * logged in to WhatsApp and posts pictures into groups (see ../wa-sender).
 *
 * The browser calls it directly at 127.0.0.1, so nothing passes through the
 * dashboard's server. Where it lives and its token are kept in this browser's
 * localStorage: they belong to this computer, not to the dashboard account.
 * Nothing is ever sent on a timer — only when someone presses the button.
 */

const KEY = 'jnt.waSender'

export interface WaConfig {
  url: string
  token: string
}

export interface WaStatus {
  phase: string
  me: string
}

export interface WaJob {
  id: string
  agent: string | null
  status: 'queued' | 'sending' | 'done' | 'partial' | 'failed'
  /** the agent's group, plus anyone else agents.json sends it to */
  recipients: number
  sent: number
  total: number
  items: { name: string; status: string; error?: string }[]
}

export function loadWaConfig(): WaConfig {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (v && typeof v.url === 'string') return { url: v.url, token: String(v.token ?? '') }
  } catch { /* storage blocked — fall through to the default */ }
  return { url: 'http://127.0.0.1:3939', token: '' }
}

export function saveWaConfig(c: WaConfig): void {
  try { localStorage.setItem(KEY, JSON.stringify(c)) } catch { /* not remembered, still used */ }
}

async function call<T>(c: WaConfig, path: string, init?: { method: string; body: string }): Promise<T> {
  let res: Response
  try {
    res = await fetch(c.url.replace(/\/+$/, '') + path, {
      method: init?.method ?? 'GET',
      body: init?.body,
      headers: {
        Authorization: `Bearer ${c.token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
  } catch (ex) {
    throw new Error('wa-sender tidak bisa dihubungi. Pastikan `npm start` berjalan di folder wa-sender.', { cause: ex })
  }
  const body = await res.json().catch(() => ({}))
  if (res.status === 401) throw new Error('Token wa-sender salah. Salin token dari wa-sender\\config.json.')
  if (!res.ok) throw new Error(body.error || `wa-sender menjawab HTTP ${res.status}`)
  return body as T
}

export const waStatus = (c: WaConfig) => call<WaStatus>(c, '/status')

/** Where each agent in agents.json would send — a check, nothing is sent. */
export const waAgents = (c: WaConfig) => call<{ agent: string; to?: string[]; error?: string }[]>(c, '/agents')
export const waJob = (c: WaConfig, id: string) => call<WaJob>(c, `/jobs/${encodeURIComponent(id)}`)

function base64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(r.error ?? new Error('Gambar tidak bisa dibaca'))
    r.readAsDataURL(file)
  })
}

/**
 * The same pictures as one PDF, a page each, every page the size of its
 * picture — so a page reads exactly like the PNG, with no margins or scaling.
 */
export async function picturesToPdf(files: File[]): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  let doc: InstanceType<typeof jsPDF> | null = null
  for (const f of files) {
    const bmp = await createImageBitmap(f)
    const size: [number, number] = [bmp.width, bmp.height]
    bmp.close()
    const orientation = size[0] > size[1] ? 'landscape' : 'portrait'
    if (!doc) doc = new jsPDF({ unit: 'px', format: size, orientation, hotfixes: ['px_scaling'], compress: true })
    else doc.addPage(size, orientation)
    doc.addImage(new Uint8Array(await f.arrayBuffer()), 'PNG', 0, 0, size[0], size[1], undefined, 'FAST')
  }
  if (!doc) throw new Error('Tidak ada gambar untuk PDF.')
  return doc.output('blob')
}

/** "01 AGISTA PRIYANTONO - JAKARTA.png" → "AGISTA PRIYANTONO" */
const rmOf = (file: string) => file.replace(/\.png$/i, '').replace(/^\d+\s+/, '').replace(/\s+-\s+[^-]+$/, '')

/**
 * Queue one agent's send (agents.json on the sender picks the group): the
 * pictures as one album, each captioned with its RM, then the PDF.
 */
export async function waSendAgent(
  c: WaConfig, agent: string, files: File[], caption: string, pdfName: string,
): Promise<WaJob> {
  const images = await Promise.all(files.map(async (f, i) => ({
    name: f.name,
    data: await base64(f),
    caption: i === 0 ? `${caption}\n${rmOf(f.name)}` : rmOf(f.name),
  })))
  const pdf = { name: pdfName, data: await base64(await picturesToPdf(files)), caption }
  return call<WaJob>(c, '/send', { method: 'POST', body: JSON.stringify({ agent, caption, images, pdf }) })
}
