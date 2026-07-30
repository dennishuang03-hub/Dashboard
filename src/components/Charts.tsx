/** Dependency-free SVG charts (no chart library needed). */

export interface AxisLabel { top: string; sub?: string }
export interface Series { name: string; color: string; values: (number | null)[] }

const EMPTY = <div className="empty-mini">Tidak ada data untuk pilihan ini</div>

/* ------------------------------------------------------------ line chart */

/**
 * A note on sizing: both charts render at `width:100%` and scale by their
 * viewBox, so `w` and `h` are a *ratio*, not a pixel size. Shrinking `h` alone
 * makes the chart shorter on screen while every font, bar and dot keeps exactly
 * the size it had — which is what "smaller but still readable" needs. Lowering
 * the font sizes instead would have been the wrong lever.
 */
export function LineChart({
  series, labels, targetLine, clamp01 = true, w = 1100, h = 300,
}: {
  series: Series[]
  labels: AxisLabel[]
  targetLine?: number | null
  clamp01?: boolean
  w?: number
  h?: number
}) {
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
          <line x1={P.l} y1={Y(v)} x2={w - P.r} y2={Y(v)} stroke="#EDF0F5" strokeWidth={1} />
          <text x={P.l - 9} y={Y(v) + 4} textAnchor="end" fontSize={12} fill="#8A94A6">
            {v.toFixed(0)}%
          </text>
        </g>
      ))}

      {labels.map((l, i) => (
        <g key={`x${i}`}>
          <text x={X(i)} y={h - P.b + 20} textAnchor="middle" fontSize={13} fill="#5A6474">{l.top}</text>
          {l.sub && (
            <text x={X(i)} y={h - P.b + 36} textAnchor="middle" fontSize={11} fill="#A6AEBD">{l.sub}</text>
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
              <circle key={i} cx={p.x} cy={p.y} r={4} fill="#fff" stroke={s.color} strokeWidth={2.5} />
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
              stroke="#fff" strokeWidth={3.5} paintOrder="stroke" strokeLinejoin="round"
            >
              {o.v.toFixed(2)}%
            </text>
          ))}
        </g>
      ))}

      {targetLine != null && targetLine >= min && targetLine <= max && (
        <g>
          <line x1={P.l} y1={Y(targetLine)} x2={w - P.r} y2={Y(targetLine)}
                stroke="#E2231A" strokeWidth={1.2} strokeDasharray="5 4" />
          <text x={w - P.r} y={Y(targetLine) - 6} textAnchor="end" fontSize={11} fill="#E2231A">
            Target {targetLine.toFixed(2)}%
          </text>
        </g>
      )}
    </svg>
  )
}

/* ------------------------------------------------------------- bar chart */

export function BarChart({
  values, labels, targetLine, lowerBetter = false, w = 560, h = 240,
}: {
  values: (number | null)[]
  labels: AxisLabel[]
  targetLine?: number | null
  lowerBetter?: boolean
  w?: number
  h?: number
}) {
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
          <line x1={P.l} y1={Y(v)} x2={w - P.r} y2={Y(v)} stroke="#EDF0F5" />
          <text x={P.l - 8} y={Y(v) + 4} textAnchor="end" fontSize={12} fill="#8A94A6">
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
                  fill={ok ? '#00A650' : '#E2231A'}
                />
                <text
                  x={cx} y={Y(val) - 7} textAnchor="middle" fontSize={12} fontWeight={500}
                  fill="#3B4453" stroke="#fff" strokeWidth={3.5} paintOrder="stroke" strokeLinejoin="round"
                >
                  {val.toFixed(2)}%
                </text>
              </>
            )}
            <text x={cx} y={h - P.b + 20} textAnchor="middle" fontSize={13} fill="#5A6474">
              {lab.top}
            </text>
            {lab.sub && (
              <text x={cx} y={h - P.b + 36} textAnchor="middle" fontSize={11} fill="#A6AEBD">
                {lab.sub}
              </text>
            )}
          </g>
        )
      })}

      {targetLine != null && targetLine <= max && (
        <g>
          <line x1={P.l} y1={Y(targetLine)} x2={w - P.r} y2={Y(targetLine)}
                stroke="#E2231A" strokeWidth={1.2} strokeDasharray="5 4" />
          {/* The caption used to sit on the line at the right edge, where it
              landed on top of the last bar's value label. It now lives above the
              plot area, which no bar and no value label can reach. */}
          <line x1={P.l} y1={P.t - 13} x2={P.l + 16} y2={P.t - 13}
                stroke="#E2231A" strokeWidth={1.2} strokeDasharray="5 4" />
          <text x={P.l + 22} y={P.t - 9} textAnchor="start" fontSize={11} fill="#E2231A">
            Target {lowerBetter ? '≤ ' : '≥ '}{targetLine.toFixed(2)}%
          </text>
        </g>
      )}
    </svg>
  )
}

/* -------------------------------------------------- horizontal bar chart */

export interface HBar { name: string; sub?: string; value: number }

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
export function HBarChart({
  bars, targetLine, lowerBetter = false, w = 560, rowH = 30,
}: {
  bars: HBar[]
  targetLine?: number | null
  lowerBetter?: boolean
  w?: number
  rowH?: number
}) {
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
        const ok = targetLine == null ? true : lowerBetter ? b.value <= targetLine : b.value >= targetLine
        const x = X(b.value)
        return (
          <g key={`${b.name}-${i}`}>
            <line x1={P.l} y1={y + rowH - 0.5} x2={w - P.r} y2={y + rowH - 0.5} stroke="#F2F4F8" />
            <text x={P.l - 10} y={b.sub ? cy - 2 : cy + 4} textAnchor="end" fontSize={11.5} fill="#3B4453" fontWeight={500}>
              {clip(b.name, 24)}
            </text>
            {b.sub && (
              <text x={P.l - 10} y={cy + 10} textAnchor="end" fontSize={9.5} fill="#A6AEBD">
                {clip(b.sub, 28)}
              </text>
            )}
            <rect
              x={P.l} y={cy - 7} width={Math.max(2, x - P.l)} height={14} rx={3}
              fill={ok ? '#3FB37A' : '#E2231A'}
            />
            <text x={x + 7} y={cy + 4} fontSize={11.5} fontWeight={500} fill={ok ? '#2A7A52' : '#B81810'}>
              {b.value.toFixed(2)}%
            </text>
          </g>
        )
      })}

      {targetLine != null && targetLine >= lo && targetLine <= hi && (
        <g>
          <line
            x1={X(targetLine)} y1={P.t} x2={X(targetLine)} y2={h - P.b}
            stroke="#E2231A" strokeWidth={1.2} strokeDasharray="5 4"
          />
          <text x={X(targetLine)} y={h - P.b + 14} textAnchor="middle" fontSize={10.5} fill="#E2231A">
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