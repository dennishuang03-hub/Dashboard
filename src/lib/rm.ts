/**
 * The "RM Pencapaian" tabs — achievement per regional manager (RM).
 *
 *   RM Pencapaian Harian     one column per day, newest first, then "vs H-1"
 *   RM Pencapaian Mingguan   this week, last week, then "vs Minggu Lalu"
 *   RM Pencapaian Bulanan    the month's counts, then "Persentase"
 *
 * All three share one layout: a title in A1, a two-row header (row 2 names the
 * indicator as a band merged over its columns, row 3 names each column), a
 * Target row, a TOTAL JAWA-BALI row, and then per region a "Total Regional" row
 * followed by one row per RM — Regional, RM, Jumlah DP/CP, figures.
 *
 * The indicators are read from the bands rather than listed here. A band the
 * sheet gains later becomes one more line on every RM card without a change to
 * this file; `KNOWN` only gives the familiar ones their short names and order.
 *
 * Retur is not in these tabs. It is computed per RM from the "Display Retur"
 * tab, which carries an RM column on every drop point — see `attachRetur`.
 */
import * as XLSX from 'xlsx'
import { cellText, latin } from './jnt'
import { ratioOf } from './display'
import type { DisplayId, DisplayKpi, DisplayReport, DisplayRow, Ratio } from './display'

export type RmPeriod = 'harian' | 'mingguan' | 'bulanan'

export const RM_PERIODS: { id: RmPeriod; label: string; zh: string }[] = [
  { id: 'harian', label: 'Harian', zh: '日' },
  { id: 'mingguan', label: 'Mingguan', zh: '周' },
  { id: 'bulanan', label: 'Bulanan', zh: '月累计' },
]

/** One indicator — a band in the sheet, or Retur from the Display tab. */
export interface RmIndicator {
  id: string
  label: string
  /** the name on an RM card, where the line is narrow — "Keluar 07:30" */
  short: string
  zh: string
  /** percent, e.g. 90 */
  target: number | null
  /** a rate to keep under its target (Retur) */
  lowerBetter: boolean
}

/** One indicator's figure for one row, in percent; delta in percentage points. */
export interface RmFigure {
  cur: number | null
  prev: number | null
  delta: number | null
  /** every dated column the sheet has, oldest first — the daily tab's three days */
  series?: (number | null)[]
}

export interface RmRow {
  key: string
  /** Latin part of the Regional column — `JAKARTA雅加达` → `JAKARTA` */
  region: string
  rm: string
  /** Jumlah DP/CP */
  sites: number | null
  vals: Record<string, RmFigure>
}

export interface RmReport {
  period: RmPeriod
  sheet: string
  /** what the figures cover — "27 Sep", "21 Sep - 27 Sep", "01 Sep - 27 Sep 2026" */
  periodLabel: string
  /** what the comparison is against — "26 Sep", "14 Sep - 20 Sep"; '' when there is none */
  prevLabel: string
  /** the headings of `RmFigure.series`, oldest first — "25 Sep", "26 Sep", "27 Sep" */
  seriesLabels: string[]
  indicators: RmIndicator[]
  /** RMs only — no totals, no unassigned ("-") rows */
  rows: RmRow[]
  /** the "Total Regional" rows, by region */
  regionTotals: Record<string, RmRow>
  /** the TOTAL JAWA-BALI row */
  total: RmRow | null
  /** regions in sheet order */
  regions: string[]
}

/* ------------------------------------------------------------ recognition */

/** Which RM tab a sheet is, by name. */
export function rmPeriodOf(sheetName: string): RmPeriod | null {
  const m = sheetName.toLowerCase().match(/^\s*rm\s+pencapaian\s+(harian|mingguan|bulanan)\b/)
  return m ? (m[1] as RmPeriod) : null
}

/** The RM tabs the workbook carries, by period. */
export function rmTabs(sheetNames: string[]): Partial<Record<RmPeriod, string>> {
  const out: Partial<Record<RmPeriod, string>> = {}
  for (const n of sheetNames) {
    const p = rmPeriodOf(n)
    if (p && !out[p]) out[p] = n
  }
  return out
}

/* ------------------------------------------------------------ indicators */

/**
 * The indicators this page already knows, in card order. Matched on the band's
 * Latin line; anything unmatched is kept under its own name, after these.
 */
const KNOWN: { id: string; re: RegExp; label: string; short: string; zh: string; lowerBetter?: boolean }[] = [
  { id: 'absensi', re: /absensi/, label: 'Absensi 06:30', short: 'Absensi 06:30', zh: '打卡准点率' },
  { id: 'k0730', re: /keluar\s*gudang|0730/, label: 'Keluar Gudang 07:30', short: 'Keluar 07:30', zh: '0730出仓率' },
  { id: 'ttd1200', re: /ttd\s*sebelum|1200/, label: 'TTD < 12:00', short: 'TTD < 12:00', zh: '1200前签收率' },
  { id: 'ritase', re: /all\s*ritase|keseluruhan/, label: 'Persentase All Ritase', short: 'All Ritase', zh: '全天签收率' },
  { id: 'retur', re: /retur/, label: 'Retur', short: 'Retur', zh: '退件率', lowerBetter: true },
]
export const RETUR_ID = 'retur'

const HAS_CJK = new RegExp('[\\u3000-\\u9fff]')
const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
const latinOf = (s: string) => lines(s).filter((l) => !HAS_CJK.test(l)).join(' ')
const zhOf = (s: string) => lines(s).filter((l) => HAS_CJK.test(l)).join(' ')

/** A figure as a number: `92.48%` → 92.48, `+0.90%` → 0.90, `-` → null. */
function num(cell: XLSX.CellObject | undefined, isPct: boolean): number | null {
  if (!cell || cell.v == null || cell.v === '') return null
  if (typeof cell.v === 'number') return isPct ? cell.v * 100 : cell.v
  const s = String(cell.v).trim()
  if (!/\d/.test(s)) return null
  const n = Number(s.replace(/[^\d.-]/g, ''))
  if (!Number.isFinite(n)) return null
  return /%/.test(s) || !isPct ? n : n * 100
}

/* ------------------------------------------------------------ the parse */

interface Band {
  id: string; ind: RmIndicator; cur: number; prev: number | null; delta: number | null
  /** the dated columns, oldest first; empty on the monthly tab */
  hist: number[]
}

export function parseRmSheet(period: RmPeriod, sheet: string, ws: XLSX.WorkSheet | undefined): RmReport | null {
  if (!ws || !ws['!ref']) return null
  const range = XLSX.utils.decode_range(ws['!ref'])
  const at = (r: number, c: number) => ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined
  const text = (r: number, c: number) => cellText(at(r, c)).trim()

  /* The header row is the one with "RM" in its own cell. */
  let hr = -1
  for (let r = range.s.r; r <= Math.min(range.e.r, 10) && hr < 0; r++) {
    for (let c = range.s.c; c <= Math.min(range.e.c, 5); c++) {
      if (latinOf(text(r, c)).toLowerCase() === 'rm') { hr = r; break }
    }
  }
  if (hr < 0) return null

  const idCol = (re: RegExp) => {
    for (let c = range.s.c; c <= Math.min(range.e.c, 5); c++) if (re.test(latinOf(text(hr, c)).toLowerCase())) return c
    return null
  }
  const cRegion = idCol(/regional|agent/) ?? range.s.c
  const cRm = idCol(/^rm$/)
  const cSites = idCol(/jumlah|dp\/cp/)
  if (cRm == null) return null
  const firstFig = Math.max(cRegion, cRm, cSites ?? 0) + 1

  /* The bands: a header merged over its columns, or a lone column with a header. */
  const merges = ws['!merges'] ?? []
  const bands: Band[] = []
  const used = new Set<string>()
  for (let c = firstFig; c <= range.e.c; c++) {
    const raw = text(hr, c)
    if (!raw) continue
    const m = merges.find((x) => x.s.r === hr && x.s.c === c)
    const span = m ? m.e.c - m.s.c + 1 : 1
    const subs = Array.from({ length: span }, (_, i) => latinOf(text(hr + 1, c + i)).toLowerCase())

    /* Which column is the figure, which the comparison, which the change. */
    const pctAt = subs.findIndex((s) => /persentase/.test(s))
    const deltaAt = subs.findIndex((s) => /^vs\b|perbandingan/.test(s))
    const plain = subs.map((_, i) => i).filter((i) => i !== deltaAt)
    const curAt = pctAt >= 0 ? pctAt : plain[0]
    const prevAt = pctAt >= 0 ? -1 : plain[1] ?? -1
    if (curAt == null || curAt < 0) continue

    const name = latinOf(raw)
    const known = KNOWN.find((k) => k.re.test(name.toLowerCase()))
    let id = known?.id ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    if (!id || used.has(id)) id = `${id || 'ind'}-${c}`
    used.add(id)

    bands.push({
      id,
      ind: {
        id,
        label: known?.label ?? name,
        short: known?.short ?? name,
        zh: known?.zh ?? zhOf(raw),
        target: null,
        lowerBetter: known?.lowerBetter ?? /retur/i.test(name),
      },
      cur: c + curAt,
      prev: prevAt >= 0 ? c + prevAt : null,
      delta: deltaAt >= 0 ? c + deltaAt : null,
      /* the sheet lists the newest first */
      hist: pctAt >= 0 ? [] : plain.map((i) => c + i).reverse(),
    })
    c += span - 1
  }
  if (!bands.length) return null

  /* What the figures cover: the column's own heading on the daily and weekly
     tabs; the range in the title on the monthly one, whose column says only
     "Persentase". */
  const b0 = bands[0]
  const title = latin(String(at(range.s.r, range.s.c)?.v ?? ''))
  const titleRange = title.match(/\d{1,2}\s+[A-Za-z]{3}[a-z]*(?:\s+\d{4})?\s*-\s*\d{1,2}\s+[A-Za-z]{3}[a-z]*(?:\s+\d{4})?/)?.[0] ?? ''
  const periodLabel = period === 'bulanan'
    ? titleRange || title
    : latinOf(text(hr + 1, b0.cur)).replace(/\//g, ' ')
  const prevLabel = b0.prev != null ? latinOf(text(hr + 1, b0.prev)).replace(/\//g, ' ') : ''
  const seriesLabels = b0.hist.map((c) => latinOf(text(hr + 1, c)).replace(/\//g, ' '))

  const readRow = (r: number): Record<string, RmFigure> => {
    const vals: Record<string, RmFigure> = {}
    for (const b of bands) {
      const cur = num(at(r, b.cur), true)
      const prev = b.prev != null ? num(at(r, b.prev), true) : null
      let delta = b.delta != null ? num(at(r, b.delta), true) : null
      if (delta == null && cur != null && prev != null) delta = cur - prev
      vals[b.id] = { cur, prev, delta, series: b.hist.map((c) => num(at(r, c), true)) }
    }
    return vals
  }

  const rows: RmRow[] = []
  const regionTotals: Record<string, RmRow> = {}
  const regions: string[] = []
  let total: RmRow | null = null
  const seen = new Map<string, number>()

  for (let r = hr + 2; r <= range.e.r; r++) {
    const regionRaw = text(r, cRegion)
    const rmRaw = text(r, cRm)
    const lower = latin(regionRaw).toLowerCase()
    /* the footnote under the table mentions "Target" too — it ends the table */
    if (/^catatan/.test(lower)) break
    if (/^target\b/.test(lower)) {
      for (const b of bands) {
        let t = num(at(r, b.cur), true)
        /* a target written over the band's first column only */
        for (let c = b.cur; t == null && c >= firstFig && c > b.cur - 4; c--) t = num(at(r, c), true)
        b.ind.target = t
      }
      continue
    }
    if (!regionRaw) continue
    const sites = cSites != null ? num(at(r, cSites), false) : null
    if (/^total\b/.test(lower)) {
      total = { key: 'TOTAL', region: '', rm: 'Total Jawa-Bali', sites, vals: readRow(r) }
      continue
    }
    const region = latin(regionRaw).toUpperCase()
    if (!regions.includes(region)) regions.push(region)
    if (/^total\b/i.test(rmRaw)) {
      regionTotals[region] = { key: `${region}|TOTAL`, region, rm: 'Total Regional', sites, vals: readRow(r) }
      continue
    }
    /* "-" is the sites with no RM — part of the regional total, not a person */
    if (!rmRaw || /^[-–—\s]+$/.test(rmRaw)) continue
    const base = `${region}|${rmRaw.toUpperCase()}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    rows.push({ key: n ? `${base}#${n}` : base, region, rm: rmRaw, sites, vals: readRow(r) })
  }
  if (!rows.length) return null

  return {
    period, sheet, periodLabel, prevLabel, seriesLabels,
    indicators: orderIndicators(bands.map((b) => b.ind)),
    rows, regionTotals, total, regions,
  }
}

function orderIndicators(list: RmIndicator[]): RmIndicator[] {
  const rank = (i: RmIndicator) => {
    const k = KNOWN.findIndex((x) => x.id === i.id)
    return k < 0 ? KNOWN.length : k
  }
  return [...list].sort((a, b) => rank(a) - rank(b))
}

/* ------------------------------------------------------------ Retur */

/**
 * Add Retur to an RM report, computed from the drop points in "Display Retur".
 *
 * Summed the way the sheet's own note says every RM figure is — the counts of
 * the sites the RM handles, divided — so an RM's Retur is (regist − void) over
 * delivery across their sites, for the same period as the rest of the report.
 * Joined on region plus RM name; an RM with no sites in the Retur tab gets no
 * figure rather than a zero.
 */
export function attachRetur(rep: RmReport, retur: DisplayReport | null): RmReport {
  if (!retur || rep.indicators.some((i) => i.id === RETUR_ID)) return rep
  const k = retur.kpis[0]
  if (!k) return rep
  const [cur, prev]: [Ratio | undefined, Ratio | undefined] =
    rep.period === 'harian' ? [k.dayRatio, k.prevRatio]
      : rep.period === 'mingguan' ? [k.weekRatio, k.weekPrevRatio]
        : [k.monthRatio, undefined]
  if (!cur) return rep

  const key = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim()
  const byRm = new Map<string, DisplayRow[]>()
  const byRegion = new Map<string, DisplayRow[]>()
  for (const r of retur.rows) {
    const reg = key(r.agent)
    const a = byRegion.get(reg)
    if (a) a.push(r); else byRegion.set(reg, [r])
    if (!r.rm) continue
    const rk = `${reg}|${key(r.rm)}`
    const b = byRm.get(rk)
    if (b) b.push(r); else byRm.set(rk, [r])
  }
  const fig = (rows: DisplayRow[] | undefined): RmFigure => {
    if (!rows?.length) return { cur: null, prev: null, delta: null }
    const c = ratioOf(rows, cur)
    const p = prev ? ratioOf(rows, prev) : null
    /* the daily tab's trend: H-2, H-1, the day — the same days as its other bands */
    const series = rep.period === 'harian' && rep.seriesLabels.length
      ? [ratioOf(rows, ['p2_ret', 'p2_deliv']), p, c].slice(-rep.seriesLabels.length)
      : undefined
    return { cur: c, prev: p, delta: c != null && p != null ? c - p : null, series }
  }
  const withRetur = (row: RmRow, f: RmFigure): RmRow => ({ ...row, vals: { ...row.vals, [RETUR_ID]: f } })

  const known = KNOWN.find((x) => x.id === RETUR_ID)!
  const regionTotals: Record<string, RmRow> = {}
  for (const [reg, row] of Object.entries(rep.regionTotals)) {
    regionTotals[reg] = withRetur(row, fig(byRegion.get(key(reg))))
  }
  return {
    ...rep,
    indicators: orderIndicators([
      ...rep.indicators,
      { id: RETUR_ID, label: known.label, short: known.short, zh: known.zh, target: retur.target, lowerBetter: true },
    ]),
    rows: rep.rows.map((r) => withRetur(r, fig(byRm.get(`${key(r.region)}|${key(r.rm)}`)))),
    regionTotals,
    total: rep.total ? withRetur(rep.total, fig(retur.rows)) : null,
  }
}

/* ------------------------------------------------------------ judging */

export type RmTone = 'ok' | 'bad' | 'na'

export function toneOf(ind: RmIndicator, v: number | null): RmTone {
  if (v == null || ind.target == null) return 'na'
  return (ind.lowerBetter ? v <= ind.target + 1e-9 : v >= ind.target - 1e-9) ? 'ok' : 'bad'
}

/** How many of a row's indicators meet target, out of those with a figure. */
export function scoreOf(row: RmRow, inds: RmIndicator[]): { met: number; of: number } {
  let met = 0, of = 0
  for (const i of inds) {
    const t = toneOf(i, row.vals[i.id]?.cur ?? null)
    if (t === 'na') continue
    of++
    if (t === 'ok') met++
  }
  return { met, of }
}

/* ------------------------------------------------------------ drop points */

/**
 * Where each RM indicator lives at drop-point level: which Display tab, and
 * which of its headline figures. An indicator missing here (a band added to the
 * RM tabs later) simply has no per-DP column in the detail view.
 */
export const DP_SOURCE: Record<string, { tab: DisplayId; kpi: string }> = {
  absensi: { tab: 'absensi', kpi: 'ontime' },
  k0730: { tab: 'ttd730', kpi: '0730' },
  ttd1200: { tab: 'ttd730', kpi: '1200' },
  ritase: { tab: 'ritase', kpi: 'ttd' },
  retur: { tab: 'retur', kpi: 'retur' },
}

/** One drop point under an RM, with a figure per indicator for one period. */
export interface RmDpLine {
  key: string
  dp: string
  /** percent; null when the tab has no figure for that period, or nothing was due */
  vals: Record<string, number | null>
}

/**
 * The drop points an RM handles, from the Display tabs, for one period.
 *
 * Joined on region plus RM name, the same way Retur is. The figure is the
 * sheet's own per-DP percentage; a site with nothing due in the period (the
 * ratio's denominator is 0) reads as no figure rather than 0%, so it is neither
 * judged nor ranked.
 */
export function rmDpLines(
  row: RmRow, period: RmPeriod, tabs: Partial<Record<DisplayId, DisplayReport>>,
): RmDpLine[] {
  const key = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim()
  const region = key(row.region)
  const rm = key(row.rm)
  const lines = new Map<string, RmDpLine>()

  for (const [indId, src] of Object.entries(DP_SOURCE)) {
    const rep = tabs[src.tab]
    const k = rep?.kpis.find((x) => x.id === src.kpi)
    if (!rep || !k) continue
    const [col, ratio] = periodCols(k, period)
    for (const r of rep.rows) {
      if (key(r.agent) !== region || key(r.rm) !== rm) continue
      const dk = key(r.dp)
      let line = lines.get(dk)
      if (!line) {
        line = { key: `${region}|${dk}`, dp: r.dp, vals: {} }
        lines.set(dk, line)
      }
      const due = ratio ? r.vals[ratio[1]] : null
      const v = col ? r.vals[col] ?? null : null
      line.vals[indId] = v == null || (ratio && !(due != null && due > 0)) ? null : v
    }
  }
  return [...lines.values()]
}

/** A headline figure's per-DP column and its counts, for one period. */
function periodCols(k: DisplayKpi, period: RmPeriod): [string | undefined, Ratio | undefined] {
  return period === 'harian' ? [k.day, k.dayRatio]
    : period === 'mingguan' ? [k.week, k.weekRatio]
      : [k.month, k.monthRatio]
}

/**
 * Whether the Display tabs carry a per-DP figure for this indicator and period
 * at all — Keluar 07:30 has none for the week. Separate from a site simply
 * having nothing due, which is a blank in a column that exists.
 */
export function dpColumnOf(
  indId: string, period: RmPeriod, tabs: Partial<Record<DisplayId, DisplayReport>>,
): string | null {
  const src = DP_SOURCE[indId]
  const k = src ? tabs[src.tab]?.kpis.find((x) => x.id === src.kpi) : undefined
  return (k && periodCols(k, period)[0]) || null
}

/**
 * The card's verdict: all at target is green, more than half amber, half or
 * fewer red. Nothing to judge is grey rather than judged.
 */
export type RmVerdict = 'ok' | 'warn' | 'bad' | 'na'
export function verdictOf(met: number, of: number): RmVerdict {
  if (!of) return 'na'
  if (met === of) return 'ok'
  return met * 2 > of ? 'warn' : 'bad'
}

/** How many of a drop point's indicators meet target, out of those with a figure. */
export function dpScoreOf(line: RmDpLine, inds: RmIndicator[]): { met: number; of: number } {
  let met = 0, of = 0
  for (const i of inds) {
    const t = toneOf(i, line.vals[i.id] ?? null)
    if (t === 'na') continue
    of++
    if (t === 'ok') met++
  }
  return { met, of }
}
