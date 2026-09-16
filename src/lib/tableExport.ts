/**
 * PDF and Excel exports for the dashboard's tables.
 *
 * Every table describes itself once, as an `ExportTable` — its columns, its
 * rows, the scope and date it was read for — and both formats are written from
 * that description. The rows are always the ones the filters currently keep,
 * all of them: "Tampilkan 40 pertama" is a screen convenience, and an export
 * that silently stopped at forty would be a wrong document rather than a short
 * one. Columns switched off in the table's column bar are left out, so the file
 * matches what the reader chose to look at.
 *
 * Both libraries are imported on first click. They are the two largest things
 * this page could load, and most visits never export anything.
 */

/** How a column's values are stored and printed. Percent values are in percent
 *  units (`94.95`), exactly as the workbook and the tables hold them. */
export type ExportKind = 'text' | 'int' | 'pct' | 'delta' | 'ratio'

/** Cell shading, matching the table on screen. */
export type ExportTone = '' | 'ok' | 'bad' | 'warn' | 'mute'

export interface ExportCol {
  head: string
  /** band above the column — consecutive columns with the same group are merged */
  group?: string
  kind?: ExportKind
  /** approximate width in characters; derived from the content when omitted */
  width?: number
}

export interface ExportCell {
  v: string | number | null
  tone?: ExportTone
  /** printed before a number, e.g. `≥ ` on a target */
  prefix?: string
}

export type ExportValue = string | number | null | ExportCell

export interface ExportTable {
  /** heading of the document, e.g. "Daftar DP / CP" */
  title: string
  /** one short line each: scope, date, filters */
  meta: string[]
  /** filename without extension */
  stem: string
  cols: ExportCol[]
  rows: ExportValue[][]
  /** a summary row printed first and in bold, e.g. TOTAL */
  total?: ExportValue[]
  /** a closing explanation printed under the table */
  note?: string
}

/* ------------------------------------------------------------- palette */

/* The dashboard's own colours (see the tokens at the top of dashboard.css),
   with light tints for cell shading — a printed page and a spreadsheet are
   read on white. */
const RED = 'E2231A'
const BLACK = '0D0D0D'
const BLACK_2 = '2E2E2E'
const GREY_LINE = 'D9D9D9'
const ZEBRA = 'F7F7F7'
const INK_2 = '5A5A5A'

const TONE: Record<Exclude<ExportTone, ''>, { fill: string; ink: string }> = {
  ok: { fill: 'E6F5EC', ink: '1E7A46' },
  bad: { fill: 'FDE7E5', ink: 'B81810' },
  warn: { fill: 'FFF3D6', ink: '8A5A00' },
  mute: { fill: 'F2F2F2', ink: '8C8C8C' },
}

const rgb = (hex: string): [number, number, number] =>
  [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]

/* ------------------------------------------------------------- helpers */

const asCell = (x: ExportValue): ExportCell =>
  x != null && typeof x === 'object' ? x : { v: x }

const fixed = (n: number, dp: number) => n.toFixed(dp).replace('.', ',')

/** The value as a reader sees it — Indonesian separators, `—` for nothing. */
function display(c: ExportCell, kind: ExportKind): string {
  const { v } = c
  if (v == null || v === '') return '—'
  if (typeof v === 'string') return `${c.prefix ?? ''}${v}`
  if (!Number.isFinite(v)) return '—'
  let s: string
  switch (kind) {
    case 'int': s = Math.round(v).toLocaleString('id-ID'); break
    case 'pct': s = `${fixed(v, 2)}%`; break
    case 'delta': s = `${v > 0 ? '+' : v < 0 ? '-' : ''}${fixed(Math.abs(v), 2)}%`; break
    default: s = String(v)
  }
  return `${c.prefix ?? ''}${s}`
}

/** Removes Mandarin (the PDF's built-in font has no glyphs for it) and swaps
 *  the few symbols that font cannot draw for plain equivalents. */
function pdfSafe(s: string): string {
  return s
    .replace(/[⺀-鿿豈-﫿︰-﹏＀-￯]/g, '')
    .replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/−/g, '-')
    .replace(/[▲▼▬]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Runs of equal, non-empty groups: `[label, start, length]`. */
function groupRuns(cols: ExportCol[]): { label: string; start: number; n: number }[] {
  const out: { label: string; start: number; n: number }[] = []
  cols.forEach((c, i) => {
    const label = c.group ?? ''
    const last = out[out.length - 1]
    if (last && last.label === label) last.n++
    else out.push({ label, start: i, n: 1 })
  })
  return out
}

const hasGroups = (cols: ExportCol[]) => cols.some((c) => c.group)

const stamp = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Width in characters a column needs, capped so one long name cannot take the sheet. */
function widthOf(t: ExportTable, i: number): number {
  const col = t.cols[i]
  if (col.width) return col.width
  const kind = col.kind ?? 'text'
  let w = col.head.length
  const all = t.total ? [t.total, ...t.rows] : t.rows
  const sample = all.length > 400 ? all.slice(0, 400) : all
  for (const r of sample) w = Math.max(w, display(asCell(r[i] ?? null), kind).length)
  return Math.min(Math.max(w + 2, kind === 'text' ? 12 : 9), kind === 'text' ? 42 : 16)
}

/* ------------------------------------------------------------------ PDF */

export async function exportTablePdf(t: ExportTable): Promise<void> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])

  /* Landscape always; A3 once the table is too wide for A4 to stay legible. */
  const totalWidth = t.cols.reduce((n, _, i) => n + widthOf(t, i), 0)
  const format = totalWidth > 190 ? 'a3' : 'a4'
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format })
  const pageW = doc.internal.pageSize.getWidth()
  const margin = 10

  /* Title band in the brand red, scope and date beneath it. */
  doc.setFillColor(...rgb(RED))
  doc.rect(0, 0, pageW, 16, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(pdfSafe(t.title), margin, 10.5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('J&T Express', pageW - margin, 10.5, { align: 'right' })

  doc.setTextColor(...rgb(INK_2))
  doc.setFontSize(9)
  let y = 22
  for (const line of t.meta) {
    doc.text(pdfSafe(line), margin, y)
    y += 4.6
  }

  const kinds = t.cols.map((c) => c.kind ?? 'text')
  const numeric = kinds.map((k) => k !== 'text')

  const head: object[][] = []
  if (hasGroups(t.cols)) {
    head.push(groupRuns(t.cols).map((g) => ({
      content: pdfSafe(g.label), colSpan: g.n,
      styles: { fillColor: rgb(BLACK), halign: 'center' },
    })))
  }
  head.push(t.cols.map((c, i) => ({
    content: pdfSafe(c.head),
    styles: { halign: numeric[i] ? 'right' : 'left' },
  })))

  const toRow = (r: ExportValue[], bold = false) => t.cols.map((_, i) => {
    const c = asCell(r[i] ?? null)
    const tone = c.tone ? TONE[c.tone] : null
    return {
      content: pdfSafe(display(c, kinds[i])),
      styles: {
        halign: numeric[i] ? 'right' : 'left',
        ...(tone ? { fillColor: rgb(tone.fill), textColor: rgb(tone.ink) } : {}),
        ...(bold ? { fontStyle: 'bold' } : {}),
      },
    }
  })

  const body = [
    ...(t.total ? [toRow(t.total, true)] : []),
    ...t.rows.map((r) => toRow(r)),
  ]

  const fontSize = t.cols.length > 22 ? 6 : t.cols.length > 14 ? 7 : 8.5

  autoTable(doc, {
    startY: y + 1,
    margin: { left: margin, right: margin, bottom: 14 },
    head: head as never,
    body: body as never,
    theme: 'grid',
    horizontalPageBreak: true,
    horizontalPageBreakRepeat: 0,
    styles: {
      font: 'helvetica', fontSize, cellPadding: 1.6, overflow: 'linebreak',
      lineColor: rgb(GREY_LINE), lineWidth: 0.15, textColor: rgb(BLACK), valign: 'middle',
    },
    headStyles: {
      fillColor: rgb(BLACK_2), textColor: [255, 255, 255], fontStyle: 'bold', lineColor: rgb(BLACK),
    },
    alternateRowStyles: { fillColor: rgb(ZEBRA) },
    columnStyles: Object.fromEntries(t.cols.map((_, i) => [i, {
      minCellWidth: numeric[i] ? 12 : 18,
    }])),
    didDrawPage: () => {
      const h = doc.internal.pageSize.getHeight()
      doc.setFontSize(7.5)
      doc.setTextColor(...rgb(INK_2))
      doc.text(`Dibuat ${stamp()} · Internal J&T`, margin, h - 6)
      doc.text(`Halaman ${doc.getNumberOfPages()}`, pageW - margin, h - 6, { align: 'right' })
    },
  })

  if (!t.rows.length && !t.total) {
    const after = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y
    doc.setFontSize(9)
    doc.setTextColor(...rgb(INK_2))
    doc.text('Tidak ada baris yang cocok dengan filter.', margin, after + 6)
    y = after + 6
  }

  if (t.note) {
    const after = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y
    const lines = doc.splitTextToSize(pdfSafe(t.note), pageW - margin * 2) as string[]
    let ny = Math.max(after, y) + 6
    if (ny + lines.length * 3.6 > doc.internal.pageSize.getHeight() - 14) {
      doc.addPage()
      ny = 16
    }
    doc.setFontSize(7.5)
    doc.setTextColor(...rgb(INK_2))
    doc.text(lines, margin, ny)
  }

  doc.save(`${safeName(t.stem)}.pdf`)
}

/* ---------------------------------------------------------------- Excel */

/** Number formats that keep the cell a real number: `94.95` shows as `94.95%`
 *  and still sorts, sums and filters as a number. */
const XFMT: Record<ExportKind, string | undefined> = {
  text: undefined,
  int: '#,##0',
  pct: '0.00"%"',
  delta: '+0.00"%";-0.00"%";0.00"%"',
  ratio: undefined,
}

export async function exportTableXlsx(t: ExportTable): Promise<void> {
  /* The package is a CommonJS bundle; depending on the bundler its API arrives
     either on the namespace or on `default`. */
  const mod = await import('xlsx-js-style')
  const XLSX = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod

  const n = t.cols.length
  const kinds = t.cols.map((c) => c.kind ?? 'text')
  const border = {
    top: { style: 'thin', color: { rgb: GREY_LINE } },
    bottom: { style: 'thin', color: { rgb: GREY_LINE } },
    left: { style: 'thin', color: { rgb: GREY_LINE } },
    right: { style: 'thin', color: { rgb: GREY_LINE } },
  }
  const font = (extra: object = {}) => ({ name: 'Calibri', sz: 11, ...extra })

  const ws: Record<string, unknown> = {}
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = []
  const rowsMeta: { hpt: number }[] = []
  const put = (r: number, c: number, cell: object) => {
    ws[XLSX.utils.encode_cell({ r, c })] = cell
  }

  let r = 0

  /* Title across the table, in the brand red. */
  for (let c = 0; c < n; c++) {
    put(r, c, {
      t: 's', v: c === 0 ? t.title : '',
      s: {
        font: font({ sz: 16, bold: true, color: { rgb: 'FFFFFF' } }),
        fill: { fgColor: { rgb: RED } },
        alignment: { vertical: 'center' },
      },
    })
  }
  merges.push({ s: { r, c: 0 }, e: { r, c: Math.max(0, n - 1) } })
  rowsMeta[r] = { hpt: 30 }
  r++

  for (const line of [...t.meta, `Dibuat ${stamp()} · Internal J&T`]) {
    put(r, 0, { t: 's', v: line, s: { font: font({ color: { rgb: INK_2 } }) } })
    merges.push({ s: { r, c: 0 }, e: { r, c: Math.max(0, n - 1) } })
    r++
  }
  r++ // a blank row between the heading and the table

  /* Column bands. */
  if (hasGroups(t.cols)) {
    for (const g of groupRuns(t.cols)) {
      for (let c = g.start; c < g.start + g.n; c++) {
        put(r, c, {
          t: 's', v: c === g.start ? g.label : '',
          s: {
            font: font({ bold: true, color: { rgb: 'FFFFFF' } }),
            fill: { fgColor: { rgb: BLACK } },
            alignment: { horizontal: 'center', vertical: 'center' },
            border,
          },
        })
      }
      if (g.n > 1) merges.push({ s: { r, c: g.start }, e: { r, c: g.start + g.n - 1 } })
    }
    rowsMeta[r] = { hpt: 20 }
    r++
  }

  /* Column heads. */
  const headRow = r
  t.cols.forEach((col, c) => {
    put(r, c, {
      t: 's', v: col.head,
      s: {
        font: font({ bold: true, color: { rgb: 'FFFFFF' } }),
        fill: { fgColor: { rgb: BLACK_2 } },
        alignment: {
          horizontal: kinds[c] === 'text' ? 'left' : 'center', vertical: 'center', wrapText: true,
        },
        border,
      },
    })
  })
  rowsMeta[r] = { hpt: 32 }
  r++

  const writeRow = (row: ExportValue[], zebra: boolean, bold: boolean) => {
    t.cols.forEach((_, c) => {
      const cell = asCell(row[c] ?? null)
      const kind = kinds[c]
      const tone = cell.tone ? TONE[cell.tone] : null
      const style = {
        font: font({ bold, ...(tone ? { color: { rgb: tone.ink } } : {}) }),
        fill: { fgColor: { rgb: tone ? tone.fill : bold ? 'EDEDED' : zebra ? ZEBRA : 'FFFFFF' } },
        alignment: { horizontal: kind === 'text' ? 'left' : 'right', vertical: 'center' },
        border,
      }
      const fmt = XFMT[kind]
      if (typeof cell.v === 'number' && Number.isFinite(cell.v) && fmt) {
        const prefix = cell.prefix ? `"${cell.prefix.replace(/"/g, '')}"` : ''
        put(r, c, { t: 'n', v: cell.v, z: prefix + fmt, s: { ...style, numFmt: prefix + fmt } })
      } else {
        const text = cell.v == null || cell.v === '' ? '—' : display(cell, kind)
        put(r, c, {
          t: 's', v: text,
          s: { ...style, alignment: { ...style.alignment, horizontal: kind === 'text' ? 'left' : 'center' } },
        })
      }
    })
    r++
  }

  if (t.total) writeRow(t.total, false, true)
  t.rows.forEach((row, i) => writeRow(row, i % 2 === 1, false))
  const lastRow = r - 1

  if (!t.rows.length && !t.total) {
    put(r, 0, { t: 's', v: 'Tidak ada baris yang cocok dengan filter.', s: { font: font({ italic: true }) } })
    r++
  }

  if (t.note) {
    r++
    put(r, 0, {
      t: 's', v: t.note,
      s: { font: font({ sz: 9, italic: true, color: { rgb: INK_2 } }), alignment: { wrapText: true, vertical: 'top' } },
    })
    merges.push({ s: { r, c: 0 }, e: { r, c: Math.max(0, n - 1) } })
    rowsMeta[r] = { hpt: Math.min(160, 15 * Math.ceil(t.note.length / 180)) }
    r++
  }

  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(r - 1, headRow), c: Math.max(0, n - 1) } })
  ws['!merges'] = merges
  ws['!rows'] = rowsMeta
  ws['!cols'] = t.cols.map((_, i) => ({ wch: widthOf(t, i) + 2 }))
  if (lastRow > headRow) {
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({ s: { r: headRow, c: 0 }, e: { r: lastRow, c: n - 1 } }),
    }
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws as never, t.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '))
  XLSX.writeFile(wb, `${safeName(t.stem)}.xlsx`)
}
