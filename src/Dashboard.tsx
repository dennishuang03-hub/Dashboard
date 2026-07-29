import { useCallback, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  PALETTE, STATUS_COLOR, averageRows, dayName, explain, fmtDate, fmtDateFull, iconFor,
  kpiSeries, latin, parseWorkbook, pct, readWorkbook, shortLabel, statusOf, targetFor,
} from './lib/jnt'
import type { AgentRow, DateSlot, Explanation, Kpi, Model, Status } from './lib/jnt'
import { BarChart, LineChart, Sparkline } from './components/Charts'
import type { AxisLabel } from './components/Charts'
import './dashboard.css'

/* --------------------------------------------------------------- helpers */

function Badge({ st }: { st: Status }) {
  if (st === 'ok') return <span className="badge ok">✓</span>
  if (st === 'warn') return <span className="badge warn">!</span>
  if (st === 'bad') return <span className="badge bad">×</span>
  return <span className="muted">—</span>
}

/** Animated hover panel explaining why a KPI is green or red. */
function TipBox({ ex, placement }: { ex: Explanation; placement: 'below' | 'left' }) {
  return (
    <div className={`tipbox tip-${placement}`} role="tooltip">
      <strong className={`tiptitle ${ex.tone}`}>
        {ex.tone === 'ok' ? '✓ ' : ex.tone === 'bad' ? '⚠ ' : ''}{ex.title}
      </strong>
      {ex.lines.map((l, i) => <span className="tipline" key={i}>{l}</span>)}
    </div>
  )
}

function Delta({ diff, lowerBetter }: { diff: number | null; lowerBetter: boolean }) {
  if (diff == null) return <span className="flat">—</span>
  const flat = Math.abs(diff) < 0.005
  const good = lowerBetter ? diff < 0 : diff > 0
  const cls = flat ? 'flat' : good ? 'up' : 'down'
  const arrow = flat ? '▬ ' : diff > 0 ? '▲ ' : '▼ '
  return <span className={cls}>{arrow}{diff > 0 ? '+' : ''}{diff.toFixed(2)}</span>
}

/* ------------------------------------------------------------- component */

export default function Dashboard() {
  const [model, setModel] = useState<Model | null>(null)
  const [fileName, setFileName] = useState('')
  const [err, setErr] = useState('')
  const [agentKey, setAgentKey] = useState('TOTAL')
  const [dateIdx, setDateIdx] = useState(0)
  const [query, setQuery] = useState('')
  const [showMap, setShowMap] = useState(false)
  const [hot, setHot] = useState(false)
  const [tick, force] = useState(0)      // Kpi objects are edited in place

  const fileRef = useRef<HTMLInputElement>(null)
  const rerender = () => force((n) => n + 1)

  /* ------------------------------------------------------------ loading */

  const handleFile = useCallback((f: File | undefined | null) => {
    if (!f) return
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = readWorkbook(e.target!.result as ArrayBuffer)
        const mdl = parseWorkbook(wb)
        setModel(mdl)
        setFileName(f.name)
        setAgentKey('TOTAL')
        setQuery('')
        setDateIdx(Math.max(0, mdl.dates.length - 1))
        setErr('')
      } catch (ex) {
        setModel(null)
        setErr((ex as Error).message)
      }
    }
    reader.onerror = () => setErr('The browser refused to open this file.')
    reader.readAsArrayBuffer(f)
  }, [])

  const picker = (
    <input
      ref={fileRef} type="file" hidden accept=".xlsx,.xls,.xlsm,.csv"
      onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = '' }}
    />
  )

  /* ------------------------------------------------------- derived data */

  const visibleAgents = useMemo<AgentRow[]>(() => {
    if (!model) return []
    const q = query.trim().toLowerCase()
    if (!q) return model.rows
    return model.rows.filter((r) =>
      r.label.toLowerCase().includes(q) || r.code.toLowerCase().includes(q))
  }, [model, query])

  const current = useMemo(() => {
    if (!model) return null
    if (agentKey !== 'TOTAL') {
      const hit = model.rows.find((r) => r.key === agentKey)
      if (hit) return { rec: hit, label: hit.label, sub: hit.code || model.region, count: 1 }
    }
    if (!query.trim() && model.totalRow) {
      return {
        rec: model.totalRow, label: 'ALL AGENTS (TOTAL)',
        sub: `${model.rows.length} agents`, count: model.rows.length,
      }
    }
    return {
      rec: averageRows(visibleAgents, 'AVERAGE', model.region),
      label: 'ALL AGENTS (AVERAGE)',
      sub: `${visibleAgents.length} agents`,
      count: visibleAgents.length,
    }
  }, [model, agentKey, query, visibleAgents])

  // `tick` is the invalidation signal — Kpi objects are edited in place.
  const kpis = useMemo(() => model?.kpis.filter((k) => k.enabled) ?? [], [model, tick])

  /* -------------------------------------------------------- empty state */

  if (!model || !current) {
    return (
      <div className="wrap">
        <TopBar meta="Upload your Excel file to begin — no data is stored." />
        {err && <div className="err"><b>Could not read that file.</b><br />{err}</div>}
        <div
          className={`dropzone${hot ? ' hot' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setHot(true) }}
          onDragLeave={() => setHot(false)}
          onDrop={(e) => { e.preventDefault(); setHot(false); handleFile(e.dataTransfer.files?.[0]) }}
        >
          <h2>Drop your J&amp;T Excel report here</h2>
          <p>
            The file is read <b>entirely in your browser</b> — nothing is uploaded, sent, or saved.
            Close the tab and the data is gone.<br />
            <b>Every sheet is read and merged automatically</b>, so a workbook that splits the
            categories across tabs (Pickup &amp; Retur, 6.30/7.30/12.00, R-2/TPTW/TTD …) produces one
            combined dashboard per agent.
          </p>
          <button className="btn primary" onClick={() => fileRef.current?.click()}>Choose file…</button>
          {picker}
          <div className="lock">Supported: .xlsx · .xlsm · .xls · .csv</div>
        </div>
      </div>
    )
  }

  /* ------------------------------------------------------------- render */

  const dates = model.dates
  const di = Math.max(0, Math.min(dateIdx, dates.length - 1))
  const dToday = dates[di]
  const dPrev = di > 0 ? dates[di - 1] : null
  const todayLabel = dToday.date ? fmtDateFull(dToday.date) : `Day ${di + 1}`

  const axisLabels: AxisLabel[] = dates.map((d, i) =>
    d.date ? { top: fmtDate(d.date), sub: dayName(d.date) } : { top: `Day ${i + 1}` })
  const prevAxisLabel = dPrev ? (dPrev.date ? fmtDate(dPrev.date) : `day ${di}`) : 'the previous day'

  const trendKpis = kpis.filter((k) => k.inTrend)

  // bar panel: first lower-is-better KPI, otherwise the weakest one
  let barK: Kpi | null = kpis.find((k) => k.lowerBetter) ?? null
  if (!barK && kpis.length) {
    let worstGap = Infinity
    for (const k of kpis) {
      const v = kpiSeries(k, current.rec, dates)[di]
      if (v == null) continue
      const gap = v - targetFor(k, current.rec)
      if (gap < worstGap) { worstGap = gap; barK = k }
    }
    barK = barK ?? kpis[0]
  }

  const okSheets = model.sheets.filter((s) => s.ok)
  const badSheets = model.sheets.filter((s) => !s.ok)

  return (
    <div className="wrap">
      <TopBar
        meta={
          <>Region: <b>{model.region}</b> &nbsp;|&nbsp; Agent: <b>{current.label}</b>
            &nbsp;|&nbsp; Date: <b>{todayLabel}</b>
            &nbsp;|&nbsp; Source: <b>{fileName}</b> ({okSheets.length} sheet{okSheets.length === 1 ? '' : 's'})</>
        }
        right={
          <div className="agentpick">
            <label>Agent — {model.region}</label>
            <select value={agentKey} onChange={(e) => setAgentKey(e.target.value)}>
              <option value="TOTAL">ALL AGENTS ({model.rows.length})</option>
              {visibleAgents.map((r) => (
                <option key={r.key} value={r.key}>{r.label}{r.code ? ` · ${r.code}` : ''}</option>
              ))}
            </select>
          </div>
        }
      />

      {/* -------- toolbar -------- */}
      <div className="toolbar">
        <button className="btn primary" onClick={() => fileRef.current?.click()}>Upload Excel</button>
        {picker}
        <Field label="Report date">
          <select value={di} onChange={(e) => setDateIdx(Number(e.target.value))}>
            {dates.map((d, i) => (
              <option key={d.key} value={i}>
                {d.date ? `${fmtDateFull(d.date)} (${dayName(d.date)})` : `Day ${i + 1}`}
                {i === dates.length - 1 ? ' — latest' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Search agent / kode">
          <input type="text" placeholder="JAKARTA or AGENT40" value={query}
                 onChange={(e) => setQuery(e.target.value)} />
        </Field>
        <div className="spacer" />
        <span className="filechip">
          {model.region} · {model.rows.length} agents · {kpis.length} KPIs · {dates.length} days
        </span>
        <button className="btn" onClick={() => setShowMap((v) => !v)}>Column mapping</button>
        <button className="btn" onClick={() => window.print()}>Print / PDF</button>
        <button className="btn" onClick={() => { setModel(null); setFileName(''); setErr('') }}>Clear data</button>
      </div>

      {badSheets.length > 0 && (
        <div className="warnbox">
          Skipped {badSheets.length} sheet{badSheets.length === 1 ? '' : 's'}:{' '}
          {badSheets.map((s) => `“${s.name}” (${s.reason})`).join(' · ')}
        </div>
      )}

      {/* -------- KPI cards -------- */}
      <div className="cards">
        {kpis.map((k) => {
          const ki = model.kpis.indexOf(k)
          const series = kpiSeries(k, current.rec, dates)
          const v = series[di]
          const p = dPrev ? series[di - 1] : null
          const tgt = targetFor(k, current.rec)
          const st = statusOf(k, v, tgt)
          const color = STATUS_COLOR[st]
          const mtd = k.monthlyCol ? current.rec.vals[k.monthlyCol] ?? null : null
          const ex = explain(k, v, p, tgt, prevAxisLabel)

          return (
            <div className={`kcard tip st-${st}`} key={k.key} style={{ borderTopColor: color }}>
              <span className="dot" style={{ background: color }} />
              <div className="kname">{k.label}</div>
              <div className="krow">
                <span className="kicon">{iconFor(k.label)}</span>
                <span className="kval" style={{ color: st === 'na' ? '#8A94A6' : color }}>{pct(v)}</span>
              </div>
              <div className="ktgt">Target {k.lowerBetter ? '≤ ' : '≥ '}{pct(tgt)}</div>
              <div className="kmtd">{mtd != null ? `MTD ${pct(mtd)}` : ' '}</div>
              <div className="kcmp">
                <span>Prev {pct(p)}</span>
                <Delta diff={v != null && p != null ? v - p : null} lowerBetter={k.lowerBetter} />
              </div>
              <Sparkline values={series} color={PALETTE[ki % PALETTE.length]} />
              <TipBox ex={ex} placement="below" />
            </div>
          )
        })}
      </div>

      {/* -------- trend, full width -------- */}
      <div className="row-trend">
        <Panel title={`KPI Trend (${dates.length} day${dates.length === 1 ? '' : 's'})`}>
          <div className="legend">
            {kpis.map((k) => (
              <button key={k.key} className={k.inTrend ? '' : 'off'}
                      onClick={() => { k.inTrend = !k.inTrend; rerender() }}>
                <span className="sw" style={{ background: PALETTE[model.kpis.indexOf(k) % PALETTE.length] }} />
                {k.label}
              </button>
            ))}
          </div>
          <LineChart
            labels={axisLabels}
            series={trendKpis.map((k) => ({
              name: k.label,
              color: PALETTE[model.kpis.indexOf(k) % PALETTE.length],
              values: kpiSeries(k, current.rec, dates),
            }))}
          />
        </Panel>
      </div>

      {/* -------- middle row -------- */}
      <div className="row-mid">
        <Panel title="KPI Summary (Selected Day)" red flush>
          <table>
            <thead>
              <tr><th>KPI</th><th className="num">Value</th><th className="num">Target</th><th className="ctr">Status</th></tr>
            </thead>
            <tbody>
              {kpis.map((k) => {
                const s = kpiSeries(k, current.rec, dates)
                const v = s[di]
                const tgt = targetFor(k, current.rec)
                const st = statusOf(k, v, tgt)
                return (
                  <tr key={k.key} className={`st-${st}`}>
                    <td className="kpiname">{k.label}</td>
                    <td className="num">{pct(v)}</td>
                    <td className="num muted">{k.lowerBetter ? '≤ ' : '≥ '}{pct(tgt)}</td>
                    <td className="ctr">
                      <span className="tip">
                        <Badge st={st} />
                        <TipBox ex={explain(k, v, dPrev ? s[di - 1] : null, tgt, prevAxisLabel)} placement="left" />
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Panel>

        <Panel title={barK ? `${barK.label} (${dates.length} day${dates.length === 1 ? '' : 's'})` : 'Trend'}>
          {barK
            ? <BarChart
                values={kpiSeries(barK, current.rec, dates)}
                labels={axisLabels}
                targetLine={targetFor(barK, current.rec)}
                lowerBetter={barK.lowerBetter}
              />
            : <div className="empty-mini">No KPI available</div>}
        </Panel>
      </div>

      {/* -------- bottom row -------- */}
      <div className="row-bot">
        <Panel title="KPI Details (Today vs Previous Day)" flush>
          <table>
            <thead>
              <tr>
                <th>KPI</th>
                <th className="num">Today ({dToday.date ? fmtDate(dToday.date) : `D${di + 1}`})</th>
                <th className="num">{dPrev ? `Prev (${dPrev.date ? fmtDate(dPrev.date) : `D${di}`})` : 'Previous'}</th>
                <th className="num">Difference</th>
                <th className="num">MTD</th>
                <th className="ctr">Status</th>
              </tr>
            </thead>
            <tbody>
              {kpis.map((k) => {
                const s = kpiSeries(k, current.rec, dates)
                const v = s[di]
                const p = dPrev ? s[di - 1] : null
                const mtd = k.monthlyCol ? current.rec.vals[k.monthlyCol] ?? null : null
                const tgt = targetFor(k, current.rec)
                const st = statusOf(k, v, tgt)
                return (
                  <tr key={k.key} className={`st-${st}`}>
                    <td className="kpiname">{k.label}</td>
                    <td className="num"><b>{pct(v)}</b></td>
                    <td className="num muted">{pct(p)}</td>
                    <td className="num"><Delta diff={v != null && p != null ? v - p : null} lowerBetter={k.lowerBetter} /></td>
                    <td className="num muted">{pct(mtd)}</td>
                    <td className="ctr">
                      <span className="tip">
                        <Badge st={st} />
                        <TipBox ex={explain(k, v, p, tgt, prevAxisLabel)} placement="left" />
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Panel>

        <Panel title="Today's Summary">
          <SummaryPanel kpis={kpis} rec={current.rec} dates={dates} di={di}
                        sub={current.sub} count={current.count} />
        </Panel>
      </div>

      {/* -------- mapping -------- */}
      {showMap && (
        <Panel title="Column mapping & targets" flush className="mapping">
          <table>
            <thead>
              <tr>
                <th className="ctr" style={{ width: 40 }}>Show</th>
                <th>Sheet</th>
                <th>Group</th>
                <th>Detected column</th>
                <th style={{ width: 180 }}>Display name</th>
                <th className="ctr" style={{ width: 120 }}>Direction</th>
                <th className="num" style={{ width: 130 }}>Target %</th>
                <th className="ctr" style={{ width: 60 }}>Trend</th>
                <th className="num">Days</th>
              </tr>
            </thead>
            <tbody>
              {model.kpis.map((k, i) => (
                <tr key={k.key}>
                  <td className="ctr">
                    <input type="checkbox" checked={k.enabled}
                           onChange={(e) => { k.enabled = e.target.checked; rerender() }} />
                  </td>
                  <td className="muted">{k.sheets.join(', ')}</td>
                  <td className="muted">{latin(k.group) || '—'}</td>
                  <td title={k.name}>{latin(k.name) || k.name}</td>
                  <td>
                    <input type="text" value={k.label}
                           onChange={(e) => { k.label = e.target.value || shortLabel(k.name, k.group); rerender() }} />
                  </td>
                  <td className="ctr">
                    <select value={k.lowerBetter ? 'lo' : 'hi'}
                            onChange={(e) => { k.lowerBetter = e.target.value === 'lo'; rerender() }}>
                      <option value="hi">≥ higher</option>
                      <option value="lo">≤ lower</option>
                    </select>
                  </td>
                  <td className="num">
                    <input
                      type="number" step="0.01"
                      placeholder={k.targetCol ? 'from file' : String(k.target)}
                      value={k.targetOverride ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value
                        k.targetOverride = raw === '' ? null : (Number.isNaN(parseFloat(raw)) ? null : parseFloat(raw))
                        rerender()
                      }}
                    />
                  </td>
                  <td className="ctr">
                    <input type="checkbox" checked={k.inTrend}
                           style={{ accentColor: PALETTE[i % PALETTE.length] }}
                           onChange={(e) => { k.inTrend = e.target.checked; rerender() }} />
                  </td>
                  <td className="num muted">{k.dateCols.length}{k.monthlyCol ? ' + MTD' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="maphint">
            Leave <b>Target %</b> empty to use the Target column from the file (per agent).
            Type a number to override it for every agent.
          </div>
        </Panel>
      )}

      <div className="note">
        Data is parsed in memory only. Refreshing the page or clicking “Clear data” removes everything —
        nothing is written to disk or sent over the network.
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ sub-views */

function TopBar({ meta, right }: { meta: ReactNode; right?: ReactNode }) {
  return (
    <div className="topbar">
      <div className="logo"><div><div className="jt">J&amp;T</div><div className="ex">EXPRESS</div></div></div>
      <div className="titleblock">
        <h1>DAILY AGENT PERFORMANCE DASHBOARD</h1>
        <div className="meta">{meta}</div>
      </div>
      {right}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="field"><label>{label}</label>{children}</div>
}

function Panel({
  title, children, red, flush, className,
}: {
  title: string; children: ReactNode; red?: boolean; flush?: boolean; className?: string
}) {
  return (
    <div className={`panel${red ? ' red' : ''}${className ? ' ' + className : ''}`}>
      <h3>{title}</h3>
      <div className="body" style={flush ? { padding: 0 } : undefined}>{children}</div>
    </div>
  )
}

function SummaryPanel({
  kpis, rec, dates, di, sub, count,
}: {
  kpis: Kpi[]; rec: AgentRow; dates: DateSlot[]; di: number; sub: string; count: number
}) {
  const on: Kpi[] = [], off: Kpi[] = []
  let best: { k: Kpi; v: number; t: number } | null = null
  let bestScore = -Infinity

  for (const k of kpis) {
    const v = kpiSeries(k, rec, dates)[di]
    if (v == null) continue
    const t = targetFor(k, rec)
    const score = k.lowerBetter ? (t - v) / Math.max(0.01, t) : (v - t) / Math.max(0.01, t)
    if (statusOf(k, v, t) === 'ok') on.push(k); else off.push(k)
    if (score > bestScore) { bestScore = score; best = { k, v, t } }
  }

  const total = on.length + off.length
  const ratio = total ? on.length / total : 0
  const [verdict, tone] =
    ratio >= 0.85 ? ['Excellent', 'good'] :
    ratio >= 0.6 ? ['Good', 'good'] :
    ratio >= 0.4 ? ['Fair', 'fair'] : ['Needs Attention', 'poor']

  return (
    <div className="sumlist">
      <Item ico="📊" lab="Overall Performance" strong={verdict} tone={tone}
            detail={`${on.length} KPI on target / ${off.length} below target${count > 1 ? ` • ${sub}` : ''}`} />
      <Item ico="⭐" lab="Best KPI" strong={best ? best.k.label : '—'} tone="good"
            detail={best ? `${pct(best.v)} vs target ${pct(best.t)}` : ''} />
      <Item ico="⚠️" lab="Needs Attention" tone={off.length ? 'poor' : 'good'}
            strong={off.length ? `${off.length} KPI below target` : 'None'}
            detail={off.length ? off.map((k) => k.label).join(', ') : 'All KPIs are on target'} />
      <Item ico="👥" lab="Next Action" strong="Priority" tone=""
            detail={off.length ? nextAction(off) : 'Maintain current performance and keep the daily briefing discipline.'} />
    </div>
  )
}

function Item({ ico, lab, strong, detail, tone }: {
  ico: string; lab: string; strong: string; detail: string; tone: string
}) {
  return (
    <div className="sumitem">
      <div className="ico">{ico}</div>
      <div className="lab">{lab}</div>
      <div className={`val ${tone}`}><span className="strong">{strong}</span>{detail}</div>
    </div>
  )
}

/* ----------------------------------------------------------- small utils */

function nextAction(off: Kpi[]): string {
  const tips = off.map((k) => {
    const l = k.label
    if (/absensi|kehadiran/i.test(l)) return 'tighten sprinter attendance before 06:30'
    if (/gudang/i.test(l)) return 'speed up sorting so vehicles leave the warehouse by 07:30'
    if (/12:00|1200/i.test(l)) return 'push first-ritase deliveries to be signed before 12:00'
    if (/ritase 2/i.test(l)) return 'reinforce second-ritase dispatch and follow-up'
    if (/tptw|on time/i.test(l)) return 'review handover timing at the drop point'
    if (/retur|return/i.test(l)) return 'reduce COD returns with pre-delivery confirmation calls'
    if (/pickup|otpu/i.test(l)) return 'improve on-time pickup routing for non-ecommerce shippers'
    if (/full day/i.test(l)) return 'lift full-day signature completion across both ritase'
    return `review ${l.toLowerCase()}`
  })
  const s = [...new Set(tips)].slice(0, 3).join('; ') + '.'
  return s.charAt(0).toUpperCase() + s.slice(1)
}