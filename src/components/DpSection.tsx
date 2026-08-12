/**
 * Drop point / collection point level view.
 *
 * The agent tabs answer "how is TANGERANG doing?". These per-agent tabs answer
 * the follow-up — "*which* of its 108 drop points is dragging it down?" — so the
 * whole section is scoped to whichever agent the toolbar has selected, and
 * pools every drop point in the region when that selection is ALL AGENTS.
 *
 * What each site actually runs shapes everything below, and it is now **read
 * from the workbook's Jenis Layanan column** rather than inferred from the
 * numbers. A pickup-only site is structurally zero on the delivery categories,
 * and a closed site is zero on all of them. Neither of those zeros is
 * underperformance, so those sites may not appear in a top-five or worst-five
 * list — they are kept in the table with a badge instead, because "why is this
 * one missing?" is a question the table has to be able to answer.
 *
 * That exclusion is the only thing left that turns on the kind. The old rules
 * that *decided* the kind — all-eight-zero means closed, 06:30 and 07:30 zero
 * means pickup-only, TPTW zero means delivery-only — are gone: they were
 * guessing at the reason behind a zero, and they were wrong often enough that a
 * bad morning could be filed as "this site does not do deliveries" and quietly
 * excused. The file says which it is; nothing here second-guesses it.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  BIZ_MODEL_LABEL, BIZ_MODEL_TAG, CANONICAL_ORDER, CATEGORY_ZH, DP_KIND_LABEL, DP_KIND_ZH,
  DP_STATUS_HINT, DP_STATUS_LABEL, DP_STATUS_RANGE, DP_STATUS_ZH, SCORE_TOTAL, SPRINTER_LABELS,
  UNSCORED_LABELS, agentFull, agentZh, dpKindClass, dpTargetFor, dpValue, exportPng, fmtDate,
  fmtDateFull, isRankable, isScored, isoDay, scoreStatusOf, sectionOf,
} from '../lib/jnt'
import type { BizModel, DateSlot, DpKind, DpRow, DpStatus, Kpi, Model } from '../lib/jnt'
import { BarChart, HBarChart } from './Charts'
import type { HBar } from './Charts'
import MultiSelect from './MultiSelect'
import Zh from './Zh'

const TOP_N = 5

/**
 * Sentinel category: rank on how many of the scored KPIs the site met, rather
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
const COL_SPV = '__spv__'
const COL_SERVICE = '__layanan__'
const COL_ONTARGET = '__ontarget__'
const COL_STATUS = '__status__'

/**
 * Columns switched off before anyone touches anything.
 *
 * The table's default was every column on, and eleven columns of a 1,666-row
 * list is not a starting point, it is something to recover from — the first
 * thing anyone did was turn three of them off again. These three are the ones
 * that went: Agen repeats across every row of a single-agent view, Supervisor
 * is a lookup rather than a measurement, and Sesuai target is the raw count the
 * new Status column exists to interpret.
 *
 * All three are one tick away in the switch above the table, and the counter
 * there reads "8/11" from the first paint, so the default announces itself
 * rather than hiding what it did.
 */
const DEFAULT_HIDDEN: readonly string[] = [COL_AGENT, COL_SPV, COL_ONTARGET]

/** Sort order for the Status column — worst first, so `▲` puts the work on top. */
const STATUS_RANK: Record<DpStatus, number> = { urgent: 0, perhatian: 1, stable: 2, '': 3 }

/**
 * Sort order for the Jenis Layanan column — by how much of the operation runs,
 * so the column reads as a scale instead of alphabetically (Delivery, Pickup,
 * Pickup Delivery, Tutup).
 *
 * Sites with no stated service sort last whichever way the column is turned, in
 * the same spirit as the null-sinks-to-the-bottom rule the KPI columns use: an
 * unknown is not the most-running site and it is not the least, it is a gap in
 * the data and belongs out of the way of the comparison.
 */
const KIND_RANK: Record<DpKind, number> = {
  both: 0, delivery: 1, pickup: 2, closed: 3, '': 4,
}

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
  /** the workbook's Jenis Layanan for this site, copied off `dp.service` */
  kind: DpKind
  /** category label → reading on the resolved day, scored or not */
  vals: Record<string, number | null>
  /** scored categories met, out of those with a reading */
  onTarget: number
  scored: number
  /** Urgent / Perhatian / Stable, from how many of `scored` were missed */
  status: DpStatus
  /**
   * Total distance from target across the scored categories, signed so positive
   * is good (`v - target`, flipped for RETUR). Only a tiebreak: on a count of
   * eight, ties are the rule rather than the exception, and without it "worst
   * five" would be five arbitrary sites out of the twenty that all missed three.
   */
  margin: number
}

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
   * in a set written before it existed. Storing the exclusions means an unknown
   * column is visible by construction, and the three names in `DEFAULT_HIDDEN`
   * are the only things anyone has to decide about.
   */
  const [hiddenCols, setHiddenCols] = useState<ReadonlySet<string>>(
    () => new Set<string>(DEFAULT_HIDDEN),
  )

  /** the KPI columns the table actually draws */
  const visKpis = useMemo(
    () => catKpis.filter((k) => !hiddenCols.has(k.label)),
    [catKpis, hiddenCols],
  )
  /* The agent column only exists in the all-agents view at all, so it is hidden
     by either of two independent things and both have to be asked. */
  const showAgent = allAgents && !hiddenCols.has(COL_AGENT)
  const showSpv = !hiddenCols.has(COL_SPV)
  const showService = !hiddenCols.has(COL_SERVICE)
  const showOnTarget = !hiddenCols.has(COL_ONTARGET)
  const showStatus = !hiddenCols.has(COL_STATUS)

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
        { id: COL_SPV, label: 'Supervisor', zh: '主管' },
        { id: COL_SERVICE, label: 'Jenis Layanan', zh: '服务类型' },
      ],
    },
    ...runsOf(catKpis).map((run) => ({
      id: run.id,
      label: run.label,
      cols: run.kpis.map((k) => ({ id: k.label, label: k.label, zh: CATEGORY_ZH[k.label] ?? '' })),
    })),
    {
      id: 'skor',
      label: 'Ringkasan',
      cols: [
        { id: COL_ONTARGET, label: 'Sesuai target', zh: '达标数' },
        { id: COL_STATUS, label: 'Status', zh: '状态' },
      ],
    },
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
      /* Straight off the row. It used to be `dpStatusOf(dp, day.key)`, recomputed
         per day from the readings; the workbook states it once and it no longer
         varies with the date being looked at, which is also the honest answer —
         a site's contracted service does not change because yesterday was slow. */
      const kind = dp.service
      const vals: Record<string, number | null> = {}
      let onTarget = 0, n = 0, margin = 0
      for (const k of catKpis) {
        const v = dpValue(dp, k.label, day.key)
        /* Every category lands in `vals`, scored or not — the per-category
           rankings and the grid cells read from here and still want TTD RITASE 2.
           Only the counting below skips it. */
        vals[k.label] = v
        if (v == null) continue
        /* Off the scorecard by policy, not by data — see `UNSCORED_LABELS`. */
        if (!isScored(k.label)) continue
        /* A Delivery site is zero on the categories it structurally does not run,
           and counting those as misses would score it 4/7 for doing exactly what
           it is there to do. Pickup Delivery sites keep every reading. */
        if (kind === 'delivery' && v === 0) continue
        n++
        const t = dpTargetFor(dp, k)
        if (k.lowerBetter ? v <= t : v >= t) onTarget++
        margin += k.lowerBetter ? t - v : v - t
      }
      return {
        dp, kind, vals, onTarget, scored: n, margin,
        status: isRankable(kind) ? scoreStatusOf(onTarget, n) : '',
      }
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
    /* Sites whose Jenis Layanan cell was blank or unreadable. Counted so the
       four kinds above always add up to the total — a stat row that silently
       does not sum is the fastest way to lose trust in the rest of the page. */
    unknown: scored.filter((s) => !s.kind).length,
  }), [scored])

  /**
   * How the scored sites split across the three Status bands.
   *
   * Counted over `scored` rather than over the filtered rows on purpose: the
   * legend below the filters is a key for the column *and* a standing summary of
   * the agent scope, and a key whose numbers move every time someone types in
   * the search box is neither. The table's own heading already says how many
   * rows the filters left.
   */
  const statusCounts = useMemo(() => ({
    urgent: scored.filter((s) => s.status === 'urgent').length,
    perhatian: scored.filter((s) => s.status === 'perhatian').length,
    stable: scored.filter((s) => s.status === 'stable').length,
    /* Pickup and Tutup sites, and anything with no readings at all — scored
       against nothing, so they carry no band. Filterable in its own right: "show
       me only the ones this scorecard cannot judge" is a real question. */
    none: scored.filter((s) => !s.status).length,
  }), [scored])

  /**
   * The three filter dropdowns' contents, counted over the current agent scope.
   *
   * The counts are the reason these are built here rather than written out as
   * static lists in the markup. A dropdown that says "Pickup 37" answers the
   * question before it is asked, and — more usefully — a "Tutup 0" tells you
   * straight away that unticking it will change nothing, which is exactly the
   * click people waste when a filter is opaque.
   *
   * They deliberately count the whole scope rather than what the *other*
   * filters have left. A count that moved every time a neighbouring box was
   * ticked would be measuring the interaction rather than the data, and the
   * numbers would stop agreeing with the stat cards above the table.
   *
   * The two "not stated" options are conditional. On a clean file they can only
   * ever match nothing, and an option that cannot do anything is a click into a
   * dead end; when they do appear, appearing is itself the signal that the
   * workbook has a gap in it.
   *
   * ── The plates ───────────────────────────────────────────────────────────────
   *
   * Every option except the DP/CP split carries the same badge the table draws
   * for that value, built here from the same `DP_KIND_LABEL` / `dpKindClass` /
   * `BIZ_MODEL_TAG` tables the cells use. Not styling for its own sake: a
   * dropdown reading "Perhatian" in plain type over a column of amber pills makes
   * the reader do a lookup every time, and the lookup is exactly what colour is
   * for. Sharing the source means the two cannot drift, either — a new band gets
   * its plate in the filter the moment it gets one in the table.
   *
   * DP / CP is left plain on purpose. It has no plate in the table: the split is
   * carried by the `CP_` prefix on the name itself, so there is nothing to match.
   */
  const filterOpts = useMemo(() => {
    const n = (p: (s: Scored) => boolean) => scored.filter(p).length
    const unknownBiz = n((s) => !s.dp.bizModel)

    /** one Jenis Layanan option, wearing the table's `.sbadge` */
    const svc = (k: DpKind, count: number, label?: string, zh?: string) => ({
      value: k,
      label: label ?? DP_KIND_LABEL[k],
      zh: zh ?? DP_KIND_ZH[k],
      badge: `sbadge ${dpKindClass(k)}`,
      n: count,
    })
    /** one Status option, wearing the table's `.stbadge` */
    const st = (k: DpStatus, count: number, label?: string, zh?: string) => ({
      value: k,
      label: label ?? DP_STATUS_LABEL[k],
      zh: zh ?? DP_STATUS_ZH[k],
      badge: `stbadge ${k || 'none'}`,
      n: count,
    })
    /** one Model Bisnis option, with the FR / AG chip that prefixes a site name */
    const bm = (k: BizModel, count: number, label?: string, zh?: string) => ({
      value: k,
      label: label ?? BIZ_MODEL_LABEL[k],
      zh,
      tag: { cls: `ptag ${k || 'unknown'}`, text: BIZ_MODEL_TAG[k] },
      n: count,
    })

    return {
      service: [
        svc('both', counts.both),
        svc('delivery', counts.delivery),
        svc('pickup', counts.pickup),
        svc('closed', counts.closed),
        ...(counts.unknown > 0 ? [svc('', counts.unknown, 'Tanpa jenis layanan', '未填')] : []),
      ],
      /* Ordered worst-first, matching the key band under the filters and the
         column's own sort. Three lists of the same three bands in three
         different orders is how a reader stops trusting any of them. */
      status: [
        st('urgent', statusCounts.urgent),
        st('perhatian', statusCounts.perhatian),
        st('stable', statusCounts.stable),
        ...(statusCounts.none > 0 ? [st('', statusCounts.none, 'Tidak dinilai', '未评分')] : []),
      ],
      type: [
        { value: 'dp', label: 'Drop point', zh: '网点', n: n((s) => !s.dp.isCp) },
        { value: 'cp', label: 'Collection point', zh: '揽收点', n: n((s) => s.dp.isCp) },
      ],
      biz: [
        bm('franchise', n((s) => s.dp.bizModel === 'franchise'), undefined, '加盟'),
        bm('agent', n((s) => s.dp.bizModel === 'agent'), undefined, '自营'),
        ...(unknownBiz > 0 ? [bm('', unknownBiz, 'Tanpa model bisnis', '未填')] : []),
      ],
    }
  }, [scored, counts, statusCounts])

  /**
   * The five best or worst sites for one category.
   *
   * Two exclusions, and they are different things:
   *
   *   `rankable` already removed the sites the file says do not run a delivery
   *   shift at all — Pickup and Tutup. Only Pickup Delivery, Delivery, and sites
   *   with no stated service reach here.
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
   * how many of the scored KPIs the site met.
   *
   * The counts are the ones already in the table's "Sesuai target" column and
   * behind its Status badge, so a bar reading 6 / 7, a row reading 6/7 and a
   * "Perhatian" plate can never disagree — a chart that contradicts the table
   * underneath it is worse than no chart. That is also why this is `SCORE_TOTAL`
   * categories rather than every column: TTD RITASE 2 is off the scorecard, so
   * it is off these bars too.
   *
   * The two charts measure opposite things on purpose. Worst counts the misses,
   * best counts the hits, so in both the bar grows in the direction the title
   * promises; a "best" chart drawn on misses would give its winner no bar at all.
   *
   * Sites with nothing scored are dropped — a site with no readings has met 0 of
   * 0, which is not an achievement or a failure. The zero rule that applies to a
   * single-category ranking does not: a 0 here is a real miss on a real KPI, and
   * the site is being judged on seven of them rather than on that one.
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
  /*
   * Three filters, and each holds the values switched **off** rather than the
   * one value chosen. They were single-choice `<select>`s, which could not
   * express the question people were actually asking — "how are the sites that
   * do pickups doing" spans Pickup Delivery *and* Pickup — so each is now a
   * `MultiSelect`. See that file for why the set is stored inside out.
   */
  const [svcOff, setSvcOff] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [stOff, setStOff] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [typeOff, setTypeOff] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [bizOff, setBizOff] = useState<ReadonlySet<string>>(() => new Set<string>())
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
      /* One membership test each, against the switched-off set. A value the
         dropdown has no option for can never be in that set, so it is shown —
         which is the right default for a workbook that grows a category the
         dashboard has not been told about yet. */
      if (svcOff.has(s.kind)) return false
      if (stOff.has(s.status)) return false
      if (typeOff.has(s.dp.isCp ? 'cp' : 'dp')) return false
      if (bizOff.has(s.dp.bizModel)) return false
      /* The supervisor is searchable even though it has no dropdown of its own:
         typing a name is the fastest way to scope the table to one person, and
         it costs nothing to leave in. */
      if (needle
        && !`${s.dp.label} ${s.dp.agentLabel} ${s.dp.supervisor}`.toLowerCase().includes(needle)) {
        return false
      }
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
      if (liveSort === COL_SPV) {
        /* Sites with no named supervisor sink, both ways round — the same rule
           the KPI columns use for a missing reading, and for the same reason. */
        if (!a.dp.supervisor !== !b.dp.supervisor) return a.dp.supervisor ? -1 : 1
        return dir * a.dp.supervisor.localeCompare(b.dp.supervisor)
      }
      if (liveSort === COL_SERVICE) {
        if (!a.kind !== !b.kind) return a.kind ? -1 : 1
        return dir * (KIND_RANK[a.kind] - KIND_RANK[b.kind])
      }
      if (liveSort === COL_ONTARGET) return dir * (a.onTarget - b.onTarget)
      if (liveSort === COL_STATUS) {
        /* Unscored rows sink both ways — the same rule the KPI columns use for a
           missing reading. A site with nothing to judge is not the calmest one. */
        if (!a.status !== !b.status) return a.status ? -1 : 1
        if (STATUS_RANK[a.status] !== STATUS_RANK[b.status]) {
          return dir * (STATUS_RANK[a.status] - STATUS_RANK[b.status])
        }
        /* Within a band, the one that missed more comes first — "Urgent" covers
           four misses and seven, and those are not the same morning. */
        return dir * ((a.scored - a.onTarget) - (b.scored - b.onTarget)) * -1
      }
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
  }, [scored, q, svcOff, stOff, typeOff, bizOff, onlyBelow, tableK, liveSort, liveDir, mode,
      catKpis, basketOn, picked])

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
      ...(showSpv ? ['Supervisor 主管'] : []),
      'Jenis 类型',
      'Model Bisnis 商业模式',
      ...(showService ? ['Jenis Layanan 服务类型'] : []),
      ...visKpis.map((k) => `${k.label}${zh(k)}`),
      ...(showOnTarget ? [`Sesuai target (dari ${SCORE_TOTAL}) 达标数`] : []),
      ...(showStatus ? ['Status 状态'] : []),
    ]

    const body = filtered.map((s) => [
      s.dp.label,
      ...(showAgent ? [agentFull(s.dp.agentLabel)] : []),
      ...(showSpv ? [s.dp.supervisor] : []),
      s.dp.isCp ? 'CP' : 'DP',
      BIZ_MODEL_LABEL[s.dp.bizModel],
      /* `DP_KIND_ZH['']` is deliberately empty, so an unstated service exports as
         a bare "—" rather than as a dash trailing a stray space. */
      ...(showService
        ? [`${DP_KIND_LABEL[s.kind]}${DP_KIND_ZH[s.kind] ? ` ${DP_KIND_ZH[s.kind]}` : ''}`]
        : []),
      ...visKpis.map((k) => cell(s, k)),
      /* only sites that run a delivery shift are scored — see `isRankable` */
      ...(showOnTarget ? [isRankable(s.kind) ? `${s.onTarget}/${s.scored}` : ''] : []),
      /* The band, not the range. A sheet is sorted and filtered on, and
         "Urgent" is worth more as a value you can group by than as prose. */
      ...(showStatus ? [s.status ? DP_STATUS_LABEL[s.status] : ''] : []),
    ])

    const ws = XLSX.utils.aoa_to_sheet([head, ...body])

    /* `0.00"%"` keeps the underlying value at 98.25 while showing "98.25%".
       A real percent format would multiply by 100 and print 9825%.
       Counted off the head rather than hardcoded: which columns precede the
       KPIs now depends on the column switch as well as on the agent scope. */
    const firstKpi = 1 + (showAgent ? 1 : 0) + (showSpv ? 1 : 0) + 2 + (showService ? 1 : 0)
    for (let R = 1; R <= body.length; R++) {
      for (let C = firstKpi; C < firstKpi + visKpis.length; C++) {
        const c = ws[XLSX.utils.encode_cell({ r: R, c: C })]
        if (c && c.t === 'n') c.z = '0.00"%"'
      }
    }

    ws['!cols'] = [
      { wch: 28 },
      ...(showAgent ? [{ wch: 20 }] : []),
      ...(showSpv ? [{ wch: 22 }] : []),
      { wch: 7 },
      { wch: 14 },
      ...(showService ? [{ wch: 24 }] : []),
      ...visKpis.map(() => ({ wch: 15 })),
      ...(showOnTarget ? [{ wch: 18 }] : []),
      ...(showStatus ? [{ wch: 12 }] : []),
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
  const colCount = 1 + (showAgent ? 1 : 0) + (showSpv ? 1 : 0) + (showService ? 1 : 0)
    + visKpis.length + (showOnTarget ? 1 : 0) + (showStatus ? 1 : 0)

  /* a plain function, not a nested component: React would remount a component
     declared inside render on every keystroke and the select would lose focus */
  const catSelect = (cur: string, onChange: (v: string) => void, id: string, withTotal = false) => (
    <select
      className="hsel" value={cur} aria-label={`Kategori yang ditampilkan pada ${id}`}
      onChange={(e) => onChange(e.target.value)}
    >
      {withTotal && (
        <option value={TOTAL_CAT}>{SCORE_TOTAL} INDIKATOR · jumlah sesuai target</option>
      )}
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
        {/* Every hint here now describes what the site *is*, per the workbook's
            Jenis Layanan column — not what its numbers looked like. The old
            hints explained the inference ("TPTW bernilai nol…"), which is
            exactly the reasoning that has been taken out. */}
        <Stat n={counts.both} lab="Pickup Delivery" zh="揽收及派送" tone="good"
              hint="Menjalankan penjemputan dan pengantaran. Masuk peringkat." />
        <Stat n={counts.delivery} lab="Delivery" zh="仅派送" tone="good"
              hint="Hanya mengantar. Masuk peringkat; kategori penjemputan tidak dinilai." />
        <Stat n={counts.pickup} lab="Pickup" zh="仅揽收" tone="warn"
              hint="Hanya menjemput. Dikeluarkan dari peringkat — kategori pengantaran pasti nol." />
        <Stat n={counts.closed} lab="Tutup" zh="已关闭" tone="mute"
              hint="Tidak beroperasi. Dikeluarkan dari peringkat." />
        {/* Only when there are any. A permanent "0 tanpa jenis layanan" card is
            noise on every normal day and says nothing; appearing at all is the
            signal that the Fr&Ag or ALL DP DATA column needs a look. */}
        {counts.unknown > 0 && (
          <Stat n={counts.unknown} lab="Tanpa jenis layanan" zh="未填服务类型" tone="mute"
                hint="Kolom Jenis Layanan kosong atau tidak dikenali di file. Tetap diperingkat agar tidak hilang dari grafik — periksa datanya." />
        )}
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
            type="text" placeholder="Cari DP / CP, agen atau supervisor…" value={q}
            onChange={(e) => setQ(e.target.value)} aria-label="Cari drop point"
            disabled={basketOn}
          />
          {/* Three multi-selects where there were four single-choice selects.
              The supervisor one is gone: with the name searchable in the box to
              the left and shown in its own column, a fourth dropdown listing
              thirty people was width spent on a question nobody was asking yet. */}
          <MultiSelect
            name="Jenis layanan" zh="服务类型" allLabel="Semua jenis layanan"
            options={filterOpts.service} off={svcOff} onChange={setSvcOff}
            disabled={basketOn}
          />
          {/* Second in the row, next to Jenis layanan: both answer "which rows",
              where the two after them answer "which kind of site". It is offered
              whether or not the Status *column* is showing — the column switch
              chooses how wide the table is, this chooses what is in it, and
              wanting the 273 Urgent sites without the column taking up room is a
              perfectly ordinary thing to want. */}
          <MultiSelect
            name="Status" zh="状态" allLabel="Semua status"
            options={filterOpts.status} off={stOff} onChange={setStOff}
            disabled={basketOn}
          />
          <MultiSelect
            name="Jenis" zh="类型" allLabel="DP dan CP"
            options={filterOpts.type} off={typeOff} onChange={setTypeOff}
            disabled={basketOn}
          />
          <MultiSelect
            name="Model bisnis" zh="商业模式" allLabel="Semua model bisnis"
            options={filterOpts.biz} off={bizOff} onChange={setBizOff}
            disabled={basketOn}
          />
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
          The key for the Status column.

          A three-value column whose values are opinions — "Urgent", "Stable" —
          is unreadable without its thresholds, and a `title` on the header is
          not good enough: the question "how bad is Perhatian?" is asked while
          looking at a row, not at a heading, and an answer that needs a hover on
          a different part of the screen does not get found.

          So the bands are written out, each with the count of sites currently in
          it. That second part is what makes this worth its height — the same
          strip that explains the column also says "31 Urgent" before anyone
          sorts or filters anything, which is the first thing you would have gone
          looking for.

          It sits under the column switch rather than above the filters because
          it belongs to the table, not to the finders: everything above chooses
          what the table contains, and this describes what is in it. Hidden with
          the column it explains — a key to something that is not on screen is
          just noise taking up a row.
        */}
        {showStatus && (
          <div className="stleg">
            <span className="stleg-h">
              Status <Zh>状态</Zh>
              <em>dari {SCORE_TOTAL} indikator yang dinilai</em>
            </span>
            <span className="stleg-pills">
              <StatLeg k="urgent" n={statusCounts.urgent} />
              <StatLeg k="perhatian" n={statusCounts.perhatian} />
              <StatLeg k="stable" n={statusCounts.stable} />
            </span>
            {/* Named, not just implied by the arithmetic. Someone counting the
                columns will get eight and the scorecard says seven, and that
                discrepancy should be answered on the same line it is noticed. */}
            <span className="stleg-note">
              {UNSCORED_LABELS.join(', ')} tidak ikut dihitung
            </span>
          </div>
        )}

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
                  {showSpv && <th className="spvcol" />}
                  {showService && <th />}
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
                  {showStatus && <th />}
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
                  {showSpv && (
                    <th className="spvcol" onClick={() => sortOn(COL_SPV)}>
                      Supervisor{arrow(COL_SPV)}<Zh>主管</Zh>
                    </th>
                  )}
                  {showService && (
                    <th onClick={() => sortOn(COL_SERVICE)}>
                      Jenis Layanan{arrow(COL_SERVICE)}<Zh>服务类型</Zh>
                    </th>
                  )}
                  {visKpis.map((k) => {
                    /* An unscored category is still a column and still sortable —
                       it just says so, once, in the header where someone
                       reconciling the count against the columns will look. */
                    const off = !isScored(k.label)
                    return (
                      <th
                        key={k.label}
                        className={`num cat${seamLabels.has(k.label) ? ' seam' : ''}${off ? ' unscored' : ''}`}
                        onClick={() => sortOn(k.label)}
                        title={off ? `${k.label} — tidak dihitung dalam Sesuai target / Status` : k.label}
                      >
                        {k.label}{off ? '*' : ''}{arrow(k.label)}<Zh>{CATEGORY_ZH[k.label] ?? ''}</Zh>
                      </th>
                    )
                  })}
                  {showOnTarget && (
                    <th
                      className="num" onClick={() => sortOn(COL_ONTARGET)}
                      title={`Berapa dari ${SCORE_TOTAL} indikator yang dinilai sudah sesuai target`}
                    >
                      Sesuai target{arrow(COL_ONTARGET)}<Zh>达标数</Zh>
                    </th>
                  )}
                  {showStatus && (
                    <th onClick={() => sortOn(COL_STATUS)}>
                      Status{arrow(COL_STATUS)}<Zh>状态</Zh>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr
                    key={s.dp.key}
                    className={`k-${dpKindClass(s.kind)}${picked.has(s.dp.key) ? ' picked' : ''}`}
                  >
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
                      {/* Agent and supervisor, folded into the pinned cell — shown
                          only on a phone, where their own columns below are
                          hidden. They ride along with the name instead of costing
                          width the indicators need, and share one line separated
                          by a middot rather than taking two: the pinned cell is
                          nearly the whole screen at that width, and a third line
                          of it starts pushing the numbers out of sight. */}
                      {(showAgent || (showSpv && s.dp.supervisor)) && (
                        <span className="dpagent">
                          {showAgent ? s.dp.agentLabel : ''}
                          {showAgent && showSpv && s.dp.supervisor ? ' · ' : ''}
                          {showSpv && s.dp.supervisor ? s.dp.supervisor : ''}
                        </span>
                      )}
                    </td>
                    {showAgent && (
                      <td className="muted agentcol">{s.dp.agentLabel}<Zh>{agentZh(s.dp.agentLabel)}</Zh></td>
                    )}
                    {showSpv && (
                      <td className="spvcol" title={s.dp.supervisor || undefined}>
                        {/* An unnamed supervisor is a dash, not a blank cell: a
                            blank reads as "this column did not load", a dash
                            reads as "the file does not say", and only one of
                            those is true. */}
                        {s.dp.supervisor || <span className="muted">—</span>}
                      </td>
                    )}
                    {showService && (
                      <td>
                        <span
                          className={`sbadge ${dpKindClass(s.kind)}`}
                          title={DP_KIND_ZH[s.kind] || 'Jenis Layanan tidak tercantum di file'}
                        >
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
                      /* Pickup and Tutup sites are grey, not red: their zeros are
                         structural, and colouring them as failures is exactly the
                         false alarm this section exists to remove. A Delivery site
                         is the same story one cell at a time — only the categories
                         it does not run read 0, so those go grey and the rest stay
                         scored normally.
                         This is the last thing that still reasons about a zero,
                         and it is allowed to: it is not deciding *what the site
                         is* — the file already said — only how to shade a cell in
                         a site whose kind is known. */
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
                    {showStatus && (
                      <td>
                        {s.status
                          ? (
                            <span
                              className={`stbadge ${s.status}`}
                              /* The row's own arithmetic, not the generic band —
                                 "4/7 · meleset 3" answers "why is this Urgent?"
                                 on the row that raised the question. */
                              title={`${DP_STATUS_HINT[s.status]} Di sini: ${s.onTarget}/${s.scored} sesuai target.`}
                            >
                              {DP_STATUS_LABEL[s.status]}
                            </span>
                          )
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
        {' '}<b>Jenis Layanan</b> diambil apa adanya dari kolom Jenis Layanan di file
        (<i>ALL DP DATA</i>) — <b>Pickup Delivery</b>, <b>Delivery</b>, <b>Pickup</b>, atau
        {' '}<b>Tutup</b> — bukan lagi ditebak dari angka hari itu. <b>Supervisor</b> diambil dari
        sheet <i>Fr&amp;Ag</i>; tanda <b>—</b> berarti file tidak mencantumkannya.
        {' '}<b>Status</b> dihitung dari {SCORE_TOTAL} indikator — {UNSCORED_LABELS.join(', ')}
        {' '}(bertanda <b>*</b>) tetap ditampilkan tetapi tidak ikut dinilai:
        {' '}<b>Stable</b> {DP_STATUS_RANGE.stable}, <b>Perhatian</b> {DP_STATUS_RANGE.perhatian},
        {' '}<b>Urgent</b> {DP_STATUS_RANGE.urgent}. Yang dihitung adalah <i>berapa yang meleset</i>,
        bukan berapa yang ada nilainya — jadi DP <b>Delivery</b>, yang beberapa kategorinya memang
        nol karena tidak dijalankan, tidak dihukum untuk kategori yang tidak ada di sana.
        {' '}Tanda <b>FR</b> / <b>AG</b> di depan nama adalah model bisnisnya: Franchise atau Agent.
        {' '}Tiga hal dikeluarkan dari peringkat lima terbaik dan lima terburuk: <b>Pickup</b>,
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
 * Says what the bars count when the ranking is over the whole scorecard.
 *
 * Without it "6 / 7" is ambiguous in exactly the way that matters — six met or
 * six missed? — and the two charts genuinely do count opposite things.
 */
function TotalNote({ worst }: { worst: boolean }) {
  return (
    <div className="chartnote">
      {worst
        ? `Jumlah dari ${SCORE_TOTAL} Indikator yang di bawah target — makin panjang makin buruk.`
        : `Jumlah dari ${SCORE_TOTAL} Indikator yang sudah sesuai target — makin panjang makin baik.`}
      {' '}Angka ini sama dengan kolom <b>Sesuai target</b> dan <b>Status</b> di tabel bawah;
      {' '}{UNSCORED_LABELS.join(', ')} tidak ikut dihitung. Bila jumlahnya seri, urutannya
      ditentukan oleh seberapa jauh nilainya dari target.
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

/**
 * One band in the Status key: the name, the range it covers, and how many sites
 * are in it.
 *
 * The range comes from `DP_STATUS_RANGE`, which is computed from the same
 * constants the classifier uses — a key that is typed out by hand is a key that
 * eventually lies, and this one is the only explanation the column has.
 */
function StatLeg({ k, n }: { k: Exclude<DpStatus, ''>; n: number }) {
  return (
    /* No Mandarin gloss on the pill: three of these side by side, each carrying
       both readings plus a range plus a count, is more text than a key can hold.
       The band name is glossed once on the heading beside them, and again in the
       tooltip here. */
    <span className={`stleg-p ${k}`} title={`${DP_STATUS_LABEL[k]} ${DP_STATUS_ZH[k]} — ${DP_STATUS_HINT[k]}`}>
      <span className={`stbadge ${k}`}>{DP_STATUS_LABEL[k]}</span>
      <span className="stleg-r">{DP_STATUS_RANGE[k]}</span>
      <span className="stleg-n">{n}</span>
    </span>
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
