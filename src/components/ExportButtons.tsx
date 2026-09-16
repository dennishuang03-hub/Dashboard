import { useState } from 'react'
import { exportTablePdf, exportTableXlsx } from '../lib/tableExport'
import type { ExportTable } from '../lib/tableExport'

/**
 * "Ekspor PDF" and "Ekspor Excel" for one table.
 *
 * `build` is called on click rather than on render, so describing a table of
 * seventeen thousand sellers costs nothing until someone asks for the file —
 * and the file is built from the filters as they stand at that moment.
 */
export default function ExportButtons({
  build, onError, tiny = true,
}: {
  build: () => ExportTable
  onError?: (msg: string) => void
  /** the small variant, for a dark panel header */
  tiny?: boolean
}) {
  const [busy, setBusy] = useState<'' | 'pdf' | 'xlsx'>('')

  const run = async (kind: 'pdf' | 'xlsx') => {
    if (busy) return
    setBusy(kind)
    try {
      const table = build()
      if (kind === 'pdf') await exportTablePdf(table)
      else await exportTableXlsx(table)
    } catch (ex) {
      const msg = `Ekspor ${kind === 'pdf' ? 'PDF' : 'Excel'} gagal: ${(ex as Error).message}`
      if (onError) onError(msg)
      else window.alert(msg)
    } finally {
      setBusy('')
    }
  }

  const cls = `btn${tiny ? ' tiny' : ''} save`
  return (
    <span className="exportbtns">
      <button className={cls} onClick={() => run('pdf')} disabled={!!busy}>
        {busy === 'pdf' ? 'Menyiapkan…' : 'Ekspor PDF'}
      </button>
      <button className={cls} onClick={() => run('xlsx')} disabled={!!busy}>
        {busy === 'xlsx' ? 'Menyiapkan…' : 'Ekspor Excel'}
      </button>
    </span>
  )
}
