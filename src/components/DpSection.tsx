/**
 * Drop point / counter point level view.
 *
 * The agent tabs answer "how is TANGERANG doing?". These per-agent tabs answer
 * the follow-up — "*which* of its 108 drop points is dragging it down?" — so the
 * whole section is scoped to whichever agent the toolbar has selected, and
 * pools every drop point in the region when that selection is ALL AGENTS.
 *
 * Two rules from the operation shape everything below (see `dpStatusOf`):
 * sites with no sprinter are structurally zero on the delivery categories, and
 * closed sites are zero on all of them. Neither is underperforming, so neither
 * may appear in a top-five or worst-five list — they are kept in the table with
 * a badge instead, because "why is this one missing?" is a question the table
 * has to be able to answer.
 */
import { useMemo, useState } from 'react'
import {
  CANONICAL_ORDER, CATEGORY_ZH, DP_KIND_LABEL, SPRINTER_LABELS, dpStatusOf, dpTargetFor, dpValue,
  fmtDate, fmtDateFull,
} from '../lib/jnt'
import type { DateSlot, DpKind, DpRow, Kpi, Model } from '../lib/jnt'
import { BarChart, HBarChart } from './Charts'
import type { HBar } from './Charts'
import Zh from './Zh'

const TOP_N = 5

/** A drop point plus everything the view needs to have decided about it once. */
interface Scored {
  dp: DpRow
  kind: DpKind
  /** category label → reading on the resolved day */
  vals: Record<string, number | null>
  /** categories met, out of those with a reading */
  onTarget: number
  scored: number
}

type StatusFilter = 'all' | DpKind
type ValueMode = 'day' | 'mtd'
type SortDir = 'asc' | 'desc'

export default function DpSection({
  model, kpis, agentKey, agentLabel, day, wanted,
}: {
  model: Model
  /** the enabled KPIs, already in canonical display order */
  kpis: Kpi[]
  /** '' / 'TOTAL' means every agent */
  agentKey: string
  agentLabel: string
  /** the DP day resolved from the toolbar's report date */
  day: DateSlot
  /** the day the toolbar actually asked for — differs when the DP tabs are shorter */
  wanted: DateSlot | null
}) {
  const allAgents = !agentKey || agentKey === 'TOTAL'

  /* the three categories that carry a 90%-ish target and read the same way, so
     a single ranking chart over them is meaningful — plus whatever else the file
     turned out to contain */
  const catKpis = useMemo(
    () => kpis.filter((k) => CANONICAL_ORDER.includes(k.label)),
    [kpis],
  )
  const defaultCat = catKpis.find((k) => k.label === SPRINTER_LABELS[0]) ?? catKpis[0] ?? null

  const [topCat, setTopCat] = useState('')
  const [worstCat, setWorstCat] = useState('')
  const [tableCat, setTableCat] = useState('')

  // resolved rather than stored, so a newly loaded file falls back on its own
  const topK = catKpis.find((k) => k.label === topCat) ?? defaultCat
  const worstK = catKpis.find((k) => k.label === worstCat) ?? defaultCat
  const tableK = catKpis.find((k) => k.label === tableCat) ?? defaultCat

  /* -------------------------------------------------------------- scoring */

  const scored = useMemo<Scored[]>(() => {
    const pool = allAgents ? model.dps : model.dps.filter((d) => d.agentKey === agentKey)
    return pool.map((dp) => {
      const vals: Record<string, number | null> = {}
      let onTarget = 0, n = 0
      for (const k of catKpis) {
        const v = dpValue(dp, k.label, day.key)
        vals[k.label] = v
        if (v == null) continue
        n++
        const t = dpTargetFor(dp, k)
        if (k.lowerBetter ? v <= t : v >= t) onTarget++
      }
      return { dp, kind: dpStatusOf(dp, day.key), vals, onTarget, scored: n }
    })
  }, [model.dps, allAgents, agentKey, catKpis, day.key])

  const active = useMemo(() => scored.filter((s) => s.kind === 'active'), [scored])
  const counts = useMemo(() => ({
    total: scored.length,
    active: active.length,
    pickup: scored.filter((s) => s.kind === 'pickup').length,
    closed: scored.filter((s) => s.kind === 'closed').length,
  }), [scored, active])

  /** Ranked, excluding pickup-only and closed sites entirely. */
  const rank = (k: Kpi | null, worst: boolean): HBar[] => {
    if (!k) return []
    const rows = active
      .map((s) => ({ s, v: s.vals[k.label] }))
      .filter((o): o is { s: Scored; v: number } => o.v != null)
    // "worst" means furthest from meeting the target, which flips for RETUR
    const best = (a: number, b: number) => (k.lowerBetter ? a - b : b - a)
    rows.sort((x, y) => (worst ? best(y.v, x.v) : best(x.v, y.v)))
    return rows.slice(0, TOP_N).map((o) => ({
      name: o.s.dp.label,
      sub: allAgents ? o.s.dp.agentLabel : undefined,
      value: o.v,
    }))
  }

  const topBars = useMemo(() => rank(topK, false), [active, topK, allAgents])
  const worstBars = useMemo(() => rank(worstK, true), [active, worstK, allAgents])

  /* below-target count per agent, for the region-wide view */
  const byAgent = useMemo(() => {
    if (!tableK) return { values: [] as (number | null)[], labels: [] as { top: string; sub?: string }[] }
    const acc = new Map<string, { label: string; bad: number; tot: number }>()
    for (const s of active) {
      const v = s.vals[tableK.label]
      if (v == null) continue
      const e = acc.get(s.dp.agentKey) ?? { label: s.dp.agentLabel, bad: 0, tot: 0 }
      e.tot++
      const t = dpTargetFor(s.dp, tableK)
      if (!(tableK.lowerBetter ? v <= t : v >= t)) e.bad++
      acc.set(s.dp.agentKey, e)
    }
    const list = [...acc.values()].sort((a, b) => b.bad - a.bad)
    return {
      values: list.map((e) => e.bad),
      labels: list.map((e) => ({ top: e.label, sub: `of ${e.tot}` })),
    }
  }, [active, tableK])

  /* ---------------------------------------------------------- table state */

  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [type, setType] = useState<'all' | 'dp' | 'cp'>('all')
  const [onlyBelow, setOnlyBelow] = useState(false)
  const [mode, setMode] = useState<ValueMode>('day')
  const [sortKey, setSortKey] = useState('__name__')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [showAll, setShowAll] = useState(false)

  const cell = (s: Scored, k: Kpi): number | null =>
    mode === 'mtd' ? (s.dp.vals[k.label]?.mtd ?? null) : s.vals[k.label]

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let out = scored.filter((s) => {
      if (status !== 'all' && s.kind !== status) return false
      if (type === 'cp' && !s.dp.isCp) return false
      if (type === 'dp' && s.dp.isCp) return false
      if (needle && !`${s.dp.label} ${s.dp.agentLabel}`.toLowerCase().includes(needle)) return false
      if (onlyBelow && tableK) {
        const v = cell(s, tableK)
        if (v == null) return false
        const t = dpTargetFor(s.dp, tableK)
        if (tableK.lowerBetter ? v <= t : v >= t) return false
      }
      return true
    })

    const dir = sortDir === 'asc' ? 1 : -1
    out = [...out].sort((a, b) => {
      if (sortKey === '__name__') return dir * a.dp.label.localeCompare(b.dp.label)
      if (sortKey === '__agent__') return dir * a.dp.agentLabel.localeCompare(b.dp.agentLabel)
      if (sortKey === '__status__') return dir * a.kind.localeCompare(b.kind)
      if (sortKey === '__ontarget__') return dir * (a.onTarget - b.onTarget)
      const k = catKpis.find((x) => x.label === sortKey)
      if (!k) return 0
      const av = cell(a, k), bv = cell(b, k)
      // rows with no reading always sink, whichever way the column is sorted
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return dir * (av - bv)
    })
    return out
  }, [scored, q, status, type, onlyBelow, tableK, sortKey, sortDir, mode, catKpis])

  const shown = showAll ? filtered : filtered.slice(0, 40)

  const sortOn = (key: string) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === '__name__' || key === '__agent__' ? 'asc' : 'desc') }
  }
  const arrow = (key: string) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '')

  const exportCsv = () => {
    /* the export keeps the workbook's bilingual habit, so the CSV can be pasted
       back beside the source data without anyone having to re-map the columns */
    const head = [
      'DP/CP 网点', 'Agen 代理区', 'Jenis 类型', 'Status 状态',
      ...catKpis.map((k) => `${k.label}${CATEGORY_ZH[k.label] ? ` ${CATEGORY_ZH[k.label]}` : ''}`),
      'Sesuai target 达标数',
    ]
    const esc = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
    const lines = [head.map(esc).join(',')]
    for (const s of filtered) {
      lines.push([
        esc(s.dp.label), esc(s.dp.agentLabel), s.dp.isCp ? 'CP' : 'DP', DP_KIND_LABEL[s.kind],
        ...catKpis.map((k) => { const v = cell(s, k); return v == null ? '' : v.toFixed(2) }),
        `${s.onTarget}/${s.scored}`,
      ].join(','))
    }
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `dp-cp-${day.date ? day.date.toISOString().slice(0, 10) : 'list'}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  /* --------------------------------------------------------------- render */

  if (!model.dps.length) return null

  const scope = allAgents ? `SEMUA AGEN · ${model.rows.length} agen` : agentLabel
  const dayLabel = day.date ? fmtDateFull(day.date) : 'hari terakhir'

  /* a plain function, not a nested component: React would remount a component
     declared inside render on every keystroke and the select would lose focus */
  const catSelect = (value: Kpi | null, onChange: (v: string) => void, id: string) => (
    <select
      className="hsel" value={value ? value.label : ''} aria-label={`Kategori yang ditampilkan pada ${id}`}
      onChange={(e) => onChange(e.target.value)}
    >
      {catKpis.map((k) => <option key={k.label} value={k.label}>{k.label}</option>)}
    </select>
  )

  return (
    <div className="dpsection">
      <div className="dphead">
        <h2>Performa DP / CP <Zh>网点绩效</Zh> — <b>{scope}</b></h2>
        <span className="dpday">
          {dayLabel}
          {wanted && wanted.key !== day.key && (
            <em>
              {' '}· tab per agen tidak memuat{' '}
              {wanted.date ? fmtDateFull(wanted.date) : 'tanggal tersebut'} — menampilkan hari terdekat
              yang tersedia
            </em>
          )}
        </span>
      </div>

      <div className="dpstats">
        <Stat n={counts.total} lab="Total DP / CP" zh="网点总数" />
        <Stat n={counts.active} lab="Aktif (masuk peringkat)" zh="运营中" tone="good" />
        <Stat n={counts.pickup} lab="Pickup saja" zh="仅揽收" tone="warn"
              hint="Tidak ada sprinter di sini — 06:30, 07:30 dan 12:00 semuanya nol, sehingga dikeluarkan dari peringkat." />
        <Stat n={counts.closed} lab="Tutup" zh="已关闭" tone="mute"
              hint="Semua kategori bernilai nol. Dikeluarkan dari peringkat." />
        <Stat
          n={tableK ? active.filter((s) => { const v = s.vals[tableK.label]; if (v == null) return false; const t = dpTargetFor(s.dp, tableK); return tableK.lowerBetter ? v > t : v < t }).length : 0}
          lab={tableK ? `Di bawah target · ${tableK.label}` : 'Di bawah target'}
          zh="未达标"
          tone="bad"
        />
      </div>

      <div className="row-dp">
        <div className="panel">
          <h3>
            <span className="ptitle">🏆 {TOP_N} DP / CP Terbaik <Zh>前五名网点</Zh></span>
            {catSelect(topK, setTopCat, 'grafik lima terbaik')}
          </h3>
          <div className="body">
            <HBarChart
              bars={topBars}
              targetLine={topK ? dpTargetFor(scored[0]?.dp ?? model.dps[0], topK) : null}
              lowerBetter={topK?.lowerBetter}
            />
          </div>
        </div>

        <div className="panel">
          <h3>
            <span className="ptitle">⚠️ {TOP_N} DP / CP Terburuk <Zh>后五名网点</Zh></span>
            {catSelect(worstK, setWorstCat, 'grafik lima terburuk')}
          </h3>
          <div className="body">
            <HBarChart
              bars={worstBars}
              targetLine={worstK ? dpTargetFor(scored[0]?.dp ?? model.dps[0], worstK) : null}
              lowerBetter={worstK?.lowerBetter}
            />
          </div>
        </div>
      </div>

      {allAgents && byAgent.values.length > 1 && (
        <div className="row-trend">
          <div className="panel">
            <h3>
              <span className="ptitle">DP / CP di Bawah Target per Agen <Zh>各代理区未达标网点</Zh></span>
              {catSelect(tableK, setTableCat, 'grafik per agen')}
            </h3>
            <div className="body">
              <BarChart values={byAgent.values} labels={byAgent.labels} w={1100} h={260} />
            </div>
          </div>
        </div>
      )}

      <div className="panel dptable">
        <h3>
          <span className="ptitle">
            Daftar DP / CP <Zh>网点清单</Zh> — {filtered.length} dari {counts.total}
          </span>
          <button className="btn tiny" onClick={exportCsv}>Ekspor CSV</button>
        </h3>

        <div className="dpfilters">
          <input
            type="text" placeholder="Cari DP / CP atau agen…" value={q}
            onChange={(e) => setQ(e.target.value)} aria-label="Cari drop point"
          />
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Filter status">
            <option value="all">Semua status</option>
            <option value="active">Aktif saja</option>
            <option value="pickup">Pickup saja</option>
            <option value="closed">Tutup</option>
          </select>
          <select value={type} onChange={(e) => setType(e.target.value as 'all' | 'dp' | 'cp')} aria-label="Filter jenis">
            <option value="all">DP dan CP</option>
            <option value="dp">Drop point</option>
            <option value="cp">Counter point</option>
          </select>
          <select
            value={tableK ? tableK.label : ''} onChange={(e) => setTableCat(e.target.value)}
            aria-label="Kategori yang dipakai filter di bawah target"
          >
            {catKpis.map((k) => <option key={k.label} value={k.label}>{k.label}</option>)}
          </select>
          <label className="chk">
            <input type="checkbox" checked={onlyBelow} onChange={(e) => setOnlyBelow(e.target.checked)} />
            Hanya di bawah target
          </label>
          <div className="seg">
            <button className={mode === 'day' ? 'on' : ''} onClick={() => setMode('day')}>
              {day.date ? fmtDate(day.date) : 'Harian'}
            </button>
            <button className={mode === 'mtd' ? 'on' : ''} onClick={() => setMode('mtd')}>Bulanan</button>
          </div>
        </div>

        <div className="body" style={{ padding: 0 }}>
          <div className="dpscroll">
            <table className="dpgrid">
              <thead>
                <tr>
                  <th className="sticky" onClick={() => sortOn('__name__')}>
                    DP / CP{arrow('__name__')}<Zh>网点</Zh>
                  </th>
                  {allAgents && (
                    <th onClick={() => sortOn('__agent__')}>Agen{arrow('__agent__')}<Zh>代理区</Zh></th>
                  )}
                  <th onClick={() => sortOn('__status__')}>Status{arrow('__status__')}<Zh>状态</Zh></th>
                  {catKpis.map((k) => (
                    <th key={k.label} className="num cat" onClick={() => sortOn(k.label)} title={k.label}>
                      {k.label}{arrow(k.label)}<Zh>{CATEGORY_ZH[k.label] ?? ''}</Zh>
                    </th>
                  ))}
                  <th className="num" onClick={() => sortOn('__ontarget__')}>
                    Sesuai target{arrow('__ontarget__')}<Zh>达标数</Zh>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.dp.key} className={`k-${s.kind}`}>
                    <td className="sticky dpname">
                      <span className={`ptag ${s.dp.isCp ? 'cp' : 'dp'}`}>{s.dp.isCp ? 'CP' : 'DP'}</span>
                      {s.dp.label}
                    </td>
                    {allAgents && <td className="muted">{s.dp.agentLabel}</td>}
                    <td>
                      <span className={`sbadge ${s.kind}`}>{DP_KIND_LABEL[s.kind]}</span>
                    </td>
                    {catKpis.map((k) => {
                      const v = cell(s, k)
                      if (v == null) return <td key={k.label} className="num muted">—</td>
                      const t = dpTargetFor(s.dp, k)
                      const ok = k.lowerBetter ? v <= t : v >= t
                      /* pickup-only and closed sites are grey, not red: their
                         zeros are structural, and colouring them as failures is
                         exactly the false alarm this section exists to remove */
                      const cls = s.kind === 'active' ? (ok ? 'hm ok' : 'hm bad') : 'hm off'
                      return (
                        <td key={k.label} className={`num ${cls}`} title={`${k.label} · target ${k.lowerBetter ? '≤' : '≥'} ${t.toFixed(2)}%`}>
                          {v.toFixed(2)}
                        </td>
                      )
                    })}
                    <td className="num">
                      {s.kind === 'active' ? <b>{s.onTarget}/{s.scored}</b> : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
                {!shown.length && (
                  <tr><td colSpan={catKpis.length + (allAgents ? 4 : 3)} className="ctr muted" style={{ padding: 24 }}>
                    Tidak ada yang cocok dengan filter ini.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {filtered.length > 40 && (
            <div className="dpmore">
              <button className="btn" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Tampilkan 40 pertama' : `Tampilkan semua ${filtered.length}`}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="note">
        Nilai yang ditampilkan: {mode === 'mtd' ? 'pencapaian bulanan' : dayLabel}. DP/CP yang bernilai nol
        pada 06:30, 07:30 dan 12:00 berarti tidak memiliki sprinter — statusnya pickup saja, dan tidak
        dimasukkan ke dalam lima terbaik maupun lima terburuk. DP/CP yang bernilai nol pada semua kategori
        dianggap sudah tutup. Keduanya tetap muncul di daftar di atas agar tidak ada yang hilang diam-diam.
      </div>
    </div>
  )
}

function Stat({ n, lab, zh, tone = '', hint }: {
  n: number; lab: string; zh: string; tone?: string; hint?: string
}) {
  return (
    <div className={`dpstat ${tone}`} title={hint}>
      <span className="n">{n}</span>
      <span className="l">{lab}<Zh>{zh}</Zh></span>
    </div>
  )
}
