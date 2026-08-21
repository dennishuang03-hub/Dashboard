/**
 * On Time Pick Up — the two OTPU tabs, read into one report.
 *
 * These arrived as an addition to a workbook the rest of the app already knew
 * how to read, and they are shaped nothing like the sheets it knew. The daily
 * report is one row per agent and one column per day; these are weekly, they
 * carry their own GTL benchmark, and the seller tab is seventeen thousand rows
 * of seller × drop point. Trying to fold them into `parseWorkbook`'s agent model
 * would mean bending both — so they get their own parser, their own model, and
 * their own pages, and the only thing the two halves share is the workbook they
 * come out of.
 *
 * Parsed separately for a second reason as well: nothing here is allowed to fail
 * the dashboard. A file without the OTPU tabs is the previous week's file and
 * has to keep working, so every entry point below returns `null` rather than
 * throwing, and the rail simply does not offer the destination.
 *
 * ── One thing worth knowing about the numbers ────────────────────────────────
 *
 * Percentages in these tabs are stored as bare fractions with no percent
 * number-format on the cell, so `cellNum` — which trusts the format — reads
 * 0.9449 and leaves it there. `ratio()` below is the conversion, and it is
 * applied only to columns the header block identified as percentages. Counts go
 * through untouched.
 *
 * The file also states each percentage *and* the two counts it comes from. Where
 * both are present the file's own value is used, because the file is the thing
 * being reported on — but the counts are divided as well and a disagreement of
 * more than half a point is collected into `warnings`, which the page shows. A
 * formula dragged one row too far is invisible in Excel and obvious here.
 */
import * as XLSX from 'xlsx'
import { OTPU_AGENT_RE, OTPU_SELLER_RE, sheetMatrix, txt } from './jnt'
import type { Cell } from './jnt'

/* ------------------------------------------------------------- sheet names */

/*
 * Which tabs belong to this parser is decided in `jnt.ts`, not here.
 *
 * `parseWorkbook` has to ask the same question — so that it skips these two
 * rather than reporting them as sheets it failed to understand — and it is the
 * lower module of the pair. Putting the patterns there and importing them here
 * keeps one answer instead of two that can drift, and keeps the import going in
 * one direction only.
 */

/* ----------------------------------------------------------------- format */

const MONTH_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

/** `45.133.106` — Indonesian grouping, which is what the report is read in. */
export function nfmt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return Math.round(v).toLocaleString('id-ID')
}

/** `94,95%` — comma decimal, to match the workbook and every other J&T report. */
export function pfmt(v: number | null | undefined, dp = 2): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v.toFixed(dp).replace('.', ',')}%`
}

/** `+0,99%` — a difference, so it always carries its sign. */
export function dfmt(v: number | null | undefined, dp = 2): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp).replace('.', ',')}%`
}

/** `19 Agu` */
export const shortDate = (d: Date): string => `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`
/** `19 Agustus 2026` */
export const longDate = (d: Date): string =>
  `${d.getDate()} ${MONTH_ID[d.getMonth()]} ${d.getFullYear()}`

export const monthName = (i: number): string => MONTH_ID[i] ?? ''

/* ------------------------------------------------------------ cell readers */

/** Excel's day number → a local midnight, with no timezone slide. */
function serial(n: number): Date | null {
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null
  const utc = new Date(Math.round((n - 25569) * 86400000))
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate())
}

/** A plain count. Strings are tolerated; anything else is "the file is silent". */
function count(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const s = v.replace(/[.\s]/g, '').replace(',', '.')
    if (!s || /^[-–—]+$/.test(s)) return null
    const n = parseFloat(s)
    return Number.isNaN(n) ? null : n
  }
  return null
}

/**
 * A percentage, however the cell chose to say it.
 *
 * Everything in these two tabs is a bare fraction, so the common path is ×100.
 * The bound is 1.5 rather than 1 so that a genuine 100% stored as `1` converts,
 * and a cell someone has already formatted as `94.95` is left alone — both of
 * which have turned up in versions of this file.
 */
function ratio(v: unknown): number | null {
  const n = count(v)
  if (n == null) return null
  return Math.abs(n) <= 1.5 ? n * 100 : n
}

/** `sheet_to_json`'s cells are bare values; `sheetMatrix`'s are objects. */
const cv = (c: Cell): unknown => (c ? c.v : null)

/* ------------------------------------------------------------------ model */

export interface OtpuPeriod {
  /** stable identity for React keys and column ids */
  key: string
  /** `31 Jul – 6 Agu` for a week, `19 Agu` for a day */
  label: string
  /** `W1`, `W2` … — the short head used in the table's column band */
  short: string
  from: Date | null
  to: Date | null
}

export interface OtpuAgentRow {
  /** `AGENT12`, or `TOTAL` for the summary row */
  code: string
  /** the city, resolved against the daily report — `''` when unknown here */
  city: string
  isTotal: boolean
  /** per week, in `weeks` order */
  orders: (number | null)[]
  picked: (number | null)[]
  pct: (number | null)[]
  ordersTotal: number | null
  pickedTotal: number | null
  /** the cumulative %OTPU across every week in the file */
  pctTotal: number | null
  /** last week minus the week before, in percentage points */
  delta: number | null
  /** the GTL benchmark, where the file states one for this row */
  gtl: number | null
  /** cumulative minus GTL */
  vsGtl: number | null
}

export interface OtpuAgentReport {
  weeks: OtpuPeriod[]
  rows: OtpuAgentRow[]
  total: OtpuAgentRow | null
  /** `GTL Juli`, from the header — the month the benchmark is taken from */
  gtlLabel: string
  /** the benchmark itself, off the TOTAL row */
  gtl: number | null
  warnings: string[]
}

export interface OtpuSellerRow {
  key: string
  seller: string
  hub: string
  dp: string
  agent: string
  /** per day, in `days` order (oldest first) */
  dailyOrders: (number | null)[]
  dailyPicked: (number | null)[]
  dailyPct: (number | null)[]
  orders: number | null
  picked: number | null
  /** the week's %OTPU for this seller */
  pct: number | null
  /** the GTL benchmark this seller is measured against — the latest month given */
  gtl: number | null
  /** every GTL month the file carries, newest last */
  gtlMonths: { label: string; value: number | null }[]
  /** weekly %OTPU minus GTL, in percentage points */
  vsGtl: number | null
  /**
   * The sheet's own two difference-against-GTL columns, kept apart rather than
   * folded into `vsGtl`.
   *
   * `Perbedaan % OTPU Daily - GTL` and `Perbedaan % OTPU Weekly - GTL` answer
   * different questions — the last day against the benchmark, and the whole week
   * against it — and a seller can sit on opposite sides of the two. `vsGtl`
   * stays the computed weekly figure it always was; these are what the file
   * says, for the filters that ask about each separately.
   */
  vsDaily: number | null
  vsWeekly: number | null
}

export interface OtpuSellerReport {
  days: OtpuPeriod[]
  rows: OtpuSellerRow[]
  total: OtpuSellerRow | null
  gtlLabel: string
  warnings: string[]
}

export interface OtpuReport {
  agent: OtpuAgentReport | null
  seller: OtpuSellerReport | null
  /** which of the two tabs were found, by their real names in the workbook */
  sheets: string[]
}

/* ------------------------------------------------- header-block vocabulary */

const ORDERS_RE = /total\s*order|订单量/i
const PICKED_RE = /jumlah\s*paket|volume\s*otpu|实际揽收件量|actual\s*pickup/i
const PCT_RE = /%\s*otpu|otpu\s*%|揽收及时率|实际揽收及时率/i
const DELTA_RE = /占比|perbandingan/i
const GTL_RE = /\bgtl\b/i
const VS_GTL_RE = /对比\s*gtl|banding\s*gtl|perbedaan/i
const AGENT_HEAD_RE = /agent|agen\b|代理/i
const SELLER_HEAD_RE = /nama\s*seller|商家名称|seller/i
const HUB_HEAD_RE = /hub|抖音网点/i
const DP_HEAD_RE = /dp\s*pickup|实际取件网点|drop\s*point/i

/** The months a GTL column can name, in the two languages the file mixes. */
const GTL_MONTHS: [RegExp, number][] = [
  [/jan|1\s*月/i, 0], [/feb|peb|2\s*月/i, 1], [/mar|3\s*月/i, 2], [/apr|4\s*月/i, 3],
  [/may|mei|5\s*月/i, 4], [/jun|6\s*月/i, 5], [/jul|7\s*月/i, 6], [/aug|agu|8\s*月/i, 7],
  [/sep|9\s*月/i, 8], [/oct|okt|10\s*月/i, 9], [/nov|11\s*月/i, 10], [/dec|des|12\s*月/i, 11],
]

/**
 * "This row is the summary", read off the label.
 *
 * The lookahead does the job `\b` looks like it would and does not: `\b` is
 * defined against `[A-Za-z0-9_]`, so it finds no boundary at all after `合计` —
 * both sides are non-word characters — and `/^合计\b/` never matches the one
 * label in this workbook that always says `合计 TOTAL`. Requiring "not followed
 * by a letter or a digit" is the same intent spelled in a way that holds for
 * Chinese, and it still refuses `Totalindo` while accepting `Total`.
 *
 * On its own this is not enough to *classify* a row — see the seller parser,
 * where a shop called "Total Care Men" is a real seller — but it is exactly the
 * question this function answers.
 */
const TOTAL_LABEL_RE = /^\s*(合计|total|jumlah|semua|all)(?![\p{L}\p{N}])/iu

function gtlMonthOf(s: string): number {
  for (const [re, i] of GTL_MONTHS) if (re.test(s)) return i
  return -1
}

/**
 * `7月31日-8月06日` → the two dates it names.
 *
 * The year is nowhere in the string, so it is taken from the workbook's own
 * dated columns where those exist and from today otherwise; and a range that
 * runs backwards across December is rolled forward a year, which is the only
 * way `12月28日-1月03日` can be read.
 */
function chineseRange(s: string, year: number): { from: Date | null; to: Date | null } {
  const hits = [...s.matchAll(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/g)]
  if (hits.length >= 2) {
    const from = new Date(year, Number(hits[0][1]) - 1, Number(hits[0][2]))
    let to = new Date(year, Number(hits[1][1]) - 1, Number(hits[1][2]))
    if (to < from) to = new Date(year + 1, Number(hits[1][1]) - 1, Number(hits[1][2]))
    return { from, to }
  }
  /* `31/07-06/08` and `31 Jul - 6 Aug` are the two other spellings seen. */
  const nums = [...s.matchAll(/(\d{1,2})\s*[/.-]\s*(\d{1,2})/g)]
  if (nums.length >= 2) {
    const from = new Date(year, Number(nums[0][2]) - 1, Number(nums[0][1]))
    let to = new Date(year, Number(nums[1][2]) - 1, Number(nums[1][1]))
    if (to < from) to = new Date(year + 1, Number(nums[1][2]) - 1, Number(nums[1][1]))
    return { from, to }
  }
  return { from: null, to: null }
}

function periodLabel(from: Date | null, to: Date | null, fallback: string): string {
  if (from && to) return `${from.getDate()} ${MONTH_SHORT[from.getMonth()]} – ${to.getDate()} ${MONTH_SHORT[to.getMonth()]}`
  if (from) return shortDate(from)
  return fallback
}

/* ------------------------------------------------------------ agent parser */

interface HeadCol { c: number; top: string; sub: string; merged: boolean }

/**
 * Read the two-row header block into one entry per column.
 *
 * `sheetMatrix` has already pushed merged values down and across, so a column
 * that is one tall cell reads the same text twice — and that repetition is
 * exactly the signal being used: a `%OTPU` column whose second row repeats the
 * first is the *cumulative* one, and a `%OTPU` column with its own second row is
 * a single week. Nothing here has to count columns or know how many weeks the
 * file happens to carry.
 */
function headerCols(m: Cell[][], lastC: number, r0: number, r1: number): HeadCol[] {
  const out: HeadCol[] = []
  for (let c = 0; c <= lastC; c++) {
    const top = txt(m[r0]?.[c] ?? null)
    const sub = txt(m[r1]?.[c] ?? null)
    out.push({ c, top, sub, merged: !sub || sub === top })
  }
  return out
}

/** The first year mentioned anywhere in the header, for the Chinese ranges. */
function guessYear(m: Cell[][], lastC: number, rows: number): number {
  for (let r = 0; r < Math.min(rows, m.length); r++) {
    for (let c = 0; c <= lastC; c++) {
      const cell = m[r]?.[c]
      if (!cell) continue
      if (cell.v instanceof Date) return cell.v.getFullYear()
      if (typeof cell.v === 'number') {
        const d = serial(cell.v)
        if (d) return d.getFullYear()
      }
      const y = /\b(20\d{2})\b/.exec(String(cell.v ?? ''))
      if (y) return Number(y[1])
    }
  }
  return new Date().getFullYear()
}

function parseAgentSheet(ws: XLSX.WorkSheet): OtpuAgentReport | null {
  const { m, lastC } = sheetMatrix(ws)
  if (m.length < 3) return null

  /* The header is the first row carrying an agent-ish label in column A or B and
     a Total Order group somewhere to its right. Scanned rather than assumed at
     row 0, because a title row above the header is a habit this workbook has. */
  let r0 = -1
  for (let r = 0; r < Math.min(m.length, 12) && r0 < 0; r++) {
    const hasAgent = [0, 1, 2].some((c) => AGENT_HEAD_RE.test(txt(m[r]?.[c] ?? null)))
    const hasOrders = m[r]?.some((cell) => ORDERS_RE.test(txt(cell)))
    if (hasAgent && hasOrders) r0 = r
  }
  if (r0 < 0) return null
  const r1 = r0 + 1

  const cols = headerCols(m, lastC, r0, r1)
  const year = guessYear(m, lastC, r1 + 1)

  const nameCol = cols.find((h) => AGENT_HEAD_RE.test(h.top))?.c ?? 0

  /* Weeks are discovered from the Total Order group and then reused for the
     other two, so the three blocks line up by position within their group even
     if one of them spells its sub-headers differently. */
  const weekOf = (h: HeadCol) => chineseRange(h.sub, year)
  const orderWeekCols = cols.filter((h) => ORDERS_RE.test(h.top) && !h.merged)
  const pickedWeekCols = cols.filter((h) => PICKED_RE.test(h.top) && !h.merged)
  /* `%OTPU` also matches the GTL and Banding headers in some files, so those are
     excluded before the group is read. */
  const isPctGroup = (h: HeadCol) =>
    PCT_RE.test(h.top) && !GTL_RE.test(h.top) && !DELTA_RE.test(h.top) && !VS_GTL_RE.test(h.top)
  const pctWeekCols = cols.filter((h) => isPctGroup(h) && !h.merged)

  if (!orderWeekCols.length) return null

  const weeks: OtpuPeriod[] = orderWeekCols.map((h, i) => {
    const { from, to } = weekOf(h)
    return {
      key: `w${i}`,
      label: periodLabel(from, to, h.sub || `Minggu ${i + 1}`),
      short: `W${i + 1}`,
      from,
      to,
    }
  })

  const ordersTotalCol = cols.find((h) => ORDERS_RE.test(h.top) && h.merged)?.c ?? null
  const pickedTotalCol = cols.find((h) => PICKED_RE.test(h.top) && h.merged)?.c ?? null
  const pctTotalCol = cols.find((h) => isPctGroup(h) && h.merged)?.c ?? null
  const deltaCol = cols.find((h) => DELTA_RE.test(h.top))?.c ?? null
  const gtlHead = cols.find((h) => GTL_RE.test(h.top) && !VS_GTL_RE.test(h.top))
  const vsGtlCol = cols.find((h) => VS_GTL_RE.test(h.top))?.c ?? null

  const gtlMonth = gtlHead ? gtlMonthOf(gtlHead.top) : -1
  const gtlLabel = gtlMonth >= 0 ? `GTL ${MONTH_ID[gtlMonth]}` : 'GTL'

  const warnSet = new Set<string>()
  const rows: OtpuAgentRow[] = []
  let total: OtpuAgentRow | null = null

  for (let r = r1 + 1; r < m.length; r++) {
    const raw = txt(m[r]?.[nameCol] ?? null)
    if (!raw) continue
    const isTotal = TOTAL_LABEL_RE.test(raw)
    const code = (isTotal ? 'TOTAL' : raw).replace(/\s+/g, '').toUpperCase()

    const orders = orderWeekCols.map((h) => count(cv(m[r]?.[h.c] ?? null)))
    const picked = pickedWeekCols.map((h) => count(cv(m[r]?.[h.c] ?? null)))
    const pct = weeks.map((_, i) => {
      const stated = pctWeekCols[i] ? ratio(cv(m[r]?.[pctWeekCols[i].c] ?? null)) : null
      const o = orders[i]
      const p = picked[i]
      const computed = o != null && p != null && o > 0 ? (p / o) * 100 : null
      if (stated != null && computed != null && Math.abs(stated - computed) > 0.5) {
        warnSet.add(`kolom %OTPU ${weeks[i].label}`)
        /* The counts are the raw fact and the percentage is derived from them,
           so where the two disagree the counts win. A dragged formula lands
           here, and reporting a number the file's own columns contradict would
           be the worse of the two failures. */
        return computed
      }
      return stated ?? computed
    })

    const ordersTotal = ordersTotalCol != null
      ? count(cv(m[r][ordersTotalCol]))
      : sumOf(orders)
    const pickedTotal = pickedTotalCol != null
      ? count(cv(m[r][pickedTotalCol]))
      : sumOf(picked)

    const statedTotal = pctTotalCol != null ? ratio(cv(m[r][pctTotalCol])) : null
    const computedTotal = ordersTotal != null && pickedTotal != null && ordersTotal > 0
      ? (pickedTotal / ordersTotal) * 100
      : null
    if (statedTotal != null && computedTotal != null && Math.abs(statedTotal - computedTotal) > 0.5) {
      warnSet.add('kolom %OTPU kumulatif')
    }
    const pctTotal = statedTotal != null && computedTotal != null
      && Math.abs(statedTotal - computedTotal) > 0.5 ? computedTotal : statedTotal ?? computedTotal

    const last = pct[pct.length - 1] ?? null
    const prev = pct.length > 1 ? pct[pct.length - 2] : null
    const computedDelta = last != null && prev != null ? last - prev : null
    const statedDelta = deltaCol != null ? ratio(cv(m[r][deltaCol])) : null
    /* No warning when the sheet's 占比 disagrees with the two weekly percentages.
       The other warnings in here exist because a number on the page might not be
       the number in the file, and the reader has to be told which. This one has
       nothing on the page to be about: the Perbandingan column was taken out of
       the table, and what is left of `delta` is the recomputed figure on the
       OTPU KUMULATIF card. A banner across the top of a report, naming a column
       nobody can see, over a value that was never taken from the sheet in the
       first place, only asks the reader to go looking for something that is not
       there. `computedDelta` still wins below, exactly as it did. */
    const delta = computedDelta ?? statedDelta

    const gtl = gtlHead ? ratio(cv(m[r][gtlHead.c])) : null
    const statedVs = vsGtlCol != null ? ratio(cv(m[r][vsGtlCol])) : null
    const vsGtl = gtl != null && pctTotal != null ? pctTotal - gtl : statedVs

    const row: OtpuAgentRow = {
      code, city: '', isTotal,
      orders, picked, pct,
      ordersTotal, pickedTotal, pctTotal,
      delta, gtl, vsGtl,
    }
    if (isTotal) total = row
    else rows.push(row)
  }

  if (!rows.length && !total) return null

  const warnings = [...warnSet].map((w) =>
    `${w} di sheet OTPU Agent tidak cocok dengan Total Order / Volume OTPU pada baris yang sama — nilai dihitung ulang dari kedua kolom jumlah tersebut.`)

  return {
    weeks, rows, total,
    gtlLabel,
    gtl: total?.gtl ?? null,
    warnings,
  }
}

function sumOf(list: (number | null)[]): number | null {
  let any = false, acc = 0
  for (const v of list) if (v != null) { any = true; acc += v }
  return any ? acc : null
}

/* ----------------------------------------------------------- seller parser */

/**
 * Seventeen thousand rows, read the cheap way.
 *
 * The header block needs merges applied — that is the whole trick the agent
 * parser above turns on — but the body does not, and building a `Cell` object
 * for every one of ~750,000 cells to read numbers out of them costs about a
 * second of the page's startup for nothing. So the header goes through
 * `sheetMatrix` capped at the first few rows and the body comes out of
 * `sheet_to_json`, which hands back plain arrays.
 */
function parseSellerSheet(ws: XLSX.WorkSheet): OtpuSellerReport | null {
  const HEAD_ROWS = 4
  const { m, lastC } = sheetMatrix(ws, HEAD_ROWS)
  if (m.length < 2) return null

  let r0 = -1
  for (let r = 0; r < Math.min(m.length, 3) && r0 < 0; r++) {
    if (m[r]?.some((cell) => SELLER_HEAD_RE.test(txt(cell)))) r0 = r
  }
  if (r0 < 0) return null
  const r1 = r0 + 1

  const cols = headerCols(m, lastC, r0, r1)

  const sellerCol = cols.find((h) => SELLER_HEAD_RE.test(h.top))?.c ?? 1
  const hubCol = cols.find((h) => HUB_HEAD_RE.test(h.top))?.c ?? null
  const dpCol = cols.find((h) => DP_HEAD_RE.test(h.top))?.c ?? null
  const agentCol = cols.find((h) => AGENT_HEAD_RE.test(h.top) && h.c !== sellerCol)?.c ?? null

  /* A column is a *daily* one when its second header row is a date. Everything
     else in the same group — the weekly roll-up, which says "weekly" or repeats
     the group name — falls through to the aggregate slots below. */
  const dayOf = (h: HeadCol): Date | null => {
    const cell = m[r1]?.[h.c]
    if (!cell) return null
    if (cell.v instanceof Date) return new Date(cell.v.getFullYear(), cell.v.getMonth(), cell.v.getDate())
    if (typeof cell.v === 'number') return serial(cell.v)
    return null
  }

  const isPctGroup = (h: HeadCol) =>
    PCT_RE.test(h.top) && !GTL_RE.test(h.top) && !VS_GTL_RE.test(h.top)

  interface DayCol { date: Date; orders: number | null; picked: number | null; pct: number | null }
  const byDay = new Map<number, DayCol>()
  const put = (d: Date, key: 'orders' | 'picked' | 'pct', c: number) => {
    const t = d.getTime()
    const slot = byDay.get(t) ?? { date: d, orders: null, picked: null, pct: null }
    slot[key] = c
    byDay.set(t, slot)
  }

  for (const h of cols) {
    const d = dayOf(h)
    if (!d) continue
    if (ORDERS_RE.test(h.top)) put(d, 'orders', h.c)
    else if (PICKED_RE.test(h.top)) put(d, 'picked', h.c)
    else if (isPctGroup(h)) put(d, 'pct', h.c)
  }

  /* Oldest first. The sheet writes them newest-first, which reads backwards on a
     chart and backwards in a table of ten columns. */
  const dayCols = [...byDay.values()].sort((a, b) => a.date.getTime() - b.date.getTime())
  const days: OtpuPeriod[] = dayCols.map((d, i) => ({
    key: `d${i}`,
    label: shortDate(d.date),
    short: shortDate(d.date),
    from: d.date,
    to: d.date,
  }))

  const aggregate = cols.filter((h) => !dayOf(h))
  const ordersCol = aggregate.find((h) => ORDERS_RE.test(h.top))?.c ?? null
  const pickedCol = aggregate.find((h) => PICKED_RE.test(h.top))?.c ?? null
  const pctCol = aggregate.find((h) => isPctGroup(h))?.c ?? null
  const vsDailyCol = aggregate.find((h) => VS_GTL_RE.test(h.top) && /daily|harian|日度/i.test(h.top))?.c ?? null
  const vsWeeklyCol = aggregate.find((h) => VS_GTL_RE.test(h.top) && /weekly|mingguan|周度/i.test(h.top))?.c ?? null

  /* Every GTL month the file carries, in calendar order. The last one is the
     benchmark the seller is actually being measured against; the earlier ones
     are there so a page can show the trend if it wants to. */
  const gtlCols = aggregate
    .filter((h) => GTL_RE.test(h.top) && !VS_GTL_RE.test(h.top) && gtlMonthOf(h.top) >= 0)
    .map((h) => ({ c: h.c, month: gtlMonthOf(h.top) }))
    .sort((a, b) => a.month - b.month)
  const gtlLabel = gtlCols.length ? `GTL ${MONTH_ID[gtlCols[gtlCols.length - 1].month]}` : 'GTL'

  /* The body, as plain arrays. `range` skips the header block that has already
     been read, and `defval:null` keeps the columns aligned when a row's trailing
     cells are empty. */
  const body = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1, raw: true, defval: null, blankrows: false, range: r1 + 1,
  })

  const rows: OtpuSellerRow[] = []
  let total: OtpuSellerRow | null = null
  const warnSet = new Set<string>()

  const at = (r: unknown[], c: number | null): unknown => (c == null ? null : r[c] ?? null)

  for (let i = 0; i < body.length; i++) {
    const r = body[i]
    if (!r) continue
    const seller = String(at(r, sellerCol) ?? '').replace(/\s+/g, ' ').trim()
    if (!seller) continue

    const hub = String(at(r, hubCol) ?? '').trim()
    const dp = String(at(r, dpCol) ?? '').trim()
    const agent = String(at(r, agentCol) ?? '').replace(/\s+/g, '').toUpperCase()

    /*
     * The summary row, identified by what it *lacks* rather than by its name.
     *
     * Matching the name alone is what a first version did, and it quietly ate
     * three rows: there is a seller in this file called "Total Care Men", and
     * "starts with total" is a perfectly ordinary way for a shop to be named.
     * The real summary row is the one that belongs to no hub, no drop point and
     * no agent — every genuine seller has all three — so both halves have to
     * hold before a row is taken out of the list.
     */
    const isTotal = !hub && !dp && !agent && TOTAL_LABEL_RE.test(seller)

    const dailyOrders = dayCols.map((d) => count(at(r, d.orders)))
    const dailyPicked = dayCols.map((d) => count(at(r, d.picked)))
    const dailyPct = dayCols.map((d, k) => {
      const stated = ratio(at(r, d.pct))
      const o = dailyOrders[k], p = dailyPicked[k]
      const computed = o != null && p != null && o > 0 ? (p / o) * 100 : null
      if (stated != null && computed != null && Math.abs(stated - computed) > 0.5) {
        warnSet.add(`kolom %OTPU harian ${shortDate(d.date)}`)
        return computed
      }
      return stated ?? computed
    })

    const orders = count(at(r, ordersCol)) ?? sumOf(dailyOrders)
    const picked = count(at(r, pickedCol)) ?? sumOf(dailyPicked)
    const stated = ratio(at(r, pctCol))
    const computed = orders != null && picked != null && orders > 0 ? (picked / orders) * 100 : null
    if (stated != null && computed != null && Math.abs(stated - computed) > 0.5) {
      warnSet.add('kolom %OTPU mingguan')
    }
    const pct = stated != null && computed != null && Math.abs(stated - computed) > 0.5
      ? computed
      : stated ?? computed

    const gtlMonths = gtlCols.map((g) => ({
      label: MONTH_ID[g.month],
      value: ratio(at(r, g.c)),
    }))
    const gtl = gtlMonths.length ? gtlMonths[gtlMonths.length - 1].value : null
    const vsDaily = ratio(at(r, vsDailyCol))
    const vsWeekly = ratio(at(r, vsWeeklyCol))
    const statedVs = vsWeekly ?? vsDaily
    const vsGtl = gtl != null && pct != null ? pct - gtl : statedVs

    const row: OtpuSellerRow = {
      /* Column A already holds a seller+DP key in this file. The row index is
         appended even to that one, because the same seller can appear twice
         under the same drop point and React needs the keys to be unique. */
      key: `${String(r[0] ?? '') || `${seller}|${dp}`}|${i}`,
      seller, hub, dp, agent,
      dailyOrders, dailyPicked, dailyPct,
      orders, picked, pct, gtl, gtlMonths, vsGtl, vsDaily, vsWeekly,
    }

    if (isTotal && !total) total = row
    else if (!isTotal) rows.push(row)
  }

  if (!rows.length) return null

  const warnings = [...warnSet].map((w) =>
    `${w} di sheet OTPU Seller tidak cocok dengan Total Order / Volume OTPU pada baris yang sama — nilai dihitung ulang dari kedua kolom jumlah tersebut.`)

  return { days, rows, total, gtlLabel, warnings }
}

/* -------------------------------------------------------------- entry point */

/**
 * Both OTPU tabs, or `null` if the workbook has neither.
 *
 * Never throws. A tab that is present but unreadable comes back as `null` on its
 * own half of the report, so one broken sheet does not take the other down with
 * it and neither takes the daily dashboard down.
 */
export function parseOtpu(wb: XLSX.WorkBook): OtpuReport | null {
  const sheets: string[] = []
  let agent: OtpuAgentReport | null = null
  let seller: OtpuSellerReport | null = null

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    try {
      if (OTPU_AGENT_RE.test(name) && !agent) {
        agent = parseAgentSheet(ws)
        if (agent) sheets.push(name)
      } else if (OTPU_SELLER_RE.test(name) && !seller) {
        seller = parseSellerSheet(ws)
        if (seller) sheets.push(name)
      }
    } catch {
      /* A malformed OTPU tab is a missing page, not a broken dashboard. */
    }
  }

  if (!agent && !seller) return null
  return { agent, seller, sheets }
}

/* ------------------------------------------------------------- derived bits */

/** Green when ahead of the benchmark, red when behind — used all over the pages. */
export const toneOf = (v: number | null | undefined, flatBand = 0.005): '' | 'up' | 'down' => {
  if (v == null || !Number.isFinite(v)) return ''
  if (Math.abs(v) < flatBand) return ''
  return v > 0 ? 'up' : 'down'
}

/** Rows with something in them this period — the default the seller table opens on. */
export const isActive = (r: OtpuSellerRow): boolean => (r.orders ?? 0) > 0

/**
 * A weighted %OTPU over any set of seller rows.
 *
 * Weighted rather than averaged, because a seller with one parcel and a seller
 * with forty thousand are not two equal opinions about how the week went. The
 * agent tab computes its own totals the same way, so the two agree.
 */
export function poolPct(rows: OtpuSellerRow[]): { orders: number; picked: number; pct: number | null } {
  let orders = 0, picked = 0
  for (const r of rows) { orders += r.orders ?? 0; picked += r.picked ?? 0 }
  return { orders, picked, pct: orders > 0 ? (picked / orders) * 100 : null }
}
