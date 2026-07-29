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
  /** set from the mapping panel; wins over everything */
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
}

export interface Model {
  kpis: Kpi[]
  rows: AgentRow[]
  /** the single region this dashboard covers, e.g. "Jawa & Bali" */
  region: string
  dates: DateSlot[]
  totalRow: AgentRow | null
  sheets: SheetInfo[]
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
export function cellDate(cell: Cell): Date | null {
  if (!cell || cell.v == null) return null
  if (cell.v instanceof Date) return snapDay(cell.v)
  const v = cell.v
  if (typeof v === 'number') {
    const z = String(cell.z || '').toLowerCase()
    if (v > 20000 && v < 80000 && (z.includes('y') || z.includes('d') || z.includes('m'))) {
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
  [/operasional|operational|全天签收|full\s*day|seharian/i, 'TTD FULL DAY'],
  [/ritase\s*pertama|一派|ritase\s*1/i, 'TTD PAKET JAM 12:00'],
  [/签收|\bttd\b/i, 'TTD'],
]

/**
 * The categories that actually exist in the report, in display order.
 * Anything a file contains that isn't on this list is still parsed, but starts
 * switched off — turn it on from the Column mapping panel if you need it.
 */
export const CANONICAL_ORDER = [
  '06:30 ABSENSI',
  '07:30 KELUAR GUDANG',
  'TTD PAKET JAM 12:00',
  'TTD RITASE 2',
  'TPTW (ON TIME)',
  'TTD FULL DAY',
  'PICKUP NON-ECOMMERCE',
  'RETUR COD NON-ECOMMERCE',
]

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

function sheetMatrix(ws: XLSX.WorkSheet): Matrix {
  if (!ws || !ws['!ref']) return { m: [], lastC: 0, hadMerges: false }
  const r = XLSX.utils.decode_range(ws['!ref'])
  const lastR = r.e.r, lastC = r.e.c
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
    const src = m[g.s.r]?.[g.s.c]
    if (!src) continue
    for (let R = g.s.r; R <= g.e.r; R++) {
      if (!m[R]) continue
      for (let C = g.s.c; C <= Math.min(g.e.c, lastC); C++) {
        if (m[R][C] == null) m[R][C] = src
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
  const { m, lastC, hadMerges } = sheetMatrix(ws)
  if (!m.length) throw new Error('the sheet is empty')

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
  if (agentCol < 0) throw new Error('no "Agent" header cell found in the first 40 rows')

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
  if (dataStart < 0) throw new Error('the Agent column has no numeric data rows underneath it')

  const nHdr = dataStart - headerRow

  /* 2b — if merge metadata was lost on export, forward-fill the group rows */
  if (!hadMerges && nHdr > 1) {
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
    const upper = labels.slice(0, nHdr - 1)
 
    let group = upper[0] || ''
    let name = upper.length ? (upper[upper.length - 1] || group) : ''
    let kind: SubKind = 'value'
    let date: Date | null = null
 
    if (upper.length) {
      const d = cellDate(subCell)
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
  if (!kpis.length) throw new Error('no KPI columns found to the right of the identity columns')

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
  if (!rows.length) throw new Error('no agent rows found')

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

/* --------------------------------------------------------- workbook parse */

/** Parse every readable sheet and merge them into a single model. */
export function parseWorkbook(wb: XLSX.WorkBook): Model {
  const sheets: SheetInfo[] = []
  const kpis: Kpi[] = []
  const kpiByKey = new Map<string, Kpi>()
  const rowByKey = new Map<string, AgentRow>()
  const rowOrder: AgentRow[] = []
  let totalRow: AgentRow | null = null

  wb.SheetNames.forEach((sheetName, sheetIdx) => {
    let raw: RawSheet
    try {
      raw = parseOneSheet(wb.Sheets[sheetName], sheetIdx)
    } catch (e) {
      sheets.push({ name: sheetName, ok: false, reason: (e as Error).message, kpiCount: 0, agentCount: 0 })
      return
    }
    sheets.push({ name: sheetName, ok: true, kpiCount: raw.kpis.length, agentCount: raw.rows.length })

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
    throw new Error(`No readable sheet found. ${why || 'The workbook has no recognisable Area/Agent table.'}`)
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
  dates.sort((a, b) => (a.date && b.date ? +a.date - +b.date : a.seq - b.seq))

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

  /* default trend series: first three enabled higher-is-better KPIs */
  let picked = 0
  for (const k of kpis) if (k.enabled && !k.lowerBetter && picked < 3) { k.inTrend = true; picked++ }
  if (!picked) kpis.filter((k) => k.enabled).slice(0, 3).forEach((k) => { k.inTrend = true })

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

  return { kpis, rows, region, dates, totalRow, sheets }
}

/* ------------------------------------------------------------- selectors */

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
      tone: 'na', title: 'No data',
      lines: [`Nothing recorded for this day.`, `Target ${dir} ${target.toFixed(2)}%`],
    }
  }

  const ok = kpi.lowerBetter ? v <= target : v >= target
  const gap = Math.abs(v - target)
  const lines = [`${v.toFixed(2)}% against target ${dir} ${target.toFixed(2)}%`]

  if (ok) {
    lines.push(kpi.lowerBetter
      ? `${gap.toFixed(2)} points under the limit — safe.`
      : `${gap.toFixed(2)} points above target — safe.`)
  } else {
    lines.push(kpi.lowerBetter
      ? `${gap.toFixed(2)} points OVER the limit.`
      : `Short by ${gap.toFixed(2)} points.`)
  }

  if (prev != null) {
    const d = v - prev
    if (Math.abs(d) < 0.005) lines.push(`Unchanged vs ${prevLabel}.`)
    else {
      const better = kpi.lowerBetter ? d < 0 : d > 0
      lines.push(`${better ? 'Improved' : 'Declined'} ${d > 0 ? '+' : ''}${d.toFixed(2)} vs ${prevLabel}.`)
    }
  }

  if (kpi.group) lines.push(latin(kpi.group))

  return {
    tone: ok ? 'ok' : 'bad',
    title: ok ? 'On target' : kpi.lowerBetter ? 'Above limit' : 'Below target',
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
