/**
 * Drop point / collection point level view.
 *
 * The agent tabs answer "how is TANGERANG doing?". These per-agent tabs answer
 * the follow-up — "*which* of its 108 drop points is dragging it down?" — so the
 * whole section is scoped to whichever agent the toolbar has selected, and
 * pools every drop point in the region when that selection is ALL AGENTS.
 *
 * What each site actually runs shapes everything below (see `dpStatusOf`):
 * a pickup-only site is structurally zero on the delivery categories, a
 * delivery-only site is structurally zero on the handover that feeds pickup,
 * and a closed site is zero on all of them. None of those zeros is
 * underperformance, so pickup-only and closed sites may not appear in a
 * top-five or worst-five list — they are kept in the table with a badge
 * instead, because "why is this one missing?" is a question the table has to be
 * able to answer.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  BIZ_MODEL_LABEL, BIZ_MODEL_TAG, CANONICAL_ORDER, CATEGORY_ZH, DP_KIND_LABEL, DP_KIND_ZH,
  SPRINTER_LABELS, agentFull, agentZh, dpStatusOf, dpTargetFor, dpValue, exportPng, fmtDate,
  fmtDateFull, isRankable, isoDay, sectionOf,
} from '../lib/jnt'
import type { BizModel, DateSlot, DpKind, DpRow, Kpi, Model } from '../lib/jnt'
import { BarChart, HBarChart } from './Charts'
import type { HBar } from './Charts'
import Zh from './Zh'

const TOP_N = 5

/**
 * Sentinel category: rank on how many of the eight KPIs the site met, rather
 * than on one KPI's percentage. Not a `Kpi`, so it lives in the dropdown's value
 * space instead — no real category can collide with it.
 */
const TOTAL_CAT = '__total__'

/** Sort order for the Status column — by how much of the operation runs, so the
 *  column reads as a scale instead of alphabetically (both, closed, delivery…). */
const KIND_RANK: Record<DpKind, number> = { both: 0, delivery: 1, pickup: 2, closed: 3 }

/** A drop point plus everything the view needs to have decided about it once. */
interface Scored {
  dp: DpRow
  kind: DpKind
  /** category label → reading on the resolved day */
  vals: Record<string, number | null>
  /** categories met, out of those with a reading */
  onTarget: number
  scored: number
  /**
   * Total distance from target across the scored categories, signed so positive
   * is good (`v - target`, flipped for RETUR). Only a tiebreak: on a count of
   * eight, ties are the rule rather than the exception, and without it "worst
   * five" would be five arbitrary sites out of the twenty that all missed three.
   */
  margin: number
}

type StatusFilter = 'all' | DpKind
type ValueMode = 'day' | 'mtd'
type SortDir = 'asc' | 'desc'

export default function DpSection({
  model, kpis, agentKey, agentLabel, day, wanted, onError,
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
  /** surfaced in the dashboard's own error banner rather than a second one here */
  onError: (msg: string) => void
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

  /**
   * `catKpis` split into contiguous runs, one per section, for the header band.
   *
   * Built by walking the columns rather than by filtering per section, so the
   * band can only ever describe the columns actually underneath it. Filtering
   * would silently produce a colSpan that no longer matches if a workbook ever
   * interleaved the two halves.
   */
  const catRuns = useMemo(() => {
    const runs: { id: string; label: string; zh: string; kpis: Kpi[] }[] = []
    for (const k of catKpis) {
      const sec = sectionOf(k.label)
      const id = sec?.id ?? 'lain'
      const last = runs[runs.length - 1]
      if (last && last.id === id) last.kpis.push(k)
      else runs.push({ id, label: sec?.label ?? 'Lainnya', zh: sec?.zh ?? '其他', kpis: [k] })
    }
    return runs
  }, [catKpis])

  /** Labels that open a section run — they carry the vertical rule between halves. */
  const seamLabels = useMemo(() => {
    const out = new Set<string>()
    let seen = 0
    for (const run of catRuns) {
      if (seen > 0) out.add(run.kpis[0].label)
      seen += run.kpis.length
    }
    return out
  }, [catRuns])

  const [topCat, setTopCat] = useState('')
  const [worstCat, setWorstCat] = useState('')
  const [tableCat, setTableCat] = useState('')

  /* "Semua KPI" is not a category, so it cannot resolve to a `Kpi` — the two
     ranking charts carry a flag instead, and their `Kpi` goes null. */
  const topTotal = topCat === TOTAL_CAT
  const worstTotal = worstCat === TOTAL_CAT

  // resolved rather than stored, so a newly loaded file falls back on its own
  const topK = topTotal ? null : (catKpis.find((k) => k.label === topCat) ?? defaultCat)
  const worstK = worstTotal ? null : (catKpis.find((k) => k.label === worstCat) ?? defaultCat)
  const tableK = catKpis.find((k) => k.label === tableCat) ?? defaultCat

  /* -------------------------------------------------------------- scoring */

  const scored = useMemo<Scored[]>(() => {
    const pool = allAgents ? model.dps : model.dps.filter((d) => d.agentKey === agentKey)
    return pool.map((dp) => {
      const kind = dpStatusOf(dp, day.key)
      const vals: Record<string, number | null> = {}
      let onTarget = 0, n = 0, margin = 0
      for (const k of catKpis) {
        const v = dpValue(dp, k.label, day.key)
        vals[k.label] = v
        if (v == null) continue
        /* A delivery-only site is zero on the categories it structurally does not
           run, and counting those as misses would score it 4/8 for doing exactly
           what it is there to do. Sites that run both flows keep every reading. */
        if (kind === 'delivery' && v === 0) continue
        n++
        const t = dpTargetFor(dp, k)
        if (k.lowerBetter ? v <= t : v >= t) onTarget++
        margin += k.lowerBetter ? t - v : v - t
      }
      return { dp, kind, vals, onTarget, scored: n, margin }
    })
  }, [model.dps, allAgents, agentKey, catKpis, day.key])

  /** The sites that run a delivery shift — the only ones a ranking may draw from. */
  const rankable = useMemo(() => scored.filter((s) => isRankable(s.kind)), [scored])
  const counts = useMemo(() => ({
    total: scored.length,
    both: scored.filter((s) => s.kind === 'both').length,
    delivery: scored.filter((s) => s.kind === 'delivery').length,
    pickup: scored.filter((s) => s.kind === 'pickup').length,
    closed: scored.filter((s) => s.kind === 'closed').length,
  }), [scored])

  /**
   * The five best or worst sites for one category.
   *
   * Two exclusions, and they are different things:
   *
   *   `dpStatusOf` already removed the sites that do not run a delivery shift at
   *   all — pickup-only and closed. Only `both` and `delivery` reach here.
   *
   *   This then drops sites reading exactly 0 *in the category being ranked*. A
   *   site can be active overall and still have no activity in one category —
   *   CP_ARIF_RAHMAN_HAKIM scores 100% at 07:30 and 12:00 but 0 at 06:30. That 0
   *   is "nothing happened here today", not "performed at 0%", and left in it
   *   would own the worst-five every single day while telling nobody anything.
   *
   * The zero rule applies to RETUR too, where low is good: a 0.00% return rate
   * at a site that handled no COD parcels is not the region's best performer,
   * it is an empty cell wearing a medal.
   */
  const ranked = (k: Kpi | null, worst: boolean): { s: Scored; v: number }[] => {
    if (!k) return []
    const rows = rankable
      .map((s) => ({ s, v: s.vals[k.label] }))
      .filter((o): o is { s: Scored; v: number } => o.v != null && o.v !== 0)
    // "worst" means furthest from meeting the target, which flips for RETUR
    const best = (a: number, b: number) => (k.lowerBetter ? a - b : b - a)
    rows.sort((x, y) => (worst ? best(y.v, x.v) : best(x.v, y.v)))
    return rows.slice(0, TOP_N)
  }

  /** How many delivery-running sites the zero rule above kept out of a ranking. */
  const zeroCount = (k: Kpi | null) =>
    k ? rankable.filter((s) => s.vals[k.label] === 0).length : 0

  const rank = (k: Kpi | null, worst: boolean): HBar[] =>
    ranked(k, worst).map((o) => ({
      name: o.s.dp.label,
      // SVG text, so the Mandarin is concatenated rather than wrapped in <Zh>
      sub: allAgents ? agentFull(o.s.dp.agentLabel) : undefined,
      value: o.v,
    }))

  /**
   * The same two charts, ranked on the whole scorecard instead of one category:
   * how many of the eight KPIs the site met.
   *
   * The counts are the ones already in the table's "Sesuai target" column, so a
   * bar reading 6 / 8 and the row reading 6/8 can never disagree — a chart that
   * contradicts the table underneath it is worse than no chart.
   *
   * The two charts measure opposite things on purpose. Worst counts the misses,
   * best counts the hits, so in both the bar grows in the direction the title
   * promises; a "best" chart drawn on misses would give its winner no bar at all.
   *
   * Sites with nothing scored are dropped — a site with no readings has met 0 of
   * 0, which is not an achievement or a failure. The zero rule that applies to a
   * single-category ranking does not: a 0 here is a real miss on a real KPI, and
   * the site is being judged on eight of them rather than on that one.
   */
  const rankTotal = (worst: boolean): HBar[] => {
    const rows = rankable.filter((s) => s.scored > 0)
    rows.sort((a, b) => {
      const av = worst ? a.scored - a.onTarget : a.onTarget
      const bv = worst ? b.scored - b.onTarget : b.onTarget
      if (av !== bv) return bv - av
      // equal counts: the one further from its targets is the worse site
      return worst ? a.margin - b.margin : b.margin - a.margin
    })
    return rows.slice(0, TOP_N).map((s) => {
      const missed = s.scored - s.onTarget
      return {
        name: s.dp.label,
        sub: allAgents ? agentFull(s.dp.agentLabel) : undefined,
        value: worst ? missed : s.onTarget,
        label: `${worst ? missed : s.onTarget} / ${s.scored}`,
        // red for anything short of a clean sheet, in both charts
        bad: missed > 0,
      }
    })
  }

  const topBars = useMemo(
    () => (topTotal ? rankTotal(false) : rank(topK, false)),
    [rankable, topK, topTotal, allAgents],
  )
  const worstBars = useMemo(
    () => (worstTotal ? rankTotal(true) : rank(worstK, true)),
    [rankable, worstK, worstTotal, allAgents],
  )

  /* below-target count per agent, for the region-wide view */
  const byAgent = useMemo(() => {
    if (!tableK) return { values: [] as (number | null)[], labels: [] as { top: string; sub?: string }[] }
    const acc = new Map<string, { label: string; bad: number; tot: number }>()
    for (const s of rankable) {
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
      // the axis is SVG: the Mandarin goes on the second line, not in a <Zh>
      labels: list.map((e) => ({
        top: e.label,
        sub: `${agentZh(e.label)}${agentZh(e.label) ? ' · ' : ''}dari ${e.tot}`,
      })),
    }
  }, [rankable, tableK])

  /* ---------------------------------------------------------- table state */

  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [type, setType] = useState<'all' | 'dp' | 'cp'>('all')
  const [biz, setBiz] = useState<'all' | BizModel>('all')
  const [onlyBelow, setOnlyBelow] = useState(false)
  const [mode, setMode] = useState<ValueMode>('day')
  const [sortKey, setSortKey] = useState('__name__')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [showAll, setShowAll] = useState(false)
  const tableRef = useRef<HTMLDivElement>(null)
  const secRowRef = useRef<HTMLTableRowElement>(null)

  /**
   * Publish the section band's real height as `--secrow-h`, which is what the
   * category row sticks below.
   *
   * `position:sticky` needs a length, and a hardcoded one is a guess that is
   * wrong the moment anything changes the row's height — a border, a font size,
   * browser zoom, a longer section name wrapping to two lines. Guessing 30px
   * against an actual 31.5px left the band overlapping the header beneath it by
   * a pixel and a half. Measuring costs one ResizeObserver and cannot drift.
   */
  useLayoutEffect(() => {
    const row = secRowRef.current
    if (!row) return
    const table = row.closest('table') as HTMLElement | null
    if (!table) return
    const apply = () => {
      /* Floored, not exact. The measured height is fractional at most zoom
         levels, and `top: 33.5px` resolves to a whole device pixel that can land
         either side of the band's real edge — one way overlaps invisibly, the
         other opens a seam for rows to show through. Rounding down always takes
         the first, and `.secrow` outranks `.catrow` so the overlap is hidden
         under the band. */
      const h = row.getBoundingClientRect().height
      table.style.setProperty('--secrow-h', `${Math.max(0, Math.floor(h))}px`)
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(row)
    return () => ro.disconnect()
  }, [catRuns, allAgents])

  const cell = (s: Scored, k: Kpi): number | null =>
    mode === 'mtd' ? (s.dp.vals[k.label]?.mtd ?? null) : s.vals[k.label]

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let out = scored.filter((s) => {
      if (status !== 'all' && s.kind !== status) return false
      if (type === 'cp' && !s.dp.isCp) return false
      if (type === 'dp' && s.dp.isCp) return false
      if (biz !== 'all' && s.dp.bizModel !== biz) return false
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
      if (sortKey === '__status__') return dir * (KIND_RANK[a.kind] - KIND_RANK[b.kind])
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
  }, [scored, q, status, type, biz, onlyBelow, tableK, sortKey, sortDir, mode, catKpis])

  const shown = showAll ? filtered : filtered.slice(0, 40)

  const sortOn = (key: string) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === '__name__' || key === '__agent__' ? 'asc' : 'desc') }
  }
  const arrow = (key: string) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '')

  /** Filename-safe: an agent label is free text out of the workbook. */
  const fileStem = () => {
    const who = (allAgents ? 'Semua Agen' : agentLabel).replace(/[\\/:*?"<>|]+/g, ' ').trim()
    const when = mode === 'mtd' ? 'bulanan' : (day.date ? isoDay(day.date) : 'daftar')
    return `Daftar DP-CP ${who} ${when}`
  }

  /**
   * A picture of this table alone.
   *
   * `shoot-table` hides everything else on the page and lets the wrap size to
   * the grid, so the right-hand categories are not cropped by the fixed capture
   * width the dashboard shot uses. Rows hidden behind "Tampilkan 40 pertama"
   * stay hidden — the image matches the screen.
   */
  const savePng = async () => {
    if (!tableRef.current) return
    try {
      await exportPng(tableRef.current, `${fileStem()}.png`, 'shoot-table')
    } catch (ex) {
      onError((ex as Error).message)
    }
  }

  /**
   * Export the "Daftar DP / CP" table as a real .xlsx — one sheet, the same
   * columns as the table on screen, and only the rows the filters are showing.
   *
   * A workbook rather than a CSV because this is opened in an Indonesian Excel,
   * where the list separator is `;` and `90,00` is a number: a comma-delimited
   * file has no separator Excel recognises and every row lands whole in column
   * A. A workbook carries its own typing, so nothing depends on the reader's
   * regional settings and the Mandarin survives without a BOM.
   *
   * No header colour: the community build of SheetJS hardcodes one font and two
   * fills when it writes styles.xml, so fills and bold are simply not reachable
   * from here. Column widths and autofilter are, and they are what actually make
   * the sheet workable — the red header would only have been decoration.
   */
  const exportXlsx = () => {
    const zh = (k: Kpi) => (CATEGORY_ZH[k.label] ? ` ${CATEGORY_ZH[k.label]}` : '')

    // the agent column only exists on screen in the all-agents view
    const head = [
      'DP / CP 网点',
      ...(allAgents ? ['Agen 代理区'] : []),
      'Jenis 类型',
      'Model Bisnis 商业模式',
      'Status 状态',
      ...catKpis.map((k) => `${k.label}${zh(k)}`),
      'Sesuai target 达标数',
    ]

    const body = filtered.map((s) => [
      s.dp.label,
      ...(allAgents ? [agentFull(s.dp.agentLabel)] : []),
      s.dp.isCp ? 'CP' : 'DP',
      BIZ_MODEL_LABEL[s.dp.bizModel],
      `${DP_KIND_LABEL[s.kind]} ${DP_KIND_ZH[s.kind]}`,
      ...catKpis.map((k) => cell(s, k)),
      /* only sites that run a delivery shift are scored — see dpStatusOf */
      isRankable(s.kind) ? `${s.onTarget}/${s.scored}` : '',
    ])

    const ws = XLSX.utils.aoa_to_sheet([head, ...body])

    /* `0.00"%"` keeps the underlying value at 98.25 while showing "98.25%".
       A real percent format would multiply by 100 and print 9825%. */
    const firstKpi = allAgents ? 5 : 4
    for (let R = 1; R <= body.length; R++) {
      for (let C = firstKpi; C < firstKpi + catKpis.length; C++) {
        const c = ws[XLSX.utils.encode_cell({ r: R, c: C })]
        if (c && c.t === 'n') c.z = '0.00"%"'
      }
    }

    ws['!cols'] = [
      { wch: 28 },
      ...(allAgents ? [{ wch: 20 }] : []),
      { wch: 7 },
      { wch: 14 },
      { wch: 24 },
      ...catKpis.map(() => ({ wch: 15 })),
      { wch: 14 },
    ]
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: body.length, c: head.length - 1 } }),
    }

    const wb = XLSX.utils.book_new()
    // sheet names cannot contain / \ ? * [ ] :
    XLSX.utils.book_append_sheet(wb, ws, 'Daftar DP-CP')

    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
    const blob = new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileStem()}.xlsx`
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
  const catSelect = (cur: string, onChange: (v: string) => void, id: string, withTotal = false) => (
    <select
      className="hsel" value={cur} aria-label={`Kategori yang ditampilkan pada ${id}`}
      onChange={(e) => onChange(e.target.value)}
    >
      {withTotal && <option value={TOTAL_CAT}>SEMUA INDIKATOR · jumlah sesuai target</option>}
      {catKpis.map((k) => <option key={k.label} value={k.label}>{k.label}</option>)}
    </select>
  )

  return (
    <div className="dpsection">
      <div className="dphead">
        <h2>
          Performa DP / CP <Zh>网点绩效</Zh> — <b>{scope}<Zh>{allAgents ? '' : agentZh(agentLabel)}</Zh></b>
        </h2>
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
        <Stat n={counts.both} lab="Delivery and Pick up" zh="派送及揽收" tone="good"
              hint="Menjalankan pengantaran dan penjemputan. Masuk peringkat." />
        <Stat n={counts.delivery} lab="Delivery Only" zh="仅派送" tone="good"
              hint="TPTW bernilai nol — mengantar tetapi tidak menyerahkan paket ke alur penjemputan. Tetap masuk peringkat." />
        <Stat n={counts.pickup} lab="Pick up Only" zh="仅揽收" tone="warn"
              hint="Tidak ada sprinter di sini — 06:30 dan 07:30 keduanya nol, sehingga dikeluarkan dari peringkat." />
        <Stat n={counts.closed} lab="Tutup" zh="已关闭" tone="mute"
              hint="Semua kategori bernilai nol. Dikeluarkan dari peringkat." />
        <Stat
          n={tableK ? rankable.filter((s) => { const v = s.vals[tableK.label]; if (v == null) return false; const t = dpTargetFor(s.dp, tableK); return tableK.lowerBetter ? v > t : v < t }).length : 0}
          lab={tableK ? `Di bawah target · ${tableK.label}` : 'Di bawah target'}
          zh="未达标"
          tone="bad"
        />
      </div>

      <div className="row-dp">
        <div className="panel">
          <h3>
            <span className="ptitle">{TOP_N} DP / CP Terbaik <Zh>前五名网点</Zh></span>
            {catSelect(topTotal ? TOTAL_CAT : (topK?.label ?? ''), setTopCat, 'grafik lima terbaik', true)}
          </h3>
          <div className="body">
            <HBarChart
              bars={topBars}
              targetLine={topK ? dpTargetFor(scored[0]?.dp ?? model.dps[0], topK) : null}
              lowerBetter={topK?.lowerBetter}
            />
            {topTotal ? <TotalNote worst={false} /> : <ZeroNote n={zeroCount(topK)} />}
          </div>
        </div>

        <div className="panel">
          <h3>
            <span className="ptitle">{TOP_N} DP / CP Terburuk <Zh>后五名网点</Zh></span>
            {catSelect(worstTotal ? TOTAL_CAT : (worstK?.label ?? ''), setWorstCat, 'grafik lima terburuk', true)}
          </h3>
          <div className="body">
            <HBarChart
              bars={worstBars}
              targetLine={worstK ? dpTargetFor(scored[0]?.dp ?? model.dps[0], worstK) : null}
              lowerBetter={worstK?.lowerBetter}
            />
            {worstTotal ? <TotalNote worst /> : <ZeroNote n={zeroCount(worstK)} />}
          </div>
        </div>
      </div>

      {allAgents && byAgent.values.length > 1 && (
        <div className="row-trend">
          <div className="panel">
            <h3>
              <span className="ptitle">DP / CP di Bawah Target per Agen <Zh>各代理区未达标网点</Zh></span>
              {catSelect(tableK?.label ?? '', setTableCat, 'grafik per agen')}
            </h3>
            <div className="body">
              <BarChart values={byAgent.values} labels={byAgent.labels} w={1100} h={260} />
            </div>
          </div>
        </div>
      )}

      <div className="panel dptable" ref={tableRef}>
        <h3>
          {/* the period is in the title rather than only in the filter bar, so a
              PNG of just this table still says which day it is */}
          <span className="ptitle">
            Daftar DP / CP <Zh>网点清单</Zh> — {filtered.length} dari {counts.total} ·{' '}
            {mode === 'mtd' ? 'Pencapaian Bulan Ini' : dayLabel}
          </span>
          <button className="btn tiny" onClick={exportXlsx}>Ekspor Excel</button>
          <button className="btn tiny" onClick={savePng}>Simpan PNG</button>
        </h3>

        <div className="dpfilters">
          <input
            type="text" placeholder="Cari DP / CP atau agen…" value={q}
            onChange={(e) => setQ(e.target.value)} aria-label="Cari drop point"
          />
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Filter status">
            <option value="all">Semua status</option>
            <option value="both">Delivery and Pick up</option>
            <option value="delivery">Delivery Only</option>
            <option value="pickup">Pick up Only</option>
            <option value="closed">Tutup</option>
          </select>
          <select value={type} onChange={(e) => setType(e.target.value as 'all' | 'dp' | 'cp')} aria-label="Filter jenis">
            <option value="all">DP dan CP</option>
            <option value="dp">Drop point</option>
            <option value="cp">Collection point</option>
          </select>
          <select value={biz} onChange={(e) => setBiz(e.target.value as 'all' | BizModel)} aria-label="Filter model bisnis">
            <option value="all">Semua model bisnis</option>
            <option value="franchise">Franchise</option>
            <option value="agent">Agent</option>
          </select>
          {/* The category this checkbox measures against is named in the label
              rather than sitting beside it as its own select. On its own that
              select changed nothing you could see — it only parameterised this
              checkbox — so it read as a filter that did not filter. */}
          <label className="chk">
            <input type="checkbox" checked={onlyBelow} onChange={(e) => setOnlyBelow(e.target.checked)} />
            Hanya di bawah target{tableK ? ` · ${tableK.label}` : ''}
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
                {/* Section band. `catKpis` is already in section order (it is
                    filtered from CANONICAL_ORDER, which is built out of the
                    sections), so the runs are contiguous and a colSpan is
                    enough — no reordering needed here. */}
                <tr className="secrow" ref={secRowRef}>
                  <th className="sticky" />
                  {allAgents && <th />}
                  <th />
                  {catRuns.map((run, i) => (
                    <th
                      key={run.id}
                      className={`secband s-${run.id}${i > 0 ? ' seam' : ''}`}
                      colSpan={run.kpis.length}
                    >
                      {run.label}<Zh>{run.zh}</Zh>
                    </th>
                  ))}
                  <th />
                </tr>
                <tr className="catrow">
                  <th className="sticky" onClick={() => sortOn('__name__')}>
                    DP / CP{arrow('__name__')}<Zh>网点</Zh>
                  </th>
                  {allAgents && (
                    <th onClick={() => sortOn('__agent__')}>Agen{arrow('__agent__')}<Zh>代理区</Zh></th>
                  )}
                  <th onClick={() => sortOn('__status__')}>Status{arrow('__status__')}<Zh>状态</Zh></th>
                  {catKpis.map((k) => (
                    <th
                      key={k.label}
                      className={`num cat${seamLabels.has(k.label) ? ' seam' : ''}`}
                      onClick={() => sortOn(k.label)} title={k.label}
                    >
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
                      {/* the tag carries the business model, not the DP/CP split:
                          the name is already prefixed CP_ where that matters, so
                          the two letters are better spent on the thing the name
                          does not tell you */}
                      <span
                        className={`ptag ${s.dp.bizModel || 'unknown'}`}
                        title={`${BIZ_MODEL_LABEL[s.dp.bizModel]} · ${s.dp.isCp ? 'Collection point' : 'Drop point'}`}
                      >
                        {BIZ_MODEL_TAG[s.dp.bizModel]}
                      </span>
                      {s.dp.label}
                    </td>
                    {allAgents && (
                      <td className="muted">{s.dp.agentLabel}<Zh>{agentZh(s.dp.agentLabel)}</Zh></td>
                    )}
                    <td>
                      <span className={`sbadge ${s.kind}`} title={DP_KIND_ZH[s.kind]}>
                        {DP_KIND_LABEL[s.kind]}
                      </span>
                    </td>
                    {catKpis.map((k) => {
                      const seam = seamLabels.has(k.label) ? ' seam' : ''
                      const v = cell(s, k)
                      if (v == null) return <td key={k.label} className={`num muted${seam}`}>—</td>
                      const t = dpTargetFor(s.dp, k)
                      const ok = k.lowerBetter ? v <= t : v >= t
                      /* Pickup-only and closed sites are grey, not red: their
                         zeros are structural, and colouring them as failures is
                         exactly the false alarm this section exists to remove.
                         A delivery-only site is the same story one cell at a
                         time — only the categories it does not run read 0, so
                         those go grey and the rest stay scored normally. */
                      const structural = s.kind === 'delivery' && v === 0
                      const cls = isRankable(s.kind) && !structural
                        ? (ok ? 'hm ok' : 'hm bad')
                        : 'hm off'
                      return (
                        <td key={k.label} className={`num ${cls}${seam}`} title={`${k.label} · target ${k.lowerBetter ? '≤' : '≥'} ${t.toFixed(2)}%`}>
                          {v.toFixed(2)}
                        </td>
                      )
                    })}
                    <td className="num">
                      {isRankable(s.kind)
                        ? `${s.onTarget}/${s.scored}`
                        : <span className="muted">—</span>}
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
        Nilai yang ditampilkan: {mode === 'mtd' ? 'pencapaian bulan ini' : dayLabel}.
        {' '}Status ditentukan dari data hari itu:
        {' '}<b>Pick up Only</b> — 06:30 dan 07:30 keduanya nol, berarti tidak ada sprinter di sini;
        {' '}<b>Delivery Only</b> — TPTW bernilai nol, jadi paket diantar tetapi tidak diserahkan ke alur
        penjemputan; {' '}<b>Delivery and Pick up</b> — semua kategori berjalan;
        {' '}<b>Tutup</b> — nilai nol pada semua kategori.
        {' '}Tanda <b>FR</b> / <b>AG</b> di depan nama adalah model bisnisnya: Franchise atau Agent.
        {' '}Tiga hal dikeluarkan dari peringkat lima terbaik dan lima terburuk: <b>Pick up Only</b>,
        {' '}<b>Tutup</b>, dan <b>DP/CP yang bernilai tepat 0,00% pada kategori yang sedang diperingkat</b>
        {' '}— itu berarti kategorinya tidak berjalan hari itu, bukan performanya nol, jadi kalau ikut
        diperingkat ia akan menguasai daftar terburuk setiap hari tanpa memberi informasi apa pun.
        Semuanya tetap muncul di daftar di atas agar tidak ada yang hilang diam-diam.
      </div>
    </div>
  )
}

/**
 * Says out loud how many sites the zero rule kept out of a ranking.
 *
 * Without it the counters above and the chart below disagree — "25 di bawah
 * target" but only two bars — and a silent exclusion is the kind of thing that
 * costs someone twenty minutes and a phone call.
 */
/**
 * Says what the bars count when the ranking is over all eight KPIs.
 *
 * Without it "6 / 8" is ambiguous in exactly the way that matters — six met or
 * six missed? — and the two charts genuinely do count opposite things.
 */
function TotalNote({ worst }: { worst: boolean }) {
  return (
    <div className="chartnote">
      {worst
        ? 'Jumlah Indikator yang di bawah target, dari Indikator yang ada nilainya — makin panjang makin buruk.'
        : 'Jumlah Indikator yang sudah sesuai target, dari Indikator yang ada nilainya — makin panjang makin baik.'}
      {' '}Angka ini sama dengan kolom <b>Sesuai target</b> di tabel bawah. Bila jumlahnya seri,
      urutannya ditentukan oleh seberapa jauh nilainya dari target.
    </div>
  )
}

function ZeroNote({ n }: { n: number }) {
  if (!n) return null
  return (
    <div className="chartnote">
      {n} DP/CP tidak diperingkat: nilainya 0,00% — tidak ada aktivitas pada kategori ini.
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
