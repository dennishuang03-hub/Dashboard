/**
 * The daily-order filter: a volume floor and the days it is read on, in one
 * dropdown.
 *
 * ── Why one control and not two ───────────────────────────────────────────────
 *
 * These were a pair of `<select>`s sitting next to each other on the filter bar,
 * and the second only appeared once the first had a value — which is the tell
 * that they were never two filters. "At least 800 orders" is not a question on
 * its own; it is only answerable against a day. Splitting one question across
 * two controls also split the answer across two places on the bar, so the state
 * had to be read left to right and reassembled.
 *
 * ── Staged, not live ─────────────────────────────────────────────────────────
 *
 * Everything inside is draft state until **Terapkan**. The other filters in this
 * panel apply on the click, and that is right for them: one tick, one narrowing,
 * instantly undone by ticking again. This one is a floor *and* a set of days,
 * and applying live means the table re-sorts and re-counts under every
 * intermediate combination on the way to the one being aimed at — including
 * combinations that match nothing. Seventeen thousand rows is too much work to
 * do for a state nobody asked to see.
 *
 * **Escape and click-away discard the draft.** Only the button commits. A panel
 * that quietly kept half-finished edits would be worse than one that loses them,
 * because the bar would then be describing a filter nobody applied.
 */
import { useEffect, useRef, useState } from 'react'
import type { OtpuPeriod } from '../lib/otpu'
import { nfmt, shortDate } from '../lib/otpu'

export interface OrderFilterValue {
  /** minimum orders in a day, or `null` for no floor */
  min: number | null
  /** the day keys the floor is read on; only meaningful when `min` is set */
  days: ReadonlySet<string>
}

/** What the trigger says when a floor is set, e.g. `≥ 100 order/hari · 3 hari`. */
function summarise(v: OrderFilterValue, total: number): string {
  if (v.min == null) return 'Semua order harian'
  const n = v.days.size
  const when = n === 0 ? 'tidak ada hari'
    : n === total ? 'semua hari'
    : `${n} hari`
  return `≥ ${nfmt(v.min)} order/hari · ${when}`
}

export default function OrderFilter({
  days, floors, value, onApply,
}: {
  days: OtpuPeriod[]
  floors: readonly number[]
  value: OrderFilterValue
  onApply: (next: OrderFilterValue) => void
}) {
  const [open, setOpen] = useState(false)
  /* The draft. Seeded from the applied value every time the panel opens, so a
     discarded edit leaves nothing behind to surprise the next opening. */
  const [min, setMin] = useState<number | null>(value.min)
  const [picked, setPicked] = useState<ReadonlySet<string>>(value.days)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const allKeys = days.map((d) => d.key)
  const allOn = picked.size === allKeys.length
  const noneOn = picked.size === 0

  const start = () => {
    setMin(value.min)
    setPicked(value.days)
    setOpen(true)
  }
  const close = () => {
    setOpen(false)
    btnRef.current?.focus()
  }

  /* Same dismissal contract as MultiSelect — pointerdown rather than click, so
     pressing a control outside does not land on a panel that is still covering
     it, and both listeners live only while the panel is open. */
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

  const toggleDay = (key: string) => {
    const next = new Set(picked)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setPicked(next)
  }

  const apply = () => {
    onApply({ min, days: picked })
    close()
  }
  /* Reset clears the filter rather than restoring what was applied — "undo my
     edits" is what closing the panel already does. */
  const reset = () => {
    setMin(null)
    setPicked(new Set(allKeys))
  }

  const summary = summarise(value, allKeys.length)
  const filtered = value.min != null

  return (
    <div className={`of${open ? ' open' : ''}`} ref={wrapRef}>
      <button
        type="button"
        ref={btnRef}
        className={`ms-btn of-btn${filtered ? ' filtered' : ''}`}
        onClick={() => (open ? close() : start())}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Filter order harian — ${summary}`}
        title={summary}
      >
        <svg className="of-ico" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M1.5 2.5h11l-4.2 5v4l-2.6 1.2v-5.2z" fill="none" stroke="currentColor"
                strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
        <span className="ms-txt">{summary}</span>
        <svg className="ms-caret" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="ms-pop of-pop" role="group" aria-label="Filter order harian">
          <div className="of-sec">
            <svg className="of-secico" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M2 11.5V7M6.2 11.5V3M10.4 11.5V5.4" fill="none" stroke="currentColor"
                    strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <span className="of-sectitle">Jumlah Order per Hari</span>
          </div>
          <div className="of-list">
            {/* "Semua" is an option in the same list rather than a way of
                clearing the others: the floor is one answer out of several, and
                a radio group with no selected state has no way to say "none". */}
            <label className="ms-row of-radio">
              <input
                type="radio" name="of-min" checked={min == null}
                onChange={() => setMin(null)}
              />
              <span className="ms-lab">Semua order</span>
            </label>
            {floors.map((n) => (
              <label key={n} className="ms-row of-radio">
                <input
                  type="radio" name="of-min" checked={min === n}
                  onChange={() => setMin(n)}
                />
                <span className="ms-lab">≥ {nfmt(n)} order/hari</span>
              </label>
            ))}
          </div>

          <div className="of-sec of-sec2">
            <svg className="of-secico" viewBox="0 0 14 14" aria-hidden="true">
              <rect x="1.7" y="2.6" width="10.6" height="9.7" rx="1.6" fill="none"
                    stroke="currentColor" strokeWidth="1.4" />
              <path d="M1.7 5.6h10.6M4.6 1.5v2.2M9.4 1.5v2.2" fill="none"
                    stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <span className="of-sectitle">Hari</span>
            {/* The master sits in the section head, where the image puts it, and
                carries the third state the way MultiSelect's does. */}
            <label className="of-master">
              <input
                type="checkbox"
                checked={allOn}
                ref={(el) => { if (el) el.indeterminate = !allOn && !noneOn }}
                onChange={(e) => setPicked(e.target.checked ? new Set(allKeys) : new Set())}
                /* The day list only decides anything once there is a floor to
                   read on it. */
                disabled={min == null}
              />
              <span>Pilih semua</span>
            </label>
          </div>
          <div className={`of-list of-days${min == null ? ' of-idle' : ''}`}>
            {days.map((d) => (
              <label key={d.key} className={`ms-row${picked.has(d.key) ? '' : ' unticked'}`}>
                <input
                  type="checkbox" checked={picked.has(d.key)}
                  onChange={() => toggleDay(d.key)}
                  disabled={min == null}
                />
                <span className="ms-lab">{d.from ? shortDate(d.from) : d.label}</span>
              </label>
            ))}
          </div>

          {/* Said out loud rather than left to be found after applying. */}
          {min != null && noneOn && (
            <div className="ms-warn">Tidak ada hari dipilih — tabel akan kosong.</div>
          )}

          <div className="of-foot">
            <button type="button" className="of-reset" onClick={reset}>
              <svg viewBox="0 0 14 14" aria-hidden="true">
                <path d="M11.8 6.2A4.9 4.9 0 1 0 11 9.6" fill="none" stroke="currentColor"
                      strokeWidth="1.5" strokeLinecap="round" />
                <path d="M12.2 2.6v3.7H8.6" fill="none" stroke="currentColor"
                      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Reset
            </button>
            <button type="button" className="of-apply" onClick={apply}>
              <svg viewBox="0 0 14 14" aria-hidden="true">
                <path d="M2.6 7.4l3 3 5.8-6.4" fill="none" stroke="currentColor"
                      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Terapkan
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
