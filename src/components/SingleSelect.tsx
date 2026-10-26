/**
 * A one-answer dropdown dressed as a MultiSelect.
 *
 * The worst-ten charts take exactly one category each, so a tick-box list would
 * be the wrong control — but a native `<select>` beside the MultiSelect chips
 * looked like a different product. This borrows `.ms`, `.ms-btn`, `.ms-pop` and
 * `.ms-row` wholesale, so the two read as the same object, and swaps the tick
 * boxes for a single marked row that closes the panel when chosen.
 */
import { useEffect, useRef, useState } from 'react'
import Zh from './Zh'

export interface SsOption {
  value: string
  label: string
  /** Mandarin gloss, shown in lighter type beside the label */
  zh?: string
}

export default function SingleSelect({
  name, zh, value, options, onChange, align = 'left',
}: {
  /** what the choice is about, for the panel title and the aria label */
  name: string
  zh?: string
  value: string
  options: SsOption[]
  onChange: (value: string) => void
  /** which edge of the trigger the panel hangs from */
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  /* same close rules as MultiSelect: pointerdown elsewhere, or Escape */
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      btnRef.current?.focus()
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const cur = options.find((o) => o.value === value) ?? options[0]

  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
    btnRef.current?.focus()
  }

  const row = (o: SsOption) => {
    const picked = o.value === cur?.value
    return (
      <button
        key={o.value} type="button" role="option" aria-selected={picked}
        className={`ms-row ss-row${picked ? ' picked' : ''}`}
        onClick={() => pick(o.value)}
      >
        <span className="ms-lab">{o.label}<Zh>{o.zh ?? ''}</Zh></span>
        {picked && (
          <svg className="ss-tick" viewBox="0 0 12 10" aria-hidden="true">
            <path d="M1 5l3.5 3.5L11 1" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    )
  }

  return (
    <div className={`ms ss${open ? ' open' : ''}`} ref={wrapRef}>
      <button
        type="button"
        ref={btnRef}
        className="ms-btn"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${name} — ${cur?.label ?? ''}`}
        title={cur?.label}
      >
        <span className="ms-txt">{cur?.label}</span>
        <svg className="ms-caret" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className={`ms-pop${align === 'right' ? ' ss-right' : ''}`} role="listbox" aria-label={name}>
          <div className="ms-head">
            <span className="ms-title">{name}<Zh>{zh ?? ''}</Zh></span>
          </div>
          <div className="ms-list">{options.map(row)}</div>
        </div>
      )}
    </div>
  )
}
