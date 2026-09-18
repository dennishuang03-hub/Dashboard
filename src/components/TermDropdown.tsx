/**
 * The pasted search terms, as a dropdown rather than as a row of chips.
 *
 * A pasted column is routinely fifty codes. Laid out as chips under the search
 * box they were the tallest thing on the filter bar — the table they filter
 * started below the fold, which is the wrong way round for a control whose whole
 * job is to make the table shorter. Folded into a dropdown the list costs one
 * button's width at rest, and the count on that button is the part anyone
 * actually reads: it says the paste arrived whole.
 *
 * It borrows the `ms-*` styling from `MultiSelect` on purpose. This sits on the
 * same bar as three of those, and a fourth control that opened a differently
 * shaped panel would read as something else entirely.
 *
 * What it is NOT is a `MultiSelect`. That component switches known options off;
 * this one holds a list someone brought with them, where the only actions are
 * remove one and remove all, and where the options are not known until they are
 * pasted. Sharing the look is right; sharing the component would mean bending a
 * tick-box model around a list that has nothing to tick.
 *
 * `disabled` closes the panel by remount, not by an effect: the caller keys this
 * component on the basket, so switching the basket on throws the open state away
 * with the instance. A panel left hanging over a disabled trigger is a thing
 * people click at, and the alternative — an effect that sets state to undo the
 * render that just happened — is a second pass for something the key settles in
 * the first.
 */
import { useEffect, useRef, useState } from 'react'

export default function TermDropdown({
  terms, onRemove, onClear, disabled,
}: {
  /** the committed search terms, in the order they were entered */
  terms: readonly string[]
  onRemove: (term: string) => void
  onClear: () => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  /* Close on a click anywhere else and on Escape — same rules as `MultiSelect`,
     for the same reasons, and bound only while open. */
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

  /*
   * Removing the last term takes the trigger away with it, so the panel is shut
   * on the way out — in the handlers rather than in an effect watching the
   * count. An effect would be a second render that undoes state the first one
   * set, for something both handlers already know at the moment they act.
   */
  const remove = (t: string) => {
    if (terms.length === 1) setOpen(false)
    onRemove(t)
  }
  const clear = () => { setOpen(false); onClear() }

  if (!terms.length) return null

  return (
    <div className={`ms tdrop${open ? ' open' : ''}`} ref={wrapRef}>
      <button
        type="button"
        ref={btnRef}
        className="ms-btn filtered"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Daftar kode pencarian — ${terms.length} kode`}
        title={terms.join(', ')}
      >
        <span className="ms-txt">Daftar kode</span>
        <span className="ms-n">{terms.length}</span>
        <svg className="ms-caret" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="ms-pop" role="group" aria-label="Daftar kode pencarian">
          <div className="ms-head">
            <span className="ms-title">Kode yang dicari</span>
            <span className="ms-count off"><b>{terms.length}</b></span>
          </div>

          <div className="ms-list">
            {terms.map((t) => (
              <div key={t} className="ms-row tdrop-row">
                <span className="ms-lab">{t}</span>
                {/* An explicit button, not a click on the row. The row is the
                    only thing in the panel, so a row that removed itself on
                    click would make reading the list and destroying it the same
                    gesture. */}
                <button
                  type="button" className="tdrop-x" onClick={() => remove(t)}
                  title={`Hapus "${t}"`} aria-label={`Hapus ${t}`}
                >×</button>
              </div>
            ))}
          </div>

          <button type="button" className="tdrop-clear" onClick={clear}>
            Hapus semua kode
          </button>
        </div>
      )}
    </div>
  )
}
