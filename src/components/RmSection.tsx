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
import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { agentZh } from '../lib/jnt'
import { RM_PERIODS, scoreOf, toneOf, verdictOf } from '../lib/rm'
import type { RmFigure, RmIndicator, RmPeriod, RmReport, RmRow, RmTone, RmVerdict } from '../lib/rm'
import type { DisplayId, DisplayReport } from '../lib/display'
import BtnIcon from './BtnIcon'
import RmDetail from './RmDetail'
import Zh from './Zh'

type SortKey = 'sheet' | 'name' | 'best' | 'worst'
type StatusKey = '' | 'ok' | 'warn' | 'bad'

const VERDICT_LABEL: Record<Exclude<StatusKey, ''>, string> = {
  ok: 'Semua KPI sesuai target',
  warn: 'Sebagian besar sesuai',
  bad: 'Mayoritas di bawah target',
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

  if (!rep) return null

  const head: RmRow | null = region ? rep.regionTotals[region] ?? null : rep.total
  const scope = region ? `${region}` : 'Jawa-Bali'
  const cmpLabel = period === 'harian' ? 'vs H-1' : period === 'mingguan' ? 'vs minggu lalu' : ''
  const anyFilter = !!(q || region || status || sort !== 'sheet')
  const reset = () => { setQ(''); setRegion(''); setStatus(''); setSort('sheet') }

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

      {openKey && period && (
        <RmDetail
          rowKey={openKey} reports={reports} initialPeriod={period}
          dpTabs={dpTabs} onNeedDps={onNeedDps} onClose={closeDetail}
        />
      )}
    </div>
  )
}
