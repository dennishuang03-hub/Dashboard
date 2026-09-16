import { useState } from 'react'
import { exportTablePdf, exportTableXlsx } from '../lib/tableExport'
import type { ExportTable } from '../lib/tableExport'
import BtnIcon from './BtnIcon'

/**
 * "Ekspor PDF" and "Ekspor Excel" for one table.
 *
 * `build` is called on click rather than on render, so describing a table of
 * seventeen thousand sellers costs nothing until someone asks for the file —
 * and the file is built from the filters as they stand at that moment.
 *
 * While either file is being made both buttons are locked: a second press used
 * to start a second export of the same table and save the file twice.
 */
export default function ExportButtons({
  build, onError, tiny = true,
}: {
  build: () => ExportTable
  /** the dashboard's shared error banner; '' clears it */
  onError?: (msg: string) => void
  /** the small variant, for a dark panel header */
  tiny?: boolean
}) {
  const [busy, setBusy] = useState<'' | 'pdf' | 'xlsx'>('')

  const run = async (kind: 'pdf' | 'xlsx') => {
    if (busy) return
    setBusy(kind)
    /* A banner left over from an earlier failure would otherwise sit above a
       file that has just saved perfectly well. */
    onError?.('')
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

  const size = tiny ? ' tiny' : ''
  return (
    <span className="exportbtns">
      <button
        className={`btn${size} act act-pdf${busy === 'pdf' ? ' is-busy' : ''}`}
        onClick={() => run('pdf')} disabled={!!busy}
        title="Simpan tabel ini sebagai PDF, dengan filter dan kolom yang sedang aktif"
      >
        <BtnIcon name={busy === 'pdf' ? 'spin' : 'pdf'} />
        <span>{busy === 'pdf' ? 'Menyiapkan…' : 'Ekspor PDF'}</span>
      </button>
      <button
        className={`btn${size} act act-xls${busy === 'xlsx' ? ' is-busy' : ''}`}
        onClick={() => run('xlsx')} disabled={!!busy}
        title="Simpan tabel ini sebagai Excel, dengan filter dan kolom yang sedang aktif"
      >
        <BtnIcon name={busy === 'xlsx' ? 'spin' : 'sheet'} />
        <span>{busy === 'xlsx' ? 'Menyiapkan…' : 'Ekspor Excel'}</span>
      </button>
    </span>
  )
}
