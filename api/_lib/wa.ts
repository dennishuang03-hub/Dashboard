/**
 * WhatsApp from inside the dashboard's own functions — no server kept running.
 *
 * Someone presses "Kirim ke Grup WhatsApp", scans a QR, and for as long as that
 * dialog is open their phone has this dashboard as a linked device. Closing it
 * logs the device out. Nothing about the link is kept anywhere on the server.
 *
 * A Vercel function lives for one request, so the link cannot be held open
 * between the scan and the sends. Instead the whole login — WhatsApp's
 * credentials and encryption keys — is handed back to the page after every
 * request, sealed, and the page hands it in again with the next one; each send
 * reconnects with it, the way WhatsApp Web reconnects when a tab reopens. The
 * seal is AES-256-GCM under a key derived from SESSION_SECRET and bound to the
 * signed-in username, so the page holds something it can neither read nor use
 * anywhere but here, and another account cannot use it either. It lives only in
 * that page's memory: a refresh drops it, which is the "log in every time" the
 * dashboard wants.
 *
 * Library: Baileys, which speaks WhatsApp's protocol directly (no browser). It
 * is not an official WhatsApp API.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import makeWASocket, {
  Browsers, BufferJSON, DisconnectReason, fetchLatestBaileysVersion, initAuthCreds, proto,
} from '@whiskeysockets/baileys'
import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap, WASocket } from '@whiskeysockets/baileys'
import { WA_GROUPS } from './waGroups.js'
import type { WaAgent } from './waAgents.js'

/* ------------------------------------------------------------- the login */

/** Everything WhatsApp needs to recognise this linked device again. */
interface Bundle {
  creds: AuthenticationCreds
  keys: Record<string, unknown>
}

/**
 * Baileys' login store, in memory — the same contract as its file-based
 * `useMultiFileAuthState`, with a map where that one has a folder.
 */
function memoryAuth(from?: Bundle): { state: AuthenticationState; dump: () => Bundle } {
  const creds = from?.creds ?? initAuthCreds()
  const keys: Record<string, unknown> = { ...(from?.keys ?? {}) }
  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type, ids) => {
        const out: Record<string, unknown> = {}
        for (const id of ids) {
          let v = keys[`${type}-${id}`]
          if (type === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v as object)
          out[id] = v
        }
        return out as { [id: string]: SignalDataTypeMap[typeof type] }
      },
      set: async (data) => {
        for (const category in data) {
          const group = data[category as keyof typeof data] ?? {}
          for (const id in group) {
            const v = group[id]
            if (v) keys[`${category}-${id}`] = v
            else delete keys[`${category}-${id}`]
          }
        }
      },
    },
  }
  return { state, dump: () => ({ creds: state.creds, keys }) }
}

function sealKey(): Buffer {
  const secret = process.env.SESSION_SECRET ?? ''
  if (secret.length < 32) throw new Error('Server belum dikonfigurasi (SESSION_SECRET).')
  return createHash('sha256').update(`${secret}|whatsapp-link-v1`).digest()
}

/** The login → an opaque string only this server, for this user, can open. */
function seal(b: Bundle, user: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', sealKey(), iv)
  c.setAAD(Buffer.from(user))
  const body = Buffer.concat([c.update(gzipSync(JSON.stringify(b, BufferJSON.replacer))), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url')
}

function unseal(s: string, user: string): Bundle {
  try {
    const raw = Buffer.from(s, 'base64url')
    const d = createDecipheriv('aes-256-gcm', sealKey(), raw.subarray(0, 12))
    d.setAAD(Buffer.from(user))
    d.setAuthTag(raw.subarray(12, 28))
    const json = gunzipSync(Buffer.concat([d.update(raw.subarray(28)), d.final()])).toString('utf8')
    return JSON.parse(json, BufferJSON.reviver) as Bundle
  } catch {
    throw Object.assign(new Error('Sesi WhatsApp tidak berlaku lagi. Scan QR ulang.'), { code: 401 })
  }
}

/* ------------------------------------------------------------ connecting */

/* Baileys logs through pino; nothing here needs its chatter */
const quiet = {
  level: 'silent',
  child() { return quiet },
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
}

/* WhatsApp refuses clients that claim too old a version; the current one is
   looked up once per warm function and reused */
let version: [number, number, number] | undefined
async function waVersion() {
  if (!version) version = (await fetchLatestBaileysVersion().catch(() => null))?.version
  return version
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Connect with a login (or a fresh one, which means a QR), resolving once
 * WhatsApp is open.
 *
 * Right after a QR is scanned WhatsApp closes the connection on purpose
 * (`restartRequired`); that is answered with a new socket on the same login.
 * Anything else that closes it before it opens is a failure. `stop` lets the
 * caller abandon the attempt — a page that went away mid-QR.
 */
async function connect(
  auth: { state: AuthenticationState },
  o: { onQr?: (qr: string) => void; until: number; stop?: { stopped: boolean } },
): Promise<WASocket> {
  const v = await waVersion()
  return new Promise<WASocket>((resolve, reject) => {
    let done = false
    let sock: WASocket | null = null
    const finish = (err: Error | null, s?: WASocket) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (err) { sock?.end(undefined); reject(err) } else resolve(s!)
    }
    const timer = setTimeout(
      () => finish(Object.assign(new Error('Waktu habis menunggu WhatsApp.'), { code: 504 })),
      Math.max(1000, o.until - Date.now()),
    )
    const open = () => {
      if (o.stop?.stopped) return finish(new Error('Dibatalkan.'))
      sock = makeWASocket({
        auth: auth.state,
        version: v,
        logger: quiet as unknown as Parameters<typeof makeWASocket>[0]['logger'],
        browser: Browsers.windows('Chrome'),
        markOnlineOnConnect: false,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
      })
      const s = sock
      s.ev.on('creds.update', (u) => { Object.assign(auth.state.creds, u) })
      s.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
          if (o.onQr) o.onQr(qr)
          /* a stored login that asks for a QR is no login at all */
          else finish(Object.assign(new Error('Sesi WhatsApp sudah tidak tertaut. Scan QR ulang.'), { code: 401 }))
        }
        if (connection === 'open') finish(null, s)
        if (connection === 'close' && !done) {
          const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode
          if (code === DisconnectReason.restartRequired) open()
          else if (code === DisconnectReason.loggedOut) {
            finish(Object.assign(new Error('WhatsApp sudah logout dari perangkat ini. Scan QR ulang.'), { code: 401 }))
          } else finish(new Error(`Koneksi WhatsApp terputus (${code ?? 'tanpa kode'}).`))
        }
      })
    }
    open()
  })
}

/* ------------------------------------------------------------ the routes */

export interface GroupCheck {
  agent: string
  /** the group's name as WhatsApp shows it; null when this number is not in it */
  name: string | null
}

const numberOf = (sock: WASocket) => (sock.user?.id ?? '').split(/[:@]/)[0]

/**
 * POST /api/wa/link — a stream of lines: `{type:"qr", qr}` each time WhatsApp
 * offers a code, then `{type:"linked", name, number, groups, state}` once the
 * phone has scanned, or `{type:"error", error}`.
 */
export function linkStream(user: string, toDataUrl: (qr: string) => Promise<string>): Response {
  const enc = new TextEncoder()
  const stop = { stopped: false }
  let live: WASocket | null = null
  const stream = new ReadableStream<Uint8Array>({
    async start(ctl) {
      const write = (o: unknown) => { if (!stop.stopped) ctl.enqueue(enc.encode(JSON.stringify(o) + '\n')) }
      const auth = memoryAuth()
      try {
        live = await connect(auth, {
          until: Date.now() + 240_000,
          stop,
          onQr: (qr) => { void toDataUrl(qr).then((url) => write({ type: 'qr', qr: url })) },
        })
        const sock = live
        const all = await sock.groupFetchAllParticipating()
        const groups: GroupCheck[] = Object.entries(WA_GROUPS).map(([agent, jid]) => ({
          agent, name: all[jid]?.subject ?? null,
        }))
        await sleep(1500)   // let the first round of key uploads land before the login is copied
        write({ type: 'linked', name: sock.user?.name ?? '', number: numberOf(sock), groups, state: seal(auth.dump(), user) })
        sock.end(undefined)
      } catch (ex) {
        write({ type: 'error', error: (ex as Error).message })
      }
      if (!stop.stopped) ctl.close()
    },
    cancel() {
      stop.stopped = true
      live?.end(undefined)
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  })
}

export interface SendResult {
  sent: string[]
  failed: { name: string; error: string }[]
  state: string
}

/**
 * One part of one agent's send: some pictures as an album, or one PDF. The
 * group comes from WA_GROUPS, never from the request, so nothing can be sent
 * anywhere else whatever the page asks.
 */
export async function sendPart(user: string, form: FormData): Promise<SendResult> {
  const meta = JSON.parse(String(form.get('meta') ?? '{}')) as {
    agent?: string; kind?: 'album' | 'pdf'; captions?: string[]
  }
  const jid = meta.agent && Object.hasOwn(WA_GROUPS, meta.agent) ? WA_GROUPS[meta.agent as WaAgent] : undefined
  if (!jid) throw Object.assign(new Error(`Agen "${meta.agent}" tidak punya grup WhatsApp.`), { code: 400 })
  const files = form.getAll('file').filter((f): f is File => typeof f !== 'string')
  if (!files.length) throw Object.assign(new Error('Tidak ada file untuk dikirim.'), { code: 400 })

  const auth = memoryAuth(unseal(String(form.get('state') ?? ''), user))
  const sock = await connect(auth, { until: Date.now() + 60_000 })
  const sent: string[] = []
  const failed: { name: string; error: string }[] = []
  try {
    if (meta.kind === 'pdf') {
      for (const [i, f] of files.entries()) {
        try {
          await sock.sendMessage(jid, {
            document: Buffer.from(await f.arrayBuffer()), fileName: f.name,
            mimetype: 'application/pdf', caption: meta.captions?.[i] || undefined,
          })
          sent.push(f.name)
        } catch (ex) { failed.push({ name: f.name, error: (ex as Error).message }) }
      }
    } else {
      /* an album is a header saying how many pictures follow, then each picture
         pointing back at it; one picture needs no album */
      let parent: proto.IMessageKey | undefined
      if (files.length > 1) {
        parent = (await sock.sendMessage(jid, { album: { expectedImageCount: files.length } }).catch(() => undefined))?.key
      }
      for (const [i, f] of files.entries()) {
        try {
          await sock.sendMessage(jid, {
            image: Buffer.from(await f.arrayBuffer()), mimetype: f.type || 'image/jpeg',
            caption: meta.captions?.[i] || undefined,
            ...(parent ? { albumParentKey: parent } : {}),
          })
          sent.push(f.name)
        } catch (ex) { failed.push({ name: f.name, error: (ex as Error).message }) }
      }
    }
    await sleep(1200)   // the last upload's acknowledgement, before the socket goes
  } finally {
    sock.end(undefined)
  }
  return { sent, failed, state: seal(auth.dump(), user) }
}

/** Unlink this dashboard from the phone. A login that is already gone is fine. */
export async function logout(user: string, state: string): Promise<void> {
  let bundle: Bundle
  try { bundle = unseal(state, user) } catch { return }
  const auth = memoryAuth(bundle)
  let sock: WASocket
  try { sock = await connect(auth, { until: Date.now() + 30_000 }) } catch { return }
  await sock.logout().catch(() => sock.end(undefined))
}
