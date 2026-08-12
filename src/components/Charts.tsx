/** Dependency-free SVG charts (no chart library needed). */
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode, RefObject } from 'react'
import { isCapturing, notCapturing, subscribeCapture } from '../lib/capture'

export interface AxisLabel { top: string; sub?: string }
export interface Series { name: string; color: string; values: (number | null)[] }

const EMPTY = <div className="empty-mini">Tidak ada data untuk pilihan ini</div>

/* ------------------------------------------------------------- responsive */

/**
 * Below this many CSS pixels of *available* width, a chart switches to its
 * portrait proportions.
 *
 * Measured on the container rather than the viewport, and that distinction is
 * load-bearing: the PNG export pins `.wrap` to 1480px while the phone's viewport
 * is still 390px wide (`body.shooting` in dashboard.css). A media query would
 * report "narrow" and draw a portrait chart into a landscape frame — the export
 * would come out with enormous type. The container knows how much room it
 * actually has; the window does not.
 */
const NARROW_AT = 560

function useBoxWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)

  /* Layout effect, not effect: this runs before the browser paints, so a phone
     never shows one frame of the landscape chart before it is corrected. */
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const apply = () => setWidth(el.getBoundingClientRect().width)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return [ref, width]
}

/**
 * Is this box narrow enough to need the upright shape?
 *
 * The measured width answers that on screen. During a PNG export it does not:
 * the page has just been pinned to a desktop width and the box is about to grow,
 * but this render is happening before the observer has said so. `isCapturing`
 * is the instruction that outranks the measurement — see lib/capture.ts.
 *
 * `useSyncExternalStore` gives every chart a synchronous re-render the moment
 * capture starts, so the reshaping is finished before the exporter measures
 * anything rather than racing it.
 */
function useNarrow(boxW: number): boolean {
  const capturing = useSyncExternalStore(subscribeCapture, isCapturing, notCapturing)
  return !capturing && boxW > 0 && boxW < NARROW_AT
}

/**
 * Measures, then hands its width to the chart inside.
 *
 * The charts scale by viewBox, so `w`/`h` are a *ratio* rather than a pixel
 * size. Making one fit a phone is therefore not a matter of shrinking it —
 * 1100×300 squeezed into 358px is 98px tall, a flat smear no one can read, which
 * is why this used to scroll sideways instead. What actually fits is a different
 * *shape*: roughly square, so the same chart gets its height back from the space
 * a phone has plenty of.
 */
function Responsive({ children }: { children: (narrow: boolean) => ReactNode }) {
  const [ref, width] = useBoxWidth<HTMLDivElement>()
  /* width 0 is "not measured yet" — assume wide, which is right on the desktop
     path and corrected before paint on the narrow one */
  const narrow = useNarrow(width)
  return <div className="chartbox" ref={ref}>{children(narrow)}</div>
}

/* ------------------------------------------------------------ line chart */

/**
 * A note on sizing: both charts render at `width:100%` and scale by their
 * viewBox, so `w` and `h` are a *ratio*, not a pixel size. Shrinking `h` alone
 * makes the chart shorter on screen while every font, bar and dot keeps exactly
 * the size it had — which is what "smaller but still readable" needs. Lowering
 * the font sizes instead would have been the wrong lever.
 */
interface LineProps {
  series: Series[]
  labels: AxisLabel[]
  targetLine?: number | null
  clamp01?: boolean
  w?: number
  h?: number
}

/**
 * 430×380 on a phone against 1100×300 on a desktop.
 *
 * Not a scaled-down version of the same rectangle — a different one. The wide
 * shape spends its pixels on horizontal room it does not need for three days of
 * data, and has none left for height. Turning it upright gives the lines
 * somewhere to move, and the near-1:1 render scale means the axis type comes out
 * at roughly its intended size instead of the ~6px it managed before.
 */
export function LineChart(props: LineProps) {
  return (
    <Responsive>
      {(narrow) => (
        <LineChartSvg
          {...props}
          w={narrow ? 430 : props.w ?? 1100}
          h={narrow ? 380 : props.h ?? 300}
        />
      )}
    </Responsive>
  )
}

function LineChartSvg({
  series, labels, targetLine, clamp01 = true, w = 1100, h = 300,
}: LineProps) {
  const P = { t: 26, r: 54, b: 48, l: 54 }
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null))
  if (!all.length || !labels.length) return EMPTY

  let min = Math.min(...all)
  let max = Math.max(...all)
  const span = max - min
  // just enough slack for the value labels to sit above the top-most point
  const pad = span > 0 ? span * 0.18 : Math.max(1, Math.abs(max) * 0.05)
  min -= pad; max += pad
  if (clamp01) { min = Math.max(0, min); max = Math.min(100, max) }
  if (max - min < 0.5) max = min + 1

  const n = labels.length
  const X = (i: number) => (n === 1 ? P.l + (w - P.l - P.r) / 2 : P.l + (i * (w - P.l - P.r)) / (n - 1))
  const Y = (v: number) => P.t + ((max - v) / (max - min)) * (h - P.t - P.b)

  const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4)
  const showVals = series.length <= 4 && n <= 12

  /**
   * Value labels, laid out per x-position rather than per series.
   * Two lines that run close together used to print their numbers on top of
   * each other, because the offset was chosen from the series index alone.
   * Here every label at one x is collected, sorted top-to-bottom, and pushed
   * down until each clears the one above it by GAP.
   */
  const GAP = 15
  const labelsAt = (i: number) => {
    const here = series
      .map((s) => ({ color: s.color, v: s.values[i] }))
      .filter((o): o is { color: string; v: number } => o.v != null)
      .map((o) => ({ ...o, y: Y(o.v) }))
      .sort((a, b) => a.y - b.y)

    let prev = -Infinity
    return here.map((o) => {
      const want = Math.max(o.y - 12, P.t - 6)
      const ly = want < prev + GAP ? prev + GAP : want
      prev = ly
      return { ...o, ly }
    })
  }

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {ticks.map((v, i) => (
        <g key={`t${i}`}>
          <line x1={P.l} y1={Y(v)} x2={w - P.r} y2={Y(v)} stroke="var(--c-grid)" strokeWidth={1} />
          <text x={P.l - 9} y={Y(v) + 4} textAnchor="end" fontSize={12} fill="var(--c-axis-2)">
            {v.toFixed(0)}%
          </text>
        </g>
      ))}

      {labels.map((l, i) => (
        <g key={`x${i}`}>
          <text x={X(i)} y={h - P.b + 20} textAnchor="middle" fontSize={13} fill="var(--c-axis)">{l.top}</text>
          {l.sub && (
            <text x={X(i)} y={h - P.b + 36} textAnchor="middle" fontSize={11} fill="var(--c-axis-2)">{l.sub}</text>
          )}
        </g>
      ))}

      {series.map((s, j) => {
        const pts = s.values
          .map((v, i) => (v == null ? null : { x: X(i), y: Y(v) }))
          .filter((p): p is { x: number; y: number } => p != null)
        if (!pts.length) return null
        return (
          <g key={s.name + j}>
            {pts.length > 1 && (
              <polyline
                fill="none" stroke={s.color} strokeWidth={2.5}
                strokeLinejoin="round" strokeLinecap="round"
                points={pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
              />
            )}
            {pts.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={4} fill="var(--c-halo)" stroke={s.color} strokeWidth={2.5} />
            ))}
          </g>
        )
      })}

      {/* drawn last so the numbers sit above every line */}
      {showVals && labels.map((_, i) => (
        <g key={`v${i}`}>
          {labelsAt(i).map((o, k) => (
            <text
              key={k} x={X(i)} y={o.ly} textAnchor="middle"
              fontSize={12} fontWeight={600} fill={o.color}
              stroke="var(--c-halo)" strokeWidth={3.5} paintOrder="stroke" strokeLinejoin="round"
            >
              {o.v.toFixed(2)}%
            </text>
          ))}
        </g>
      ))}

      {targetLine != null && targetLine >= min && targetLine <= max && (
        <g>
          <line x1={P.l} y1={Y(targetLine)} x2={w - P.r} y2={Y(targetLine)}
                stroke="var(--c-bad)" strokeWidth={1.2} strokeDasharray="5 4" />
          <text x={w - P.r} y={Y(targetLine) - 6} textAnchor="end" fontSize={11} fill="var(--c-bad)">
            Target {targetLine.toFixed(2)}%
          </text>
        </g>
      )}
    </svg>
  )
}

/* ------------------------------------------------------------- bar chart */

interface BarProps {
  values: (number | null)[]
  labels: AxisLabel[]
  targetLine?: number | null
  lowerBetter?: boolean
  w?: number
  h?: number
  /**
   * What a narrow container does.
   *   'reshape'  (default) turn the chart upright so it fits
   *   'scroll'   keep it wide and let it pan — for axes whose labels are names
   */
  narrowMode?: 'reshape' | 'scroll'
}

/**
 * Same reasoning as `LineChart` — see the note there — with one escape hatch.
 *
 * Reshaping works when the x-axis has a handful of entries. It does not when
 * every bar carries a name: ten agents in a 400-unit viewBox leaves 40 units per
 * label, and "SEMARANG 三宝垄 · 2 dari 4" printed in 40 units is the pile of
 * overlapping text this replaced. There is no shape that fixes that — the labels
 * need horizontal room or they need to not be there.
 *
 * So such a chart asks for `narrowMode="scroll"` and keeps its width, sized to
 * one comfortable band per bar and rendered at 1:1 so the type comes out exactly
 * as designed. Panning a legible chart beats reading an illegible one that fits.
 */
export function BarChart(props: BarProps) {
  const [ref, boxW] = useBoxWidth<HTMLDivElement>()
  const narrow = useNarrow(boxW)
  const base = props.w ?? 560

  if (narrow && props.narrowMode === 'scroll') {
    const wide = Math.max(base, props.values.length * 116)
    return (
      <div className="chartbox chartscroll" ref={ref}>
        {/* a pixel width, not a percentage: it is what makes the viewBox render
            1:1 and therefore what keeps the labels at their designed size */}
        <div style={{ width: wide }}>
          <BarChartSvg {...props} w={wide} h={props.h ?? 240} />
        </div>
      </div>
    )
  }

  return (
    <div className="chartbox" ref={ref}>
      <BarChartSvg
        {...props}
        w={narrow ? 400 : base}
        h={narrow ? 300 : props.h ?? 240}
      />
    </div>
  )
}

function BarChartSvg({
  values, labels, targetLine, lowerBetter = false, w = 560, h = 240,
}: BarProps) {
  const P = { t: 30, r: 16, b: 48, l: 52 }
  const real = values.filter((v): v is number => v != null)
  if (!real.length) return EMPTY

  let max = Math.max(...real)
  if (targetLine != null) max = Math.max(max, targetLine)
  /* 1.35 left a third of the panel as blank sky above the bars. 1.12 keeps only
     the room the value labels actually need, so the bars fill the plot. */
  max = max * 1.12 || 1

  const n = values.length
  const band = (w - P.l - P.r) / n
  const bw = Math.min(34, band * 0.55)
  const Y = (v: number) => P.t + (1 - v / max) * (h - P.t - P.b)
  const ticks = Array.from({ length: 4 }, (_, i) => (max * i) / 3)

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {ticks.map((v, i) => (
        <g key={`t${i}`}>
          <line x1={P.l} y1={Y(v)} x2={w - P.r} y2={Y(v)} stroke="var(--c-grid)" />
          <text x={P.l - 8} y={Y(v) + 4} textAnchor="end" fontSize={12} fill="var(--c-axis-2)">
            {v.toFixed(1)}%
          </text>
        </g>
      ))}

      {values.map((val, i) => {
        const cx = P.l + band * i + band / 2
        const lab: AxisLabel = labels[i] ?? { top: '' }
        const ok = val == null ? true
          : targetLine == null ? true
          : lowerBetter ? val <= targetLine : val >= targetLine
        return (
          <g key={i}>
            {val != null && (
              <>
                <rect
                  x={cx - bw / 2} y={Y(val)} width={bw}
                  height={Math.max(1, h - P.b - Y(val))} rx={2.5}
                  fill={ok ? 'var(--c-ok)' : 'var(--c-bad)'}
                />
                <text
                  x={cx} y={Y(val) - 7} textAnchor="middle" fontSize={12} fontWeight={500}
                  fill="var(--c-axis)" stroke="var(--c-halo)" strokeWidth={3.5} paintOrder="stroke" strokeLinejoin="round"
                >
                  {val.toFixed(2)}%
                </text>
              </>
            )}
            <text x={cx} y={h - P.b + 20} textAnchor="middle" fontSize={13} fill="var(--c-axis)">
              {lab.top}
            </text>
            {lab.sub && (
              <text x={cx} y={h - P.b + 36} textAnchor="middle" fontSize={11} fill="var(--c-axis-2)">
                {lab.sub}
              </text>
            )}
          </g>
        )
      })}

      {targetLine != null && targetLine <= max && (
        <g>
          <line x1={P.l} y1={Y(targetLine)} x2={w - P.r} y2={Y(targetLine)}
                stroke="var(--c-bad)" strokeWidth={1.2} strokeDasharray="5 4" />
          {/* The caption used to sit on the line at the right edge, where it
              landed on top of the last bar's value label. It now lives above the
              plot area, which no bar and no value label can reach. */}
          <line x1={P.l} y1={P.t - 13} x2={P.l + 16} y2={P.t - 13}
                stroke="var(--c-bad)" strokeWidth={1.2} strokeDasharray="5 4" />
          <text x={P.l + 22} y={P.t - 9} textAnchor="start" fontSize={11} fill="var(--c-bad)">
            Target {lowerBetter ? '≤ ' : '≥ '}{targetLine.toFixed(2)}%
          </text>
        </g>
      )}
    </svg>
  )
}

/* -------------------------------------------------- horizontal bar chart */

export interface HBar {
  name: string
  sub?: string
  value: number
  /** printed at the end of the bar instead of `value` as a percentage — the
   *  ranking can be a count ("6 / 8"), which a `%` suffix would misdescribe */
  label?: string
  /** forces the bar's colour when there is no target line to judge it against */
  bad?: boolean
}

/**
 * Ranked bars laid out horizontally.
 *
 * Drop-point names are long (`SERUA_INDAH_CIPUTAT`, `CP_TANGKUBAN_PERAHU`) and a
 * vertical bar chart can only show them rotated or truncated. Turning the axis
 * on its side gives each label a full readable line and makes the ranking read
 * top-to-bottom, which is how a "top five" is read anyway.
 *
 * The value axis starts at the *smallest* bar rather than at zero: five drop
 * points that all sit between 94% and 98% are otherwise five identical-looking
 * blocks. `floor` keeps the target line inside the frame when it is close by.
 */
interface HBarProps {
  bars: HBar[]
  targetLine?: number | null
  lowerBetter?: boolean
  w?: number
  rowH?: number
}

/**
 * This one keeps its proportions and only narrows: its height already comes from
 * the row count, so it was never the flat smear the other two were. Dropping the
 * width from 560 to 400 lifts the render scale from roughly 0.64 to 0.9, which is
 * the difference between 8px axis type and 11px.
 */
export function HBarChart(props: HBarProps) {
  return (
    <Responsive>
      {(narrow) => <HBarChartSvg {...props} w={narrow ? 440 : props.w ?? 560} />}
    </Responsive>
  )
}

function HBarChartSvg({
  bars, targetLine, lowerBetter = false, w = 560, rowH = 30,
}: HBarProps) {
  if (!bars.length) return EMPTY

  const P = { t: 8, r: 62, b: 22, l: 176 }
  const h = P.t + P.b + bars.length * rowH
  const vals = bars.map((b) => b.value)

  let lo = Math.min(...vals, targetLine ?? Infinity)
  let hi = Math.max(...vals, targetLine ?? -Infinity)
  const span = hi - lo
  lo = Math.max(0, lo - (span > 0 ? span * 0.25 : Math.max(2, Math.abs(lo) * 0.05)))
  hi = hi + (span > 0 ? span * 0.12 : Math.max(2, Math.abs(hi) * 0.05) )
  if (hi - lo < 0.5) hi = lo + 1

  const plot = w - P.l - P.r
  const X = (v: number) => P.l + ((v - lo) / (hi - lo)) * plot

  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {bars.map((b, i) => {
        const y = P.t + i * rowH
        const cy = y + rowH / 2
        const ok = b.bad != null
          ? !b.bad
          : targetLine == null ? true : lowerBetter ? b.value <= targetLine : b.value >= targetLine
        const x = X(b.value)
        return (
          <g key={`${b.name}-${i}`}>
            <line x1={P.l} y1={y + rowH - 0.5} x2={w - P.r} y2={y + rowH - 0.5} stroke="var(--c-grid)" />
            <text x={P.l - 10} y={b.sub ? cy - 2 : cy + 4} textAnchor="end" fontSize={11.5} fill="var(--c-axis)" fontWeight={500}>
              {clip(b.name, 24)}
            </text>
            {b.sub && (
              <text x={P.l - 10} y={cy + 10} textAnchor="end" fontSize={9.5} fill="var(--c-axis-2)">
                {clip(b.sub, 28)}
              </text>
            )}
            <rect
              x={P.l} y={cy - 7} width={Math.max(2, x - P.l)} height={14} rx={3}
              fill={ok ? 'var(--c-ok)' : 'var(--c-bad)'}
            />
            <text x={x + 7} y={cy + 4} fontSize={11.5} fontWeight={500} fill={ok ? 'var(--c-ok-ink)' : 'var(--c-bad-ink)'}>
              {b.label ?? `${b.value.toFixed(2)}%`}
            </text>
          </g>
        )
      })}

      {targetLine != null && targetLine >= lo && targetLine <= hi && (
        <g>
          <line
            x1={X(targetLine)} y1={P.t} x2={X(targetLine)} y2={h - P.b}
            stroke="var(--c-bad)" strokeWidth={1.2} strokeDasharray="5 4"
          />
          <text x={X(targetLine)} y={h - P.b + 14} textAnchor="middle" fontSize={10.5} fill="var(--c-bad)">
            Target {lowerBetter ? '≤ ' : '≥ '}{targetLine.toFixed(2)}%
          </text>
        </g>
      )}
    </svg>
  )
}

/* ------------------------------------------------------------- sparkline */

export function Sparkline({ values, color }: { values: (number | null)[]; color: string }) {
  const real = values.filter((v): v is number => v != null)
  if (real.length < 2) return <div className="spark" />

  const W = 100, H = 28
  const min = Math.min(...real)
  const max = Math.max(...real) - min < 1e-9 ? min + 1 : Math.max(...real)
  const n = values.length

  const pts = values
    .map((v, i) => (v == null ? null : `${(n === 1 ? W / 2 : (i * W) / (n - 1)).toFixed(1)},${(3 + ((max - v) / (max - min)) * (H - 6)).toFixed(1)}`))
    .filter((p): p is string => p != null)

  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <polyline fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" points={pts.join(' ')} />
    </svg>
  )
}