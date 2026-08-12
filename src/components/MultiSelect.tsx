/**
 * A filter dropdown that takes more than one answer.
 *
 * The DP/CP filters were `<select>`s, which can hold exactly one choice each,
 * and that turned out to be the wrong shape for the question people actually
 * ask. "How are the sites that do pickups doing" covers both *Pickup Delivery*
 * and *Pickup*, and a single-choice control cannot express it — you had to look
 * at one, remember the numbers, then look at the other.
 *
 * ── Ticked, not picked ────────────────────────────────────────────────────────
 *
 * The set this component holds is the values switched **off**, never the ones
 * switched on, and everything starts fully ticked. That is the same way the
 * column switch two rows below works, and it is deliberate that the two match:
 * they sit in the same panel and would otherwise teach opposite habits.
 *
 * It also sidesteps a genuine ambiguity. Store the selection instead and the
 * empty set has to mean something, and both available meanings are bad: "show
 * nothing" is a dead table you reach by unticking your way there, and "show
 * everything" is indistinguishable from having ticked every box, so the same
 * screen state has two representations and the control flickers between them.
 * Storing exclusions makes "everything" exactly one state — the empty set —
 * and unticking is monotonic: it always narrows, never silently widens.
 */
import { useEffect, useRef, useState } from 'react'
import Zh from './Zh'

export interface MsOption {
  value: string
  label: string
  /** Mandarin gloss, shown in lighter type beside the label */
  zh?: string
  /** how many rows in scope carry this value — greyed, on the right */
  n?: number
  /**
   * Draw the label as the same plate the table draws for this value — the class
   * list of that plate, e.g. `sbadge both` or `stbadge urgent`.
   *
   * The point is recognition rather than decoration. "Perhatian" in the filter
   * and the amber pill in the Status column were the same fact wearing two
   * different faces, and matching them means a value can be found by its colour
   * in either place. It is the component's caller that owns the mapping,
   * because it is the caller that owns the table.
   */
  badge?: string
  /**
   * A short chip *before* the label, for values the table shows as a tag beside
   * a name rather than as a plate of their own — the FR / AG model marker.
   */
  tag?: { cls: string; text: string }
}

export default function MultiSelect({
  name, zh, allLabel, options, off, onChange, disabled,
}: {
  /** what the filter is about, for the trigger and the aria label — "Jenis layanan" */
  name: string
  zh?: string
  /** what the trigger reads when nothing is switched off — "Semua jenis layanan" */
  allLabel: string
  options: MsOption[]
  /** the values switched off; empty means every option is showing */
  off: ReadonlySet<string>
  onChange: (next: ReadonlySet<string>) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const on = options.filter((o) => !off.has(o.value))
  const allOn = on.length === options.length
  const noneOn = on.length === 0

  /**
   * Close on a click anywhere else, and on Escape.
   *
   * `pointerdown` rather than `click`: a click fires after mouseup, so pressing
   * on a control outside the panel left the panel open long enough to cover the
   * thing being pressed. Both listeners are bound only while open, so a page
   * with four of these is not running eight idle listeners.
   */
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      /* Focus goes back to the trigger, not wherever it was. Escape closed
         something the keyboard was inside; dropping focus to <body> would send
         the next Tab back to the top of the page. */
      btnRef.current?.focus()
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  /* The basket switches the filters off mid-use, and a panel left hanging open
     over a disabled control is the kind of thing that gets clicked at. */
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])

  const toggle = (value: string) => {
    const next = new Set(off)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange(next)
  }

  const showAll = () => onChange(new Set<string>())
  const hideAll = () => onChange(new Set(options.map((o) => o.value)))

  /*
   * What the closed trigger says.
   *
   * A count alone ("2 dari 4") is the safe answer and a poor one: the whole
   * point of a filter bar is to be readable at rest, and two of the three
   * dropdowns here are usually sitting on a single value. So one value names
   * itself, and only a genuine mixture falls back to counting.
   */
  const summary = allOn ? allLabel
    : noneOn ? `${name} · tidak ada`
    : on.length === 1 ? on[0].label
    : `${name} · ${on.length} dari ${options.length}`

  return (
    <div className={`ms${open ? ' open' : ''}`} ref={wrapRef}>
      <button
        type="button"
        ref={btnRef}
        className={`ms-btn${allOn ? '' : ' filtered'}${noneOn ? ' empty' : ''}`}
        onClick={() => setOpen(!open)}
        disabled={disabled}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${name} — ${summary}`}
        title={allOn ? allLabel : on.map((o) => o.label).join(', ') || 'Tidak ada yang dipilih'}
      >
        <span className="ms-txt">{summary}</span>
        {/* The count rides on the trigger, not only inside the panel: "this list
            is filtered" has to be legible without opening anything, or a filter
            left on from ten minutes ago quietly explains a number nobody can
            account for. */}
        {!allOn && <span className="ms-n">{on.length}</span>}
        <svg className="ms-caret" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="ms-pop" role="group" aria-label={name}>
          <div className="ms-head">
            <span className="ms-title">{name}<Zh>{zh ?? ''}</Zh></span>
            <span className={`ms-count${allOn ? '' : ' off'}`}>
              <b>{on.length}</b>/{options.length}
            </span>
          </div>

          {/* Carries the third state, like the column switch does: a plain
              unticked box above a list showing two of four would be describing
              something that is not on screen. */}
          <label className="ms-row ms-master">
            <input
              type="checkbox"
              checked={allOn}
              ref={(el) => { if (el) el.indeterminate = !allOn && !noneOn }}
              onChange={(e) => (e.target.checked ? showAll() : hideAll())}
            />
            <span className="ms-lab">Pilih semua</span>
          </label>

          <div className="ms-list">
            {options.map((o) => {
              const ticked = !off.has(o.value)
              return (
                <label key={o.value} className={`ms-row${ticked ? '' : ' unticked'}`}>
                  <input type="checkbox" checked={ticked} onChange={() => toggle(o.value)} />
                  <span className="ms-lab">
                    {o.tag && <span className={o.tag.cls}>{o.tag.text}</span>}
                    {/* The gloss stays outside the plate. In the table the badge
                        carries the Indonesian alone and the Mandarin lives in
                        its tooltip; widening the plate to hold both here would
                        make the same value a different shape in the two places,
                        which is the thing this is trying to fix. */}
                    {o.badge ? <span className={o.badge}>{o.label}</span> : o.label}
                    <Zh>{o.zh ?? ''}</Zh>
                  </span>
                  {o.n != null && <span className="ms-num">{o.n}</span>}
                </label>
              )
            })}
          </div>

          {/* Said out loud rather than left to be discovered. Unticking the last
              box is a reachable state and the table it produces is empty, which
              looks like a bug unless the control admits it caused it. */}
          {noneOn && (
            <div className="ms-warn">Tidak ada yang dipilih — tabel akan kosong.</div>
          )}
        </div>
      )}
    </div>
  )
}
