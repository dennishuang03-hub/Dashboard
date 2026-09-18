/**
 * The pasted search terms, folded into the search box itself.
 *
 * A pasted column is routinely fifty codes. Laid out as chips under the box they
 * were the tallest thing on the filter bar — the table they filter started below
 * the fold, which is the wrong way round for a control whose whole job is to
 * make the table shorter. So the list lives behind a count badge and a caret at
 * the right-hand end of the field, and drops open underneath it.
 *
 * It renders as a fragment rather than a wrapper, and that is load-bearing: the
 * panel is a child of `.dpsearchbox`, which is the positioned element, so it can
 * pin to both of its edges and come out exactly as wide as the field it belongs
 * to. Wrapped in a box of its own the panel would hang off the caret instead and
 * be a floating card beside the search box rather than part of it.
 *
 * The footer has one button. A paired "OK" was considered and left out: there is
 * nothing to confirm, because every removal has already changed the table behind
 * the panel. An OK button next to a filter that has already applied itself is a
 * button that says "done" when the only thing it does is close a panel that a
 * click anywhere else also closes.
 *
 * `disabled` closes the panel by remount, not by an effect: the caller keys this
 * component on the basket, so switching the basket on throws the open state away
 * with the instance.
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
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  /* Close on a click anywhere else and on Escape — same rules as `MultiSelect`,
     for the same reasons, and bound only while open. Two refs rather than one
     wrapper: the trigger and the panel are siblings, so "inside the control"
     means inside either of them. */
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return
      setOpen(false)
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
   * in the handlers rather than in an effect watching the count. An effect would
   * be a second render undoing what the first one did, for something both
   * handlers already know at the moment they act.
   */
  const remove = (t: string) => {
    if (terms.length === 1) setOpen(false)
    onRemove(t)
  }
  const clear = () => { setOpen(false); onClear() }

  if (!terms.length) return null

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className={`tdrop-btn${open ? ' open' : ''}`}
        onClick={() => setOpen(!open)}
        disabled={disabled}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Daftar kode pencarian — ${terms.length} kode`}
        title={terms.join(', ')}
      >
        <span className="tdrop-n">{terms.length}</span>
        <svg className="tdrop-caret" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="tdrop-pop" ref={popRef} role="group" aria-label="Daftar kode pencarian">
          <div className="tdrop-list">
            {terms.map((t) => (
              <div key={t} className="tdrop-row">
                <span className="tdrop-lab">{t}</span>
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

          <div className="tdrop-foot">
            <button type="button" className="tdrop-clear" onClick={clear}>Clear</button>
          </div>
        </div>
      )}
    </>
  )
}
