/**
 * One "Display" report — Absensi Tepat Waktu, 0730 & TTD 1200, or TTD All
 * Ritase — at drop-point level.
 *
 * Built from the same furniture as the DP/CP page (`.dphead`, `.dpstats`,
 * `.dpfilters`, `.dpgrid`), so the three sub-pages read as parts of that page
 * rather than as a new app bolted onto it, and every capture and print rule
 * already written for the DP/CP table applies here unchanged.
 *
 * Every headline figure is recomputed from the DP rows in scope — see
 * `ratioOf`. The TOTAL row the workbook carries is not used: in the current file
 * it sums a fixed range rather than every row (the Ritase tab's TOTAL is Jakarta
 * alone), so it disagrees with its own table.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { agentZh, exportPng, isoDay } from '../lib/jnt'
import { fmtDayLong, isActive, ratioOf } from '../lib/display'
import type { DisplayCol, DisplayKpi, DisplayReport, DisplayRow } from '../lib/display'
import type { ExportCol, ExportTable, ExportTone, ExportValue } from '../lib/tableExport'
import { HBarChart } from './Charts'
import type { HBar } from './Charts'
import BtnIcon from './BtnIcon'
import ExportButtons from './ExportButtons'
import MultiSelect from './MultiSelect'
import type { MsOption } from './MultiSelect'
import Zh from './Zh'

const TOP_N = 5
const PAGE = 40

/**
 * How a row stands on the headline figure. `idle` — nothing was due that day,
 * so every figure on the row is 0. Those rows are folded away by default; see
 * `showZero`.
 */
type RowStatus = 'ok' | 'bad' | 'idle'

const STATUS_LABEL: Record<RowStatus, string> = {
  ok: 'Sesuai target', bad: 'Di bawah target', idle: 'Bernilai 0',
}
const STATUS_ZH: Record<RowStatus, string> = { ok: '达标', bad: '未达标', idle: '无数据' }
const STATUS_BADGE: Record<RowStatus, string> = {
  ok: 'stbadge stable', bad: 'stbadge urgent', idle: 'stbadge none',
}
/** worst first, so a status sort puts the work on top */
const STATUS_RANK: Record<RowStatus, number> = { bad: 0, ok: 1, idle: 2 }

const COL_DP = '__dp__'
const COL_AGENT = '__agent__'
const COL_RM = '__rm__'
const COL_STATUS = '__status__'

type SortDir = 'asc' | 'desc'

/** A line of the table body: an RM heading, or a drop point under it. */
type Item =
  | { kind: 'sep'; rm: string; agent: string; rows: DisplayRow[]; zeros: number }
  | { kind: 'row'; row: DisplayRow }

const fmtInt = (v: number | null) => (v == null ? '—' : Math.round(v).toLocaleString('id-ID'))
const fmtPct = (v: number | null) => (v == null ? '—' : v.toFixed(2).replace('.', ','))
const fmtPp = (v: number | null) =>
  v == null ? '—' : `${v > 0 ? '▲ +' : v < 0 ? '▼ ' : '▬ '}${v.toFixed(2).replace('.', ',')}`
const deltaCls = (v: number | null) =>
  v == null || Math.abs(v) < 0.005 ? 'flat' : v > 0 ? 'up' : 'down'

export default function DisplaySection({
  report, part, agentKey, agentLabel, onError,
}: {
  report: DisplayReport
  /** the badge on the band — "B1", "B2", "B3" */
  part: string
  /** '' / 'TOTAL' means every agent */
  agentKey: string
  agentLabel: string
  onError: (msg: string) => void
}) {
  const allAgents = !agentKey || agentKey === 'TOTAL'

  /* ------------------------------------------------------------- scope */

  const scoped = useMemo(() => {
    if (allAgents) return report.rows
    const want = agentLabel.trim().toUpperCase()
    return report.rows.filter((r) => r.agent.toUpperCase() === want)
  }, [report, allAgents, agentLabel])

  /* The 0730 & 1200 tab has two headline figures; the one picked here drives the
     status column, the rankings and the per-RM figure. */
  const [kpiId, setKpiId] = useState(report.kpis[0].id)
  const kpi: DisplayKpi = report.kpis.find((k) => k.id === kpiId) ?? report.kpis[0]

  const targetOf = (r: DisplayRow) => r.target ?? report.target ?? 90
  const statusOf = (r: DisplayRow): RowStatus => {
    if (!isActive(r, kpi)) return 'idle'
    const v = r.vals[kpi.day]
    if (v == null) return 'idle'
    return v >= targetOf(r) - 1e-9 ? 'ok' : 'bad'
  }

  /* ------------------------------------------------------------ filters */

  const [q, setQ] = useState('')
  const [agentOff, setAgentOff] = useState<ReadonlySet<string>>(() => new Set())
  const [rmOff, setRmOff] = useState<ReadonlySet<string>>(() => new Set())
  const [stOff, setStOff] = useState<ReadonlySet<string>>(() => new Set())
  /**
   * The all-zero rows, folded away unless asked for.
   *
   * A site with nothing due that day reads 0 in every column, and a list where a
   * sixth of the rows are zeros buries the ones that need looking at. They are
   * not dropped silently: each RM heading says how many it is holding back and
   * has its own tick to show them, and the bar above has one tick for the lot.
   */
  const [showZero, setShowZero] = useState(false)
  const [zeroRms, setZeroRms] = useState<ReadonlySet<string>>(() => new Set())
  /* Grouped by RM from the start: the list is read one regional manager at a
     time, and the RM headings only mean something in that order. */
  const [sortKey, setSortKey] = useState<string>(COL_RM)
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [showAll, setShowAll] = useState(false)

  const agentList = useMemo(() => [...new Set(scoped.map((r) => r.agent))], [scoped])

  const filterOpts = useMemo(() => {
    const count = (pick: (r: DisplayRow) => string) => {
      const m = new Map<string, number>()
      for (const r of scoped) m.set(pick(r), (m.get(pick(r)) ?? 0) + 1)
      return m
    }
    const agents = count((r) => r.agent)
    const rms = count((r) => r.rm || '—')
    const st = new Map<RowStatus, number>()
    for (const r of scoped) st.set(statusOf(r), (st.get(statusOf(r)) ?? 0) + 1)
    return {
      agent: [...agents].map(([v, n]): MsOption => ({ value: v, label: v, zh: agentZh(v), n })),
      rm: [...rms].sort((a, b) => a[0].localeCompare(b[0])).map(([v, n]): MsOption => ({ value: v, label: v, n })),
      /* The zero rows have their own tick, so they are not a status to filter. */
      status: (['bad', 'ok'] as RowStatus[]).map((s): MsOption => ({
        value: s, label: STATUS_LABEL[s], zh: STATUS_ZH[s], n: st.get(s) ?? 0, badge: STATUS_BADGE[s],
      })),
      counts: st,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, kpi])

  /* The sheet's own visible columns, as the sheet shows them — see
     `parseDisplaySheet`. A merged header is a band over its columns; a column
     with a header of its own has an empty band above it. */
  const visCols = report.cols
  const bands = useMemo(() => {
    const out: { id: string; label: string; zh: string; span: number }[] = []
    for (const c of visCols) {
      const last = out[out.length - 1]
      if (last && c.group && last.id === c.group) last.span++
      else {
        const g = report.groups.find((x) => x.id === c.group)
        out.push({ id: c.group || c.id, label: g?.label ?? '', zh: g?.zh ?? '', span: 1 })
      }
    }
    return out
  }, [visCols, report])
  /* a rule down the left of every band, so each merged header reads as a block */
  const seamIds = useMemo(() => {
    const s = new Set<string>()
    visCols.forEach((c, i) => {
      if (i > 0 && (c.group !== visCols[i - 1].group || !c.group)) s.add(c.id)
    })
    return s
  }, [visCols])

  /* The Agen column exists only in the all-agents view; a sort on it falls back
     to the RM order without forgetting what was asked for. */
  const sortGone = sortKey === COL_AGENT && !allAgents
  const liveSort = sortGone ? COL_RM : sortKey
  const liveDir: SortDir = sortGone ? 'asc' : sortDir
  const grouped = liveSort === COL_RM

  /** Every row the filters keep, zeros included, in table order. */
  const base = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const out = scoped.filter((r) => {
      if (agentOff.has(r.agent)) return false
      if (rmOff.has(r.rm || '—')) return false
      if (stOff.has(statusOf(r))) return false
      if (needle && !`${r.dp} ${r.rm} ${r.agent}`.toLowerCase().includes(needle)) return false
      return true
    })
    const dir = liveDir === 'asc' ? 1 : -1
    const colKind = new Map(report.cols.map((c) => [c.id, c]))
    return [...out].sort((a, b) => {
      if (liveSort === COL_DP) return dir * a.dp.localeCompare(b.dp)
      if (liveSort === COL_AGENT) return dir * a.agent.localeCompare(b.agent) || a.dp.localeCompare(b.dp)
      if (liveSort === COL_RM) {
        if (!a.rm !== !b.rm) return a.rm ? -1 : 1
        /* within an RM, the sheet's own order — the sort is stable */
        return dir * a.rm.localeCompare(b.rm)
      }
      if (liveSort === COL_STATUS) {
        const d = STATUS_RANK[statusOf(a)] - STATUS_RANK[statusOf(b)]
        if (d) return dir * d
      }
      const key = liveSort === COL_STATUS ? kpi.day : liveSort
      const c = colKind.get(key)
      /* A zero row's 0,00% is "nothing was due", not the worst score in the
         region — so its percentages sink, whichever way the column turns. */
      const val = (r: DisplayRow) =>
        c && c.kind !== 'int' && !isActive(r, kpi) ? null : r.vals[key] ?? null
      const av = val(a), bv = val(b)
      if (av == null && bv == null) return a.dp.localeCompare(b.dp)
      if (av == null) return 1
      if (bv == null) return -1
      return dir * (av - bv) || a.dp.localeCompare(b.dp)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, q, agentOff, rmOff, stOff, liveSort, liveDir, kpi, report])

  const zeroShown = (r: DisplayRow) =>
    showZero || zeroRms.has(r.rm || '—') || statusOf(r) !== 'idle'
  /** What the table, its title and the exports hold. */
  const filtered = useMemo(
    () => base.filter(zeroShown),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, showZero, zeroRms, kpi],
  )
  const zeroTotal = base.length - base.filter((r) => statusOf(r) !== 'idle').length

  /**
   * The body, in order. In RM order every RM opens with a heading — including
   * an RM whose sites are all zeros and so all folded away, because its heading
   * is where the tick to show them lives.
   */
  const items = useMemo((): Item[] => {
    if (!grouped) return filtered.map((row) => ({ kind: 'row', row }))
    const out: Item[] = []
    let cur: Extract<Item, { kind: 'sep' }> | null = null
    for (const r of base) {
      const rm = r.rm || '—'
      if (!cur || cur.rm !== rm) {
        cur = { kind: 'sep', rm, agent: r.agent, rows: [], zeros: 0 }
        out.push(cur)
      }
      cur.rows.push(r)
      if (statusOf(r) === 'idle') cur.zeros++
      if (zeroShown(r)) out.push({ kind: 'row', row: r })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grouped, base, filtered])

  /* Forty drop points, and the headings that come with them. */
  const shownItems = useMemo(() => {
    if (showAll) return items
    const out: Item[] = []
    let n = 0
    for (const it of items) {
      if (it.kind === 'row' && n >= PAGE) break
      if (it.kind === 'row') n++
      out.push(it)
    }
    /* a heading with nothing under it at the cut is noise, not a promise */
    while (out.length && out[out.length - 1].kind === 'sep' && n >= PAGE) out.pop()
    return out
  }, [items, showAll])

  const anyFilter = !!q.trim() || agentOff.size > 0 || rmOff.size > 0 || stOff.size > 0
  const resetFilters = () => {
    setQ(''); setAgentOff(new Set()); setRmOff(new Set()); setStOff(new Set())
  }
  const toggleZeroRm = (rm: string) => setZeroRms((prev) => {
    const next = new Set(prev)
    if (next.has(rm)) next.delete(rm)
    else next.add(rm)
    return next
  })

  /* One agent picked from the chart: the Agen filter with every other agent
     switched off, so the dropdown says the same thing the chart does. */
  const focusAgent = agentList.length > 1 && agentOff.size === agentList.length - 1
    ? agentList.find((a) => !agentOff.has(a)) ?? null
    : null
  const tableRef = useRef<HTMLDivElement>(null)
  const pickAgent = (a: string) => {
    if (focusAgent === a) setAgentOff(new Set())
    else setAgentOff(new Set(agentList.filter((x) => x !== a)))
    setShowAll(false)
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const sortOn = (key: string) => {
    if (sortKey === key && !sortGone) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else {
      setSortKey(key)
      setSortDir(key === COL_DP || key === COL_AGENT || key === COL_RM || key === COL_STATUS ? 'asc' : 'desc')
    }
  }
  const arrow = (key: string) => (liveSort === key ? (liveDir === 'asc' ? ' ▲' : ' ▼') : '')

  /* ----------------------------------------------------------- sticky band */

  const secRowRef = useRef<HTMLTableRowElement>(null)
  /* Same measurement as the DP/CP table — the category row sticks under the band
     at the band's real height, see DpSection. */
  useLayoutEffect(() => {
    const row = secRowRef.current
    const table = row?.closest('table') as HTMLElement | null
    if (!row || !table) return
    const apply = () => {
      table.style.setProperty('--secrow-h', `${Math.max(0, Math.floor(row.getBoundingClientRect().height))}px`)
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(row)
    return () => ro.disconnect()
  }, [bands, allAgents])

  /* ------------------------------------------------------------ summaries */

  const summary = (k: DisplayKpi) => {
    const day = ratioOf(scoped, k.dayRatio)
    const prev = ratioOf(scoped, k.prevRatio)
    const week = ratioOf(scoped, k.weekRatio)
    const weekPrev = ratioOf(scoped, k.weekPrevRatio)
    return {
      day, prev,
      delta: day != null && prev != null ? day - prev : null,
      month: ratioOf(scoped, k.monthRatio),
      week,
      weekDelta: week != null && weekPrev != null ? week - weekPrev : null,
    }
  }

  const target = report.target ?? 90
  const active = useMemo(() => scoped.filter((r) => isActive(r, kpi) && r.vals[kpi.day] != null), [scoped, kpi])

  const bar = (r: DisplayRow): HBar => ({
    name: r.dp,
    sub: allAgents ? `${r.agent}${r.rm ? ` · ${r.rm}` : ''}` : r.rm,
    value: r.vals[kpi.day] ?? 0,
  })
  const ranked = useMemo(
    () => [...active].sort((a, b) => (b.vals[kpi.day] ?? 0) - (a.vals[kpi.day] ?? 0)),
    [active, kpi],
  )
  const topBars = ranked.slice(0, TOP_N).map(bar)
  const worstBars = ranked.slice(-TOP_N).reverse().map(bar)

  const byAgent = useMemo(() => {
    if (!allAgents) return []
    const groups = new Map<string, DisplayRow[]>()
    for (const r of report.rows) {
      const g = groups.get(r.agent)
      if (g) g.push(r)
      else groups.set(r.agent, [r])
    }
    const out: AgentBar[] = []
    for (const [a, rows] of groups) {
      const value = ratioOf(rows, kpi.dayRatio)
      if (value == null) continue
      out.push({
        agent: a, value, sites: rows.length,
        below: rows.filter((r) => statusOf(r) === 'bad').length,
      })
    }
    return out.sort((a, b) => b.value - a.value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allAgents, report, kpi])

  /* ------------------------------------------------------------- exports */

  const dayLabel = fmtDayLong(report.date)
  const scope = allAgents ? `SEMUA AGEN · ${new Set(report.rows.map((r) => r.agent)).size} agen` : agentLabel

  const fileStem = () => {
    const who = (focusAgent ?? (allAgents ? 'Semua Agen' : agentLabel)).replace(/[\\/:*?"<>|]+/g, ' ').trim()
    return `${report.label.replace(/[\\/:*?"<>|&]+/g, ' ').replace(/\s+/g, ' ')} ${who} ${report.date ? isoDay(report.date) : ''}`.trim()
  }

  const [pngBusy, setPngBusy] = useState(false)
  const savePng = async () => {
    if (!tableRef.current || pngBusy) return
    setPngBusy(true)
    onError('')
    try {
      await exportPng(tableRef.current, `${fileStem()}.png`, 'shoot-table')
    } catch (ex) {
      onError((ex as Error).message)
    } finally {
      setPngBusy(false)
    }
  }

  const cellTone = (r: DisplayRow, c: DisplayCol, v: number): ExportTone => {
    if (c.kind === 'delta') return v > 0.005 ? 'ok' : v < -0.005 ? 'bad' : ''
    if (!c.scored) return ''
    if (!isActive(r, kpi)) return 'mute'
    return v >= targetOf(r) - 1e-9 ? 'ok' : 'bad'
  }

  const buildExport = (): ExportTable => {
    const cols: ExportCol[] = [{ head: 'DP / CP', width: 30 }]
    if (allAgents) cols.push({ head: 'Agen', width: 14 })
    cols.push({ head: 'RM', width: 24 })
    for (const c of visCols) {
      const g = report.groups.find((x) => x.id === c.group)
      cols.push({ head: c.label, group: g?.label, kind: c.kind, width: c.kind === 'int' ? 13 : 14 })
    }
    cols.push({ head: 'Status', width: 16 })
    const tone: Record<RowStatus, ExportTone> = { ok: 'ok', bad: 'bad', idle: 'mute' }
    const rows = filtered.map((r): ExportValue[] => {
      const row: ExportValue[] = [r.dp]
      if (allAgents) row.push(r.agent)
      row.push(r.rm || null)
      for (const c of visCols) {
        const v = r.vals[c.id]
        row.push(v == null ? null : { v, tone: cellTone(r, c, v) })
      }
      const s = statusOf(r)
      row.push({ v: STATUS_LABEL[s], tone: tone[s] })
      return row
    })
    return {
      title: report.title,
      meta: [
        `Agen: ${focusAgent ?? (allAgents ? 'Semua agen' : agentLabel)} · ${dayLabel} · Target ≥ ${fmtPct(target)}%`,
        `${filtered.length} dari ${scoped.length} DP / CP${q.trim() ? ` · pencarian "${q.trim()}"` : ''} · status dinilai pada ${kpi.label}`,
      ],
      stem: fileStem(),
      cols,
      rows,
      note: 'Hijau = sesuai target, merah = di bawah target, abu-abu = bernilai 0 (tidak ada yang seharusnya dihitung hari itu). '
        + 'Kolom perbandingan dalam poin persentase.',
    }
  }

  /* --------------------------------------------------------------- render */

  const colCount = 2 + (allAgents ? 1 : 0) + 1 + visCols.length
  const multi = report.kpis.length > 1
  const counts = filterOpts.counts
  const rowCount = items.filter((it) => it.kind === 'row').length
  const shownRows = shownItems.filter((it) => it.kind === 'row').length

  return (
    <div className="dpsection dxsection">
      <div className="dphead">
        <span className="partnum">{part}</span>
        <span className="dptitles">
          <h2>{report.title} <Zh>{report.zh}</Zh></h2>
          <span className="partsub">
            Rincian per drop point &amp; collection point — {scope}
            <Zh>{allAgents ? '' : agentZh(agentLabel)}</Zh> · {dayLabel} · Target ≥ {fmtPct(target)}%
          </span>
        </span>
        <span className="dpday">
          <em>sumber: sheet “{report.sheet}”</em>
        </span>
      </div>

      {/* The headline figures. With two of them the cards double as the switch
          for which one the rest of the page is judged on. */}
      <div className={`dxcards${multi ? ' multi' : ''}`}>
        {report.kpis.map((k) => {
          const s = summary(k)
          const ok = s.day != null && s.day >= target
          const cls = `dxcard ${s.day == null ? 'na' : ok ? 'ok' : 'bad'}${multi && k.id === kpi.id ? ' on' : ''}`
          const body = (
            <>
              <span className="dxc-lab">{k.label}<Zh>{k.zh}</Zh></span>
              <span className="dxc-main">
                <span className="dxc-val">{s.day == null ? '—' : `${fmtPct(s.day)}%`}</span>
                <span className={`dxc-delta ${deltaCls(s.delta)}`} title="Dibanding hari sebelumnya, poin persentase">
                  {fmtPp(s.delta)}
                </span>
              </span>
              <span className="dxc-tgt">Target ≥ {fmtPct(target)}% · {dayLabel}</span>
              <span className="dxc-foot">
                <span><em>H-1</em>{s.prev == null ? '—' : `${fmtPct(s.prev)}%`}</span>
                <span><em>Bulanan</em>{s.month == null ? '—' : `${fmtPct(s.month)}%`}</span>
                {k.weekRatio && (
                  <span>
                    <em>Mingguan</em>{s.week == null ? '—' : `${fmtPct(s.week)}%`}
                    {s.weekDelta != null && <i className={deltaCls(s.weekDelta)}> {fmtPp(s.weekDelta)}</i>}
                  </span>
                )}
              </span>
            </>
          )
          return multi ? (
            <button
              key={k.id} type="button" className={cls} onClick={() => setKpiId(k.id)}
              aria-pressed={k.id === kpi.id}
              title="Status, peringkat, dan urutan tabel dinilai pada indikator ini"
            >{body}</button>
          ) : <div key={k.id} className={cls}>{body}</div>
        })}
      </div>

      <div className="dpstats">
        <Stat n={scoped.length} lab="Total DP / CP" zh="网点总数" />
        <Stat n={counts.get('ok') ?? 0} lab="Sesuai target" zh="达标" tone="good"
              hint={`${kpi.label} ≥ target pada ${dayLabel}.`} />
        <Stat n={counts.get('bad') ?? 0} lab="Di bawah target" zh="未达标" tone="bad"
              hint={`${kpi.label} di bawah target pada ${dayLabel}.`} />
        <Stat n={counts.get('idle') ?? 0} lab="Bernilai 0" zh="无数据" tone="mute"
              hint="Tidak ada yang seharusnya dihitung hari itu — disembunyikan di tabel kecuali dicentang, dan tidak diperingkat." />
      </div>

      {byAgent.length > 1 && (
        <div className="panel agpanel">
          <h3>
            <span className="ptitle">{kpi.label} per Agen <Zh>各代理区</Zh> · {dayLabel}</span>
            {focusAgent
              ? (
                <button className="btn tiny act act-clear" onClick={() => setAgentOff(new Set())}>
                  <BtnIcon name="list" />
                  <span>Tampilkan semua agen</span>
                </button>
              )
              : <span className="aghint">Klik agen untuk melihat DP/CP-nya di tabel</span>}
          </h3>
          <div className="body">
            <AgentColumns bars={byAgent} target={target} focus={focusAgent} onPick={pickAgent} />
          </div>
        </div>
      )}

      <div className="row-dp">
        <div className="panel">
          <h3><span className="ptitle">{TOP_N} DP / CP Terbaik <Zh>前五名网点</Zh> · {kpi.label}</span></h3>
          <div className="body"><HBarChart bars={topBars} targetLine={target} /></div>
        </div>
        <div className="panel">
          <h3><span className="ptitle">{TOP_N} DP / CP Terburuk <Zh>后五名网点</Zh> · {kpi.label}</span></h3>
          <div className="body">
            <HBarChart bars={worstBars} targetLine={target} />
            {counts.get('idle') ? (
              <div className="chartnote">
                {counts.get('idle')} DP/CP bernilai 0 tidak ikut diperingkat.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="panel dptable" ref={tableRef}>
        <h3>
          <span className="ptitle">
            Daftar DP / CP <Zh>网点清单</Zh>{focusAgent && <> · {focusAgent}<Zh>{agentZh(focusAgent)}</Zh></>}
            {' '}— {filtered.length} dari {scoped.length} · {dayLabel}
          </span>
          <button
            className={`btn tiny act act-png${pngBusy ? ' is-busy' : ''}`}
            onClick={savePng} disabled={pngBusy}
            title="Simpan tabel ini sebagai gambar PNG, persis seperti di layar"
          >
            <BtnIcon name={pngBusy ? 'spin' : 'image'} />
            <span>{pngBusy ? 'Menyimpan…' : 'Simpan PNG · Tabel'}</span>
          </button>
          <ExportButtons build={buildExport} onError={onError} />
        </h3>

        <div className="dpfilters">
          <div className="dpsearchbox">
            <input
              type="text" placeholder="Cari DP / CP atau RM…" value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Cari drop point atau RM"
            />
            {q && (
              <button type="button" className="dpsearchx" onClick={() => setQ('')}
                      title="Hapus kata kunci" aria-label="Hapus kata kunci">×</button>
            )}
          </div>
          {allAgents && (
            <MultiSelect name="Agen" zh="代理区" allLabel="Semua agen"
                         options={filterOpts.agent} off={agentOff} onChange={setAgentOff} />
          )}
          <MultiSelect name="RM" zh="区域经理" allLabel="Semua RM"
                       options={filterOpts.rm} off={rmOff} onChange={setRmOff} />
          <MultiSelect name="Status" zh="状态" allLabel="Semua status"
                       options={filterOpts.status} off={stOff} onChange={setStOff} />
          {multi && (
            <div className="seg" role="group" aria-label="Indikator untuk status">
              {report.kpis.map((k) => (
                <button key={k.id} className={k.id === kpi.id ? 'on' : ''} onClick={() => setKpiId(k.id)}>
                  {k.label}
                </button>
              ))}
            </div>
          )}
          <label className={`zerotoggle${showZero ? ' on' : ''}`} title="DP/CP yang tidak punya apa pun untuk dihitung hari itu">
            <input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} />
            Tampilkan DP/CP bernilai 0 <b>{zeroTotal}</b>
          </label>
          {anyFilter && (
            <button className="btn tiny act act-clear" onClick={resetFilters}>
              <BtnIcon name="clear" />
              <span>Reset filter</span>
            </button>
          )}
        </div>

        <div className="body" style={{ padding: 0 }}>
          <div className="dpscroll">
            <table className="dpgrid dxgrid">
              <thead>
                <tr className="secrow" ref={secRowRef}>
                  <th className="sticky" />
                  {allAgents && <th className="agentcol" />}
                  <th className="rmcol" />
                  {bands.map((b, i) => (
                    <th
                      key={b.id} colSpan={b.span}
                      className={`${b.label ? 'secband dxband' : ''}${i > 0 ? ' seam' : ''}`}
                    >
                      {b.label}{b.zh && <Zh>{b.zh}</Zh>}
                    </th>
                  ))}
                  <th className="seam" />
                </tr>
                <tr className="catrow">
                  <th className="sticky" onClick={() => sortOn(COL_DP)}>DP / CP{arrow(COL_DP)}<Zh>网点</Zh></th>
                  {allAgents && (
                    <th className="agentcol" onClick={() => sortOn(COL_AGENT)}>Agen{arrow(COL_AGENT)}<Zh>代理区</Zh></th>
                  )}
                  <th className="rmcol" onClick={() => sortOn(COL_RM)}>RM{arrow(COL_RM)}<Zh>区域经理</Zh></th>
                  {visCols.map((c) => (
                    <th
                      key={c.id}
                      className={`num cat${seamIds.has(c.id) ? ' seam' : ''}${c.group ? ' dxdate' : ''}${c.id === kpi.day ? ' dxkey' : ''}`}
                      onClick={() => sortOn(c.id)}
                      title={c.kind === 'delta' ? `${c.label} — poin persentase` : c.label}
                    >
                      {c.label}{arrow(c.id)}{c.zh && <Zh>{c.zh}</Zh>}
                    </th>
                  ))}
                  <th className="seam" onClick={() => sortOn(COL_STATUS)}>Status{arrow(COL_STATUS)}<Zh>状态</Zh></th>
                </tr>
              </thead>
              <tbody>
                {shownItems.map((it) => {
                  if (it.kind === 'sep') {
                    const live = it.rows.filter((x) => statusOf(x) !== 'idle')
                    const pct = ratioOf(it.rows, kpi.dayRatio)
                    const bad = live.filter((x) => statusOf(x) === 'bad').length
                    const open = showZero || zeroRms.has(it.rm)
                    return (
                      <tr className="rmsep" key={`sep|${it.rm}`}>
                        <td colSpan={colCount}>
                          <span className="rmsep-in">
                            <b>{it.rm === '—' ? 'Tanpa RM' : it.rm}</b>
                            {allAgents && <span>{it.agent}</span>}
                            <span>{live.length} DP/CP</span>
                            {pct != null && (
                              <span className={pct >= target ? 'up' : 'down'}>{kpi.label} {fmtPct(pct)}%</span>
                            )}
                            {bad > 0 && <span className="down">{bad} di bawah target</span>}
                            {it.zeros > 0 && (
                              <label className={`rmzero${open ? ' on' : ''}`}>
                                <input
                                  type="checkbox" checked={open} disabled={showZero}
                                  onChange={() => toggleZeroRm(it.rm)}
                                />
                                {open ? 'Sembunyikan' : 'Tampilkan'} {it.zeros} DP/CP bernilai 0
                              </label>
                            )}
                          </span>
                        </td>
                      </tr>
                    )
                  }
                  const r = it.row
                  const st = statusOf(r)
                  const live = isActive(r, kpi)
                  return (
                      <tr key={r.key} className={st === 'idle' ? 'k-closed' : ''}>
                        <td className="sticky dpcell" title={r.dp}>
                          <span className="dpname"><span className="dptext">{r.dp}</span></span>
                          <span className="dpagent">{[allAgents ? r.agent : '', r.rm].filter(Boolean).join(' · ')}</span>
                        </td>
                        {allAgents && <td className="muted agentcol">{r.agent}<Zh>{agentZh(r.agent)}</Zh></td>}
                        <td className="rmcol" title={r.rm || undefined}>{r.rm || <span className="muted">—</span>}</td>
                        {visCols.map((c) => {
                          const seam = seamIds.has(c.id) ? ' seam' : ''
                          const v = r.vals[c.id]
                          if (v == null) return <td key={c.id} className={`num muted${seam}`}>—</td>
                          if (c.kind === 'int') return <td key={c.id} className={`num${seam}`}>{fmtInt(v)}</td>
                          if (c.kind === 'delta') {
                            return (
                              <td key={c.id} className={`num${seam}`}>
                                {live ? <span className={deltaCls(v)}>{fmtPp(v)}</span> : <span className="muted">—</span>}
                              </td>
                            )
                          }
                          const t = targetOf(r)
                          const cls = !c.scored ? '' : !live ? ' hm off' : v >= t - 1e-9 ? ' hm ok' : ' hm bad'
                          return (
                            <td key={c.id} className={`num${cls}${seam}`} title={`${c.label} · target ≥ ${fmtPct(t)}%`}>
                              {fmtPct(v)}
                            </td>
                          )
                        })}
                        <td className="seam">
                          <span className={STATUS_BADGE[st]} title={`${kpi.label}: ${fmtPct(r.vals[kpi.day] ?? null)}% · target ≥ ${fmtPct(targetOf(r))}%`}>
                            {STATUS_LABEL[st]}
                          </span>
                        </td>
                      </tr>
                  )
                })}
                {!shownItems.length && (
                  <tr><td colSpan={colCount} className="ctr muted" style={{ padding: 24 }}>
                    Tidak ada yang cocok dengan filter ini.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {rowCount > PAGE && (
            <div className="dpmore">
              <button
                className="btn act act-more" aria-expanded={showAll}
                onClick={() => {
                  const collapsing = showAll
                  setShowAll(!showAll)
                  if (collapsing) tableRef.current?.scrollIntoView({ block: 'start' })
                }}
              >
                <span>{showAll ? `Tampilkan ${PAGE} pertama` : `Tampilkan semua ${rowCount} (${rowCount - shownRows} lagi)`}</span>
                <BtnIcon name={showAll ? 'collapse' : 'list'} />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="note">
        Data dari sheet <i>{report.sheet}</i>, {dayLabel}. Persentase ringkasan, per agen, per RM, dan
        {' '}per filter <b>dihitung ulang dari baris DP/CP</b> (jumlah pembilang ÷ jumlah penyebut),
        bukan diambil dari baris TOTAL di file. <b>Status</b> dinilai pada <b>{kpi.label}</b> hari itu
        {' '}terhadap target tiap DP/CP. DP/CP <b>bernilai 0</b> — yang tidak punya apa pun untuk
        {' '}dihitung hari itu — disembunyikan; centang di baris RM atau di atas tabel untuk
        {' '}menampilkannya. Kolom <b>Perbandingan</b> dalam poin persentase.
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ agent chart */

interface AgentBar { agent: string; value: number; sites: number; below: number }

/**
 * One column per agent, tallest first, against the target line.
 *
 * Columns rather than the horizontal bar list the DP rankings use: ten agents
 * fit across the panel at a third of the height, and "who is under the line" is
 * read at a glance along one edge. Every column is a button — clicking it scopes
 * the table below to that agent, clicking it again (or "Tampilkan semua agen")
 * brings every agent back.
 *
 * The scale starts a little below the lowest figure rather than at zero: every
 * agent sits in the 90s, and from zero the ten columns would be ten identical
 * slabs with the differences in the last few pixels.
 */
function AgentColumns({ bars, target, focus, onPick }: {
  bars: AgentBar[]
  target: number
  focus: string | null
  onPick: (agent: string) => void
}) {
  const lo = Math.max(0, Math.floor(Math.min(target, ...bars.map((b) => b.value)) - 3))
  const hi = 100
  const y = (v: number) => Math.max(2, Math.min(100, ((v - lo) / (hi - lo)) * 100))
  return (
    <div className="agchart" style={{ ['--ag-n' as string]: bars.length }}>
      <div className="agtarget" style={{ ['--ag-t' as string]: y(target) }}>
        <span>≥ {fmtPct(target)}%</span>
      </div>
      {bars.map((b) => {
        const ok = b.value >= target
        const on = focus === b.agent
        return (
          <button
            key={b.agent} type="button"
            className={`agcol${ok ? ' ok' : ' bad'}${on ? ' on' : ''}${focus && !on ? ' dim' : ''}`}
            onClick={() => onPick(b.agent)}
            aria-pressed={on}
            title={`${b.agent}: ${fmtPct(b.value)}% · ${b.sites} DP/CP · ${b.below} di bawah target — klik untuk ${on ? 'kembali ke semua agen' : 'melihat DP/CP-nya di tabel'}`}
          >
            <span className="agplot">
              <span className="agfill" style={{ height: `${y(b.value)}%` }}>
                <span className="agval">{fmtPct(b.value)}</span>
              </span>
            </span>
            <span className="agname">{b.agent}</span>
            <span className="agsub">{b.sites} DP · {b.below > 0 ? <em>{b.below} ↓</em> : '✓'}</span>
          </button>
        )
      })}
    </div>
  )
}

function Stat({ n, lab, zh, tone = '', hint }: {
  n: number; lab: string; zh: string; tone?: string; hint?: string
}) {
  return (
    <div className={`dpstat ${tone}`} title={hint}>
      <span className="n">{n.toLocaleString('id-ID')}</span>
      <span className="l">{lab}<Zh>{zh}</Zh></span>
    </div>
  )
}
