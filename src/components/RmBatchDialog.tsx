/**
 * The "Unduh semua RM" pop-up: choose the RMs, then download them or send them
 * to the agents' WhatsApp groups.
 *
 * Its faces, in the order someone meets them:
 *
 *   pick  — every RM of the period, ticked, grouped by region with a tick box
 *           per region, and a search box. All of them is the default.
 *   link  — "Kirim ke Grup WhatsApp" only: a QR to scan with the phone that
 *           will send, then which of the agents' groups that number is in.
 *   run   — a loading animation while each RM's detail is photographed under
 *           an opaque cover — machinery, not something to watch.
 *   done  — what was downloaded, or each agent's send as it goes.
 *
 * WhatsApp is logged in for this dialog only (see lib/waLink.ts). Closing it
 * logs the phone out again; so does leaving the page. A send that fails ends in
 * an error pop-up that names each failure and can resend just those.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { scoreOf, verdictOf } from '../lib/rm'
import type { RmIndicator, RmRow } from '../lib/rm'
import {
  PART_BUDGET, WA_AGENTS, fmtWaNumber, jpegsToPdf, linkWhatsApp, logoutWhatsApp, packBySize, rmOfFile,
  sendWaPart, toWaJpeg,
} from '../lib/waLink'
import type { WaLinked } from '../lib/waLink'
import BtnIcon from './BtnIcon'

export interface BatchProgress {
  i: number
  n: number
  rm: string
}

export interface BatchResult {
  ok: number
  failed: string[]
  /** the ZIP's name; '' when nothing was saved (or nothing was meant to be) */
  zip: string
  cancelled?: boolean
  error?: string
  /** "Kirim ke Grup WhatsApp": the pictures per agent */
  groups?: { agent: string; files: File[] }[]
}

/** one agent's send, as the page shows it */
type AgentRun = {
  status: 'wait' | 'prep' | 'run' | 'done'
  total: number
  sent: number
  failed: { name: string; error: string }[]
}

type Link =
  | { step: 'off' }
  | { step: 'wait' }
  | { step: 'qr'; qr: string }
  | { step: 'linked'; info: WaLinked }
  | { step: 'error'; error: string }

/* how many destination chips show before "+N lainnya" */
const CHIP_MAX = 4

export default function RmBatchDialog({
  rows, scope, inds, periodName, periodLabel, progress, result, onStart, onStop, onClose,
}: {
  /** the RMs on offer, in sheet order — every agent's, or only the one the page is filtered to */
  rows: RmRow[]
  /** the agent the page is filtered to; '' for all of them */
  scope: string
  inds: RmIndicator[]
  periodName: string
  periodLabel: string
  progress: BatchProgress | null
  result: BatchResult | null
  onStart: (keys: string[], send: boolean) => void
  onStop: () => void
  onClose: () => void
}) {
  /* the RMs switched off — empty means all, the default */
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set())
  const [q, setQ] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)
  const [showAllChips, setShowAllChips] = useState(false)

  /* ---------------------------------------------------------- WhatsApp */

  const [link, setLink] = useState<Link>({ step: 'off' })
  /* the sealed login: memory only, replaced after every request */
  const waState = useRef('')
  const linkAbort = useRef<AbortController | null>(null)
  const [sending, setSending] = useState(false)
  const [sendAgents, setSendAgents] = useState<ReadonlySet<string>>(() => new Set())
  const [runs, setRuns] = useState<Record<string, AgentRun>>({})
  /* each agent's JPEGs and PDFs, made once and reused by a resend */
  const payload = useRef<Record<string, { jpegs: File[]; pdfs: File[] }>>({})
  const [errOpen, setErrOpen] = useState(false)
  const started = useRef(false)

  const phase = result ? 'done' : progress ? 'run' : link.step !== 'off' ? 'link' : 'pick'

  /* the phone is logged out when the dialog goes, however it goes */
  useEffect(() => {
    const leave = () => { if (waState.current) void logoutWhatsApp(waState.current) }
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('pagehide', leave)
      linkAbort.current?.abort()
      leave()
    }
  }, [])

  const regions = useMemo(() => {
    const m = new Map<string, RmRow[]>()
    for (const r of rows) m.set(r.region, [...(m.get(r.region) ?? []), r])
    return [...m]
  }, [rows])

  const needle = q.trim().toLowerCase()
  const picked = rows.length - rows.filter((r) => off.has(r.key)).length
  const allOn = off.size === 0

  /* the agents among the ticked RMs, and those of them that have a group */
  const pickedAgents = [...new Set(rows.filter((r) => !off.has(r.key)).map((r) => r.region))]
  const sendable = pickedAgents.filter((a) => WA_AGENTS.has(a))
  const unmapped = pickedAgents.filter((a) => !WA_AGENTS.has(a))
  const chips = showAllChips ? sendable : sendable.slice(0, CHIP_MAX)

  /* after the scan: the ticked agents whose group this number is in, and not */
  const linkedInfo = link.step === 'linked' ? link.info : null
  const member = new Set(linkedInfo?.groups.filter((g) => g.name).map((g) => g.agent) ?? [])
  const reachable = sendable.filter((a) => member.has(a))
  const notMember = sendable.filter((a) => !member.has(a))

  const download = () => {
    setSending(false)
    onStart(rows.filter((r) => !off.has(r.key)).map((r) => r.key), false)
  }

  const startLink = async () => {
    linkAbort.current?.abort()
    const ac = new AbortController()
    linkAbort.current = ac
    setLink({ step: 'wait' })
    try {
      const info = await linkWhatsApp((qr) => setLink({ step: 'qr', qr }), ac.signal)
      waState.current = info.state
      setLink({ step: 'linked', info })
    } catch (ex) {
      if (ac.signal.aborted) return
      setLink({ step: 'error', error: (ex as Error).message })
    }
  }

  const cancelLink = () => {
    linkAbort.current?.abort()
    if (waState.current) void logoutWhatsApp(waState.current)
    waState.current = ''
    setLink({ step: 'off' })
  }

  /* photograph only the RMs whose agent's group this number can post to */
  const beginSend = (agents: string[]) => {
    setSending(true)
    setSendAgents(new Set(agents))
    onStart(rows.filter((r) => !off.has(r.key) && agents.includes(r.region)).map((r) => r.key), true)
  }

  /* linked and every ticked agent's group is reachable: no reason to stop and ask */
  useEffect(() => {
    if (link.step === 'linked' && !sending && reachable.length && !notMember.length) beginSend(reachable)
  }, [link.step])  // eslint-disable-line react-hooks/exhaustive-deps

  const patchRun = (agent: string, p: Partial<AgentRun> | ((r: AgentRun) => Partial<AgentRun>)) =>
    setRuns((m) => {
      const cur = m[agent] ?? { status: 'wait', total: 0, sent: 0, failed: [] }
      return { ...m, [agent]: { ...cur, ...(typeof p === 'function' ? p(cur) : p) } }
    })

  /**
   * Each agent in turn: its pictures as JPEGs, sent as one album (two, when they
   * do not fit one request), then the PDF. `only` narrows a resend to the files
   * that failed.
   */
  const sendAll = async (groups: { agent: string; files: File[] }[], only?: Record<string, Set<string>>) => {
    const caption = (agent: string, n: number) => `Pencapaian RM ${agent} · ${periodName} ${periodLabel} · ${n} RM`
    let anyFailed = false
    for (const { agent, files } of groups) {
      patchRun(agent, { status: 'prep' })
      let p = payload.current[agent]
      try {
        if (!p) {
          const jpegs: File[] = []
          for (const f of files) jpegs.push(await toWaJpeg(f))
          /* one PDF when it fits a request, else one per run of pages */
          const base = `Pencapaian RM ${agent} ${periodName} ${periodLabel}`.replace(/[\\/:*?"<>|&]+/g, ' ')
          const whole = await jpegsToPdf(jpegs)
          const pdfs = whole.size <= PART_BUDGET
            ? [new File([whole], `${base}.pdf`, { type: 'application/pdf' })]
            : await Promise.all(packBySize(jpegs, PART_BUDGET * 0.9).map(async (run, i, all) =>
              new File([await jpegsToPdf(run)], `${base} (Bagian ${i + 1} dari ${all.length}).pdf`, { type: 'application/pdf' })))
          p = { jpegs, pdfs }
          payload.current[agent] = p
          patchRun(agent, { total: jpegs.length + pdfs.length })
        }
      } catch (ex) {
        patchRun(agent, { status: 'done', failed: [{ name: agent, error: (ex as Error).message }] })
        anyFailed = true
        continue
      }

      const want = only?.[agent]
      const imgs = p.jpegs.filter((f) => !want || want.has(f.name))
      const pdfs = p.pdfs.filter((f) => !want || want.has(f.name))
      const head = caption(agent, p.jpegs.length)
      const failed: { name: string; error: string }[] = []
      patchRun(agent, { status: 'run' })

      const part = async (kind: 'album' | 'pdf', batch: File[], caps: string[]) => {
        try {
          const r = await sendWaPart(waState.current, agent, kind, batch, caps)
          waState.current = r.state
          failed.push(...r.failed)
          patchRun(agent, (cur) => ({ sent: cur.sent + r.sent.length }))
        } catch (ex) {
          failed.push(...batch.map((f) => ({ name: f.name, error: (ex as Error).message })))
        }
      }
      for (const batch of packBySize(imgs)) {
        await part('album', batch, batch.map((f) =>
          f === p.jpegs[0] ? `${head}\n${rmOfFile(f.name)}` : rmOfFile(f.name)))
      }
      for (const pdf of pdfs) await part('pdf', [pdf], [head])

      patchRun(agent, { status: 'done', failed })
      if (failed.length) anyFailed = true
    }
    if (anyFailed) setErrOpen(true)
  }

  /* only the agents that have a group */
  const sendGroups = (result?.groups ?? []).filter((g) => sendAgents.has(g.agent))
  useEffect(() => {
    if (!sending || !sendGroups.length || started.current) return
    started.current = true
    void sendAll(sendGroups)
  }, [sending, result])  // eslint-disable-line react-hooks/exhaustive-deps

  const failedGroups = sendGroups.filter((g) => (runs[g.agent]?.failed.length ?? 0) > 0)
  const sendingNow = sendGroups.some((g) => runs[g.agent]?.status !== 'done')
  const sentOk = sendGroups.filter((g) => runs[g.agent]?.status === 'done' && !runs[g.agent].failed.length).length

  /* resend what did not arrive — a group that got eight of ten gets the other two */
  const retryFailed = () => {
    const only: Record<string, Set<string>> = {}
    /* an agent whose pictures were never prepared is sent whole */
    for (const g of failedGroups) {
      if (payload.current[g.agent]) only[g.agent] = new Set(runs[g.agent].failed.map((f) => f.name))
    }
    setErrOpen(false)
    for (const g of failedGroups) patchRun(g.agent, { status: 'wait', failed: [] })
    void sendAll(failedGroups, only)
  }

  const close = () => {
    linkAbort.current?.abort()
    if (waState.current) void logoutWhatsApp(waState.current)
    waState.current = ''
    onClose()
  }

  const setMany = (keys: string[], on: boolean) => setOff((prev) => {
    const next = new Set(prev)
    for (const k of keys) {
      if (on) next.delete(k)
      else next.add(k)
    }
    return next
  })

  /* focus in on open, Escape closes — except while working, where only Batal stops it */
  const busy = phase === 'run' || sendingNow
  useEffect(() => { boxRef.current?.focus() }, [phase])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return
      e.preventDefault()
      if (errOpen) setErrOpen(false)
      else if (phase === 'link') cancelLink()
      else close()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  })

  const pct = progress ? Math.round((progress.i / progress.n) * 100) : 0

  return (
    <div
      className={`rmb-scrim${phase === 'run' ? ' covering' : ''}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy && phase !== 'link') close() }}
    >
      <div className="rmb" role="dialog" aria-modal="true" aria-labelledby="rmb-title" ref={boxRef} tabIndex={-1}>
        <header className="rmb-head">
          <span className="rmb-titles">
            <h2 id="rmb-title">{sending || phase === 'link' ? 'Kirim Pencapaian RM' : 'Unduh Pencapaian RM'}</h2>
            <span className="rmb-sub">{scope || 'Semua agen'} · {periodName} · {periodLabel}</span>
          </span>
          {!busy && (
            <button className="rmd-close" onClick={phase === 'link' ? cancelLink : close}
                    aria-label="Tutup" title="Tutup (Esc)">
              <BtnIcon name="close" />
            </button>
          )}
        </header>

        {phase === 'pick' && (
          <>
            <div className="rmb-tools">
              <div className="dpsearchbox">
                <input type="text" placeholder="Cari nama RM…" value={q}
                       onChange={(e) => setQ(e.target.value)} aria-label="Cari nama RM" />
                {q && (
                  <button type="button" className="dpsearchx" onClick={() => setQ('')}
                          title="Hapus kata kunci" aria-label="Hapus kata kunci">×</button>
                )}
              </div>
              <label className="rmb-all">
                <input
                  type="checkbox" checked={allOn}
                  ref={(el) => { if (el) el.indeterminate = !allOn && picked > 0 }}
                  onChange={(e) => setOff(e.target.checked ? new Set() : new Set(rows.map((r) => r.key)))}
                />
                <span>{scope ? `Semua RM ${scope}` : 'Semua agen & RM'}</span>
                <b>{picked} / {rows.length}</b>
              </label>
            </div>

            <div className="rmb-list">
              {regions.map(([region, list]) => {
                const hits = list.filter((r) => !needle || r.rm.toLowerCase().includes(needle))
                if (!hits.length) return null
                const on = list.filter((r) => !off.has(r.key)).length
                return (
                  <section className={`rmb-reg${scope ? ' solo' : ''}`} key={region}>
                    {/* one agent only: the "Semua RM <agent>" box above already is this */}
                    {!scope && (
                      <label className="rmb-reghead">
                        <input
                          type="checkbox" checked={on === list.length}
                          ref={(el) => { if (el) el.indeterminate = on > 0 && on < list.length }}
                          onChange={(e) => setMany(list.map((r) => r.key), e.target.checked)}
                        />
                        <span>{region}</span>
                        <b>{on} / {list.length}</b>
                      </label>
                    )}
                    {hits.map((r) => {
                      const s = scoreOf(r, inds)
                      return (
                        <label className={`rmb-row${off.has(r.key) ? ' unticked' : ''}`} key={r.key}>
                          <input type="checkbox" checked={!off.has(r.key)}
                                 onChange={(e) => setMany([r.key], e.target.checked)} />
                          <span className={`rmc-dot v-${verdictOf(s.met, s.of)}`} aria-hidden="true" />
                          <span className="rmb-name">{r.rm}</span>
                          <span className="rmb-score">{s.of ? `${s.met}/${s.of}` : '—'}</span>
                        </label>
                      )
                    })}
                  </section>
                )
              })}
              {needle && !rows.some((r) => r.rm.toLowerCase().includes(needle)) && (
                <div className="rmb-empty">Tidak ada nama RM yang memuat “{q.trim()}”.</div>
              )}
            </div>

            {/* WhatsApp: where it goes, and that it asks for a scan first */}
            {sendable.length > 0 && (
              <div className="rmb-wa ok">
                <div className="rmb-wa-top">
                  <span className="rmb-wa-dot" aria-hidden="true" />
                  <span className="rmb-wa-who">
                    <b>Kirim lewat WhatsApp</b>
                    <span>scan QR saat mengirim · logout otomatis setelah selesai</span>
                  </span>
                </div>
                <div className="rmb-wa-dest">
                  <span className="rmb-wa-lab">Grup tujuan · {sendable.length}</span>
                  <span className="rmb-chips">
                    {chips.map((a) => <span className="rmb-chip" key={a}>{a}</span>)}
                    {sendable.length > CHIP_MAX && (
                      <button type="button" className="rmb-chip more" onClick={() => setShowAllChips(!showAllChips)}>
                        {showAllChips ? 'ringkas' : `+${sendable.length - CHIP_MAX} lainnya`}
                      </button>
                    )}
                  </span>
                  {unmapped.length > 0 && (
                    <span className="rmb-wa-note">Tanpa grup, tidak dikirim: {unmapped.join(', ')}</span>
                  )}
                </div>
              </div>
            )}

            <footer className="rmb-foot">
              <span className="rmb-note">Unduh: satu PNG per RM dalam ZIP. Kirim: album + PDF ke grup tiap agen.</span>
              <button type="button" className="rmb-btn ghost" onClick={close}>Batal</button>
              <button type="button" className="rmb-btn ghost" disabled={!picked} onClick={download}>
                <BtnIcon name="image" />
                Unduh {picked} RM
              </button>
              {/* only when at least one ticked agent has a group to receive it */}
              {sendable.length > 0 && (
                <button type="button" className="rmb-btn send" onClick={startLink}
                        title={`Scan QR WhatsApp, lalu kirim album + PDF ke grup ${sendable.join(', ')}`}>
                  <BtnIcon name="send" />
                  Kirim ke Grup WhatsApp
                </button>
              )}
            </footer>
          </>
        )}

        {phase === 'link' && (
          <div className="rmb-run rmb-link">
            {(link.step === 'wait' || link.step === 'qr') && (
              <>
                <div className="rmb-qrbox" aria-live="polite">
                  {link.step === 'qr'
                    ? <img src={link.qr} alt="QR untuk masuk WhatsApp" className="rmb-qr" />
                    : <span className="rmb-ring small" aria-label="Menyiapkan QR" />}
                </div>
                <div className="rmb-runtxt">
                  <b>Scan dengan WhatsApp untuk mengirim</b>
                  <span>{link.step === 'qr' ? 'QR diperbarui otomatis ±20 detik sekali' : 'Menyiapkan QR…'}</span>
                </div>
                <ol className="rmb-steps">
                  <li>Buka <b>WhatsApp</b> di HP yang akan dipakai mengirim.</li>
                  <li>Ketuk <b>⋮ / Setelan → Perangkat tertaut → Tautkan perangkat</b>.</li>
                  <li>Arahkan kamera ke QR ini.</li>
                </ol>
                <p className="rmb-hint">Nomor ini harus anggota grup agen. Logout otomatis saat pop-up ditutup.</p>
                <button type="button" className="rmb-btn ghost" onClick={cancelLink}>Batal</button>
              </>
            )}

            {link.step === 'linked' && (
              <>
                <div className="rmb-acct">
                  <span className="rmb-avatar" aria-hidden="true">{(link.info.name || '?').trim().charAt(0).toUpperCase()}</span>
                  <span className="rmb-acct-id">
                    <b>{link.info.name || 'WhatsApp'}</b>
                    <span>{fmtWaNumber(link.info.number)}</span>
                  </span>
                  <span className="rmb-acct-ok">Terhubung</span>
                </div>
                <ul className="rmb-grpcheck">
                  {sendable.map((a) => {
                    const g = link.info.groups.find((x) => x.agent === a)
                    return (
                      <li key={a} className={g?.name ? 'ok' : 'bad'}>
                        <BtnIcon name={g?.name ? 'check' : 'close'} />
                        <b>{a}</b>
                        <span>{g?.name ?? 'nomor ini bukan anggota grupnya'}</span>
                      </li>
                    )
                  })}
                </ul>
                {notMember.length > 0 && (
                  <>
                    <p className="rmb-hint">
                      {reachable.length
                        ? `${notMember.length} grup tidak bisa dikirimi dari nomor ini dan akan dilewati.`
                        : 'Nomor ini bukan anggota grup mana pun yang dipilih. Tambahkan ke grupnya, atau scan dengan nomor lain.'}
                    </p>
                    <div className="rmb-done-actions">
                      <button type="button" className="rmb-btn ghost" onClick={cancelLink}>Batal &amp; logout</button>
                      {reachable.length > 0 && (
                        <button type="button" className="rmb-btn send" onClick={() => beginSend(reachable)}>
                          <BtnIcon name="send" />
                          Kirim ke {reachable.length} grup
                        </button>
                      )}
                    </div>
                  </>
                )}
              </>
            )}

            {link.step === 'error' && (
              <>
                <div className="rmb-badge bad" aria-hidden="true"><BtnIcon name="close" /></div>
                <div className="rmb-runtxt" role="alert">
                  <b>WhatsApp gagal tertaut</b>
                  <span>{link.error}</span>
                </div>
                <div className="rmb-done-actions">
                  <button type="button" className="rmb-btn ghost" onClick={cancelLink}>Batal</button>
                  <button type="button" className="rmb-btn send" onClick={startLink}>
                    <BtnIcon name="retry" />
                    Coba lagi
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {phase === 'run' && progress && (
          <div className="rmb-run" role="status" aria-live="polite">
            <div className="rmb-loader" aria-hidden="true">
              <span className="rmb-ring" />
              <span className="rmb-pct">{pct}%</span>
            </div>
            <div className="rmb-runtxt">
              <b>Menyiapkan gambar {Math.min(progress.i + 1, progress.n)} dari {progress.n} RM…</b>
              <span>{progress.rm}</span>
            </div>
            <div className="rmb-track" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
            <p className="rmb-hint">
              {sending
                ? 'Jangan tutup halaman ini. Setelah selesai, album + PDF langsung dikirim ke grup WhatsApp.'
                : 'Jangan tutup halaman ini. File ZIP akan terunduh otomatis setelah selesai.'}
            </p>
            <button type="button" className="rmb-btn ghost" onClick={onStop}>Batal</button>
          </div>
        )}

        {phase === 'done' && result && (
          <div className="rmb-run">
            {(() => {
              const bad = !!result.cancelled || !!result.error || !result.ok
                || (sending && !sendingNow && failedGroups.length > 0)
              return (
                <div className={`rmb-badge ${sending && sendingNow ? 'busy' : bad ? 'bad' : 'ok'}`} aria-hidden="true">
                  <BtnIcon name={sending && sendingNow ? 'spin' : bad ? 'close' : 'check'} />
                </div>
              )
            })()}
            <div className="rmb-runtxt" role="status">
              {result.cancelled ? (
                <b>{sending ? 'Pengiriman dibatalkan.' : 'Unduhan dibatalkan.'}</b>
              ) : result.error ? (
                <><b>Gagal membuat file.</b><span>{result.error}</span></>
              ) : !result.ok ? (
                <b>Tidak ada gambar yang berhasil dibuat.</b>
              ) : sending ? (
                sendingNow
                  ? <><b>Mengirim ke grup WhatsApp…</b><span>{sentOk} dari {sendGroups.length} grup selesai</span></>
                  : failedGroups.length
                    ? <><b>{sentOk} dari {sendGroups.length} grup terkirim.</b><span>{failedGroups.length} grup gagal.</span></>
                    : <><b>Terkirim ke {sendGroups.length} grup WhatsApp.</b><span>{result.ok} RM · album + PDF</span></>
              ) : (
                <><b>{result.ok} detail RM berhasil diunduh.</b><span>“{result.zip}”</span></>
              )}
            </div>
            {result.failed.length > 0 && (
              <p className="rmb-fail">{result.failed.length} gambar gagal dibuat: {result.failed.join(', ')}</p>
            )}
            {sending && sendGroups.length > 0 && (
              <div className="rmb-send">
                {sendGroups.map(({ agent, files }) => {
                  const a = runs[agent]
                  const st = a?.status !== 'done' ? 'run' : a.failed.length ? 'bad' : 'ok'
                  return (
                    <div className={`rmb-autorow ${st}`} key={agent}>
                      <BtnIcon name={st === 'ok' ? 'check' : st === 'bad' ? 'close' : 'spin'} />
                      <span className="rmb-sendname">{agent}</span>
                      <span className="rmb-sendn">
                        {!a || a.status === 'wait' ? `menunggu · ${files.length} RM`
                          : a.status === 'prep' ? 'menyiapkan album + PDF…'
                          : `${a.sent} / ${a.total} terkirim`}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
            {sending && !sendingNow && <p className="rmb-hint">WhatsApp logout otomatis saat pop-up ini ditutup.</p>}
            <div className="rmb-done-actions">
              {sending && !sendingNow && failedGroups.length > 0 && (
                <button type="button" className="rmb-btn ghost" onClick={() => setErrOpen(true)}>Lihat kesalahan</button>
              )}
              <button type="button" className="rmb-btn primary" disabled={sendingNow} onClick={close}>
                {sendingNow ? 'Mengirim…' : 'Tutup'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* -------- what went wrong, per agent -------- */}
      {errOpen && failedGroups.length > 0 && (
        <div className="rmb-err-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setErrOpen(false) }}>
          <div className="rmb-err" role="alertdialog" aria-modal="true" aria-labelledby="rmb-err-title">
            <div className="rmb-err-icon" aria-hidden="true"><BtnIcon name="close" /></div>
            <h3 id="rmb-err-title">
              {failedGroups.length === sendGroups.length
                ? 'Pengiriman WhatsApp gagal'
                : `${failedGroups.length} dari ${sendGroups.length} grup gagal dikirim`}
            </h3>
            <ul className="rmb-err-list">
              {failedGroups.map(({ agent }) => {
                const a = runs[agent]
                return (
                  <li key={agent}>
                    <b>{agent}</b>
                    <span className="rmb-err-n">{a.failed.length} dari {a.total || a.failed.length} belum terkirim</span>
                    <span className="rmb-err-why">{[...new Set(a.failed.map((f) => f.error))].join(' · ')}</span>
                  </li>
                )
              })}
            </ul>
            <div className="rmb-err-actions">
              <button type="button" className="rmb-btn ghost" onClick={() => setErrOpen(false)}>Tutup</button>
              <button type="button" className="rmb-btn send" onClick={retryFailed}>
                <BtnIcon name="retry" />
                Kirim ulang {failedGroups.length} grup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
