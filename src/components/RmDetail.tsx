/**
 * The detail pop-out for one RM, opened from a card on Pencapaian RM.
 *
 * Top to bottom, it answers three questions in the order someone asks them:
 *
 *   1. How is this RM doing?        all three periods side by side, per
 *                                   indicator, with the daily tab's 3-day trend
 *   2. Which sites are the problem?  for every indicator the RM misses, the three
 *                                   drop points furthest from target
 *   3. And the rest of the sites?    the full DP list, one period at a time
 *
 * The drop-point figures come from the Display tabs (see `rmDpLines`), which are
 * read the first time any pop-out is opened; the summary above them needs only
 * the RM tabs and shows at once.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { agentZh } from '../lib/jnt'
import { RM_PERIODS, dpColumnOf, dpScoreOf, rmDpLines, scoreOf, toneOf, verdictOf } from '../lib/rm'
import type { RmDpLine, RmIndicator, RmPeriod, RmReport, RmRow } from '../lib/rm'
import type { DisplayId, DisplayReport } from '../lib/display'
import BtnIcon from './BtnIcon'
import Zh from './Zh'

const WORST_N = 3

type DpFilter = '' | 'bad' | 'ok'
type SortDir = 'asc' | 'desc'
const COL_DP = '__dp__'
const COL_SCORE = '__score__'

const fmt = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(2)}%`)
const GE = (ind: RmIndicator) => (ind.lowerBetter ? '≤' : '≥')

/** Worse first, whichever direction "worse" is for the indicator. */
const worseFirst = (ind: RmIndicator) => (a: number, b: number) => (ind.lowerBetter ? b - a : a - b)

/**
 * Three days as a line, with the target drawn across it — the point of a trend
 * here is whether it is heading toward the line or away from it.
 */
function Trend({ ind, values, labels }: { ind: RmIndicator; values: (number | null)[]; labels: string[] }) {
  const real = values.filter((v): v is number => v != null)
  if (real.length < 2) return <span className="rmd-notrend">—</span>
  const W = 104, H = 34, PX = 6, PY = 6
  const pool = ind.target != null ? [...real, ind.target] : real
  let lo = Math.min(...pool), hi = Math.max(...pool)
  if (hi - lo < 1e-9) { lo -= 1; hi += 1 }
  const pad = (hi - lo) * 0.12
  lo -= pad; hi += pad
  const x = (i: number) => PX + (values.length === 1 ? (W - 2 * PX) / 2 : (i * (W - 2 * PX)) / (values.length - 1))
  const y = (v: number) => PY + ((hi - v) / (hi - lo)) * (H - 2 * PY)
  const pts = values.map((v, i) => (v == null ? null : [x(i), y(v)] as const))
  const line = pts.filter((p): p is readonly [number, number] => p != null).map((p) => p.join(',')).join(' ')
  return (
    <svg className="rmd-trend" viewBox={`0 0 ${W} ${H}`} role="img"
         aria-label={`Tren ${ind.label}: ${values.map((v, i) => `${labels[i] ?? ''} ${fmt(v)}`).join(', ')}`}>
      {ind.target != null && (
        <line className="rmd-trend-tgt" x1={PX} x2={W - PX} y1={y(ind.target)} y2={y(ind.target)} />
      )}
      <polyline className="rmd-trend-line" points={line} />
      {pts.map((p, i) => p && (
        <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 3.4 : 2.4}
                className={`rmd-trend-dot ${toneOf(ind, values[i])}`}>
          <title>{`${labels[i] ?? ''}: ${fmt(values[i])}`}</title>
        </circle>
      ))}
    </svg>
  )
}

export default function RmDetail({
  rowKey, reports, initialPeriod, dpTabs, onNeedDps, onClose,
}: {
  /** the RM, by the key its rows share across the three tabs */
  rowKey: string
  reports: Partial<Record<RmPeriod, RmReport>>
  /** the period the page was showing — the DP list opens on it */
  initialPeriod: RmPeriod
  /** the Display tabs: undefined while not yet read, null when they could not be */
  dpTabs: Partial<Record<DisplayId, DisplayReport>> | null | undefined
  onNeedDps: () => void
  onClose: () => void
}) {
  const periods = RM_PERIODS.filter((p) => reports[p.id])
  const [period, setPeriod] = useState<RmPeriod>(initialPeriod)
  const rep = reports[period] ?? reports[periods[0].id]!

  /* The same RM in each tab. */
  const byPeriod = useMemo(() => {
    const out: Partial<Record<RmPeriod, RmRow>> = {}
    for (const p of periods) out[p.id] = reports[p.id]!.rows.find((r) => r.key === rowKey)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports, rowKey])
  const row = byPeriod[period] ?? Object.values(byPeriod).find(Boolean)!
  const daily = reports.harian
  const inds = rep.indicators

  /* ------------------------------------------------ open, close, focus */

  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (dpTabs === undefined) onNeedDps() }, [dpTabs, onNeedDps])
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    boxRef.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      /* keep Tab inside the pop-out while it is open */
      if (e.key !== 'Tab' || !boxRef.current) return
      const f = [...boxRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input,select,[tabindex]:not([tabindex="-1"])')]
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === boxRef.current)) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('keydown', key)
      document.body.style.overflow = prev
      back?.focus()
    }
  }, [onClose])

  /* ------------------------------------------------ drop points */

  const lines = useMemo(
    () => (dpTabs ? rmDpLines(row, period, dpTabs) : []),
    [dpTabs, row, period],
  )
  /* an indicator the Display tabs carry no per-DP figure for in this period —
     Keluar 07:30 has no weekly one */
  const noDp = useMemo(() => {
    const s = new Set<string>()
    if (!dpTabs) return s
    for (const i of inds) if (!dpColumnOf(i.id, period, dpTabs)) s.add(i.id)
    return s
  }, [dpTabs, inds, period])

  const scored = useMemo(() => lines.map((l) => ({ line: l, ...dpScoreOf(l, inds) })), [lines, inds])

  const worst = useMemo(() => inds
    .filter((i) => toneOf(i, row.vals[i.id]?.cur ?? null) === 'bad')
    .map((i) => ({
      ind: i,
      picks: lines
        .filter((l) => toneOf(i, l.vals[i.id] ?? null) === 'bad')
        .sort((a, b) => worseFirst(i)(a.vals[i.id]!, b.vals[i.id]!))
        .slice(0, WORST_N),
    })), [inds, lines, row])

  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<DpFilter>('')
  const [sortKey, setSortKey] = useState<string>(COL_SCORE)
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const needle = q.trim().toLowerCase()
  const shown = useMemo(() => {
    const list = scored.filter((x) =>
      (!needle || x.line.dp.toLowerCase().includes(needle))
      && (!filter || (filter === 'bad' ? x.met < x.of : x.of > 0 && x.met === x.of)))
    const dir = sortDir === 'asc' ? 1 : -1
    /* sites with no figure always sink, whichever way the column is sorted */
    const val = (x: typeof list[number]): number | string | null => {
      if (sortKey === COL_DP) return x.line.dp
      if (sortKey === COL_SCORE) return x.of ? x.met / x.of : null
      return x.line.vals[sortKey] ?? null
    }
    return list.sort((a, b) => {
      const va = val(a), vb = val(b)
      if (va == null && vb == null) return a.line.dp.localeCompare(b.line.dp)
      if (va == null) return 1
      if (vb == null) return -1
      const c = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number)
      return c * dir || a.line.dp.localeCompare(b.line.dp)
    })
  }, [scored, needle, filter, sortKey, sortDir])

  const sortOn = (k: string) => {
    if (k === sortKey) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir(k === COL_DP || k === COL_SCORE ? 'asc' : 'desc') }
  }
  const arrow = (k: string) => (k === sortKey ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '')
  const ariaSort = (k: string) => (k === sortKey ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none')

  /* ------------------------------------------------ render */

  const s = scoreOf(row, inds)
  const verdict = verdictOf(s.met, s.of)
  const periodName = RM_PERIODS.find((p) => p.id === period)!.label
  const badDps = scored.filter((x) => x.met < x.of).length
  const okDps = scored.filter((x) => x.of > 0 && x.met === x.of).length

  const dpBody = (() => {
    if (dpTabs === undefined) return <div className="rmd-wait">Memuat daftar DP/CP… <Zh>正在加载</Zh></div>
    if (dpTabs === null || !lines.length) {
      return (
        <div className="rmd-wait">
          {dpTabs === null
            ? 'Sheet Display tidak dapat dibaca, jadi daftar DP/CP tidak tersedia.'
            : 'Tidak ada DP/CP untuk RM ini di sheet Display.'}
        </div>
      )
    }
    return null
  })()

  return (
    <div className="rmd-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="rmd" role="dialog" aria-modal="true" aria-labelledby="rmd-title" ref={boxRef} tabIndex={-1}>
        <header className="rmd-head">
          <span className="rmd-id">
            <h2 id="rmd-title">{row.rm}</h2>
            <span className="rmd-sub">
              {row.region}<Zh>{agentZh(row.region)}</Zh>
              {row.sites != null && <> · {row.sites} DP/CP</>}
              {' '}· {periodName} {rep.periodLabel}
            </span>
          </span>
          <span className={`rmd-verdict v-${verdict}`}>
            {s.of ? <><b>{s.met} / {s.of}</b> KPI sesuai target</> : 'Tidak ada data'}
          </span>
          <button className="rmd-close" onClick={onClose} aria-label="Tutup detail" title="Tutup (Esc)">
            <BtnIcon name="close" />
          </button>
        </header>

        <div className="rmd-body">
          {/* 1 — every period at once */}
          <section className="rmd-sec">
            <h3 className="rmd-h">Pencapaian per periode <Zh>各周期达成率</Zh></h3>
            <div className="rmd-scroll">
              <table className="rmd-sum">
                <thead>
                  <tr>
                    <th className="l">Indikator</th>
                    {periods.map((p) => (
                      <th key={p.id} className={p.id === period ? 'cur' : ''}>
                        {p.label}<span className="rmd-th-sub">{reports[p.id]!.periodLabel}</span>
                      </th>
                    ))}
                    <th>Target</th>
                    {daily && (
                      <th className="trend">
                        Tren {daily.seriesLabels.length} hari
                        <span className="rmd-th-sub">{daily.seriesLabels[0]} – {daily.seriesLabels.at(-1)}</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {inds.map((ind) => (
                    <tr key={ind.id}>
                      <th className="l" scope="row">{ind.label}<Zh>{ind.zh}</Zh></th>
                      {periods.map((p) => {
                        const pi = reports[p.id]!.indicators.find((x) => x.id === ind.id) ?? ind
                        const v = byPeriod[p.id]?.vals[ind.id]?.cur ?? null
                        return (
                          <td key={p.id} className={`${toneOf(pi, v)}${p.id === period ? ' cur' : ''}`}>{fmt(v)}</td>
                        )
                      })}
                      <td className="tgt">{GE(ind)} {fmt(ind.target)}</td>
                      {daily && (
                        <td className="trend">
                          <Trend
                            ind={daily.indicators.find((x) => x.id === ind.id) ?? ind}
                            values={byPeriod.harian?.vals[ind.id]?.series ?? []}
                            labels={daily.seriesLabels}
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* the period the rest of the pop-out is about */}
          <div className="rmd-tabs dpfilters">
            <div className="seg" role="group" aria-label="Periode daftar DP/CP">
              {periods.map((p) => (
                <button key={p.id} className={p.id === period ? 'on' : ''} onClick={() => setPeriod(p.id)}
                        aria-pressed={p.id === period}>
                  {p.label}
                </button>
              ))}
            </div>
            <span className="rmperiod"><BtnIcon name="calendar" />{rep.periodLabel}</span>
          </div>

          {/* 2 — where it goes wrong */}
          <section className="rmd-sec">
            <h3 className="rmd-h">DP/CP terburuk per indikator <Zh>最差网点</Zh> · {periodName}</h3>
            {!worst.length ? (
              <div className="rmd-allok">Semua indikator RM ini sesuai target untuk periode {periodName.toLowerCase()}.</div>
            ) : dpBody ?? (
              <div className="rmd-worst">
                {worst.map(({ ind, picks }) => (
                  <div className="rmd-wcard" key={ind.id}>
                    <div className="rmd-wtitle">
                      <span>{ind.label}</span>
                      <span className="bad">{fmt(row.vals[ind.id]?.cur)}</span>
                    </div>
                    <div className="rmd-wtgt">Target {GE(ind)} {fmt(ind.target)}</div>
                    {noDp.has(ind.id) ? (
                      <div className="rmd-wnone">Tidak ada angka per DP/CP untuk periode ini.</div>
                    ) : picks.length ? (
                      <ol>
                        {picks.map((l: RmDpLine) => (
                          <li key={l.key}>
                            <span className="dp">{l.dp}</span>
                            <span className="bad">{fmt(l.vals[ind.id])}</span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <div className="rmd-wnone">Tidak ada DP/CP di bawah target.</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 3 — every site */}
          <section className="rmd-sec">
            <h3 className="rmd-h">
              Daftar DP/CP <Zh>网点清单</Zh> · {periodName}
              {!dpBody && <span className="rmd-hn"> — {shown.length} dari {lines.length}</span>}
            </h3>
            {dpBody ?? (
              <>
                <div className="dpfilters rmd-filters">
                  <div className="dpsearchbox">
                    <input type="text" placeholder="Cari DP/CP…" value={q}
                           onChange={(e) => setQ(e.target.value)} aria-label="Cari DP/CP" />
                    {q && (
                      <button type="button" className="dpsearchx" onClick={() => setQ('')}
                              title="Hapus kata kunci" aria-label="Hapus kata kunci">×</button>
                    )}
                  </div>
                  <select value={filter} onChange={(e) => setFilter(e.target.value as DpFilter)} aria-label="Status DP/CP">
                    <option value="">Semua DP/CP ({lines.length})</option>
                    <option value="bad">Ada KPI di bawah target ({badDps})</option>
                    <option value="ok">Semua KPI sesuai target ({okDps})</option>
                  </select>
                </div>
                <div className="rmd-scroll">
                  <table className="rmd-dp">
                    <thead>
                      <tr>
                        <th className="l" aria-sort={ariaSort(COL_DP)}>
                          <button onClick={() => sortOn(COL_DP)}>DP / CP{arrow(COL_DP)}</button>
                        </th>
                        {inds.map((i) => (
                          <th key={i.id} aria-sort={ariaSort(i.id)}
                              title={`${i.label} · Target ${GE(i)} ${fmt(i.target)}`
                                + (noDp.has(i.id) ? ' · tidak ada angka per DP/CP untuk periode ini' : '')}>
                            <button onClick={() => sortOn(i.id)}>{i.short}{noDp.has(i.id) ? '*' : ''}{arrow(i.id)}</button>
                          </th>
                        ))}
                        <th aria-sort={ariaSort(COL_SCORE)}>
                          <button onClick={() => sortOn(COL_SCORE)}>KPI{arrow(COL_SCORE)}</button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map(({ line, met, of }) => (
                        <tr key={line.key} className={of ? '' : 'idle'}>
                          <th className="l" scope="row">{line.dp}</th>
                          {inds.map((i) => {
                            const v = line.vals[i.id] ?? null
                            return <td key={i.id} className={toneOf(i, v)}>{fmt(v)}</td>
                          })}
                          <td>
                            {of
                              ? <span className={`rmd-chip v-${verdictOf(met, of)}`}>{met}/{of}</span>
                              : <span className="rmd-chip v-na">Tidak ada data</span>}
                          </td>
                        </tr>
                      ))}
                      {!shown.length && (
                        <tr><td className="rmd-empty" colSpan={inds.length + 2}>Tidak ada DP/CP yang cocok.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {noDp.size > 0 && (
                  <div className="rmd-foot">
                    * {inds.filter((i) => noDp.has(i.id)).map((i) => i.label).join(', ')}: sheet Display
                    tidak memuat angka per DP/CP untuk periode {periodName.toLowerCase()}.
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
