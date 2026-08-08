/**
 * J&T Daily Agent Performance — Excel parser & KPI model.
 *
 * Framework-free. Everything happens in memory; nothing is persisted.
 *
 * The real report splits KPI categories across SHEETS. Every sheet repeats the
 * same identity columns and adds its own KPI groups, e.g.
 *
 *   sheet "Pickup & Retur Non Ecom"
 *   ┌──────┬────────┬─────────────┬───────────────────────────────────────────────┐
 *   │ Area │ Agent  │ Kode Agent  │            Kualitas Non Platform              │
 *   │      │        │             ├──────────────────────┬────────────────────────┤
 *   │      │        │             │ Pickup Non-Ecommerce │ Retur COD Non-Ecommerce│
 *   │      │        │             ├──────┬────────┬──────┼──────┬────────┬────────┤
 *   │      │        │             │Target│26/07/26│ …    │Target│26/07/26│  …     │
 *   ├──────┼────────┼─────────────┼──────┼────────┼──────┼──────┼────────┼────────┤
 *   │ Jawa │TANGERANG│ AGENT12    │ 85%  │ 90.00% │ …    │ 85%  │ 90.00% │  …     │
 *   └──────┴────────┴─────────────┴──────┴────────┴──────┴──────┴────────┴────────┘
 *
 * `parseWorkbook` parses every readable sheet and merges them into ONE model,
 * matching agents by Kode Agent (falling back to the agent name). Column ids are
 * namespaced per sheet (`"2:14"`) so indices never collide.
 *
 * Drop-point readings live on their own tabs and are parsed separately (see
 * `parseDpSheet`). Two layouts are in circulation and both are read the same way,
 * because neither the parser nor the dashboard cares which one a file uses:
 *
 *   one tab per agent  — `AG12`, `AG13`, … `AG40`; the agent is the tab
 *   one tab for all    — `ALL DP DATA`; the agent is a column on every row
 *
 * The only thing that has to hold is that each row can name its own agent, by
 * its Kode Agent column or by the tab it sits on.
 */
import * as XLSX from 'xlsx'

/* ------------------------------------------------------------------ types */

export type Cell = { v: unknown; z: string; t?: string } | null
export type SubKind = 'date' | 'monthly' | 'target' | 'value'
/** `${sheetIndex}:${columnIndex}` — unique across the whole workbook. */
export type ColId = string

export interface DateSlot {
  key: string
  date: Date | null
  seq: number
}

export interface Kpi {
  key: string
  group: string
  /** original header text, may contain CJK */
  name: string
  /** short, editable display label */
  label: string
  /** sheets this KPI was found on */
  sheets: string[]
  dateCols: { id: ColId; date: Date | null }[]
  monthlyCol: ColId | null
  /** per-agent target column, when the sheet has one */
  targetCol: ColId | null
  byDateKey: Record<string, ColId>
  lowerBetter: boolean
  /** fallback target when there is no target column */
  target: number
  /** manual override; wins over the file's own Target column */
  targetOverride: number | null
  enabled: boolean
  inTrend: boolean
}

export interface AgentRow {
  /** merge key — Kode Agent when available, else the normalised name */
  key: string
  name: string
  label: string
  code: string
  area: string
  vals: Record<ColId, number>
}

export interface SheetInfo {
  name: string
  ok: boolean
  reason?: string
  kpiCount: number
  agentCount: number
  /**
   * 'agent'  one row per agent
   * 'dp'     one row per drop point / collection point, with readings
   * 'lookup' no readings at all — a reference table naming each site's business
   *          model, merged into the DP rows rather than shown on its own
   */
  kind: 'agent' | 'dp' | 'lookup'
}

/* ------------------------------------------------------- drop point level */

/**
 * One KPI's readings for one drop point.
 *
 * DP sheets are keyed by the *canonical* KPI label rather than by `ColId`,
 * because the drop-point tabs and the agent tabs spell the same category
 * differently (`快递员出勤准点率 / Tingkat Ketepatan Waktu Kehadiran Spirnter`
 * vs `06:30 ABSENSI`). Resolving both to `shortLabel()` is what lets a DP row
 * and an agent row talk about the same thing.
 */
export interface DpKpiVals {
  byDate: Record<string, number>
  mtd: number | null
  target: number | null
}

/** How much of the operation a drop point actually runs — see `dpStatusOf`. */
export type DpKind = 'both' | 'delivery' | 'pickup' | 'closed'

/**
 * Who runs the site: a partner-owned franchise, or J&T's own agent network.
 * `''` when the workbook's "Model Bisnis" column is absent or blank — older
 * files simply do not carry it, and an unknown model must not be guessed.
 */
export type BizModel = 'franchise' | 'agent' | ''

export interface DpRow {
  /** unique across the workbook: `${agentKey}::${name}` */
  key: string
  name: string
  label: string
  agentKey: string
  agentLabel: string
  agentCode: string
  /** the file prefixes collection points with `CP_`; everything else is a drop point */
  isCp: boolean
  /** from the workbook's "商业模式 Model Bisnis" column; `''` when not stated */
  bizModel: BizModel
  sheet: string
  /** canonical KPI label → readings */
  vals: Record<string, DpKpiVals>
}

export interface Model {
  kpis: Kpi[]
  rows: AgentRow[]
  /** the single region this dashboard covers, e.g. "Jawa & Bali" */
  region: string
  dates: DateSlot[]
  totalRow: AgentRow | null
  sheets: SheetInfo[]
  /** every drop point / collection point found in the per-agent tabs */
  dps: DpRow[]
  /** the days the DP tabs carry — usually a subset of `dates` */
  dpDates: DateSlot[]
}

/** This dashboard covers the Jawa & Bali region only. */
export const REGION_RE = /jawa|java|bali/i
export const REGION_LABEL = 'Jawa & Bali'

export type Status = 'ok' | 'warn' | 'bad' | 'na'

/* -------------------------------------------------------------- constants */

export const PALETTE = [
  '#E2231A', '#F5A623', '#2E86DE', '#00A650', '#8E44AD',
  '#16A085', '#D35400', '#C2185B', '#5D6D7E', '#0B7285',
]
export const STATUS_COLOR: Record<Status, string> = {
  ok: '#00A650', warn: '#F5A623', bad: '#E2231A', na: '#C6CCD8',
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/* ---------------------------------------------------------------- format */

/**
 * Day-precision key. Sheets may store the same day as a real date cell in one tab
 * and as text in another; normalising to Y-M-D makes them line up instead of
 * producing two separate columns on the axis.
 */
export const dayKey = (d: Date | null, seq: number): string =>
  d ? `d${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : `seq${seq}`

/**
 * `2026-07-28`, built from the date's *local* parts.
 *
 * `toISOString()` converts to UTC first, and every date in this model is local
 * midnight — so in Jakarta (UTC+7) it became 17:00 the previous day and each
 * exported filename came out dated one day early.
 */
export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const fmtDate = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`
export const fmtDateFull = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
export const dayName = (d: Date) => DAYS[d.getDay()]
export const pct = (v: number | null | undefined, dp = 2) =>
  v == null || Number.isNaN(v) ? '—' : `${v.toFixed(dp)}%`

/** Strip CJK so labels stay readable in a latin UI. */
const CJK = /[⺀-鿿豈-﫿︰-﹏＀-￯]/g
export function latin(s: unknown): string {
  const raw = String(s ?? '')
  const out = raw.replace(CJK, ' ').replace(/\s+/g, ' ').trim()
  return out || raw.trim()
}

export function txt(cell: Cell): string {
  if (!cell || cell.v == null) return ''
  if (cell.v instanceof Date) return fmtDateFull(cell.v)
  return String(cell.v).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/* ------------------------------------------------------- cell conversions */

/** Cell → number, honouring Excel percent number-formats. */
export function cellNum(cell: Cell): number | null {
  if (!cell || cell.v == null) return null
  const v = cell.v
  if (v instanceof Date) return null
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null
    return String(cell.z || '').includes('%') ? v * 100 : v
  }
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return null
    if (/^[-–—_.‐-―－]{1,6}$/.test(s)) return null           // "—", "--", "－－"
    if (/^#+$/.test(s)) return null                          // "#####" (column too narrow)
    if (/^(n\/?a|na|null|nil|kosong)$/i.test(s)) return null
    let cleaned = s.replace(/%/g, '').replace(/\s/g, '')
    if (/,\d{1,2}$/.test(cleaned) && !cleaned.includes('.')) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.')  // 1.234,56 → 1234.56
    } else {
      cleaned = cleaned.replace(/,/g, '')
    }
    const n = parseFloat(cleaned)
    return Number.isNaN(n) ? null : n                        // "91.40%" → 91.4
  }
  return null
}

const MONTH_KEYS = [
  'jan', 'feb|peb', 'mar', 'apr', 'may|mei', 'jun', 'jul',
  'aug|agu|ags', 'sep', 'oct|okt', 'nov', 'dec|des',
]
function monthIndex(name: string): number {
  const n = name.toLowerCase()
  for (let i = 0; i < MONTH_KEYS.length; i++) {
    for (const k of MONTH_KEYS[i].split('|')) if (n.startsWith(k)) return i
  }
  return -1
}

/**
 * Excel serial → local midnight, with no dependence on the machine's timezone.
 * `(serial - 25569) * 86_400_000` is UTC midnight of the target day; reading it
 * back with UTC getters and rebuilding locally keeps the calendar date exact.
 */
function serialToDate(n: number): Date {
  const u = new Date(Math.round((Math.floor(n) - 25569) * 86400000))
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate())
}

/**
 * Snap a Date to its calendar day.
 *
 * SheetJS builds dates from a 1899-12-30 baseline and corrects for the timezone
 * offset difference between then and now. In zones whose historical offset had an
 * odd minute component (Jakarta was +07:07 in 1899) the result lands a few minutes
 * *before* midnight, so `getDate()` returns the previous day. Adding 12 hours
 * before reading the parts absorbs drift in either direction.
 */
function snapDay(d: Date): Date {
  const x = new Date(d.getTime() + 12 * 3600 * 1000)
  return new Date(x.getFullYear(), x.getMonth(), x.getDate())
}

/** Cell → Date, if it plausibly is one. */
/**
 * `loose` relaxes the number-format check and is passed ONLY for header cells.
 * A bare serial in a header row is always a date — readings are percentages, so
 * nothing in the data can reach the 20000-80000 window. In the data area the
 * format check stays on, so a genuine reading of 46231 is never read as a day.
 */
export function cellDate(cell: Cell, loose = false): Date | null {
  if (!cell || cell.v == null) return null
  if (cell.v instanceof Date) return snapDay(cell.v)
  const v = cell.v
  if (typeof v === 'number') {
    const z = String(cell.z || '').toLowerCase()
    const formatted = z.includes('y') || z.includes('d') || z.includes('m')
    if (v > 20000 && v < 80000 && (formatted || loose)) {
      const d = serialToDate(v)
      return Number.isNaN(d.getTime()) ? null : d
    }
    return null
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/)        // 2026/7/24
  if (m) return new Date(+m[1], +m[2] - 1, +m[3])
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)          // 26/07/2026
  if (m) {
    const yy = +m[3] < 100 ? 2000 + +m[3] : +m[3]
    return new Date(yy, +m[2] - 1, +m[1])                           // dd/mm (ID locale)
  }
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})$/)                         // 7/24
  if (m) {
    const y = new Date().getFullYear()
    const p = +m[1], q = +m[2]
    return q > 12 ? new Date(y, p - 1, q) : new Date(y, q - 1, p)
  }
  m = s.match(/^(\d{1,2})\s*[-\s/]\s*([a-z]{3,9})\.?(?:\s*(\d{2,4}))?$/i)   // 24-Jul / 24 Juli 2026
  if (m) {
    const mi = monthIndex(m[2])
    if (mi >= 0) {
      const yy = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : new Date().getFullYear()
      return new Date(yy, mi, +m[1])
    }
  }
  return null
}

/* ------------------------------------------------------------ KPI naming */

/**
 * Group-aware, because "Persentase TTD" means different things under
 * "Ritase Pertama" (the 12:00 signature) and "Operasional Harian" (full day).
 */
const ALIASES: [RegExp, string][] = [
  [/ritase\s*kedua|\bkedua\b|二派|ritase\s*2|\br-?2\b/i, 'TTD RITASE 2'],
  [/1200|12\s*[:.]\s*00|jam\s*12/i, 'TTD PAKET JAM 12:00'],
  [/retur|退件|return/i, 'RETUR COD NON-ECOMMERCE'],
  [/tptw|交件准点/i, 'TPTW (ON TIME)'],
  [/kehadiran|absensi|出勤|sprinter|attendance/i, '06:30 ABSENSI'],
  [/keluar\s*gudang|出仓|0730|07\s*[:.]\s*30/i, '07:30 KELUAR GUDANG'],
  [/pickup|揽收|otpu|penjemputan/i, 'PICKUP NON-ECOMMERCE'],
  [/operasional|operational|全天签收|full\s*day|seharian/i, 'PERSENTASE TTD'],
  [/ritase\s*pertama|一派|ritase\s*1/i, 'TTD PAKET JAM 12:00'],
  [/签收|\bttd\b/i, 'TTD'],
]

export interface KpiSection {
  id: string
  label: string
  zh: string
  /** canonical labels, in the order they should appear inside the section */
  labels: string[]
}

/**
 * The eight categories in two halves.
 *
 * The first four are all *punctuality* — did the courier clock in, leave the
 * warehouse, sign by noon, hand over on time. Every one is a clock reading, and
 * a site failing them is failing at the same thing four times over.
 *
 * The second four are *completion and quality* — how much of the day's volume
 * was signed for, and how the non-platform work went. A site can be flawless on
 * one half and poor on the other, which is exactly why they are worth separating:
 * eight cards in an undifferentiated row made that pattern invisible.
 */
export const KPI_SECTIONS: KpiSection[] = [
  {
    id: 'ketepatan',
    label: 'Ketepatan Waktu',
    zh: '准点率',
    labels: [
      '06:30 ABSENSI',
      '07:30 KELUAR GUDANG',
      'TTD PAKET JAM 12:00',
      'TPTW (ON TIME)',
    ],
  },
  {
    id: 'penyelesaian',
    label: 'Penyelesaian & Kualitas',
    zh: '签收与质量',
    labels: [
      'TTD RITASE 2',
      'PERSENTASE TTD',
      'PICKUP NON-ECOMMERCE',
      'RETUR COD NON-ECOMMERCE',
    ],
  },
]

/**
 * The categories that actually exist in the report, in display order. Anything
 * a file contains that isn't on this list is still parsed but stays hidden, so
 * an extra column in a future workbook can't push the dashboard out of shape.
 *
 * Derived from `KPI_SECTIONS` rather than written out again: display order *is*
 * section order, and two hand-maintained lists would eventually disagree about
 * where TPTW sits — leaving a card in one section and its table column in the
 * other.
 */
export const CANONICAL_ORDER: string[] = KPI_SECTIONS.flatMap((s) => s.labels)

/** Which half a category belongs to; `null` for a column no section claims. */
export function sectionOf(label: string): KpiSection | null {
  return KPI_SECTIONS.find((s) => s.labels.includes(label)) ?? null
}

/**
 * Mandarin name for each category, lifted verbatim from the workbook's own
 * header rows rather than translated — so a supervisor reading the dashboard
 * and a supervisor reading the Excel are looking at the same words.
 */
export const CATEGORY_ZH: Record<string, string> = {
  '06:30 ABSENSI': '快递员出勤准点率',
  '07:30 KELUAR GUDANG': '0730出仓率',
  'TTD PAKET JAM 12:00': '1200签收率',
  'TTD RITASE 2': '二派签收率',
  'TPTW (ON TIME)': '交件准点率',
  'PERSENTASE TTD': '全天签收率',
  'PICKUP NON-ECOMMERCE': '非平台揽收及时率',
  'RETUR COD NON-ECOMMERCE': '非平台COD退件率',
}

/**
 * Mandarin name for each agent city.
 *
 * The per-agent tabs already write the combined form in their Agent column
 * ("TANGERANG唐格朗"), but the summary tabs write Latin only — and the summary
 * name is the one that wins the join, so it is the one shown. This puts the
 * Mandarin back, from a table rather than by keeping the CJK the parser strips.
 */
export const AGENT_ZH: Record<string, string> = {
  JAKARTA: '雅加达',
  TANGERANG: '唐格朗',
  BEKASI: '勿加西',
  BOGOR: '茂物',
  DEPOK: '德波',
  BANDUNG: '万隆',
  SEMARANG: '三宝垄',
  YOGYAKARTA: '日惹',
  SURABAYA: '泗水',
  BALI: '巴厘',
}

/** `''` for anything not on the list — a new city, or the all-agents row. */
export function agentZh(label: string): string {
  return AGENT_ZH[latin(label).toUpperCase().trim()] ?? ''
}

/** `TANGERANG 唐格朗` — for plain-text places: options, SVG labels, Excel. */
export function agentFull(label: string): string {
  const zh = agentZh(label)
  return zh ? `${label} ${zh}` : label
}

/**
 * The three categories a *sprinter* (courier) drives — attendance, leaving the
 * warehouse, and the first-ritase signature. Used for the default chart
 * category; the classification itself reads the narrower lists below.
 */
export const SPRINTER_LABELS = [
  '06:30 ABSENSI',
  '07:30 KELUAR GUDANG',
  'TTD PAKET JAM 12:00',
]

/**
 * The two categories that say whether a sprinter is *based* at the site: does
 * anyone clock in, and does anything leave the warehouse. Zero on both means no
 * courier works out of here, so the site can only be taking parcels in.
 *
 * 12:00 is deliberately not on this list even though it is a sprinter category.
 * It is a *result* — the share of the first ritase signed by noon — so a site
 * whose couriers all clocked in and left on time can still read 0 there on a bad
 * day. Including it made those days look like "no sprinter at all". Attendance
 * and warehouse-exit are the two that cannot be zero while a courier is present.
 */
export const PICKUP_ONLY_LABELS = [
  '06:30 ABSENSI',
  '07:30 KELUAR GUDANG',
]

/**
 * Handover-on-time: the category that only moves when the site passes parcels
 * on to the pickup flow. Zero here on a site that is otherwise running means it
 * delivers but does not collect.
 */
export const DELIVERY_ONLY_LABEL = 'TPTW (ON TIME)'

/**
 * The kinds that run a delivery shift, and so are the only ones a top-five or
 * worst-five may draw from. `pickup` and `closed` are structurally zero on the
 * delivery categories and would own every worst-five without meaning anything.
 */
export const DP_RANKABLE: readonly DpKind[] = ['both', 'delivery']

/** Does this site run a delivery shift, i.e. may it appear in a ranking? */
export const isRankable = (kind: DpKind): boolean => DP_RANKABLE.includes(kind)

/**
 * KPIs pre-selected for the trend chart. Named explicitly so that reordering
 * CANONICAL_ORDER, hiding a KPI, or a direction flip can't silently change
 * which three lines you get. Everything else stays toggleable in the legend.
 */
export const TREND_DEFAULT = [
  '06:30 ABSENSI',
  '07:30 KELUAR GUDANG',
  'TTD PAKET JAM 12:00',
]

/**
 * The three categories the comparison bar chart can switch between. They share
 * the same 90% target, so a single chart with one target line is meaningful for
 * all three — which is not true of, say, RETUR (a low-is-good limit).
 */
export const BAR_CHOICES = [
  '06:30 ABSENSI',
  '07:30 KELUAR GUDANG',
  'TTD PAKET JAM 12:00',
]

/**
 * Direction is not guessable for these — it is known. Everything on this list is
 * a completion rate (higher is better); RETUR is the one limit where lower wins.
 *
 * This exists because the per-file direction sniffing in `parseWorkbook` reads
 * the data rather than the meaning, and it got TTD PAKET JAM 12:00 backwards:
 * the chart then declared "Target ≤ 90%" and painted 93% bars red. Known
 * categories are pinned after the sniffing so the data can no longer overrule
 * them; unfamiliar columns still fall back to the guess.
 */
export const HIGHER_IS_BETTER = new Set([
  '06:30 ABSENSI',
  '07:30 KELUAR GUDANG',
  'TTD PAKET JAM 12:00',
  'TTD RITASE 2',
  'TPTW (ON TIME)',
  'PERSENTASE TTD',
  'PICKUP NON-ECOMMERCE',
  'TTD',
])
export const LOWER_IS_BETTER = new Set([
  'RETUR COD NON-ECOMMERCE',
])

export function shortLabel(name: string, group = ''): string {
  const combined = `${group} ${name}`
  for (const [re, out] of ALIASES) if (re.test(combined)) return out
  const l = latin(name).toUpperCase()
  return l.length > 34 ? `${l.slice(0, 33)}…` : (l || 'KPI')
}

const ICONS: [RegExp, string][] = [
  [/retur|return/i, '↺'],
  [/pickup|otpu/i, '📦'],
  [/absensi|kehadiran/i, '👥'],
  [/gudang/i, '🚚'],
  [/12:00|1200/i, '⏱'],
  [/ritase|reverse/i, '↻'],
  [/tptw|on time/i, '⏰'],
]
export function iconFor(label: string): string {
  for (const [re, out] of ICONS) if (re.test(label)) return out
  return '📈'
}

export function isLowerBetter(text: string): boolean {
  return /retur|退件|return|reject|gagal|fail|\blate\b|terlambat|keterlambatan|\blost\b|hilang|damage|rusak|komplain|complaint/i.test(text)
}

/* --------------------------------------------------- worksheet → matrix */

interface Matrix { m: Cell[][]; lastC: number; hadMerges: boolean }

/** A cell Excel wrote but left without a value is still empty for our purposes. */
const isBlank = (c: Cell): boolean => c == null || c.v == null || String(c.v).trim() === ''

/**
 * `maxRows` reads only the top of the sheet, for callers that just need the
 * header block — `looksLikeDpSheet` asks that question of every tab in the file,
 * and the combined drop-point tab is ~1700 rows × 70 columns, so materialising
 * all of it twice per load is work with no answer in it. Merges are still applied
 * to the rows that were read, which is what the header block depends on.
 */
function sheetMatrix(ws: XLSX.WorkSheet, maxRows = Infinity): Matrix {
  if (!ws || !ws['!ref']) return { m: [], lastC: 0, hadMerges: false }
  const r = XLSX.utils.decode_range(ws['!ref'])
  const lastR = Math.min(r.e.r, maxRows - 1), lastC = r.e.c
  const m: Cell[][] = []
  for (let R = 0; R <= lastR; R++) {
    const row: Cell[] = new Array(lastC + 1).fill(null)
    for (let C = 0; C <= lastC; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })] as XLSX.CellObject | undefined
      row[C] = cell ? { v: cell.v, z: (cell.z as string) || '', t: cell.t } : null
    }
    m.push(row)
  }
  const merges = ws['!merges'] || []
  for (const g of merges) {
    const src = m[g.s.r]?.[g.s.c] ?? null
    if (isBlank(src)) continue
    for (let R = g.s.r; R <= g.e.r; R++) {
      if (!m[R]) continue
      for (let C = g.s.c; C <= Math.min(g.e.c, lastC); C++) {
        if (isBlank(m[R][C])) m[R][C] = src
      }
    }
  }
  return { m, lastC, hadMerges: merges.length > 0 }
}

/* ------------------------------------------------------- per-sheet parse */

interface RawKpi {
  group: string
  name: string
  dateCols: { id: ColId; date: Date | null }[]
  monthlyCol: ColId | null
  targetCol: ColId | null
}
interface RawRow {
  key: string
  name: string
  code: string
  area: string
  vals: Record<ColId, number>
  isTotal: boolean
}
interface RawSheet { kpis: RawKpi[]; rows: RawRow[]; totalRow: RawRow | null }

const IDENTITY_RE = /^(kode|code|kd\.?|id|no\.?|nomor|nama|name|agen|agent|area|region|wilayah|provinsi|pulau|cabang|outlet|hub|dc|drop\s*point|branch)\b/i

/** Errors thrown here are plain phrases — `parseWorkbook` prefixes the sheet name. */
function parseOneSheet(ws: XLSX.WorkSheet, sheetIdx: number): RawSheet {
  const { m, lastC } = sheetMatrix(ws)
  if (!m.length) throw new Error('sheet ini kosong')

  const cid = (C: number): ColId => `${sheetIdx}:${C}`

  /* 1 — locate the Agent header cell */
  let headerRow = -1, agentCol = -1, areaCol = -1, codeCol = -1
  const scanTo = Math.min(m.length, 40)
  for (let R = 0; R < scanTo && agentCol < 0; R++) {
    for (let C = 0; C <= Math.min(lastC, 12); C++) {
      const s = txt(m[R][C])
      if (!s) continue
      // "Agent" but NOT "Kode Agent"
      if (/^(agent|agen|代理区)$/i.test(s) || (/agent|代理区/i.test(s) && !/kode|code|kd\b/i.test(s))) {
        headerRow = R; agentCol = C; break
      }
    }
  }
  if (agentCol < 0) throw new Error('tidak ada judul kolom "Agent" pada 40 baris pertama')

  for (let C = 0; C < agentCol; C++) {
    const s = txt(m[headerRow][C])
    if (s && /area|区域|wilayah|region|provinsi|pulau/i.test(s)) { areaCol = C; break }
  }
  if (areaCol < 0 && agentCol > 0) areaCol = agentCol - 1

  /* 1b — skip any further identity columns (Kode Agent, No, …) */
  let kpiStart = agentCol + 1
  while (kpiStart <= lastC) {
    const s = txt(m[headerRow][kpiStart])
    if (!s || !IDENTITY_RE.test(s)) break
    if (/kode|code|kd\b|^id$/i.test(s) && codeCol < 0) codeCol = kpiStart
    kpiStart++
  }

  /* 2 — find the first data row */
  const numCount = (R: number) => {
    let n = 0
    for (let c = kpiStart; c <= lastC; c++) if (cellNum(m[R][c]) != null) n++
    return n
  }
  let dataStart = -1
  for (let R = headerRow + 1; R < m.length; R++) {
    const a = txt(m[R][agentCol])
    if (!a) continue
    if (/^(agent|agen|代理区|area|区域|kode)/i.test(a)) continue
    if (numCount(R) >= 2) { dataStart = R; break }
  }
  if (dataStart < 0) throw new Error('kolom Agent tidak memiliki baris data angka di bawahnya')

  const nHdr = dataStart - headerRow

  /* 2b — close every hole in the header block.
     Each header row is forward-filled to the right, so a column whose group or
     KPI-name cell is empty inherits the label of the column to its left. Merge
     metadata does this when the exporter writes it; this repairs the rows where
     it did not. Runs unconditionally — a workbook can carry merges for some
     header rows and not others. */
  if (nHdr > 1) {
    for (let R = headerRow; R < dataStart - 1; R++) {
      let last: Cell = null
      for (let C = kpiStart; C <= lastC; C++) {
        if (m[R][C] != null && txt(m[R][C])) last = m[R][C]
        else if (last) m[R][C] = last
      }
    }
  }

  /* 3 — describe every KPI column */
  const kpis: RawKpi[] = []
  const byKey = new Map<string, RawKpi>()

  for (let C = kpiStart; C <= lastC; C++) {
    const labels: string[] = []
    for (let k = 0; k < nHdr; k++) labels.push(txt(m[headerRow + k]?.[C] ?? null))
    const subCell = m[headerRow + nHdr - 1]?.[C] ?? null
    const sub = labels[nHdr - 1] || ''
    /* Positional read. Never collapse the upper rows with filter(Boolean): a
       hole in one row would shift the others and hand the column a different
       identity from its siblings — which is exactly how a single day goes
       missing from one KPI. Step 2b guarantees there are no holes left. */
    const upper = labels.slice(0, nHdr - 1)

    let group = upper[0] || ''
    let name = upper.length ? (upper[upper.length - 1] || group) : ''
    let kind: SubKind = 'value'
    let date: Date | null = null

    if (upper.length) {
      const d = cellDate(subCell, true)     // header row: unformatted serials count
      if (/^target|目标|标准|standar|kpi\s*target/i.test(sub)) kind = 'target'
      else if (/bulanan|monthly|月度|\bmtd\b|pencapaian|akumulasi/i.test(sub)) kind = 'monthly'
      else if (d) { kind = 'date'; date = d }
    } else {
      name = sub                                     // flat header
    }
    if (!name) continue
    // when group === name there is really only one header level
    if (group === name) group = ''

    const key = `${group}||${name}`
    let k = byKey.get(key)
    if (!k) {
      k = { group, name, dateCols: [], monthlyCol: null, targetCol: null }
      byKey.set(key, k); kpis.push(k)
    }
    if (kind === 'date') k.dateCols.push({ id: cid(C), date })
    else if (kind === 'monthly') { if (!k.monthlyCol) k.monthlyCol = cid(C) }
    else if (kind === 'target') { if (!k.targetCol) k.targetCol = cid(C) }
    else k.dateCols.push({ id: cid(C), date: null })   // unlabelled → treat as a day slot
  }
  if (!kpis.length) throw new Error('tidak ada kolom KPI di sebelah kanan kolom identitas')

  /* 4 — read data rows */
  const rows: RawRow[] = []
  let totalRow: RawRow | null = null
  let lastArea = '', blanks = 0

  for (let R = dataStart; R < m.length; R++) {
    const name = txt(m[R][agentCol])
    const nc = numCount(R)
    if (!name && nc === 0) { if (++blanks > 8) break; continue }
    blanks = 0
    if (!name || nc === 0) continue

    const isTotal = /合计|^total$|^jumlah|grand\s*total|keseluruhan|^sum$/i.test(name)
    const isTargetRow = /^target$|^目标$|^standar/i.test(name)
    if (isTargetRow) continue                          // a whole-row target is handled by targetCol

    const areaTxt = areaCol >= 0 ? txt(m[R][areaCol]) : ''
    if (areaTxt && !isTotal) lastArea = areaTxt

    const vals: Record<ColId, number> = {}
    for (let C = kpiStart; C <= lastC; C++) {
      const n = cellNum(m[R][C])
      if (n != null) vals[cid(C)] = n
    }

    const code = codeCol >= 0 ? txt(m[R][codeCol]) : ''
    const rec: RawRow = {
      key: normKey(isTotal ? '__TOTAL__' : (code || name)),
      name, code,
      area: isTotal ? '' : (latin(lastArea) || lastArea),
      vals, isTotal,
    }
    if (isTotal) totalRow = rec
    else rows.push(rec)
  }
  if (!rows.length) throw new Error('tidak ditemukan baris agen')

  /* 5 — percent-scaling fallback (0.9140 stored without a % format) */
  for (const k of kpis) {
    const ids = k.dateCols.map((d) => d.id)
    if (k.monthlyCol) ids.push(k.monthlyCol)
    if (k.targetCol) ids.push(k.targetCol)
    const vs: number[] = []
    for (const r of rows) for (const id of ids) if (r.vals[id] != null) vs.push(Math.abs(r.vals[id]))
    if (vs.length >= 3 && Math.max(...vs) <= 1.0000001) {
      for (const r of [...rows, totalRow]) {
        if (!r) continue
        for (const id of ids) if (r.vals[id] != null) r.vals[id] *= 100
      }
    }
  }

  return { kpis, rows, totalRow }
}

function normKey(s: string): string {
  return s.toUpperCase().replace(/\s+/g, ' ').trim()
}

/* --------------------------------------------------- drop-point sheet parse */

const DP_HEADER_RE = /drop\s*point|网点|dp\s*\/\s*cp/i
const CODE_HEADER_RE = /kode|code|编码|\bkd\b/i
const AGENT_HEADER_RE = /agent|agen\b|代理区/i
/* Loose on purpose: the title is written "商业模式 Model Bisnis" in the files seen
   so far, but "Bisnis" or "模式" alone is unambiguous in a header block whose only
   other columns are an agent, a code, a site name and eight percentage KPIs. */
const MODEL_HEADER_RE = /model\s*bisnis|bisnis|商业模式|模式|business\s*model/i

/**
 * `Franchise` / `Agent` out of the workbook's "Model Bisnis" column.
 *
 * `franchise` is tested first: `AGENT_HEADER_RE`-style words are the looser
 * match, and a value like "Franchise Agent" belongs to the partner, not to us.
 * Anything unrecognised comes back `''` rather than being forced into one of the
 * two — a wrong tag on the row is worse than a visibly missing one.
 */
function bizModelOf(s: string): BizModel {
  if (/franchise|frenchise|waralaba|加盟|\bfr\b/i.test(s)) return 'franchise'
  if (/agent|agen|自营|直营|\bag\b/i.test(s)) return 'agent'
  return ''
}

/**
 * Strict form, used only to *identify* the column by its contents: the cell has
 * to be the word itself, not merely contain it. `bizModelOf` is deliberately
 * loose so it can read a value once the column is known, but that looseness
 * would hand the job to `Kode Agent` — every one of whose cells reads "AGENT12".
 */
const isBizModelWord = (s: string): boolean =>
  /^(franchise|frenchise|waralaba|agent|agen|加盟|自营|直营)$/i.test(s.trim())

/**
 * A report title, as opposed to a column heading.
 *
 * The drop-point tab carries a red banner across the top of the sheet — in the
 * current file `网管-雅加达网点质量达成 2026-08-06` and
 * `NM - Pencapaian Kualitas DropPoint Jakarta 2026-08-06` — and *both* of those
 * satisfy `DP_HEADER_RE` exactly as well as the real `网点 / Nama Drop point`
 * heading does. The banner is merged across the full width of the sheet, so it
 * is also the first match any top-down scan meets: taking it points the parser
 * at a column with nothing underneath it, and the whole tab then fails with
 * "kolom Drop point tidak memiliki baris data angka di bawahnya".
 *
 * The date inside the title is what separates the two. A column heading names a
 * thing; only a title says *when*. Length alone does not work — the Chinese
 * banner is shorter than several genuine headings in this file.
 */
const TITLE_RE = /\d{4}|\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}/

const isHeaderLabel = (s: string): boolean => !!s && s.length <= 80 && !TITLE_RE.test(s)

interface DpHeaderHit { headerRow: number; dpCol: number }

/** How far down a sheet the header block may start. */
const DP_HEADER_SCAN_ROWS = 30

/**
 * Locate the `Nama Drop point` heading — the anchor the whole DP parse hangs off.
 *
 * Three tiers, best first:
 *   1. a heading whose row *also* names the agent or its code somewhere else.
 *      A header block always carries its identity columns side by side, and a
 *      banner row never does, so this is the answer whenever it exists.
 *   2. any match that is not title-shaped (see `TITLE_RE`).
 *   3. failing both, the first match of any kind — the pre-existing behaviour,
 *      kept so an unfamiliar file shape degrades rather than disappears.
 */
function findDpHeader(m: Cell[][], lastC: number): DpHeaderHit | null {
  const maxR = Math.min(m.length, DP_HEADER_SCAN_ROWS)
  const maxC = Math.min(lastC, 20)
  let loose: DpHeaderHit | null = null
  let plain: DpHeaderHit | null = null

  for (let R = 0; R < maxR; R++) {
    const row = m[R]
    if (!row) continue
    for (let C = 0; C <= maxC; C++) {
      const s = txt(row[C])
      if (!s || !DP_HEADER_RE.test(s)) continue
      if (!loose) loose = { headerRow: R, dpCol: C }
      if (!isHeaderLabel(s)) continue
      if (!plain) plain = { headerRow: R, dpCol: C }
      for (let C2 = 0; C2 <= maxC; C2++) {
        if (C2 === C) continue
        const t = txt(row[C2])
        if (!isHeaderLabel(t)) continue
        if (AGENT_HEADER_RE.test(t) || CODE_HEADER_RE.test(t)) return { headerRow: R, dpCol: C }
      }
    }
  }
  return plain ?? loose
}

/**
 * A drop-point tab lists sites, not agents, and must NOT be merged into the
 * agent-level model — doing so would create a second "06:30 ABSENSI" KPI (the
 * DP tabs spell it in Chinese) and duplicate every card on the dashboard.
 * The give-away is a "Nama Drop point" / 网点 column in the header block.
 *
 * The match has to be a real heading rather than a title (`isHeaderLabel`):
 * the agent-level tabs are titled in the same words, and one of them classified
 * as a DP tab would take its KPIs out of the dashboard entirely.
 */
export function looksLikeDpSheet(ws: XLSX.WorkSheet): boolean {
  if (!ws || !ws['!ref']) return false
  const { m, lastC } = sheetMatrix(ws, DP_HEADER_SCAN_ROWS)
  const hit = findDpHeader(m, lastC)
  return !!hit && isHeaderLabel(txt(m[hit.headerRow][hit.dpCol]))
}

interface RawDpSheet { rows: DpRow[]; kpiCount: number; dates: { key: string; date: Date | null }[] }

/* -------------------------------------------- business-model lookup sheet */

/** One site's business model, as stated on a reference tab. */
export interface BizModelEntry {
  /** Kode Agent, normalised — `AGENT40` */
  agentCode: string
  /** drop-point name, normalised */
  name: string
  model: BizModel
}

/**
 * Read a tab that names each site's business model and nothing else.
 *
 * The daily report does not always carry a "Model Bisnis" column beside the
 * readings — the combined `ALL DP DATA` tab does not — and without it every site
 * on the dashboard is tagged `?`. Rather than have someone widen a 48-column
 * sheet by hand each morning, the fact can live on its own tab (`Fr&Ag`) that is
 * written once and changes only when a site changes hands.
 *
 * Such a tab looks almost exactly like a drop-point tab: agent, Kode Agent, site
 * name, and a header block. The one difference is that it has no readings, and
 * that is what this function checks. Returning `null` rather than throwing lets
 * the caller fall through to the real drop-point parser, so a tab that *does*
 * carry both a Model Bisnis column and readings is still parsed as data — which
 * is what the older per-agent tabs are.
 */
function parseBizModelSheet(ws: XLSX.WorkSheet): BizModelEntry[] | null {
  const { m, lastC } = sheetMatrix(ws)
  if (!m.length) return null

  const hit = findDpHeader(m, lastC)
  if (!hit) return null
  const { headerRow, dpCol } = hit

  /* The Model Bisnis column may sit either side of the site name, so the sweep
     covers the whole width rather than only the identity block to the left. */
  let modelCol = -1
  for (let R = 0; R <= headerRow + 3 && modelCol < 0; R++) {
    if (!m[R]) continue
    for (let C = 0; C <= lastC; C++) {
      if (C === dpCol) continue
      if (MODEL_HEADER_RE.test(txt(m[R][C]))) { modelCol = C; break }
    }
  }
  if (modelCol < 0) return null           // no business-model column: not this kind of tab

  let agentCol = -1, codeCol = -1
  for (let C = 0; C < dpCol; C++) {
    const s = txt(m[headerRow][C])
    if (!s) continue
    if (CODE_HEADER_RE.test(s)) { if (codeCol < 0) codeCol = C }
    else if (AGENT_HEADER_RE.test(s)) { if (agentCol < 0) agentCol = C }
  }

  const headerText = txt(m[headerRow][dpCol])
  const entries: BizModelEntry[] = []
  let lastCode = '', blanks = 0

  for (let R = headerRow + 1; R < m.length; R++) {
    const name = txt(m[R][dpCol])
    if (!name) { if (++blanks > 40) break; continue }
    blanks = 0
    /* the header block is merged down a few rows, so its own text reappears */
    if (name === headerText || DP_HEADER_RE.test(name)) continue
    if (/合计|^total$|^jumlah|grand\s*total|^sum$/i.test(name)) continue

    /* A reading anywhere on this row means the tab is a data tab after all, and
       parsing it as a lookup would throw its numbers away. Hand it back. */
    let nums = 0
    for (let C = dpCol + 1; C <= lastC; C++) if (cellNum(m[R][C]) != null) nums++
    if (nums >= 2) return null

    const model = bizModelOf(txt(m[R][modelCol]))
    if (!model) continue                  // blank or unrecognised — nothing to record

    const c = codeCol >= 0 ? txt(m[R][codeCol]) : ''
    if (c) lastCode = c
    const agent = agentCol >= 0 ? txt(m[R][agentCol]) : ''

    entries.push({
      agentCode: normKey(lastCode) || normKey(agent),
      name: normKey(name),
      model,
    })
  }

  return entries.length ? entries : null
}

/**
 * Index the lookup two ways, because the join can be made on two different
 * strengths of evidence.
 *
 * `byPair` is Kode Agent plus site name, which is exact. `byName` is the site
 * name alone, and it holds **only names that appear once in the whole file** —
 * a name used by two agents is ambiguous, and guessing which one is meant would
 * put a confident wrong tag on a row, which is worse than the `?` it replaced.
 */
function indexBizModels(entries: BizModelEntry[]) {
  const byPair = new Map<string, BizModel>()
  const seen = new Map<string, BizModel | null>()   // null marks "seen more than once"

  for (const e of entries) {
    byPair.set(`${e.agentCode}::${e.name}`, e.model)
    if (seen.has(e.name)) {
      if (seen.get(e.name) !== e.model) seen.set(e.name, null)
    } else {
      seen.set(e.name, e.model)
    }
  }

  const byName = new Map<string, BizModel>()
  for (const [name, model] of seen) if (model) byName.set(name, model)

  return { byPair, byName }
}

/**
 * `AG12` → `AGENT12`. The tab name is the fallback identity for a sheet whose
 * Kode Agent column is blank; without it such a tab's drop points would end up
 * orphaned and invisible behind the agent filter.
 *
 * Only one-agent-per-tab files (`AG12` … `AG40`) can be identified this way. A
 * combined tab — every agent's drop points on one sheet, as "ALL DP DATA" — has
 * no single agent to name, so it returns `''` and the row's own Kode Agent
 * column carries the identity instead. That column is per-row on such a sheet,
 * which is exactly what makes the combined shape work at all.
 */
function agentKeyFromSheet(sheetName: string): string {
  const m = sheetName.trim().match(/^ag[\s_-]*(\d+)$/i)
  return m ? `AGENT${m[1]}` : ''
}

/** Errors thrown here are plain phrases — `parseWorkbook` prefixes the sheet name. */
function parseDpSheet(ws: XLSX.WorkSheet, sheetName: string): RawDpSheet {
  const { m, lastC } = sheetMatrix(ws)
  if (!m.length) throw new Error('sheet ini kosong')

  /* 1 — locate the Drop point header cell */
  const hit = findDpHeader(m, lastC)
  if (!hit) throw new Error('tidak ada judul kolom "Nama Drop point"')
  const { headerRow, dpCol } = hit

  /* 1b — identity columns to its left */
  let agentCol = -1, codeCol = -1
  for (let C = 0; C < dpCol; C++) {
    const s = txt(m[headerRow][C])
    if (!s) continue
    if (CODE_HEADER_RE.test(s)) { if (codeCol < 0) codeCol = C }
    else if (AGENT_HEADER_RE.test(s)) { if (agentCol < 0) agentCol = C }
  }

  /* 2 — first data row */
  const numCount = (R: number) => {
    let n = 0
    for (let c = dpCol + 1; c <= lastC; c++) if (cellNum(m[R][c]) != null) n++
    return n
  }
  let dataStart = -1
  for (let R = headerRow + 1; R < m.length; R++) {
    if (!txt(m[R][dpCol])) continue
    if (DP_HEADER_RE.test(txt(m[R][dpCol]))) continue
    if (numCount(R) >= 2) { dataStart = R; break }
  }
  if (dataStart < 0) throw new Error('kolom Drop point tidak memiliki baris data angka di bawahnya')

  const nHdr = dataStart - headerRow
  if (nHdr < 2) throw new Error('blok judul terlalu dangkal untuk memuat nama KPI')

  /* 2a — the "Model Bisnis" column, which sits to the *right* of the drop-point
     name rather than with the other identity columns, so the step-1b scan does
     not reach it.
     The sweep starts at row 0, not at `headerRow`. `headerRow` is wherever the
     *网点* title happens to sit, and a title one row higher than that — its merge
     starting earlier, or a spare banner row above the block — put the column out
     of reach and every site came back "?". Run before step 2b, which overwrites
     blanks in the header block and would smear the title along the row. It stays
     out of the KPI scan on its own: "MODEL BISNIS" is not in CANONICAL_ORDER, so
     step 3 drops it like any other unknown column. */
  let modelCol = -1
  for (let R = 0; R < dataStart && modelCol < 0; R++) {
    for (let C = 0; C <= lastC; C++) {
      if (MODEL_HEADER_RE.test(txt(m[R][C]))) { modelCol = C; break }
    }
  }

  /* 2b — close every hole in the header block (see parseOneSheet, step 2b) */
  for (let R = headerRow; R < dataStart - 1; R++) {
    let last: Cell = null
    for (let C = dpCol + 1; C <= lastC; C++) {
      if (m[R][C] != null && txt(m[R][C])) last = m[R][C]
      else if (last) m[R][C] = last
    }
  }

  /* 3 — describe every KPI column, resolved to a canonical label.
     Columns that do not resolve to a category this dashboard knows about are
     dropped outright — the DP tabs carry a few hidden helper columns holding
     copies of the drop-point name, and they must not become phantom KPIs. */
  interface DpCol { label: string; kind: SubKind; dateKey: string; date: Date | null }
  const cols: Record<number, DpCol> = {}
  const dateSlots = new Map<string, Date | null>()
  const seenLabels = new Set<string>()

  for (let C = dpCol + 1; C <= lastC; C++) {
    const labels: string[] = []
    for (let k = 0; k < nHdr; k++) labels.push(txt(m[headerRow + k]?.[C] ?? null))
    const sub = labels[nHdr - 1] || ''
    const group = labels[0] || ''
    const name = labels[nHdr - 2] || group
    if (!name) continue

    const label = shortLabel(name, group)
    if (!CANONICAL_ORDER.includes(label)) continue

    let kind: SubKind = 'value'
    let date: Date | null = null
    if (/^target|目标|标准|standar|kpi\s*target/i.test(sub)) kind = 'target'
    else if (/bulanan|monthly|月度|\bmtd\b|pencapaian|akumulasi/i.test(sub)) kind = 'monthly'
    else {
      const d = cellDate(m[headerRow + nHdr - 1]?.[C] ?? null, true)
      if (!d) continue                    // an unlabelled column carries no meaning here
      kind = 'date'; date = d
    }

    const dateKey = date ? dayKey(date, 0) : ''
    if (kind === 'date') dateSlots.set(dateKey, date)
    cols[C] = { label, kind, dateKey, date }
    seenLabels.add(label)
  }
  if (!seenLabels.size) throw new Error('tidak ada kolom KPI yang dikenali')

  /* 3b — model bisnis by content, when no header matched.
     The header is the fast path, but it is also the fragile one: a renamed title,
     a typo, or a column carrying the value with no title at all leaves every site
     tagged "?" with nothing to say why. "Franchise" and "Agent" are distinctive
     enough to recognise on sight, so fall back to reading the data.
     Only columns step 3 did not claim as a KPI are considered, and a column has
     to be *mostly* these two words — a majority of its non-empty cells — before
     it is accepted, so a stray note column cannot win the job. */
  if (modelCol < 0) {
    const probeEnd = Math.min(m.length, dataStart + 60)
    let bestCol = -1, bestHits = 0
    for (let C = 0; C <= lastC; C++) {
      if (cols[C] || C === dpCol || C === agentCol || C === codeCol) continue
      let hits = 0, filled = 0
      for (let R = dataStart; R < probeEnd; R++) {
        const s = txt(m[R]?.[C] ?? null)
        if (!s) continue
        filled++
        if (isBizModelWord(s)) hits++
      }
      if (filled >= 2 && hits * 2 > filled && hits > bestHits) { bestHits = hits; bestCol = C }
    }
    modelCol = bestCol
  }

  /* 4 — read the drop points */
  const rows: DpRow[] = []
  const fallbackKey = agentKeyFromSheet(sheetName)
  let lastAgent = '', lastCode = '', blanks = 0

  for (let R = dataStart; R < m.length; R++) {
    const name = txt(m[R][dpCol])
    const nc = numCount(R)
    /* A tab that holds one agent ends where its list ends, so a short run of empty
       rows meant the end of the data. A combined tab is one agent's block after
       another's, and a spacer, a per-agent subtotal band or a page break between
       two of them is empty for as many rows as the author felt like — stopping at
       eight would silently drop every agent below the first gap. The scan is
       bounded by the sheet either way; the cost of looking further is nothing. */
    if (!name && nc === 0) { if (++blanks > 40) break; continue }
    blanks = 0
    if (!name) continue
    if (/合计|^total$|^jumlah|grand\s*total|^sum$/i.test(name)) continue

    /* Agent + code are written once and merged down the whole block on some tabs
       and repeated on every row on others — carry the last seen value forward so
       both shapes produce the same result. */
    const a = agentCol >= 0 ? txt(m[R][agentCol]) : ''
    const c = codeCol >= 0 ? txt(m[R][codeCol]) : ''
    if (a) lastAgent = a
    if (c) lastCode = c

    const vals: Record<string, DpKpiVals> = {}
    for (const cStr of Object.keys(cols)) {
      const C = Number(cStr)
      const col = cols[C]
      const v = cellNum(m[R][C])
      if (v == null) continue
      const slot = (vals[col.label] ??= { byDate: {}, mtd: null, target: null })
      if (col.kind === 'date') slot.byDate[col.dateKey] = v
      else if (col.kind === 'monthly') slot.mtd = v
      else if (col.kind === 'target') slot.target = v
    }

    const code = normKey(lastCode) || fallbackKey
    rows.push({
      key: `${code || sheetName}::${normKey(name)}`,
      name,
      label: latin(name) || name,
      agentKey: code || normKey(lastAgent) || sheetName,
      agentLabel: latin(lastAgent) || lastAgent || code || sheetName,
      agentCode: code,
      isCp: /^cp[\s_-]/i.test(name.trim()),
      bizModel: modelCol >= 0 ? bizModelOf(txt(m[R][modelCol])) : '',
      sheet: sheetName,
      vals,
    })
  }
  if (!rows.length) throw new Error('tidak ditemukan baris drop point')

  /* 5 — percent-scaling fallback (0.9140 stored without a % number-format) */
  for (const label of seenLabels) {
    const vs: number[] = []
    for (const r of rows) {
      const s = r.vals[label]
      if (!s) continue
      for (const k of Object.keys(s.byDate)) vs.push(Math.abs(s.byDate[k]))
      if (s.mtd != null) vs.push(Math.abs(s.mtd))
      if (s.target != null) vs.push(Math.abs(s.target))
    }
    if (vs.length >= 3 && Math.max(...vs) <= 1.0000001) {
      for (const r of rows) {
        const s = r.vals[label]
        if (!s) continue
        for (const k of Object.keys(s.byDate)) s.byDate[k] *= 100
        if (s.mtd != null) s.mtd *= 100
        if (s.target != null) s.target *= 100
      }
    }
  }

  return {
    rows,
    kpiCount: seenLabels.size,
    dates: [...dateSlots.entries()].map(([key, date]) => ({ key, date })),
  }
}

/* ------------------------------------------------- drop-point classification */

/**
 * What a drop point was actually doing on a given day.
 *
 *   closed   — every one of the eight categories reads 0. The site is shut.
 *   pickup   — 06:30 *and* 07:30 both read 0. Nobody clocks in and nothing
 *              leaves the warehouse here, so no sprinter is based at the site:
 *              it only takes parcels in over the counter. Every delivery
 *              category is then structurally zero rather than bad.
 *   delivery — TPTW reads 0. Couriers deliver out of this site but it hands
 *              nothing over to the pickup flow, so the pickup categories are
 *              the structural zeros instead.
 *   both     — the site runs a delivery shift *and* a pickup flow.
 *
 * Order matters twice over. A closed site reads 0 on 06:30 and 07:30 as well,
 * so the all-zero test has to run first or every closed site would come back
 * "pickup only". And a pickup-only site hands nothing over either, so its TPTW
 * is 0 too — the pickup test has to beat the delivery test for the same reason.
 * In both pairs the earlier answer is the more specific one, so it wins.
 *
 * Sites that run a delivery shift (`both` and `delivery`) are the ones ranked;
 * see `DP_RANKABLE`.
 */
export function dpStatusOf(dp: DpRow, dateKey: string): DpKind {
  const read = (label: string): number | null => {
    const v = dp.vals[label]?.byDate[dateKey]
    return v == null ? null : v
  }

  /* closed — 0 across all eight categories */
  const all = CANONICAL_ORDER.map(read).filter((v): v is number => v != null)
  if (!all.length) return 'closed'          // nothing recorded at all — unrankable either way
  if (all.every((v) => v === 0)) return 'closed'

  /* pickup only — 0 on both 06:30 and 07:30 */
  const shift = PICKUP_ONLY_LABELS.map(read)
  /* Guard: if the workbook carried neither column there is nothing to test, and
     treating "absent" as "zero" would quietly mark every single site pickup-only
     and leave both ranking charts empty. Same for TPTW below. */
  if (shift.some((v) => v != null) && shift.every((v) => v == null || v === 0)) return 'pickup'

  /* delivery only — 0 on TPTW, the handover that feeds the pickup flow */
  if (read(DELIVERY_ONLY_LABEL) === 0) return 'delivery'

  return 'both'
}

export const DP_KIND_LABEL: Record<DpKind, string> = {
  both: 'Delivery and Pick up',
  delivery: 'Delivery Only',
  pickup: 'Pick up Only',
  closed: 'Tutup',
}

export const DP_KIND_ZH: Record<DpKind, string> = {
  both: '派送及揽收',
  delivery: '仅派送',
  pickup: '仅揽收',
  closed: '已关闭',
}

/** Model bisnis as it should read on screen and in the export. */
export const BIZ_MODEL_LABEL: Record<BizModel, string> = {
  franchise: 'Franchise',
  agent: 'Agent',
  '': '—',
}

/** The two-letter tag on the front of a drop-point name. */
export const BIZ_MODEL_TAG: Record<BizModel, string> = {
  franchise: 'FR',
  agent: 'AG',
  '': '?',
}

/** Reading for one category on one day; `null` when the column is absent. */
export function dpValue(dp: DpRow, label: string, dateKey: string): number | null {
  const v = dp.vals[label]?.byDate[dateKey]
  return v == null ? null : v
}

/** Target for this category *at this drop point* — its own column wins. */
export function dpTargetFor(dp: DpRow, kpi: Kpi): number {
  const own = dp.vals[kpi.label]?.target
  if (own != null) return own
  return targetFor(kpi, null)
}

/* --------------------------------------------------------- workbook parse */

/** Parse every readable sheet and merge them into a single model. */
export function parseWorkbook(wb: XLSX.WorkBook): Model {
  const sheets: SheetInfo[] = []
  const kpis: Kpi[] = []
  const kpiByKey = new Map<string, Kpi>()
  const rowByKey = new Map<string, AgentRow>()
  const rowOrder: AgentRow[] = []
  let totalRow: AgentRow | null = null
  const dps: DpRow[] = []
  const dpDateMap = new Map<string, Date | null>()
  const bizEntries: BizModelEntry[] = []

  wb.SheetNames.forEach((sheetName, sheetIdx) => {
    const ws = wb.Sheets[sheetName]

    /* per-agent drop-point tab — parsed into its own model, never merged into
       the agent rows (see `looksLikeDpSheet`) */
    if (looksLikeDpSheet(ws)) {
      /* A reference tab naming each site's business model looks like a
         drop-point tab and is not one. Tried first, and it declines by returning
         null the moment it finds readings, so a real data tab falls straight
         through to the parser below. */
      const biz = parseBizModelSheet(ws)
      if (biz) {
        bizEntries.push(...biz)
        sheets.push({
          name: sheetName, ok: true, kind: 'lookup',
          kpiCount: 0, agentCount: biz.length,
        })
        return
      }

      try {
        const raw = parseDpSheet(ws, sheetName)
        dps.push(...raw.rows)
        for (const d of raw.dates) if (!dpDateMap.has(d.key)) dpDateMap.set(d.key, d.date)
        sheets.push({
          name: sheetName, ok: true, kind: 'dp',
          kpiCount: raw.kpiCount, agentCount: raw.rows.length,
        })
      } catch (e) {
        sheets.push({
          name: sheetName, ok: false, kind: 'dp',
          reason: (e as Error).message, kpiCount: 0, agentCount: 0,
        })
      }
      return
    }

    let raw: RawSheet
    try {
      raw = parseOneSheet(ws, sheetIdx)
    } catch (e) {
      sheets.push({ name: sheetName, ok: false, kind: 'agent', reason: (e as Error).message, kpiCount: 0, agentCount: 0 })
      return
    }
    sheets.push({ name: sheetName, ok: true, kind: 'agent', kpiCount: raw.kpis.length, agentCount: raw.rows.length })

    /* merge KPIs */
    for (const rk of raw.kpis) {
      const key = `${rk.group}||${rk.name}`
      let k = kpiByKey.get(key)
      if (!k) {
        k = {
          key, group: rk.group, name: rk.name,
          label: shortLabel(rk.name, rk.group),
          sheets: [], dateCols: [], monthlyCol: null, targetCol: null, byDateKey: {},
          lowerBetter: isLowerBetter(`${rk.name} ${rk.group}`),
          target: 0, targetOverride: null, enabled: true, inTrend: false,
        }
        kpiByKey.set(key, k); kpis.push(k)
      }
      if (!k.sheets.includes(sheetName)) k.sheets.push(sheetName)
      k.dateCols.push(...rk.dateCols)
      if (!k.monthlyCol) k.monthlyCol = rk.monthlyCol
      if (!k.targetCol) k.targetCol = rk.targetCol
    }

    /* merge agents */
    for (const rr of raw.rows) {
      let row = rowByKey.get(rr.key)
      if (!row) {
        row = {
          key: rr.key, name: rr.name, label: latin(rr.name) || rr.name,
          code: rr.code, area: rr.area, vals: {},
        }
        rowByKey.set(rr.key, row); rowOrder.push(row)
      }
      if (!row.area && rr.area) row.area = rr.area
      if (!row.code && rr.code) row.code = rr.code
      Object.assign(row.vals, rr.vals)
    }
    if (raw.totalRow) {
      if (!totalRow) {
        totalRow = { key: '__TOTAL__', name: 'TOTAL', label: 'TOTAL', code: '', area: '', vals: {} }
      }
      Object.assign(totalRow.vals, raw.totalRow.vals)
    }
  })

  if (!kpis.length) {
    const why = sheets.filter((s) => !s.ok).map((s) => `“${s.name}”: ${s.reason}`).join(' · ')
    throw new Error(`Tidak ada sheet yang dapat dibaca. ${why || 'Workbook ini tidak memiliki tabel Area/Agent yang dikenali.'}`)
  }

  /* sort each KPI's day columns oldest → newest (the file lists them newest first) */
  for (const k of kpis) {
    k.dateCols.sort((a, b) => (a.date && b.date ? +a.date - +b.date : 0))
  }

  /* shared date axis (day-precision keys, so tabs line up) */
  const seen = new Set<string>()
  const dates: DateSlot[] = []
  for (const k of kpis) {
    k.dateCols.forEach((d, i) => {
      const key = dayKey(d.date, i)
      if (!seen.has(key)) { seen.add(key); dates.push({ key, date: d.date, seq: i }) }
    })
  }
  dates.sort((a, b) => {
    if (a.date && b.date) return +a.date - +b.date
    if (!a.date && !b.date) return a.seq - b.seq
    return a.date ? 1 : -1        // undated slots sort before any real day
  })

  for (const k of kpis) {
    k.byDateKey = {}
    k.dateCols.forEach((d, i) => { k.byDateKey[dayKey(d.date, i)] = d.id })
  }

  /**
   * Direction, inferred from the data rather than the column name.
   *
   * A name-based guess is wrong for this report: "Retur COD Non-Ecommerce" sounds
   * like a return rate you want small, but the file scores it against a 85% target
   * that the values sit *above* — so it is really a ≥ metric. When a Target column
   * exists, whichever side the readings cluster on tells us the true direction.
   * Only fall back to the name when there is no target to compare against.
   */
  for (const k of kpis) {
    if (!k.targetCol) continue                      // keep the name-based guess
    let above = 0, below = 0
    for (const r of rowOrder) {
      const t = r.vals[k.targetCol]
      if (t == null) continue
      for (const d of k.dateCols) {
        const v = r.vals[d.id]
        if (v == null) continue
        if (v > t) above++
        else if (v < t) below++
      }
    }
    if (above !== below) k.lowerBetter = below > above
  }

  /* the sniffing above only applies to columns we don't already know */
  for (const k of kpis) {
    if (HIGHER_IS_BETTER.has(k.label)) k.lowerBetter = false
    else if (LOWER_IS_BETTER.has(k.label)) k.lowerBetter = true
  }

  /* fallback targets */
  for (const k of kpis) {
    let t: number | null = null
    if (k.targetCol) {
      for (const r of rowOrder) { if (r.vals[k.targetCol] != null) { t = r.vals[k.targetCol]; break } }
    }
    k.target = t ?? (k.lowerBetter ? 2 : 95)
  }

  /* keep only the real categories, in the agreed display order */
  const rank = (k: Kpi) => {
    const i = CANONICAL_ORDER.indexOf(k.label)
    return i < 0 ? CANONICAL_ORDER.length : i
  }
  for (const k of kpis) k.enabled = CANONICAL_ORDER.includes(k.label)
  kpis.sort((a, b) => rank(a) - rank(b))
  // nothing matched (an unfamiliar file) — fall back to showing everything
  if (!kpis.some((k) => k.enabled)) for (const k of kpis) k.enabled = true

  /* default trend series — see TREND_DEFAULT */
  for (const k of kpis) k.inTrend = k.enabled && TREND_DEFAULT.includes(k.label)
  if (!kpis.some((k) => k.inTrend)) {
    kpis.filter((k) => k.enabled && !k.lowerBetter).slice(0, 3).forEach((k) => { k.inTrend = true })
  }

  /**
   * Keep Jawa & Bali only. If the workbook ever carries other regions they are
   * dropped here — and the file's own Total row is discarded with them, since it
   * would be a national total rather than a regional one. When no row carries a
   * recognisable region (blank Area column) everything is kept as-is.
   */
  const regional = rowOrder.filter((r) => REGION_RE.test(r.area))
  const rows = regional.length ? regional : rowOrder
  if (regional.length && regional.length !== rowOrder.length) totalRow = null
  const region = rows[0]?.area || REGION_LABEL

  /**
   * Attach every drop point to an agent that survived the regional filter.
   *
   * The join is on Kode Agent (`AGENT12`), which both levels carry, with the
   * agent's own display name copied over the DP tab's — the tabs write
   * "TANGERANG唐格朗" where the summary sheet writes "TANGERANG", and the agent
   * picker has to show one name, not two.
   */
  /**
   * Fill in the business model from the reference tab, where the readings tab
   * did not carry one.
   *
   * Done before the agent join below, which overwrites `agentKey` with the
   * summary sheet's key — `agentCode` is the raw Kode Agent both tabs share, and
   * it is what the exact match is made on.
   *
   * A model already read off the row itself always wins: the older per-agent
   * tabs carry their own column, and a reference tab that has drifted out of
   * date must not overrule the sheet the numbers came from.
   */
  if (bizEntries.length) {
    const { byPair, byName } = indexBizModels(bizEntries)
    for (const d of dps) {
      if (d.bizModel) continue
      const key = normKey(d.name)
      d.bizModel = byPair.get(`${d.agentCode}::${key}`) ?? byName.get(key) ?? ''
    }
  }

  const byCode = new Map<string, AgentRow>()
  for (const r of rows) {
    if (r.code) byCode.set(normKey(r.code), r)
    byCode.set(r.key, r)
  }
  let matched = 0
  for (const d of dps) {
    const hit = byCode.get(d.agentKey)
    if (!hit) continue
    d.agentKey = hit.key
    d.agentLabel = hit.label
    matched++
  }
  /**
   * Unmatched drop points are dropped only when the join demonstrably worked —
   * they then belong to an agent outside this region. If *nothing* matched the
   * join itself is broken (a renamed code column, a workbook with no summary
   * tab), and silently discarding every drop point would take the whole section
   * off the page with no explanation. In that case keep them as they came.
   */
  const keptDps = matched > 0
    ? dps.filter((d) => byCode.has(d.agentKey) || rows.some((r) => r.key === d.agentKey))
    : dps

  const dpDates: DateSlot[] = [...dpDateMap.entries()]
    .map(([key, date], i) => ({ key, date, seq: i }))
    .sort((a, b) => (a.date && b.date ? +a.date - +b.date : a.seq - b.seq))

  return { kpis, rows, region, dates, totalRow, sheets, dps: keptDps, dpDates }
}

/* ------------------------------------------------------------- selectors */

/**
 * The drop-point day to show for a given dashboard day.
 *
 * The agent tabs carry a week; the per-agent DP tabs carry only the last two
 * days. Asking for 24/07 at DP level therefore has no answer, and returning
 * nothing would blank the whole section for five of the seven selectable days.
 * Instead we fall back to the newest DP day that is not after the one asked for,
 * and failing that to the oldest one available — the caller says so on screen.
 */
export function resolveDpDate(dpDates: DateSlot[], want: DateSlot | null): DateSlot | null {
  if (!dpDates.length) return null
  if (!want) return dpDates[dpDates.length - 1]
  const exact = dpDates.find((d) => d.key === want.key)
  if (exact) return exact
  if (!want.date) return dpDates[dpDates.length - 1]
  let best: DateSlot | null = null
  for (const d of dpDates) if (d.date && +d.date <= +want.date) best = d
  return best ?? dpDates[0]
}

export function kpiSeries(kpi: Kpi, rec: AgentRow, dates: DateSlot[]): (number | null)[] {
  return dates.map((d) => {
    const id = kpi.byDateKey[d.key]
    if (id == null) return null
    return rec.vals[id] ?? null
  })
}

/** Target for this KPI *for this agent* — manual override → target column → fallback. */
export function targetFor(kpi: Kpi, rec: AgentRow | null): number {
  if (kpi.targetOverride != null) return kpi.targetOverride
  if (kpi.targetCol && rec) {
    const v = rec.vals[kpi.targetCol]
    if (v != null) return v
  }
  return kpi.target
}

/** Binary by design: anything that misses the target is red. */
export function statusOf(kpi: Kpi, v: number | null, target: number): Status {
  if (v == null) return 'na'
  const ok = kpi.lowerBetter ? v <= target : v >= target
  return ok ? 'ok' : 'bad'
}

export interface Explanation { tone: Status; title: string; lines: string[] }

/** Plain-language reason behind a status dot, shown on hover. */
export function explain(
  kpi: Kpi, v: number | null, prev: number | null, target: number, prevLabel: string,
): Explanation {
  const dir = kpi.lowerBetter ? '≤' : '≥'
  if (v == null) {
    return {
      tone: 'na', title: 'Tidak ada data',
      lines: [`Tidak ada catatan untuk hari ini.`, `Target ${dir} ${target.toFixed(2)}%`],
    }
  }

  const ok = kpi.lowerBetter ? v <= target : v >= target
  const gap = Math.abs(v - target)
  const lines = [`${v.toFixed(2)}% terhadap target ${dir} ${target.toFixed(2)}%`]

  if (ok) {
    lines.push(kpi.lowerBetter
      ? `${gap.toFixed(2)} poin di bawah batas — aman.`
      : `${gap.toFixed(2)} poin di atas target — aman.`)
  } else {
    lines.push(kpi.lowerBetter
      ? `${gap.toFixed(2)} poin MELEBIHI batas.`
      : `Kurang ${gap.toFixed(2)} poin dari target.`)
  }

  if (prev != null) {
    const d = v - prev
    if (Math.abs(d) < 0.005) lines.push(`Tidak berubah dibanding ${prevLabel}.`)
    else {
      const better = kpi.lowerBetter ? d < 0 : d > 0
      lines.push(`${better ? 'Naik' : 'Turun'} ${d > 0 ? '+' : ''}${d.toFixed(2)} dibanding ${prevLabel}.`)
    }
  }

  if (kpi.group) lines.push(latin(kpi.group))

  return {
    tone: ok ? 'ok' : 'bad',
    title: ok ? 'Sesuai target' : kpi.lowerBetter ? 'Di atas batas' : 'Di bawah target',
    lines,
  }
}

/** Average an arbitrary set of agent rows into one synthetic row. */
export function averageRows(list: AgentRow[], label: string, area: string): AgentRow {
  const sum: Record<string, number> = {}
  const cnt: Record<string, number> = {}
  for (const r of list) {
    for (const id of Object.keys(r.vals)) {
      sum[id] = (sum[id] ?? 0) + r.vals[id]
      cnt[id] = (cnt[id] ?? 0) + 1
    }
  }
  const vals: Record<string, number> = {}
  for (const id of Object.keys(sum)) if (cnt[id]) vals[id] = sum[id] / cnt[id]
  return { key: '__AVG__', name: label, label, code: '', area, vals }
}

/**
 * Read an ArrayBuffer into a workbook.
 *
 * `cellDates: false` is deliberate — we convert Excel serials ourselves in
 * `serialToDate`, which is exact, instead of relying on SheetJS's
 * timezone-sensitive conversion. `cellNF: true` keeps the number-format string
 * on `.z`, which is what tells us "this is a date" and "this is a percentage".
 */
export function readWorkbook(buf: ArrayBuffer): XLSX.WorkBook {
  return XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: false, cellNF: true })
}

/* ------------------------------------------------------------- PNG export */

/** Two frames, so the browser has actually applied `body.shooting` and reflowed
 *  to the pinned capture width before anything is measured. Measuring in the
 *  same tick returns the pre-reflow height, which is what truncated the image. */
const settled = () =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

/**
 * Renders `el` to a PNG download. html2canvas is fetched on first use only, so
 * the page still loads and parses Excel with no internet — the Excel path never
 * depends on this.
 *
 * Capturing the *whole* dashboard, not just the visible part, needs four things
 * that html2canvas will not infer on its own:
 *
 *   1. `body.shooting` pins .wrap to a fixed width, so the capture does not
 *      depend on the current window size (see dashboard.css).
 *   2. The page is scrolled to the top and `scrollX/scrollY` are zeroed —
 *      otherwise html2canvas offsets the clone by the scroll position and the
 *      top of the dashboard is cut off.
 *   3. `width`/`height` are taken from `scrollWidth`/`scrollHeight` (the full
 *      laid-out size), not from the viewport, so panels below the fold render.
 *   4. `windowWidth`/`windowHeight` match, so media queries inside the clone
 *      evaluate against the full canvas rather than the real window.
 */
export async function exportPng(
  el: HTMLElement,
  filename: string,
  /**
   * Extra body class applied for the duration of the shot, so a caller can
   * decide what belongs in *its* picture — `shoot-main` drops the DP/CP section
   * from the dashboard shot, `shoot-table` keeps nothing but the DP/CP table.
   * It goes on before the two settling frames, so the reflow it causes is
   * included in the measurement rather than fighting it.
   */
  bodyClass = '',
): Promise<void> {
  const w = window as unknown as { html2canvas?: (e: HTMLElement, o: object) => Promise<HTMLCanvasElement> }

  if (!w.html2canvas) {
    await new Promise<void>((resolve, reject) => {
      const tag = document.createElement('script')
      tag.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
      tag.onload = () => resolve()
      tag.onerror = () => reject(new Error(
        'Pustaka gambar gagal dimuat — sepertinya Anda sedang offline. Gunakan Cetak / PDF sebagai gantinya.'))
      document.head.appendChild(tag)
    })
  }

  const prevX = window.scrollX
  const prevY = window.scrollY

  document.body.classList.add('shooting')
  if (bodyClass) document.body.classList.add(bodyClass)
  window.scrollTo(0, 0)
  await settled()

  try {
    const width = Math.ceil(el.scrollWidth)
    const height = Math.ceil(el.scrollHeight)

    // Cap the pixel budget: at scale 2 a tall dashboard can exceed the browser's
    // maximum canvas area and silently come back blank.
    const scale = Math.max(1, Math.min(2, 30_000_000 / (width * height)))

    const canvas = await w.html2canvas!(el, {
      backgroundColor: '#F4F6FA',
      scale,
      useCORS: true,
      logging: false,
      scrollX: 0,
      scrollY: 0,
      width,
      height,
      windowWidth: width,
      windowHeight: height,
    })

    if (!canvas.width || !canvas.height) {
      throw new Error('Hasil tangkapan layar kosong. Gunakan Cetak / PDF sebagai gantinya.')
    }

    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
    if (!blob) throw new Error('Browser tidak dapat mengodekan gambar ini.')
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  } finally {
    document.body.classList.remove('shooting')
    if (bodyClass) document.body.classList.remove(bodyClass)
    window.scrollTo(prevX, prevY)
  }
}