/** Dependency-free SVG charts (no chart library needed). */

export interface AxisLabel { top: string; sub?: string }
export interface Series { name: string; color: string; values: (number | null)[] }

const EMPTY = <div className="empty-mini">No data for this selection</div>

/* ------------------------------------------------------------ line chart */

export function LineChart({
  series, labels, targetLine, clamp01 = true, w = 1100, h = 400,
}: {
  series: Series[]
  labels: AxisLabel[]
  targetLine?: number | null
  clamp01?: boolean
  w?: number
  h?: number
}) {
  const P = { t: 30, r: 54, b: 52, l: 54 }
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null))
  if (!all.length || !labels.length) return EMPTY

  let min = Math.min(...all)
  let max = Math.max(...all)
  const span = max - min
  const pad = span > 0 ? span * 0.3 : Math.max(1, Math.abs(max) * 0.05)
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
              fontSize={12} fontWeight={700} fill={o.color}
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
  values, labels, targetLine, lowerBetter = false, w = 440, h = 262,
}: {
  values: (number | null)[]
  labels: AxisLabel[]
  targetLine?: number | null
  lowerBetter?: boolean
  w?: number
  h?: number
}) {
  const P = { t: 26, r: 12, b: 44, l: 44 }
  const real = values.filter((v): v is number => v != null)
  if (!real.length) return EMPTY

  let max = Math.max(...real)
  if (targetLine != null) max = Math.max(max, targetLine)
  max = max * 1.35 || 1

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
          <text x={P.l - 6} y={Y(v) + 3.5} textAnchor="end" fontSize={9.5} fill="#8A94A6">
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
                <text x={cx} y={Y(val) - 6} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#3B4453">
                  {val.toFixed(2)}%
                </text>
              </>
            )}
            <text x={cx} y={h - P.b + 15} textAnchor="middle" fontSize={9.5} fill="#5A6474">
              {lab.top}
            </text>
            {lab.sub && (
              <text x={cx} y={h - P.b + 27} textAnchor="middle" fontSize={9} fill="#A6AEBD">
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
          <text x={w - P.r} y={Y(targetLine) - 5} textAnchor="end" fontSize={9} fill="#E2231A">
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