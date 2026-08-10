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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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

/**
 * The non-KPI columns, by the id they are known by in both the sort and the
 * column switch.
 *
 * One id space on purpose: a column is sorted by the same string that hides it,
 * so "the column being sorted just went away" is a set lookup rather than a
 * mapping that can drift.
 */
const COL_NAME = '__name__'
const COL_AGENT = '__agent__'
const COL_STATUS = '__status__'
const COL_ONTARGET = '__ontarget__'

/** Sort order for the Status column — by how much of the operation runs, so the
 *  column reads as a scale instead of alphabetically (both, closed, delivery…). */
const KIND_RANK: Record<DpKind, number> = { both: 0, delivery: 1, pickup: 2, closed: 3 }

/** One run of the header band: the KPI columns belonging to a single section. */
interface CatRun { id: string; label: string; zh: string; kpis: Kpi[] }

/** One tick box in the column switch. */
interface ColOpt { id: string; label: string; zh: string; locked?: boolean }

/**
 * Split a KPI list into contiguous runs, one per section.
 *
 * Built by walking the columns rather than by filtering per section, so a band
 * can only ever describe the columns actually underneath it. Filtering would
 * silently produce a colSpan that no longer matches if a workbook ever
 * interleaved the two halves — or, now, if the switch below hides the middle of
 * a run.
 */
function runsOf(kpis: Kpi[]): CatRun[] {
  const runs: CatRun[] = []
  for (const k of kpis) {
    const sec = sectionOf(k.label)
    const id = sec?.id ?? 'lain'
    const last = runs[runs.length - 1]
    if (last && last.id === id) last.kpis.push(k)
    else runs.push({ id, label: sec?.label ?? 'Lainnya', zh: sec?.zh ?? '其他', kpis: [k] })
  }
  return runs
}

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

  /* ------------------------------------------------------ column visibility */

  /**
   * The columns switched *off*, never the ones switched on.
   *
   * Which way round this is stored is the whole design. The column list comes
   * out of the workbook — eight KPIs today, a ninth the day someone adds one —
   * so a stored list of visible columns would have to be reconciled with every
   * file that loads, and a brand-new KPI would arrive hidden because it was not
   * in a set written before it existed. Storing the exclusions makes "show
   * everything" the empty set: an unknown column is visible by construction,
   * which is exactly what "default: every column ticked" has to mean here.
   */
  const [hiddenCols, setHiddenCols] = useState<ReadonlySet<string>>(() => new Set<string>())

  /** the KPI columns the table actually draws */
  const visKpis = useMemo(
    () => catKpis.filter((k) => !hiddenCols.has(k.label)),
    [catKpis, hiddenCols],
  )
  /* The agent column only exists in the all-agents view at all, so it is hidden
     by either of two independent things and both have to be asked. */
  const showAgent = allAgents && !hiddenCols.has(COL_AGENT)
  const showStatus = !hiddenCols.has(COL_STATUS)
  const showOnTarget = !hiddenCols.has(COL_ONTARGET)

  /**
   * The switch itself: every column in the grid, grouped the way the header band
   * groups them, so the row of tick boxes reads in the same order as the columns
   * it controls.
   *
   * Built from `catKpis` rather than `visKpis` — a hidden column has to stay in
   * the row or there would be no way to bring it back.
   */
  const colGroups = useMemo<{ id: string; label: string; cols: ColOpt[] }[]>(() => [
    {
      id: 'ident',
      label: 'Identitas',
      cols: [
        /* The name is not switchable: a table of unlabelled percentages is not a
           narrower table, it is an unreadable one. It is still shown, ticked and
           locked, so the row accounts for every column on screen rather than
           leaving someone hunting for the one that is missing from it. */
        { id: COL_NAME, label: 'DP / CP', zh: '网点', locked: true },
        ...(allAgents ? [{ id: COL_AGENT, label: 'Agen', zh: '代理区' }] : []),
        { id: COL_STATUS, label: 'Status', zh: '状态' },
      ],
    },
    ...runsOf(catKpis).map((run) => ({
      id: run.id,
      label: run.label,
      cols: run.kpis.map((k) => ({ id: k.label, label: k.label, zh: CATEGORY_ZH[k.label] ?? '' })),
    })),
    { id: 'skor', label: 'Ringkasan', cols: [{ id: COL_ONTARGET, label: 'Sesuai target', zh: '达标数' }] },
  ], [catKpis, allAgents])

  /* the locked name column is not one of the choices, so it counts in neither
     half of "8 / 11" and "select all" cannot try to switch it off */
  const colOptions = useMemo(
    () => colGroups.flatMap((g) => g.cols).filter((c) => !c.locked),
    [colGroups],
  )
  const shownCols = colOptions.reduce((n, c) => n + (hiddenCols.has(c.id) ? 0 : 1), 0)
  const allColsOn = shownCols === colOptions.length

  const toggleCol = (id: string) => setHiddenCols((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  /* `new Set()` rather than a delete pass: the set may still be holding ids from
     a workbook that is no longer loaded, and clearing it drops those too. */
  const showEveryCol = () => setHiddenCols(new Set<string>())
  const hideEveryCol = () => setHiddenCols(new Set(colOptions.map((c) => c.id)))

  /** `catKpis` split into contiguous runs, one per section, for the header band. */
  const catRuns = useMemo(() => runsOf(visKpis), [visKpis])

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
  const [sortKey, setSortKey] = useState<string>(COL_NAME)
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [showAll, setShowAll] = useState(false)
  /**
   * The comparison basket: drop points ticked for a side-by-side look.
   *
   * Keyed by `dp.key` rather than by row index, so a tick survives sorting,
   * searching and the day switch — which is the whole point. You find one site,
   * tick it, clear the search, find another, tick that, and only then ask to see
   * the two together.
   */
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [onlyPicked, setOnlyPicked] = useState(false)
  const tableRef = useRef<HTMLDivElement>(null)
  const secRowRef = useRef<HTMLTableRowElement>(null)

  const togglePick = (key: string) => setPicked((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  /** Ticked sites that exist in the current agent scope. */
  const pickedCount = useMemo(
    () => scored.reduce((n, s) => n + (picked.has(s.dp.key) ? 1 : 0), 0),
    [scored, picked],
  )

  /**
   * Whether the table is actually showing the basket.
   *
   * Guarded by the count so an empty basket can never blank the table — but the
   * guard alone was not enough, and the difference is worth spelling out because
   * it made the feature unusable.
   *
   * Masking `onlyPicked` hides its effect without clearing it. Untick everything
   * and the table correctly went back to the full list, while `onlyPicked` was
   * still sitting there `true`; the very next tick satisfied the guard again and
   * the table collapsed to that one row, with no way to add a second. The only
   * escape was "Kosongkan", which happens to reset the flag.
   *
   * So the flag is cleared for real below, and this stays as the guard against
   * the frame in between.
   */
  const basketOn = onlyPicked && pickedCount > 0

  /**
   * An empty basket disarms the view.
   *
   * An effect rather than a line inside `togglePick`, because emptying is not
   * only something the tick does: changing the agent takes every selected site
   * out of scope too, and that path would have re-armed exactly the same way.
   * Reacting to the count catches every route to zero, present and future.
   */
  useEffect(() => {
    if (onlyPicked && pickedCount === 0) setOnlyPicked(false)
  }, [onlyPicked, pickedCount])

  /**
   * The sort actually in force: hiding the column the table is sorted by drops
   * the order back to the name.
   *
   * The order would otherwise survive the column's disappearance, leaving the
   * rows in an arrangement nothing on screen explains — every visible header
   * unmarked and the list in no discernible order. The agent column reaches the
   * same state by a second route, since a single-agent toolbar selection drops
   * it outright.
   *
   * Derived rather than corrected in an effect, so `sortKey` still holds what
   * was actually asked for: tick the column back on and its order comes back,
   * instead of having been quietly overwritten while it was out of sight.
   */
  const sortGone = sortKey !== COL_NAME
    && (hiddenCols.has(sortKey) || (sortKey === COL_AGENT && !allAgents))
  const liveSort = sortGone ? COL_NAME : sortKey
  const liveDir: SortDir = sortGone ? 'asc' : sortDir

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

    /*
     * A basket is not another filter, and this is the one design decision worth
     * arguing about.
     *
     * Left as a filter it would AND with the others, and the sequence that
     * builds a selection would then destroy it: you search "CIJANTUNG", tick it,
     * search "TEBET", tick that — and asking to see your two picks through a
     * search box still reading "TEBET" shows you one. The tick and the thing
     * that found the tick are different acts, and the second should not outlive
     * itself.
     *
     * So the basket replaces the filters rather than joining them. Sorting still
     * applies, because comparing three sites by a column is exactly what this is
     * for.
     */
    let out = basketOn ? scored.filter((s) => picked.has(s.dp.key)) : scored.filter((s) => {
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

    const dir = liveDir === 'asc' ? 1 : -1
    out = [...out].sort((a, b) => {
      if (liveSort === COL_NAME) return dir * a.dp.label.localeCompare(b.dp.label)
      if (liveSort === COL_AGENT) return dir * a.dp.agentLabel.localeCompare(b.dp.agentLabel)
      if (liveSort === COL_STATUS) return dir * (KIND_RANK[a.kind] - KIND_RANK[b.kind])
      if (liveSort === COL_ONTARGET) return dir * (a.onTarget - b.onTarget)
      const k = catKpis.find((x) => x.label === liveSort)
      if (!k) return 0
      const av = cell(a, k), bv = cell(b, k)
      // rows with no reading always sink, whichever way the column is sorted
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return dir * (av - bv)
    })
    return out
  }, [scored, q, status, type, biz, onlyBelow, tableK, liveSort, liveDir, mode, catKpis,
      basketOn, picked])

  /* A deliberate selection is never truncated: forty is a guard against dumping
     1,666 rows nobody asked for, and ticking sites one at a time is the opposite
     of that. */
  const shown = showAll || basketOn ? filtered : filtered.slice(0, 40)

  const sortOn = (key: string) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === COL_NAME || key === COL_AGENT ? 'asc' : 'desc') }
  }
  const arrow = (key: string) => (liveSort === key ? (liveDir === 'asc' ? ' ▲' : ' ▼') : '')

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
   * "The same columns" includes the ones the column switch has hidden: the
   * export is a copy of what is being looked at, and a sheet that quietly hands
   * back the eight columns someone just narrowed to three is not that. Jenis and
   * Model Bisnis are the exception — on screen they are the tag in front of the
   * name rather than columns of their own, so they are always written out.
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
      ...(showAgent ? ['Agen 代理区'] : []),
      'Jenis 类型',
      'Model Bisnis 商业模式',
      ...(showStatus ? ['Status 状态'] : []),
      ...visKpis.map((k) => `${k.label}${zh(k)}`),
      ...(showOnTarget ? ['Sesuai target 达标数'] : []),
    ]

    const body = filtered.map((s) => [
      s.dp.label,
      ...(showAgent ? [agentFull(s.dp.agentLabel)] : []),
      s.dp.isCp ? 'CP' : 'DP',
      BIZ_MODEL_LABEL[s.dp.bizModel],
      ...(showStatus ? [`${DP_KIND_LABEL[s.kind]} ${DP_KIND_ZH[s.kind]}`] : []),
      ...visKpis.map((k) => cell(s, k)),
      /* only sites that run a delivery shift are scored — see dpStatusOf */
      ...(showOnTarget ? [isRankable(s.kind) ? `${s.onTarget}/${s.scored}` : ''] : []),
    ])

    const ws = XLSX.utils.aoa_to_sheet([head, ...body])

    /* `0.00"%"` keeps the underlying value at 98.25 while showing "98.25%".
       A real percent format would multiply by 100 and print 9825%.
       Counted off the head rather than hardcoded: which columns precede the
       KPIs now depends on the column switch as well as on the agent scope. */
    const firstKpi = 1 + (showAgent ? 1 : 0) + 2 + (showStatus ? 1 : 0)
    for (let R = 1; R <= body.length; R++) {
      for (let C = firstKpi; C < firstKpi + visKpis.length; C++) {
        const c = ws[XLSX.utils.encode_cell({ r: R, c: C })]
        if (c && c.t === 'n') c.z = '0.00"%"'
      }
    }

    ws['!cols'] = [
      { wch: 28 },
      ...(showAgent ? [{ wch: 20 }] : []),
      { wch: 7 },
      { wch: 14 },
      ...(showStatus ? [{ wch: 24 }] : []),
      ...visKpis.map(() => ({ wch: 15 })),
      ...(showOnTarget ? [{ wch: 14 }] : []),
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

  /* the name column, plus whatever the switch left standing — the empty-state
     row has to span exactly the columns that are there */
  const colCount = 1 + (showAgent ? 1 : 0) + (showStatus ? 1 : 0) + visKpis.length
    + (showOnTarget ? 1 : 0)

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
      {/* Part B of the page. Deliberately the same red plate and the same weight
          as the "Data Agen" band above it — see `.partband` in dashboard.css.
          The subtitle spells out the unit of the rows below, because that is the
          one thing that separates this half from the one before it: everything
          up there is an agent, everything down here is a single counter. */}
      {/*
        Built to the same pattern as the "Data Agen" band in Dashboard.tsx: a
        short title, and every qualifier in the line beneath it.

        That is the whole reason A looked composed and B did not. B was carrying
        its scope inside the heading — "Performa DP / CP 网点绩效 — SEMUA AGEN ·
        10 agen" — which is four separate facts in one sentence and wraps onto
        two or three lines the moment the screen narrows, taking the badge's
        alignment with it. Moving the scope and the date down to the subtitle
        leaves a heading that fits one line at any width, and the two bands then
        read as a matched pair rather than as two attempts at the same idea.

        The fallback notice is the exception and stays a line of its own: it is a
        warning, it appears rarely, and it should not be mistaken for part of the
        ordinary description.
      */}
      <div className="dphead">
        <span className="partnum">B</span>
        <span className="dptitles">
          <h2>Data DP / CP <Zh>网点数据</Zh></h2>
          <span className="partsub">
            Rincian per drop point &amp; collection point — {scope}
            <Zh>{allAgents ? '' : agentZh(agentLabel)}</Zh> · {dayLabel}
          </span>
        </span>
        {wanted && wanted.key !== day.key && (
          <span className="dpday">
            {/* "tab per agen" described the old one-tab-per-agent workbook and
                stopped being true when the drop points moved to a single
                combined sheet — this names the data, not the layout it used to
                live in. */}
            <em>
              data DP/CP {wanted.date ? fmtDateFull(wanted.date) : 'tanggal tersebut'} belum
              ada — menampilkan hari terdekat
            </em>
          </span>
        )}
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
              {/* Every bar here is a named agent, and a name needs width no
                  amount of reshaping can give it — this is the one chart that
                  pans on a phone instead of fitting. */}
              <BarChart
                values={byAgent.values} labels={byAgent.labels}
                w={1100} h={260} narrowMode="scroll"
              />
            </div>
          </div>
        </div>
      )}

      <div className="panel dptable" ref={tableRef}>
        <h3>
          {/* the period is in the title rather than only in the filter bar, so a
              PNG of just this table still says which day it is */}
          {/* The heading says which of the two lists this is, so an exported PNG
              of a three-row table is not mistaken for a filter gone wrong. */}
          <span className="ptitle">
            {basketOn
              ? <>Perbandingan DP / CP <Zh>网点对比</Zh> — {filtered.length} dipilih</>
              : <>Daftar DP / CP <Zh>网点清单</Zh> — {filtered.length} dari {counts.total}</>}
            {' · '}{mode === 'mtd' ? 'Pencapaian Bulan Ini' : dayLabel}
          </span>
          <button className="btn tiny" onClick={exportXlsx}>Ekspor Excel</button>
          <button className="btn tiny" onClick={savePng}>Simpan PNG</button>
        </h3>

        {/* While the basket is showing, the finders are disabled rather than left
            live-but-ignored. They cannot narrow a selection — the basket replaces
            them — and a search box that accepts typing and changes nothing is a
            worse answer than one that plainly says it is not in use. */}
        <div className="dpfilters">
          <input
            type="text" placeholder="Cari DP / CP atau agen…" value={q}
            onChange={(e) => setQ(e.target.value)} aria-label="Cari drop point"
            disabled={basketOn}
          />
          <select
            value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}
            aria-label="Filter status" disabled={basketOn}
          >
            <option value="all">Semua status</option>
            <option value="both">Delivery and Pick up</option>
            <option value="delivery">Delivery Only</option>
            <option value="pickup">Pick up Only</option>
            <option value="closed">Tutup</option>
          </select>
          <select
            value={type} onChange={(e) => setType(e.target.value as 'all' | 'dp' | 'cp')}
            aria-label="Filter jenis" disabled={basketOn}
          >
            <option value="all">DP dan CP</option>
            <option value="dp">Drop point</option>
            <option value="cp">Collection point</option>
          </select>
          <select
            value={biz} onChange={(e) => setBiz(e.target.value as 'all' | BizModel)}
            aria-label="Filter model bisnis" disabled={basketOn}
          >
            <option value="all">Semua model bisnis</option>
            <option value="franchise">Franchise</option>
            <option value="agent">Agent</option>
          </select>
          {/* The category this checkbox measures against is named in the label
              rather than sitting beside it as its own select. On its own that
              select changed nothing you could see — it only parameterised this
              checkbox — so it read as a filter that did not filter. */}
          <label className="chk">
            <input
              type="checkbox" checked={onlyBelow} disabled={basketOn}
              onChange={(e) => setOnlyBelow(e.target.checked)}
            />
            Hanya di bawah target{tableK ? ` · ${tableK.label}` : ''}
          </label>
          <div className="seg">
            <button className={mode === 'day' ? 'on' : ''} onClick={() => setMode('day')}>
              {day.date ? fmtDate(day.date) : 'Harian'}
            </button>
            <button className={mode === 'mtd' ? 'on' : ''} onClick={() => setMode('mtd')}>Bulanan</button>
          </div>

        </div>

        {/*
          The column switch: one tick box per column, laid out along the top of
          the table in the order the columns appear in it.

          It was a dropdown first, and the dropdown was wrong twice. A 290px
          panel anchored to its button ran off the edge of a narrow window with
          no way to reach the rest of it — but the deeper problem is that this is
          not a menu decision. Which columns you are reading is the state of the
          table, and hiding that state behind a button means the answer to "why
          is TPTW not here?" needs a click to find. Spelled out, the boxes *are*
          the answer: eleven labels, three unticked, nothing to open.

          It is not a filter and is never disabled with them. The filters choose
          which *rows* the table is about; this chooses how wide it is, and
          narrowing a comparison of three sites to the two indicators being
          argued about is exactly when it is most wanted — which is precisely
          when the basket has the filter bar above switched off.
        */}
        <div className="dpcolbar" role="group" aria-label="Kolom yang ditampilkan">
          <div className="dpcolhead">
            <span className="dpcoltitle">Kolom <Zh>列</Zh></span>
            <span className={`dpcoln${allColsOn ? '' : ' off'}`}>
              <b>{shownCols}</b>/{colOptions.length}
            </span>
            {/* One box for the lot, and it carries the third state on purpose:
                a plain checkbox reading "unticked" over a table showing eight of
                eleven columns would be describing something that is not true. */}
            <label className="colchip master">
              <input
                type="checkbox"
                checked={allColsOn}
                ref={(el) => { if (el) el.indeterminate = shownCols > 0 && !allColsOn }}
                onChange={(e) => (e.target.checked ? showEveryCol() : hideEveryCol())}
              />
              Pilih semua
            </label>
          </div>

          <div className="dpcolwrap">
            {colGroups.map((g) => (
              <div className="colgrp" key={g.id}>
                <span className="colgrph">{g.label}</span>
                {g.cols.map((c) => (
                  <label
                    key={c.id}
                    title={c.locked ? 'Kolom nama selalu ditampilkan' : c.zh || undefined}
                    className={`colchip${c.locked ? ' locked' : hiddenCols.has(c.id) ? ' off' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={c.locked || !hiddenCols.has(c.id)}
                      disabled={c.locked}
                      readOnly={c.locked}
                      onChange={() => toggleCol(c.id)}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/*
          The selection bar. Appears on the first tick and counts up from there.

          It replaced a checkbox sitting among the filters, which was wrong twice
          over: it looked like another filter when it is a different kind of
          thing entirely, and it was silent — you could tick five rows and get no
          acknowledgement that anything had been collected. A bar that says "5
          dipilih" the moment you tick the fifth is the feedback the checkbox
          never gave.

          `aria-live="polite"` so the count is announced rather than only shown;
          the tick is in a table cell and a screen-reader user has no other way
          to know the basket grew.
        */}
        {pickedCount > 0 && (
          <div className="dppicked" role="status" aria-live="polite">
            <span className="dppicked-n"><b>{pickedCount}</b> dipilih</span>
            <span className="dppicked-act">
              <button className="btn tiny primary" onClick={() => setOnlyPicked(!basketOn)}>
                {basketOn ? 'Tampilkan semua' : 'Tampilkan yang dipilih'}
              </button>
              <button
                className="btn tiny"
                onClick={() => { setPicked(new Set<string>()); setOnlyPicked(false) }}
              >
                Kosongkan
              </button>
            </span>
          </div>
        )}

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
                  {showAgent && <th className="agentcol" />}
                  {showStatus && <th />}
                  {catRuns.map((run, i) => (
                    <th
                      key={run.id}
                      className={`secband s-${run.id}${i > 0 ? ' seam' : ''}`}
                      colSpan={run.kpis.length}
                    >
                      {run.label}<Zh>{run.zh}</Zh>
                    </th>
                  ))}
                  {showOnTarget && <th />}
                </tr>
                <tr className="catrow">
                  <th className="sticky" onClick={() => sortOn(COL_NAME)}>
                    DP / CP{arrow(COL_NAME)}<Zh>网点</Zh>
                  </th>
                  {showAgent && (
                    <th className="agentcol" onClick={() => sortOn(COL_AGENT)}>
                      Agen{arrow(COL_AGENT)}<Zh>代理区</Zh>
                    </th>
                  )}
                  {showStatus && (
                    <th onClick={() => sortOn(COL_STATUS)}>Status{arrow(COL_STATUS)}<Zh>状态</Zh></th>
                  )}
                  {visKpis.map((k) => (
                    <th
                      key={k.label}
                      className={`num cat${seamLabels.has(k.label) ? ' seam' : ''}`}
                      onClick={() => sortOn(k.label)} title={k.label}
                    >
                      {k.label}{arrow(k.label)}<Zh>{CATEGORY_ZH[k.label] ?? ''}</Zh>
                    </th>
                  ))}
                  {showOnTarget && (
                    <th className="num" onClick={() => sortOn(COL_ONTARGET)}>
                      Sesuai target{arrow(COL_ONTARGET)}<Zh>达标数</Zh>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.dp.key} className={`k-${s.kind}${picked.has(s.dp.key) ? ' picked' : ''}`}>
                    {/*
                      The flex layout lives on the span inside, not on the cell.

                      `display:flex` on a `<td>` takes it out of the table layout
                      and the engine re-parents it into an anonymous cell — and a
                      `position:sticky` box inside an anonymous table box is
                      exactly where iOS Safari stops honouring the stickiness.
                      That is why this column stayed pinned on a desktop and
                      scrolled away on a phone, cutting the names in half.

                      Keeping the cell a cell and giving the span the flexbox
                      costs one element and makes the pinning work everywhere.
                    */}
                    <td className="sticky dpcell" title={s.dp.label}>
                      <span className="dpname">
                        {/* Inside the pinned cell on purpose: the tick has to stay
                            reachable while the row is scrolled sideways, or
                            selecting sites you found by their figures means
                            scrolling back left for every one. */}
                        <input
                          type="checkbox"
                          className="dppick"
                          checked={picked.has(s.dp.key)}
                          onChange={() => togglePick(s.dp.key)}
                          aria-label={`Pilih ${s.dp.label} untuk perbandingan`}
                        />
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
                        <span className="dptext">{s.dp.label}</span>
                      </span>
                      {/* The agent, folded into the pinned cell — shown only on a
                          phone, where the column of its own below is hidden. It
                          rides along with the name instead of costing width the
                          indicators need. */}
                      {showAgent && <span className="dpagent">{s.dp.agentLabel}</span>}
                    </td>
                    {showAgent && (
                      <td className="muted agentcol">{s.dp.agentLabel}<Zh>{agentZh(s.dp.agentLabel)}</Zh></td>
                    )}
                    {showStatus && (
                      <td>
                        <span className={`sbadge ${s.kind}`} title={DP_KIND_ZH[s.kind]}>
                          {DP_KIND_LABEL[s.kind]}
                        </span>
                      </td>
                    )}
                    {visKpis.map((k) => {
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
                    {showOnTarget && (
                      <td className="num">
                        {isRankable(s.kind)
                          ? `${s.onTarget}/${s.scored}`
                          : <span className="muted">—</span>}
                      </td>
                    )}
                  </tr>
                ))}
                {!shown.length && (
                  <tr><td colSpan={colCount} className="ctr muted" style={{ padding: 24 }}>
                    Tidak ada yang cocok dengan filter ini.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* nothing to expand while the basket is showing — it is already whole */}
          {!basketOn && filtered.length > 40 && (
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
