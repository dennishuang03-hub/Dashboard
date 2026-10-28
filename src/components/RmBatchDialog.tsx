/**
 * The "Unduh semua RM" pop-up: choose the RMs, then wait, then done.
 *
 * Three faces of one dialog, decided by the page's state rather than held here:
 *
 *   pick  — every RM of the period, ticked, grouped by region with a tick box
 *           per region, and a search box. All of them is the default.
 *   run   — a loading animation and a count. The backdrop turns opaque here,
 *           because underneath it the page is opening each RM's detail and
 *           photographing it, and none of that is for the person to watch.
 *   done  — what was downloaded, what failed, and a close button. After
 *           "Unduh & Kirim ke Group", also each agent's send to its WhatsApp
 *           group as it happens.
 *
 * The sending is wa-sender's (see ../../../wa-sender): a program on this
 * computer, logged in to WhatsApp. "Unduh & Kirim ke Group" exists only for an
 * agent that agents.json gives a group — an agent without one gets the ZIP and
 * nothing else, and with wa-sender not running the button is not there at all.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { scoreOf, verdictOf } from '../lib/rm'
import type { RmIndicator, RmRow } from '../lib/rm'
import { loadWaConfig, saveWaConfig, waAgents, waJob, waSendAgent, waStatus } from '../lib/waSender'
import type { WaConfig, WaJob, WaStatus } from '../lib/waSender'
import BtnIcon from './BtnIcon'

export interface BatchProgress {
  i: number
  n: number
  rm: string
}

export interface BatchResult {
  ok: number
  failed: string[]
  /** the ZIP's name; '' when nothing was saved */
  zip: string
  cancelled?: boolean
  error?: string
  /** "Unduh & Kirim ke Group": the pictures per agent, for wa-sender */
  groups?: { agent: string; files: File[] }[]
}

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
  const phase = result ? 'done' : progress ? 'run' : 'pick'

  /* the RMs switched off — empty means all, the default */
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set())
  const [q, setQ] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)

  /*
   * wa-sender: asked once when the dialog opens whether it is connected, and
   * which agents agents.json gives a group to.
   */
  const [waCfg, setWaCfg] = useState<WaConfig>(loadWaConfig)
  const [wa, setWa] = useState<{ checking: boolean; status: WaStatus | null; err: string }>(
    { checking: true, status: null, err: '' })
  const [waEdit, setWaEdit] = useState(false)
  const waReady = wa.status?.phase === 'ready'
  /* the agents with a WhatsApp group to send to */
  const [mapped, setMapped] = useState<ReadonlySet<string>>(() => new Set())
  /* the agents this run sends to — fixed at the press */
  const [sendAgents, setSendAgents] = useState<ReadonlySet<string>>(() => new Set())
  /* this run sends through wa-sender — decided at the press, not when it ends */
  const [autoRun, setAutoRun] = useState(false)
  const [autoJobs, setAutoJobs] = useState<Record<string, { job?: WaJob; err?: string }>>({})
  const autoStarted = useRef(false)

  const checkWa = async (cfg: WaConfig) => {
    try {
      const status = await waStatus(cfg)
      const list = status.phase === 'ready' ? await waAgents(cfg).catch(() => []) : []
      setMapped(new Set(list.filter((a) => a.to?.length).map((a) => a.agent)))
      setWa({ checking: false, status, err: status.phase === 'ready' ? '' : `WhatsApp ${status.phase}` })
    } catch (ex) {
      setWa({ checking: false, status: null, err: (ex as Error).message })
    }
  }
  useEffect(() => { void checkWa(waCfg) }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const saveWa = () => {
    saveWaConfig(waCfg)
    setWaEdit(false)
    setWa({ checking: true, status: null, err: '' })
    void checkWa(waCfg)
  }

  /* each agent in turn: hand over its pictures, then follow the job to the end */
  const runAuto = async (groups: { agent: string; files: File[] }[]) => {
    for (const { agent, files } of groups) {
      try {
        let job = await waSendAgent(waCfg, agent, files,
          `Pencapaian RM ${agent} · ${periodName} ${periodLabel} · ${files.length} RM`,
          `Pencapaian RM ${agent} ${periodName} ${periodLabel}.pdf`.replace(/[\\/:*?"<>|&]+/g, ' '))
        setAutoJobs((m) => ({ ...m, [agent]: { job } }))
        while (job.status === 'queued' || job.status === 'sending') {
          await new Promise((r) => setTimeout(r, 1500))
          job = await waJob(waCfg, job.id)
          setAutoJobs((m) => ({ ...m, [agent]: { job } }))
        }
      } catch (ex) {
        setAutoJobs((m) => ({ ...m, [agent]: { err: (ex as Error).message } }))
      }
    }
  }
  /* only the agents that have a group; the rest were downloaded and that is all */
  const autoGroups = (result?.groups ?? []).filter((g) => sendAgents.has(g.agent))
  useEffect(() => {
    if (!autoRun || !autoGroups.length || autoStarted.current) return
    autoStarted.current = true
    void runAuto(autoGroups)
  }, [autoRun, result])  // eslint-disable-line react-hooks/exhaustive-deps

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
  const sendable = waReady ? pickedAgents.filter((a) => mapped.has(a)) : []
  const unmapped = pickedAgents.filter((a) => !mapped.has(a))

  const begin = (send: boolean) => {
    setAutoRun(send && sendable.length > 0)
    setSendAgents(new Set(send ? sendable : []))
    onStart(rows.filter((r) => !off.has(r.key)).map((r) => r.key), send)
  }

  const setMany = (keys: string[], on: boolean) => setOff((prev) => {
    const next = new Set(prev)
    for (const k of keys) {
      if (on) next.delete(k)
      else next.add(k)
    }
    return next
  })

  /* focus in on open, Escape closes — except mid-download, where only Batal stops it */
  useEffect(() => { boxRef.current?.focus() }, [phase])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || phase === 'run') return
      e.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [phase, onClose])

  const pct = progress ? Math.round((progress.i / progress.n) * 100) : 0

  return (
    <div
      className={`rmb-scrim${phase === 'run' ? ' covering' : ''}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget && phase !== 'run') onClose() }}
    >
      <div className="rmb" role="dialog" aria-modal="true" aria-labelledby="rmb-title" ref={boxRef} tabIndex={-1}>
        <header className="rmb-head">
          <span className="rmb-titles">
            <h2 id="rmb-title">Unduh Pencapaian RM</h2>
            <span className="rmb-sub">{scope || 'Semua agen'} · {periodName} · {periodLabel}</span>
          </span>
          {phase !== 'run' && (
            <button className="rmd-close" onClick={onClose} aria-label="Tutup" title="Tutup (Esc)">
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

            <div className={`rmb-wa${waReady ? ' ok' : ''}`}>
              <span className="rmb-wa-txt">
                {wa.checking ? 'Memeriksa WhatsApp otomatis…'
                  : !waReady ? <>WhatsApp otomatis tidak aktif ({wa.err || 'belum diatur'}) — hanya unduh.</>
                  : !sendable.length ? <>
                      WhatsApp terhubung · <b>{wa.status?.me}</b>. {scope || 'Agen yang dipilih'} belum punya grup
                      WhatsApp — hanya unduh.
                    </>
                  : <>
                      WhatsApp terhubung · <b>{wa.status?.me}</b> — dikirim ke grup <b>{sendable.join(', ')}</b>.
                      {unmapped.length > 0 && <> {unmapped.length} agen lain belum punya grup, hanya diunduh.</>}
                    </>}
              </span>
              <button type="button" className="rmb-wa-edit" onClick={() => setWaEdit(!waEdit)}>
                {waEdit ? 'Tutup' : 'Atur'}
              </button>
              {waEdit && (
                <div className="rmb-wa-form">
                  <label>
                    <span>Alamat wa-sender</span>
                    <input type="text" value={waCfg.url} spellCheck={false}
                           onChange={(e) => setWaCfg({ ...waCfg, url: e.target.value })} />
                  </label>
                  <label>
                    <span>Token (dari wa-sender\config.json)</span>
                    <input type="password" value={waCfg.token} spellCheck={false} autoComplete="off"
                           onChange={(e) => setWaCfg({ ...waCfg, token: e.target.value.trim() })} />
                  </label>
                  <button type="button" className="rmb-btn primary" onClick={saveWa}>Simpan &amp; cek</button>
                </div>
              )}
            </div>

            <footer className="rmb-foot">
              <span className="rmb-note">Satu gambar PNG per RM, dalam satu folder di file ZIP.</span>
              <button type="button" className="rmb-btn ghost" onClick={onClose}>Batal</button>
              <button
                type="button" className="rmb-btn ghost" disabled={!picked}
                onClick={() => begin(false)}
              >
                <BtnIcon name="image" />
                Unduh {picked} RM
              </button>
              {/* only when at least one ticked agent has a group to receive it */}
              {sendable.length > 0 && (
                <button
                  type="button" className="rmb-btn send" disabled={!picked}
                  onClick={() => begin(true)}
                  title={`Unduh ZIP, lalu kirim album + PDF ke grup WhatsApp ${sendable.join(', ')}`}
                >
                  <BtnIcon name="send" />
                  Unduh &amp; Kirim ke Group
                </button>
              )}
            </footer>
          </>
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
            <p className="rmb-hint">Jangan tutup halaman ini. File ZIP akan terunduh otomatis setelah selesai.</p>
            <button type="button" className="rmb-btn ghost" onClick={onStop}>Batal</button>
          </div>
        )}

        {phase === 'done' && result && (
          <div className="rmb-run">
            <div className={`rmb-badge ${result.cancelled || result.error || !result.ok ? 'bad' : 'ok'}`} aria-hidden="true">
              <BtnIcon name={result.cancelled || result.error || !result.ok ? 'close' : 'check'} />
            </div>
            <div className="rmb-runtxt" role="status">
              {result.cancelled ? (
                <b>Unduhan dibatalkan.</b>
              ) : result.error ? (
                <><b>Gagal membuat file ZIP.</b><span>{result.error}</span></>
              ) : result.ok ? (
                <><b>{result.ok} detail RM berhasil diunduh.</b><span>“{result.zip}”</span></>
              ) : (
                <b>Tidak ada gambar yang berhasil dibuat.</b>
              )}
            </div>
            {result.failed.length > 0 && (
              <p className="rmb-fail">{result.failed.length} gagal: {result.failed.join(', ')}</p>
            )}
            {autoRun && autoGroups.length > 0 && (
              <div className="rmb-send">
                <span className="rmb-sendhead">Mengirim ke grup WhatsApp tiap agen</span>
                {autoGroups.map(({ agent, files }) => {
                  const a = autoJobs[agent]
                  const st = a?.err ? 'bad'
                    : a?.job?.status === 'done' ? 'ok'
                    : a?.job?.status === 'partial' || a?.job?.status === 'failed' ? 'bad' : 'run'
                  const failedItems = a?.job?.items.filter((i) => i.status === 'failed') ?? []
                  return (
                    <div className={`rmb-autorow ${st}`} key={agent}>
                      <BtnIcon name={st === 'ok' ? 'check' : st === 'bad' ? 'close' : 'spin'} />
                      <span className="rmb-sendname">Grup {agent}</span>
                      <span className="rmb-sendn">
                        {a?.err ? 'gagal'
                          : a?.job ? `${a.job.sent} / ${a.job.total} terkirim · album + PDF`
                            + (a.job.recipients > 1 ? ` · ${a.job.recipients} penerima` : '')
                          : `menyiapkan album + PDF · ${files.length} RM`}
                      </span>
                      {(a?.err || failedItems.length > 0) && (
                        <span className="rmb-autoerr">
                          {a?.err ?? failedItems.map((i) => `${i.name}: ${i.error ?? 'gagal'}`).join(' · ')}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            <button type="button" className="rmb-btn primary" onClick={onClose}>Tutup</button>
          </div>
        )}
      </div>
    </div>
  )
}
