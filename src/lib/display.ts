/**
 * The "Display" tabs — per-DP detail reports for single categories.
 *
 *   Display Absensi 630         Persentase Absensi Tepat Waktu Sprinter
 *   Display 730 & 1200          Persentase 0730 & TTD 1200
 *   Display Ritase Keseluruhan  Persentase Keseluruhan TTD Berdasarkan Ritase
 *   Display Retur               Monitoring Retur Agent (lower is better)
 *
 * They share one layout, which is what lets one parser and one page serve all
 * of them: a title in A1, a two-row header (row 2 names the column, row 3 dates
 * the ones that were merged across several days), a TOTAL row, a blank row, and
 * then one row per drop point — Agent, RM, Nama DP, figures.
 *
 * Columns are found by their header text rather than by letter. The three tabs
 * put the same kinds of figure in different places, and a template that gains a
 * column should move a figure, not silently swap it for its neighbour. A column
 * that cannot be found is dropped; a report whose headline figure cannot be
 * found is not offered at all, rather than drawn with holes.
 */
import * as XLSX from 'xlsx'
import { latin } from './jnt'

export type DisplayId = 'absensi' | 'ttd730' | 'ritase' | 'retur'
export type DisplayColKind = 'int' | 'pct' | 'delta'

/** A header the sheet merges across several columns — a band over them. */
export interface DisplayGroup { id: string; label: string; zh: string }

/** A column the sheet shows, as the sheet heads it. */
export interface DisplayCol {
  id: string
  label: string
  zh?: string
  /** the band it sits under; '' for a column with a header of its own */
  group: string
  kind: DisplayColKind
  /** a percentage judged against the row's target — shaded green/red */
  scored?: boolean
}

/** Two column ids whose sum-ratio is a percentage: numerator, denominator. */
export type Ratio = [string, string]

/**
 * One headline figure. The 0730 & 1200 tab carries two; the others carry one.
 *
 * Every period is a ratio of two counts, so the figure can be recomputed for any
 * subset of rows — one agent, or whatever the filters leave — and stay exactly
 * the number the workbook would print for that subset.
 */
export interface DisplayKpi {
  id: string
  label: string
  zh: string
  /** column ids of the per-row percentages, for the table and the rankings */
  day: string
  prev?: string
  prev2?: string
  delta?: string
  month?: string
  week?: string
  weekPrev?: string
  weekDelta?: string
  /** the counts behind them */
  dayRatio: Ratio
  prevRatio?: Ratio
  monthRatio?: Ratio
  weekRatio?: Ratio
  weekPrevRatio?: Ratio
}

export interface DisplayRow {
  key: string
  /** Latin part of the Agent column — `JAKARTA雅加达` → `JAKARTA` */
  agent: string
  rm: string
  dp: string
  /** percent, e.g. 90 */
  target: number | null
  /** by column id; pct and delta columns in percent (0.9262 → 92.62) */
  vals: Record<string, number | null>
}

export interface DisplayReport {
  id: DisplayId
  sheet: string
  /** short name for the rail and the band */
  label: string
  zh: string
  /** the report's own title, as written in A1 minus the date */
  title: string
  date: Date | null
  /** the target the TOTAL row states, in percent */
  target: number | null
  /** the headline is a rate to keep *under* the target (Retur), not over it */
  lowerBetter: boolean
  /** the table: the sheet's visible columns, in order, and the bands over them */
  groups: DisplayGroup[]
  cols: DisplayCol[]
  kpis: DisplayKpi[]
  rows: DisplayRow[]
}

/* ------------------------------------------------------------ recognition */

/**
 * Which report a tab is, by name.
 *
 * By name only, the same test as `isDisplaySheet` in `lib/jnt.ts`, which keeps
 * these tabs out of the DP parser — change one and change the other.
 */
export function displayIdOf(sheetName: string): DisplayId | null {
  const n = sheetName.toLowerCase()
  if (!/^\s*display\b/.test(n)) return null
  if (/absen/.test(n)) return 'absensi'
  if (/730|1200/.test(n)) return 'ttd730'
  if (/ritase/.test(n)) return 'ritase'
  if (/retur/.test(n)) return 'retur'
  return null
}

/* ------------------------------------------------------------ the specs */

/**
 * How to find a column.
 *
 * `one` — a single-column header, the `nth` time that exact text appears.
 * `grp` — a header merged across several columns (one per day or week), and
 *         `at` picks the column inside it: 0 is the newest.
 *
 * Header text is compared after stripping the Mandarin line and any dates, so
 * "总人数\nTotal Orang\n22/09/2026" is `total orang`, occurrence 1.
 */
type Find = { one: string; nth?: number } | { grp: string; nth?: number; at: number }

/**
 * A figure the headline arithmetic needs, by id — found whether or not the
 * sheet shows it. What the *table* shows is read from the sheet itself.
 */
interface ColSpec { id: string; kind: DisplayColKind; find: Find }

/** A count the sheet does not carry, made from two it does: `from[0] - from[1]`. */
interface DeriveSpec { id: string; from: [string, string] }

interface Spec {
  label: string
  zh: string
  cols: ColSpec[]
  derive?: DeriveSpec[]
  kpis: DisplayKpi[]
  lowerBetter?: boolean
}

const SPECS: Record<DisplayId, Spec> = {
  absensi: {
    label: 'Absensi Tepat Waktu',
    zh: '打卡准点率',
    cols: [
      { id: 'd_total', kind: 'int', find: { one: 'total orang' } },
      { id: 'd_absen', kind: 'int', find: { one: 'jumlah yang absensi' } },
      { id: 'd_ontime', kind: 'int', find: { one: 'jumlah absensi tepat waktu' } },
      { id: 'd_pabs', kind: 'pct', find: { grp: 'persentase absensi', at: 0 } },
      { id: 'd_pct', kind: 'pct', find: { grp: 'persentase absensi tepat waktu', at: 0 } },
      { id: 'd_delta', kind: 'delta', find: { one: 'perbandingan h-1' } },
      { id: 't_1', kind: 'pct', find: { grp: 'persentase absensi tepat waktu', at: 1 } },
      { id: 't_2', kind: 'pct', find: { grp: 'persentase absensi tepat waktu', at: 2 } },
      { id: 'm_total', kind: 'int', find: { one: 'total orang bulanan' } },
      { id: 'm_ontime', kind: 'int', find: { one: 'jumlah absensi tepat waktu bulanan' } },
      { id: 'm_pct', kind: 'pct', find: { one: 'persentase bulanan' } },
      { id: 'w_pct', kind: 'pct', find: { grp: 'persentase mingguan absensi tepat waktu', at: 0 } },
      { id: 'w_prev', kind: 'pct', find: { grp: 'persentase mingguan absensi tepat waktu', at: 1 } },
      { id: 'w_delta', kind: 'delta', find: { one: 'perbandingan mingguan' } },
      /* counts behind H-1 and the two weeks, for recomputing a subset */
      { id: 'p_total', kind: 'int', find: { one: 'total orang', nth: 1 } },
      { id: 'p_ontime', kind: 'int', find: { one: 'jumlah absensi tepat waktu', nth: 1 } },
      { id: 'w_total', kind: 'int', find: { one: 'total orang mingguan', nth: 0 } },
      { id: 'w_ontime', kind: 'int', find: { one: 'jumlah absensi tepat waktu', nth: 3 } },
      { id: 'wp_total', kind: 'int', find: { one: 'total orang mingguan', nth: 1 } },
      { id: 'wp_ontime', kind: 'int', find: { one: 'jumlah absensi tepat waktu', nth: 4 } },
    ],
    kpis: [{
      id: 'ontime', label: 'Absensi Tepat Waktu', zh: '打卡准点率',
      day: 'd_pct', prev: 't_1', prev2: 't_2', delta: 'd_delta', month: 'm_pct',
      week: 'w_pct', weekPrev: 'w_prev', weekDelta: 'w_delta',
      dayRatio: ['d_ontime', 'd_total'], prevRatio: ['p_ontime', 'p_total'],
      monthRatio: ['m_ontime', 'm_total'], weekRatio: ['w_ontime', 'w_total'],
      weekPrevRatio: ['wp_ontime', 'wp_total'],
    }],
  },

  ttd730: {
    label: '0730 & TTD 1200',
    zh: '出仓率 & 签收率',
    cols: [
      { id: 'd_rit1', kind: 'int', find: { one: 'seharusnya ttd rit-1' } },
      /* Headed "Persentase Keluar Gudang 0730" in the file, but it is the count —
         the percentage is the merged group of the same name further right. */
      { id: 'd_0730n', kind: 'int', find: { one: 'persentase keluar gudang 0730' } },
      { id: 'd_1200n', kind: 'int', find: { one: 'ttd sebelum 1200' } },
      { id: 'd_0730', kind: 'pct', find: { grp: 'persentase keluar gudang 0730', at: 0 } },
      { id: 'd_0730d', kind: 'delta', find: { one: 'perbandingan h-1', nth: 0 } },
      { id: 'd_1200', kind: 'pct', find: { grp: 'ttd sebelum 1200', at: 0 } },
      { id: 'd_1200d', kind: 'delta', find: { one: 'perbandingan h-1', nth: 1 } },
      { id: 't0730_1', kind: 'pct', find: { grp: 'persentase keluar gudang 0730', at: 1 } },
      { id: 't0730_2', kind: 'pct', find: { grp: 'persentase keluar gudang 0730', at: 2 } },
      { id: 't1200_1', kind: 'pct', find: { grp: 'ttd sebelum 1200', at: 1 } },
      { id: 't1200_2', kind: 'pct', find: { grp: 'ttd sebelum 1200', at: 2 } },
      { id: 'm_rit1', kind: 'int', find: { one: 'seharusnya ttd rit-1 bulanan' } },
      { id: 'm_0730n', kind: 'int', find: { one: 'persentase keluar gudang 0730 bulanan' } },
      { id: 'm_0730', kind: 'pct', find: { one: 'persentase bulanan', nth: 0 } },
      { id: 'm_1200n', kind: 'int', find: { one: 'ttd sebelum 1200 bulanan' } },
      { id: 'm_1200', kind: 'pct', find: { one: 'persentase bulanan', nth: 1 } },
      { id: 'w_1200', kind: 'pct', find: { grp: 'persentase mingguan ttd 1200', at: 0 } },
      { id: 'w_1200p', kind: 'pct', find: { grp: 'persentase mingguan ttd 1200', at: 1 } },
      { id: 'w_delta', kind: 'delta', find: { one: 'perbandingan mingguan' } },
      { id: 'p_rit1', kind: 'int', find: { one: 'seharusnya ttd rit-1', nth: 1 } },
      { id: 'p_0730n', kind: 'int', find: { one: 'persentase keluar gudang 0730', nth: 1 } },
      { id: 'p_1200n', kind: 'int', find: { one: 'ttd sebelum 1200', nth: 1 } },
      { id: 'w_rit1', kind: 'int', find: { one: 'seharusnya ttd rit-1 mingguan', nth: 0 } },
      { id: 'w_1200n', kind: 'int', find: { one: 'ttd sebelum 1200 mingguan', nth: 0 } },
      { id: 'wp_rit1', kind: 'int', find: { one: 'seharusnya ttd rit-1 mingguan', nth: 1 } },
      { id: 'wp_1200n', kind: 'int', find: { one: 'ttd sebelum 1200 mingguan', nth: 1 } },
    ],
    kpis: [
      {
        id: '0730', label: 'Keluar Gudang 07:30', zh: '0730出仓率',
        day: 'd_0730', prev: 't0730_1', prev2: 't0730_2', delta: 'd_0730d', month: 'm_0730',
        dayRatio: ['d_0730n', 'd_rit1'], prevRatio: ['p_0730n', 'p_rit1'],
        monthRatio: ['m_0730n', 'm_rit1'],
      },
      {
        id: '1200', label: 'TTD Sebelum 12:00', zh: '1200签收率',
        day: 'd_1200', prev: 't1200_1', prev2: 't1200_2', delta: 'd_1200d', month: 'm_1200',
        week: 'w_1200', weekPrev: 'w_1200p', weekDelta: 'w_delta',
        dayRatio: ['d_1200n', 'd_rit1'], prevRatio: ['p_1200n', 'p_rit1'],
        monthRatio: ['m_1200n', 'm_rit1'], weekRatio: ['w_1200n', 'w_rit1'],
        weekPrevRatio: ['wp_1200n', 'wp_rit1'],
      },
    ],
  },

  ritase: {
    label: 'TTD All Ritase',
    zh: '全天签收率',
    cols: [
      { id: 'd_due', kind: 'int', find: { one: 'seharusnya ttd h-1' } },
      { id: 'd_done', kind: 'int', find: { one: 'ttd sebelum 2359' } },
      { id: 'd_open', kind: 'int', find: { one: 'belum ttd' } },
      { id: 'd_pct', kind: 'pct', find: { grp: 'persentase ttd all ritase', at: 0 } },
      { id: 'd_delta', kind: 'delta', find: { one: 'perbandingan h-1' } },
      { id: 't_1', kind: 'pct', find: { grp: 'persentase ttd all ritase', at: 1 } },
      { id: 't_2', kind: 'pct', find: { grp: 'persentase ttd all ritase', at: 2 } },
      { id: 'm_due', kind: 'int', find: { one: 'seharusnya ttd bulanan' } },
      { id: 'm_done', kind: 'int', find: { one: 'ttd bulanan' } },
      { id: 'm_open', kind: 'int', find: { one: 'belum ttd bulanan' } },
      { id: 'm_pct', kind: 'pct', find: { one: 'persentase bulanan' } },
      { id: 'w_pct', kind: 'pct', find: { grp: 'persentase mingguan ttd all ritase', at: 0 } },
      { id: 'w_prev', kind: 'pct', find: { grp: 'persentase mingguan ttd all ritase', at: 1 } },
      { id: 'w_delta', kind: 'delta', find: { one: 'perbandingan mingguan' } },
      { id: 'p_due', kind: 'int', find: { one: 'seharusnya ttd', nth: 0 } },
      { id: 'p_done', kind: 'int', find: { one: 'ttd sebelum 2359', nth: 1 } },
      { id: 'w_due', kind: 'int', find: { one: 'seharusnya ttd mingguan', nth: 0 } },
      { id: 'w_done', kind: 'int', find: { one: 'ttd mingguan', nth: 0 } },
      { id: 'wp_due', kind: 'int', find: { one: 'seharusnya ttd mingguan', nth: 1 } },
      { id: 'wp_done', kind: 'int', find: { one: 'ttd mingguan', nth: 1 } },
    ],
    kpis: [{
      id: 'ttd', label: 'TTD All Ritase', zh: '全天签收率',
      day: 'd_pct', prev: 't_1', prev2: 't_2', delta: 'd_delta', month: 'm_pct',
      week: 'w_pct', weekPrev: 'w_prev', weekDelta: 'w_delta',
      dayRatio: ['d_done', 'd_due'], prevRatio: ['p_done', 'p_due'],
      monthRatio: ['m_done', 'm_due'], weekRatio: ['w_done', 'w_due'],
      weekPrevRatio: ['wp_done', 'wp_due'],
    }],
  },

  /* Retur = regist − void, and %Retur = Retur ÷ Total Delivery, for every
     period — the sheet's own "Logic" note. The target is a ceiling. */
  retur: {
    label: 'Retur',
    zh: '退件率',
    lowerBetter: true,
    cols: [
      { id: 'd_deliv', kind: 'int', find: { one: 'total delivery' } },
      { id: 'd_reg', kind: 'int', find: { one: 'jumlah regist retur' } },
      { id: 'd_void', kind: 'int', find: { one: 'jumlah void retur' } },
      { id: 'd_pct', kind: 'pct', find: { grp: '%retur', at: 0 } },
      { id: 't_1', kind: 'pct', find: { grp: '%retur', at: 1 } },
      { id: 't_2', kind: 'pct', find: { grp: '%retur', at: 2 } },
      { id: 'd_delta', kind: 'delta', find: { one: 'perbandingan h-1' } },
      { id: 'p_deliv', kind: 'int', find: { one: 'total delivery', nth: 1 } },
      { id: 'p_reg', kind: 'int', find: { one: 'jumlah regist retur', nth: 1 } },
      { id: 'p_void', kind: 'int', find: { one: 'jumlah void retur', nth: 1 } },
      { id: 'm_deliv', kind: 'int', find: { one: 'total delivery bulanan' } },
      { id: 'm_reg', kind: 'int', find: { one: 'jumlah regist retur bulanan' } },
      { id: 'm_void', kind: 'int', find: { one: 'jumlah void retur bulanan' } },
      { id: 'm_pct', kind: 'pct', find: { one: '%retur bulanan' } },
      { id: 'w_pct', kind: 'pct', find: { grp: 'persentase mingguan', at: 0 } },
      { id: 'w_prev', kind: 'pct', find: { grp: 'persentase mingguan', at: 1 } },
      { id: 'w_delta', kind: 'delta', find: { one: 'perbandingan mingguan' } },
      { id: 'w_deliv', kind: 'int', find: { one: 'total delivery mingguan', nth: 0 } },
      { id: 'w_reg', kind: 'int', find: { one: 'jumlah regist retur mingguan', nth: 0 } },
      { id: 'w_void', kind: 'int', find: { one: 'jumlah void retur mingguan', nth: 0 } },
      { id: 'wp_deliv', kind: 'int', find: { one: 'total delivery mingguan', nth: 1 } },
      { id: 'wp_reg', kind: 'int', find: { one: 'jumlah regist retur mingguan', nth: 1 } },
      { id: 'wp_void', kind: 'int', find: { one: 'jumlah void retur mingguan', nth: 1 } },
    ],
    derive: [
      { id: 'd_ret', from: ['d_reg', 'd_void'] },
      { id: 'p_ret', from: ['p_reg', 'p_void'] },
      { id: 'm_ret', from: ['m_reg', 'm_void'] },
      { id: 'w_ret', from: ['w_reg', 'w_void'] },
      { id: 'wp_ret', from: ['wp_reg', 'wp_void'] },
    ],
    kpis: [{
      id: 'retur', label: '%Retur', zh: '退件率',
      day: 'd_pct', prev: 't_1', prev2: 't_2', delta: 'd_delta', month: 'm_pct',
      week: 'w_pct', weekPrev: 'w_prev', weekDelta: 'w_delta',
      dayRatio: ['d_ret', 'd_deliv'], prevRatio: ['p_ret', 'p_deliv'],
      monthRatio: ['m_ret', 'm_deliv'], weekRatio: ['w_ret', 'w_deliv'],
      weekPrevRatio: ['wp_ret', 'wp_deliv'],
    }],
  },
}

/** Rail order, and the order the pages are numbered in. */
export const DISPLAY_ORDER: DisplayId[] = ['absensi', 'ttd730', 'ritase', 'retur']

/* ------------------------------------------------------------ helpers */

/** A line written in Mandarin (CJK punctuation through the unified ideographs). */
const HAS_CJK = new RegExp('[\\u3000-\\u9fff]')

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTHS_ID: Record<string, number> = { mei: 4, agu: 7, agt: 7, okt: 9, des: 11 }
const SHORT_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

/** `23 Sep` */
const shortDay = (d: Date) => `${d.getDate()} ${SHORT_ID[d.getMonth()]}`

/** A written-out date in a header — "24 Sep 2026", "18 Sep" — as the Retur tab dates its columns. */
const WORD_DATE = /\b\d{1,2}\s+(?:jan|feb|mar|apr|mei|may|jun|jul|agu|agt|aug|sep|okt|oct|nov|des|dec)[a-z]*\.?(?:\s+\d{4})?\b/gi

/**
 * Header text as the specs name it: no Mandarin, no dates, one line, lower case.
 *
 * Whole Mandarin *lines* are dropped rather than the characters in them — the
 * Mandarin line often opens with Latin ("T-1应签收", "0730出仓率"), and keeping
 * that prefix would make the same figure read differently from tab to tab.
 */
function norm(s: unknown): string {
  return String(s ?? '')
    .split(/\r?\n/)
    .filter((l) => !HAS_CJK.test(l))
    .join(' ')
    .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, ' ')
    .replace(WORD_DATE, ' ')
    .replace(/\s+-\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** The date at the end of the A1 title — "… Jawa-Bali 23 Sep 2026". */
function titleDate(title: string): Date | null {
  const m = title.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/)
  if (!m) return null
  const k = m[2].toLowerCase()
  const mi = MONTHS.indexOf(k) >= 0 ? MONTHS.indexOf(k) : MONTHS_ID[k]
  if (mi == null) return null
  return new Date(Number(m[3]), mi, Number(m[1]))
}

/** A cell as a number: raw numbers as they are, text with thousands separators
 *  and a trailing % or arrow read the way the sheet prints it. */
function num(cell: XLSX.CellObject | undefined, kind: DisplayColKind): number | null {
  if (!cell || cell.v == null || cell.v === '') return null
  if (typeof cell.v === 'number') return kind === 'int' ? cell.v : cell.v * 100
  const s = String(cell.v).trim()
  const neg = /▼/.test(s) && !/-/.test(s)
  const n = Number(s.replace(/[^\d.-]/g, ''))
  if (!Number.isFinite(n) || !/\d/.test(s)) return null
  const v = /%/.test(s) || kind === 'int' ? n : n * 100
  return neg ? -v : v
}

/* ------------------------------------------------------------ the parse */

interface Head { name: string; c: number; span: number }

export function parseDisplaySheet(id: DisplayId, sheet: string, ws: XLSX.WorkSheet | undefined): DisplayReport | null {
  if (!ws || !ws['!ref']) return null
  const spec = SPECS[id]
  const range = XLSX.utils.decode_range(ws['!ref'])
  const at = (r: number, c: number) => ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined
  const text = (r: number, c: number) => String(at(r, c)?.v ?? '')

  /* The header row is the one naming "Nama DP" — row 2 in every copy seen so
     far, found rather than assumed so an extra title line does not break it. */
  let hr = -1
  for (let r = range.s.r; r <= Math.min(range.e.r, 10) && hr < 0; r++) {
    for (let c = range.s.c; c <= Math.min(range.e.c, 6); c++) {
      if (/nama\s*dp/i.test(text(r, c))) { hr = r; break }
    }
  }
  if (hr < 0) return null

  const merges = ws['!merges'] ?? []
  const heads: Head[] = []
  for (let c = range.s.c; c <= range.e.c; c++) {
    const raw = text(hr, c)
    if (!raw.trim()) continue
    const m = merges.find((x) => x.s.r === hr && x.e.r === hr && x.s.c === c)
    const span = m ? m.e.c - m.s.c + 1 : 1
    heads.push({ name: norm(raw), c, span })
  }

  const locate = (f: Find): number | null => {
    if ('one' in f) {
      const hits = heads.filter((h) => h.span === 1 && h.name === f.one)
      return hits[f.nth ?? 0]?.c ?? null
    }
    const hits = heads.filter((h) => h.span > 1 && h.name === f.grp)
    const h = hits[f.nth ?? 0]
    return h && f.at < h.span ? h.c + f.at : null
  }

  const title = String(at(range.s.r, range.s.c)?.v ?? '')
  const latinTitle = title.split(/\n/).map((l) => l.trim()).find((l) => /[a-z]{4}/i.test(l) && !HAS_CJK.test(l)) ?? ''
  const date = titleDate(latinTitle)
  const day = (back: number) => {
    if (!date) return back ? `H-${back}` : 'Hari ini'
    const d = new Date(date)
    d.setDate(d.getDate() - back)
    return shortDay(d)
  }

  /* The spec's columns are the arithmetic's inputs — found whether or not the
     sheet shows them, since most of the counts are in hidden columns. */
  const colAt = new Map<string, number>()
  const specKind = new Map<string, DisplayColKind>()
  for (const s of spec.cols) {
    const c = locate(s.find)
    if (c == null) continue
    colAt.set(s.id, c)
    specKind.set(s.id, s.kind)
  }
  const derived = (spec.derive ?? []).filter((d) => colAt.has(d.from[0]) && colAt.has(d.from[1]))
  const derivedIds = new Set(derived.map((d) => d.id))

  /* A figure is kept only if everything it is made of was found. */
  const found = (id: string) => colAt.has(id) || derivedIds.has(id)
  const has = (id?: string) => !id || found(id)
  const hasR = (r?: Ratio) => !r || (found(r[0]) && found(r[1]))
  const kpis: DisplayKpi[] = []
  for (const k of spec.kpis) {
    if (!has(k.day) || !hasR(k.dayRatio)) continue
    kpis.push({
      ...k,
      prev: has(k.prev) ? k.prev : undefined,
      prev2: has(k.prev2) ? k.prev2 : undefined,
      delta: has(k.delta) ? k.delta : undefined,
      month: has(k.month) ? k.month : undefined,
      week: has(k.week) ? k.week : undefined,
      weekPrev: has(k.weekPrev) ? k.weekPrev : undefined,
      weekDelta: has(k.weekDelta) ? k.weekDelta : undefined,
      prevRatio: hasR(k.prevRatio) ? k.prevRatio : undefined,
      monthRatio: hasR(k.monthRatio) ? k.monthRatio : undefined,
      weekRatio: hasR(k.weekRatio) ? k.weekRatio : undefined,
      weekPrevRatio: hasR(k.weekPrevRatio) ? k.weekPrevRatio : undefined,
    })
  }
  if (!kpis.length) return null

  /* The identity columns, by header — Agent, RM, Nama DP. */
  const idCol = (re: RegExp) => heads.find((h) => re.test(h.name))?.c ?? null
  const cAgent = idCol(/^agent$/)
  const cRm = idCol(/^rm$/)
  const cDp = idCol(/nama dp/)
  const cTarget = idCol(/^target$/)
  if (cDp == null) return null

  /*
   * The table: exactly the columns the sheet shows, in the sheet's order, under
   * the sheet's own headers.
   *
   * Hidden columns (`!cols[i].hidden`, which SheetJS only fills when the sheet
   * is read with `cellStyles`) are the working the report's author chose not to
   * show — yesterday's raw counts, the target, the weekly counts — and are left
   * out. A header merged across several columns becomes a band over them, with
   * each column named by the line beneath it (the date), as in the sheet.
   */
  const hidden = new Set<number>()
  ;(ws['!cols'] ?? []).forEach((ci, i) => { if (ci?.hidden) hidden.add(i) })
  const idAt = new Map<number, string>()
  for (const [sid, c] of colAt) if (!idAt.has(c)) idAt.set(c, sid)
  const lines = (raw: string) => raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const latinOf = (raw: string) => lines(raw).filter((l) => !HAS_CJK.test(l)).join(' ')
  const zhOf = (raw: string) => lines(raw).filter((l) => HAS_CJK.test(l)).join(' ')
  const skip = new Set([cAgent, cRm, cDp, cTarget].filter((c): c is number => c != null))

  /* How a column prints, from its number format in the first rows that have one. */
  const kindAt = (c: number, name: string): DisplayColKind => {
    for (let r = hr + 2; r <= Math.min(range.e.r, hr + 40); r++) {
      const z = String(at(r, c)?.z ?? '')
      if (!z || z === 'General') continue
      if (/▲|▼/.test(z)) return 'delta'
      return z.includes('%') ? 'pct' : 'int'
    }
    return /perbandingan/.test(name) ? 'delta' : 'int'
  }

  const cols: DisplayCol[] = []
  const groups: DisplayGroup[] = []
  for (const h of heads) {
    const raw = text(hr, h.c)
    const group = h.span > 1 ? `g${h.c}` : ''
    /* `w`, the text as Excel prints it: some of these are real dates, and their
       value is a serial number (46288) rather than "23/Sep". */
    const subs = Array.from({ length: h.span }, (_, i) => {
      const cell = at(hr + 1, h.c + i)
      return String(cell?.w ?? cell?.v ?? '').trim()
    })
    /* One copy of the 0730 tab dates its three days 23/Sep, 22/Sep, 22/Sep. A
       repeated date is a typo in the sheet, so the days are counted back from
       the report's own date instead. */
    if (h.span > 1 && new Set(subs).size < subs.length && subs.every((s) => /\d/.test(s))) {
      subs.forEach((_, i) => { subs[i] = day(i) })
    }
    for (let i = 0; i < h.span; i++) {
      const c = h.c + i
      if (hidden.has(c) || skip.has(c)) continue
      if (group && !groups.some((g) => g.id === group)) {
        groups.push({ id: group, label: latinOf(raw), zh: zhOf(raw) })
      }
      const kind = kindAt(c, h.name)
      cols.push({
        id: idAt.get(c) ?? `x${c}`,
        label: group ? subs[i] || `Kolom ${i + 1}` : latinOf(raw),
        zh: group ? undefined : zhOf(raw) || undefined,
        group,
        kind,
        scored: kind === 'pct',
      })
    }
  }

  const readAt: [string, number, DisplayColKind][] = [
    ...[...colAt].map(([sid, c]): [string, number, DisplayColKind] => [sid, c, specKind.get(sid) ?? 'int']),
    ...cols.filter((col) => !colAt.has(col.id))
      .map((col): [string, number, DisplayColKind] => [col.id, Number(col.id.slice(1)), col.kind]),
  ]
  const readVals = (r: number) => {
    const vals: Record<string, number | null> = {}
    for (const [vid, c, k] of readAt) vals[vid] = num(at(r, c), k)
    for (const d of derived) {
      const a = vals[d.from[0]], b = vals[d.from[1]]
      vals[d.id] = a == null && b == null ? null : (a ?? 0) - (b ?? 0)
    }
    return vals
  }

  let target: number | null = null
  const rows: DisplayRow[] = []
  const seen = new Map<string, number>()
  for (let r = hr + 2; r <= range.e.r; r++) {
    const dp = text(r, cDp).trim()
    const agentRaw = cAgent != null ? text(r, cAgent).trim() : ''
    /* The TOTAL row carries no agent (the 0730 tab writes "AGENT40" where the
       name would be) — it is read only for the target it states. */
    if (!agentRaw) {
      if (target == null && cTarget != null) target = num(at(r, cTarget), 'pct')
      continue
    }
    if (!dp) continue
    const agent = latin(agentRaw).trim() || agentRaw
    /* Same name twice in one tab is rare but not impossible; the key must stay
       unique or React will drop a row. */
    const base = `${agent}|${dp}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    rows.push({
      key: n ? `${base}#${n}` : base,
      agent,
      /* the sheet writes "-" for a site with no RM; that is no RM, not an RM
         called "-" that would sort to the top of the list */
      rm: cRm != null ? text(r, cRm).trim().replace(/^[-–—\s]+$/, '') : '',
      dp,
      target: cTarget != null ? num(at(r, cTarget), 'pct') : null,
      vals: readVals(r),
    })
  }
  if (!rows.length) return null

  return {
    id, sheet,
    label: spec.label,
    zh: spec.zh,
    title: latinTitle.replace(/^NM-/, '').replace(/\s+\d{1,2}\s+[A-Za-z]{3,}\.?\s+\d{4}\s*$/, '').trim() || spec.label,
    date,
    target: target ?? rows.find((r) => r.target != null)?.target ?? null,
    lowerBetter: !!spec.lowerBetter,
    groups,
    cols,
    kpis,
    rows,
  }
}

/** Every Display tab the workbook carries, in rail order. */
export function parseDisplays(wb: XLSX.WorkBook): DisplayReport[] {
  const out: DisplayReport[] = []
  for (const name of wb.SheetNames) {
    const id = displayIdOf(name)
    if (!id || out.some((r) => r.id === id)) continue
    const rep = parseDisplaySheet(id, name, wb.Sheets[name])
    if (rep) out.push(rep)
  }
  return out.sort((a, b) => DISPLAY_ORDER.indexOf(a.id) - DISPLAY_ORDER.indexOf(b.id))
}

/* ------------------------------------------------------------ arithmetic */

/**
 * A ratio over a set of rows, in percent — the figure the workbook would print
 * for exactly those rows. `null` when there is nothing to divide by.
 */
export function ratioOf(rows: DisplayRow[], r: Ratio | undefined): number | null {
  if (!r) return null
  let n = 0, d = 0
  for (const row of rows) {
    n += row.vals[r[0]] ?? 0
    d += row.vals[r[1]] ?? 0
  }
  return d > 0 ? (n / d) * 100 : null
}

/** A row has nothing to judge when the denominator of the headline is zero. */
export function isActive(row: DisplayRow, k: DisplayKpi): boolean {
  return (row.vals[k.dayRatio[1]] ?? 0) > 0
}

export const fmtDayLong = (d: Date | null): string => {
  if (!d) return 'tanggal laporan'
  const long = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
  return `${d.getDate()} ${long[d.getMonth()]} ${d.getFullYear()}`
}
