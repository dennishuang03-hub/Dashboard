/**
 * Pencapaian RM — one card per regional manager.
 *
 * Read one RM at a time, which is why it is cards rather than a table: the
 * question someone brings to this page is "how is *my* RM doing", and a card
 * answers it with every indicator in one place and a single verdict at the foot
 * — how many of them are at target. The search box narrows the grid to the RMs
 * whose name matches, down to the one card.
 *
 * The indicators are whatever the RM tabs carry plus Retur (see `lib/rm.ts`), so
 * a column added to the workbook later becomes one more line on every card
 * without a change here.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { agentZh, capturePng, saveBlob } from '../lib/jnt'
import { RM_PERIODS, scoreOf, toneOf, verdictOf } from '../lib/rm'
import type { RmFigure, RmIndicator, RmPeriod, RmReport, RmRow, RmTone, RmVerdict } from '../lib/rm'
import type { DisplayId, DisplayReport } from '../lib/display'
import BtnIcon from './BtnIcon'
import RmBatchDialog from './RmBatchDialog'
import type { BatchResult } from './RmBatchDialog'
import RmDetail from './RmDetail'
import Zh from './Zh'
import { zipStore } from '../lib/zip'

type SortKey = 'sheet' | 'name' | 'best' | 'worst'
type StatusKey = '' | 'ok' | 'warn' | 'bad'

const VERDICT_LABEL: Record<Exclude<StatusKey, ''>, string> = {
  ok: 'Semua KPI sesuai target',
  warn: 'Sebagian besar sesuai',
  bad: 'Mayoritas di bawah target',
}

/** A file or folder name Windows will accept. */
const clean = (x: string) => x.replace(/[\\/:*?"<>|&]+/g, ' ').replace(/\s+/g, ' ').trim()

/** "Unduh semua RM": the RMs to photograph, which one is on screen, and where they go. */
interface Batch {
  rows: RmRow[]
  i: number
  period: RmPeriod
  /** the folder inside the ZIP, and the ZIP's own name */
  folder: string
  /** "Unduh & Kirim ke Group": keep the pictures per agent for the share sheet too */
  send: boolean
}

const fmt = (v: number | null) => (v == null ? '—' : `${v.toFixed(2)}%`)
const fmtPp = (v: number | null) =>
  v == null ? '' : `${v > 0.005 ? '▲ +' : v < -0.005 ? '▼ ' : '▬ '}${v.toFixed(2)}`

/** Good news is green whichever way it moves — down, for Retur. */
function deltaCls(ind: RmIndicator, d: number | null): string {
  if (d == null || Math.abs(d) < 0.005) return 'flat'
  return (ind.lowerBetter ? d < 0 : d > 0) ? 'up' : 'down'
}

/** The part of a name that matched the search, marked. */
function Hit({ text, q }: { text: string; q: string }): ReactNode {
  const i = q ? text.toLowerCase().indexOf(q) : -1
  if (i < 0) return text
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>
}

export default function RmSection({ reports, part, dpTabs, onNeedDps }: {
  reports: Partial<Record<RmPeriod, RmReport>>
  /** the badge on the band */
  part: string
  /** the Display tabs, for the drop points in the detail pop-out — read on first open */
  dpTabs: Partial<Record<DisplayId, DisplayReport>> | null | undefined
  onNeedDps: () => void
}) {
  /* the RM whose detail is open, by row key */
  const [openKey, setOpenKey] = useState<string | null>(null)
  const closeDetail = useCallback(() => setOpenKey(null), [])
  const periods = RM_PERIODS.filter((p) => reports[p.id])
  const [periodWanted, setPeriod] = useState<RmPeriod>(periods[0]?.id ?? 'harian')
  const period = reports[periodWanted] ? periodWanted : periods[0]?.id
  const rep = period ? reports[period]! : null

  const [q, setQ] = useState('')
  const [region, setRegion] = useState('')
  const [status, setStatus] = useState<StatusKey>('')
  const [sort, setSort] = useState<SortKey>('sheet')

  const inds = useMemo(() => rep?.indicators ?? [], [rep])

  /* Region and status narrow the grid and the headline figures; the search
     narrows the grid only — the tiles stay the region's, so a card can be read
     against them. */
  const inRegion = useMemo(
    () => (rep ? rep.rows.filter((r) => !region || r.region === region) : []),
    [rep, region],
  )

  const scored = useMemo(() => inRegion.map((row) => {
    const s = scoreOf(row, inds)
    return { row, ...s, verdict: verdictOf(s.met, s.of) }
  }), [inRegion, inds])

  const needle = q.trim().toLowerCase()
  const shown = useMemo(() => {
    const list = scored.filter((x) =>
      (!needle || x.row.rm.toLowerCase().includes(needle))
      && (!status || x.verdict === status))
    const ratio = (x: { met: number; of: number }) => (x.of ? x.met / x.of : -1)
    if (sort === 'name') list.sort((a, b) => a.row.rm.localeCompare(b.row.rm))
    else if (sort === 'best') list.sort((a, b) => ratio(b) - ratio(a) || a.row.rm.localeCompare(b.row.rm))
    else if (sort === 'worst') list.sort((a, b) => ratio(a) - ratio(b) || a.row.rm.localeCompare(b.row.rm))
    return list
  }, [scored, needle, status, sort])

  const counts = useMemo(() => {
    const m: Record<RmVerdict, number> = { ok: 0, warn: 0, bad: 0, na: 0 }
    for (const x of scored) m[x.verdict]++
    return m
  }, [scored])

  /*
   * "Unduh semua RM" — every RM's detail pop-out as a PNG, in one folder, in one
   * ZIP.
   *
   * The picture has to be the real pop-out, so the page opens each RM in turn
   * (keyed, so each is a fresh pop-out on the page's period), the pop-out says
   * when it is ready (`onAutoShot`), it is photographed exactly as Simpan PNG
   * would, and the next one opens. A browser cannot write a folder on its own;
   * a ZIP holding one is the nearest thing that downloads without a prompt.
   *
   * One RM failing does not stop the rest — it is named at the end instead.
   */
  const [batchOpen, setBatchOpen] = useState(false)
  const [batch, setBatch] = useState<Batch | null>(null)
  const [result, setResult] = useState<BatchResult | null>(null)
  const shots = useRef<{ name: string; file: string; agent: string; data: Blob }[]>([])
  const failed = useRef<string[]>([])
  const stopped = useRef(false)

  const onShot = useCallback(async (el: HTMLElement) => {
    if (!batch) return
    const row = batch.rows[batch.i]
    try {
      const data = await capturePng(el, 'shoot-rmd')
      const n = String(batch.i + 1).padStart(String(batch.rows.length).length, '0')
      const file = `${n} ${clean(row.rm)} - ${clean(row.region)}.png`
      shots.current.push({ name: `${batch.folder}/${file}`, file, agent: row.region, data })
    } catch {
      failed.current.push(row.rm)
    }
    if (stopped.current) return
    if (batch.i + 1 < batch.rows.length) {
      setBatch({ ...batch, i: batch.i + 1 })
      return
    }
    const done = shots.current
    shots.current = []
    const zip = `${batch.folder}.zip`
    /* sending: the pictures per agent, in sheet order — each agent has its own
       group — and no ZIP; downloading: the ZIP and nothing else */
    const groups = batch.send ? [...done.reduce((m, x) => {
      m.set(x.agent, [...(m.get(x.agent) ?? []), new File([x.data], x.file, { type: 'image/png' })])
      return m
    }, new Map<string, File[]>())].map(([agent, files]) => ({ agent, files })) : undefined
    const base = { ok: done.length, failed: [...failed.current], zip: done.length && !batch.send ? zip : '', groups }
    try {
      if (done.length && !batch.send) saveBlob(await zipStore(done), zip)
      setResult(base)
    } catch (ex) {
      setResult({ ...base, ok: 0, zip: '', error: (ex as Error).message })
    }
    setBatch(null)
  }, [batch, setResult])

  const stopBatch = useCallback(() => {
    stopped.current = true
    shots.current = []
    setBatch(null)
    setResult({ ok: 0, failed: [], zip: '', cancelled: true })
  }, [setResult])

  const closeBatch = useCallback(() => {
    setBatchOpen(false)
    setResult(null)
  }, [setBatchOpen, setResult])

  if (!rep) return null

  const head: RmRow | null = region ? rep.regionTotals[region] ?? null : rep.total
  const scope = region ? `${region}` : 'Jawa-Bali'
  const cmpLabel = period === 'harian' ? 'vs H-1' : period === 'mingguan' ? 'vs minggu lalu' : ''
  const anyFilter = !!(q || region || status || sort !== 'sheet')
  const reset = () => { setQ(''); setRegion(''); setStatus(''); setSort('sheet') }
  const periodName = RM_PERIODS.find((p) => p.id === period)?.label ?? ''

  const startBatch = (keys: string[], send: boolean) => {
    if (!period || !keys.length || batch) return
    const pick = new Set(keys)
    const rows = rep.rows.filter((r) => pick.has(r.key))
    /* the folder says what is in it: the whole region set, one region, or a pick */
    const regs = [...new Set(rows.map((r) => r.region))]
    const what = rows.length === rep.rows.length ? 'Jawa-Bali'
      : regs.length === 1 && rows.length === rep.rows.filter((r) => r.region === regs[0]).length ? regs[0]
      : `${rows.length} RM`
    shots.current = []
    failed.current = []
    stopped.current = false
    setResult(null)
    setOpenKey(null)
    setBatch({ rows, i: 0, period, send, folder: clean(`Pencapaian RM ${what} ${periodName} ${rep.periodLabel}`) })
  }

  return (
    <div className="dpsection rmsection">
      <div className="dphead">
        <span className="partnum">{part}</span>
        <span className="dptitles">
          <h2>Pencapaian RM <Zh>RM达成率</Zh></h2>
          <span className="partsub">
            Per regional manager, dari DP/CP yang di-handle — {scope}
            <Zh>{region ? agentZh(region) : ''}</Zh> · {rep.periodLabel}
            {rep.prevLabel && <> · dibanding {rep.prevLabel}</>}
          </span>
        </span>
        <span className="dpday">
          <em>sumber: sheet “{rep.sheet}”</em>
          {inds.some((i) => i.id === 'retur') && <> · Retur dihitung dari sheet “Display Retur”</>}
        </span>
      </div>

      <div className="panel rmbar">
        <div className="dpfilters">
          <div className="seg" role="group" aria-label="Periode">
            {periods.map((p) => (
              <button key={p.id} className={p.id === period ? 'on' : ''} onClick={() => setPeriod(p.id)}
                      aria-pressed={p.id === period}>
                {p.label}
              </button>
            ))}
          </div>
          <span className="rmperiod" title="Periode data yang ditampilkan">
            <BtnIcon name="calendar" />{rep.periodLabel}
          </span>
          <div className="dpsearchbox">
            <input
              type="text" placeholder="Cari nama RM…" value={q}
              onChange={(e) => setQ(e.target.value)} aria-label="Cari nama RM"
            />
            {q && (
              <button type="button" className="dpsearchx" onClick={() => setQ('')}
                      title="Hapus kata kunci" aria-label="Hapus kata kunci">×</button>
            )}
          </div>
          <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Regional">
            <option value="">Semua Regional ({rep.rows.length} RM)</option>
            {rep.regions.map((r) => (
              <option key={r} value={r}>{r} ({rep.rows.filter((x) => x.region === r).length} RM)</option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusKey)} aria-label="Status">
            <option value="">Semua status</option>
            {(['ok', 'warn', 'bad'] as const).map((s) => (
              <option key={s} value={s}>{VERDICT_LABEL[s]} ({counts[s]})</option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Urutan">
            <option value="sheet">Urut: per regional</option>
            <option value="name">Urut: nama A–Z</option>
            <option value="best">Urut: KPI tercapai terbanyak</option>
            <option value="worst">Urut: KPI tercapai tersedikit</option>
          </select>
          {anyFilter && (
            <button className="btn tiny act act-clear" onClick={reset}>
              <BtnIcon name="clear" />
              <span>Reset filter</span>
            </button>
          )}
          <button
            className="btn tiny act act-png rmbatch-btn"
            onClick={() => { setResult(null); setBatchOpen(true) }}
            title={region
              ? `Pilih RM ${region} lalu simpan detail masing-masing sebagai PNG, satu folder dalam file ZIP`
              : 'Pilih agen dan RM lalu simpan detail masing-masing sebagai PNG, satu folder dalam file ZIP'}
          >
            <BtnIcon name="image" />
            <span>{region ? `Unduh RM ${region}` : 'Unduh semua RM'}</span>
          </button>
        </div>
      </div>

      {/* The headline: the region's (or Jawa-Bali's) own figure per indicator,
          as the sheet prints it on its total rows. */}
      <div className="rmstats">
        <div className="rmstat total">
          <span className="rms-lab">Total RM<Zh>区域经理总数</Zh></span>
          <span className="rms-val">{inRegion.length}</span>
          <span className="rms-sub">
            <b className="okc">{counts.ok}</b> semua KPI · <b className="warnc">{counts.warn}</b> sebagian ·{' '}
            <b className="badc">{counts.bad}</b> di bawah
          </span>
        </div>
        {inds.map((ind) => {
          const f: RmFigure = head?.vals[ind.id] ?? { cur: null, prev: null, delta: null }
          const t = toneOf(ind, f.cur)
          const met = inRegion.filter((r) => toneOf(ind, r.vals[ind.id]?.cur ?? null) === 'ok').length
          const judged = inRegion.filter((r) => toneOf(ind, r.vals[ind.id]?.cur ?? null) !== 'na').length
          return (
            <div className={`rmstat ${t}`} key={ind.id}>
              <span className="rms-lab">{ind.label}<Zh>{ind.zh}</Zh></span>
              <span className="rms-main">
                <span className="rms-val">{fmt(f.cur)}</span>
                {f.delta != null && (
                  <span className={`rms-delta ${deltaCls(ind, f.delta)}`} title={`${cmpLabel}, poin persentase`}>
                    {fmtPp(f.delta)}
                  </span>
                )}
              </span>
              <span className="rms-sub">
                Target {ind.lowerBetter ? '≤' : '≥'} {fmt(ind.target)} · {met}/{judged} RM sesuai
              </span>
            </div>
          )
        })}
      </div>

      <div className="rmcount">
        Menampilkan <b>{shown.length}</b> dari {inRegion.length} RM
        {needle && <> · pencarian “{q.trim()}”</>}
        <span className="rmlegend">
          <span><i className="ok" />Semua KPI sesuai</span>
          <span><i className="warn" />Sebagian besar sesuai</span>
          <span><i className="bad" />Mayoritas di bawah target</span>
        </span>
      </div>

      {shown.length ? (
        <div className="rmgrid">
          {shown.map(({ row, met, of, verdict }) => (
            <article
              className={`rmcard v-${verdict}`} key={row.key}
              role="button" tabIndex={0} aria-haspopup="dialog"
              aria-label={`Lihat detail ${row.rm}`}
              onClick={() => setOpenKey(row.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenKey(row.key) }
              }}
            >
              <header className="rmc-head">
                <span className={`rmc-dot v-${verdict}`} aria-hidden="true" />
                <span className="rmc-id">
                  <span className="rmc-name"><Hit text={row.rm} q={needle} /></span>
                  <span className="rmc-reg">
                    {row.region}<Zh>{agentZh(row.region)}</Zh>
                    {row.sites != null && <> · {row.sites} DP/CP</>}
                  </span>
                </span>
              </header>
              <dl className="rmc-list">
                {inds.map((ind) => {
                  const f = row.vals[ind.id]
                  const t: RmTone = toneOf(ind, f?.cur ?? null)
                  return (
                    <div className="rmc-row" key={ind.id}
                         title={`${ind.label} · Target ${ind.lowerBetter ? '≤' : '≥'} ${fmt(ind.target)}`
                           + (f?.prev != null ? ` · sebelumnya ${fmt(f.prev)}` : '')}>
                      <dt>{ind.short}</dt>
                      <dd>
                        <span className={`rmc-val ${t}`}>{fmt(f?.cur ?? null)}</span>
                        {f?.delta != null && (
                          <span className={`rmc-delta ${deltaCls(ind, f.delta)}`}>{fmtPp(f.delta)}</span>
                        )}
                      </dd>
                    </div>
                  )
                })}
              </dl>
              <footer className={`rmc-foot v-${verdict}`}>
                <span>{of ? <><b>{met} / {of}</b> KPI sesuai target</> : 'Tidak ada data periode ini'}</span>
                <span className="rmc-more" aria-hidden="true">Detail ›</span>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <div className="dropzone rmempty">
          <h2>Tidak ada RM yang cocok <Zh>无匹配结果</Zh></h2>
          <p>
            {needle ? <>Tidak ada nama RM yang memuat “{q.trim()}”</> : 'Tidak ada RM untuk filter ini'}
            {region && <> di {region}</>}.
          </p>
          <button className="btn primary" onClick={reset}>Reset filter</button>
        </div>
      )}

      {/* Behind the dialog's opaque cover while it runs: each picked RM's
          pop-out, opened one at a time to be photographed. `offstage` keeps it
          from taking focus or the keyboard away from the dialog. */}
      {batch && (
        <RmDetail
          key={batch.rows[batch.i].key}
          rowKey={batch.rows[batch.i].key} reports={reports} initialPeriod={batch.period}
          dpTabs={dpTabs} onNeedDps={onNeedDps} onClose={stopBatch} onAutoShot={onShot} offstage
        />
      )}
      {batchOpen && (
        <RmBatchDialog
          rows={inRegion} scope={region} inds={inds} periodName={periodName} periodLabel={rep.periodLabel}
          progress={batch ? { i: batch.i, n: batch.rows.length, rm: batch.rows[batch.i].rm } : null}
          result={result} onStart={startBatch} onStop={stopBatch} onClose={closeBatch}
        />
      )}

      {openKey && period && !batch && (
        <RmDetail
          rowKey={openKey} reports={reports} initialPeriod={period}
          dpTabs={dpTabs} onNeedDps={onNeedDps} onClose={closeDetail}
        />
      )}
    </div>
  )
}
