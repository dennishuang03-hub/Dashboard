import { useCallback, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  BAR_CHOICES, CATEGORY_ZH, PALETTE, STATUS_COLOR, averageRows, dayName, explain, fmtDate, fmtDateFull,
  iconFor, exportPng, isoDay, kpiSeries, parseWorkbook, pct, readWorkbook, resolveDpDate,
  statusOf, targetFor,
} from './lib/jnt'
import type { AgentRow, DateSlot, Explanation, Kpi, Model, Status } from './lib/jnt'
import { BarChart, LineChart, Sparkline } from './components/Charts'
import type { AxisLabel } from './components/Charts'
import DpSection from './components/DpSection'
import Zh from './components/Zh'
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
  const [barKey, setBarKey] = useState('')
  const [hot, setHot] = useState(false)
  const [tick, force] = useState(0)      // Kpi objects are edited in place

  const fileRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
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
        setBarKey('')
        setDateIdx(Math.max(0, mdl.dates.length - 1))
        setErr('')
      } catch (ex) {
        setModel(null)
        setErr((ex as Error).message)
      }
    }
    reader.onerror = () => setErr('Browser menolak membuka file ini.')
    reader.readAsArrayBuffer(f)
  }, [])

  const picker = (
    <input
      ref={fileRef} type="file" hidden accept=".xlsx,.xls,.xlsm,.csv"
      onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = '' }}
    />
  )

  /* ------------------------------------------------------- derived data */

  const current = useMemo(() => {
    if (!model) return null
    if (agentKey !== 'TOTAL') {
      const hit = model.rows.find((r) => r.key === agentKey)
      if (hit) return { rec: hit, label: hit.label, sub: hit.code || model.region, count: 1 }
    }
    if (model.totalRow) {
      return {
        rec: model.totalRow, label: 'SEMUA AGEN (TOTAL)',
        sub: `${model.rows.length} agen`, count: model.rows.length,
      }
    }
    return {
      rec: averageRows(model.rows, 'RATA-RATA', model.region),
      label: 'SEMUA AGEN (RATA-RATA)',
      sub: `${model.rows.length} agen`,
      count: model.rows.length,
    }
  }, [model, agentKey])

  // `tick` is the invalidation signal — Kpi objects are edited in place.
  const kpis = useMemo(() => model?.kpis.filter((k) => k.enabled) ?? [], [model, tick])

  /**
   * The three KPIs the bar chart can show. They are looked up by label rather
   * than by index so a workbook that omits one of them simply offers fewer
   * choices instead of pointing the chart at the wrong column.
   */
  const barChoices = useMemo<Kpi[]>(() => {
    if (!model) return []
    const out: Kpi[] = []
    for (const label of BAR_CHOICES) {
      const hit = model.kpis.find((k) => k.label === label && k.enabled)
      if (hit) out.push(hit)
    }
    // an unfamiliar workbook may carry none of the three — show what it does have
    return out.length ? out : kpis.slice(0, 3)
  }, [model, kpis])

  // resolved, not stored: a newly loaded file falls back to the first choice
  // on its own instead of pointing at a KPI that no longer exists
  const barK: Kpi | null = barChoices.find((k) => k.key === barKey) ?? barChoices[0] ?? null

  /* The dashboard shot deliberately stops above the DP/CP section — that list
     has its own Simpan PNG button, because the two are read separately. */
  const savePng = async () => {
    if (!wrapRef.current) return
    const d = model?.dates[dateIdx]
    const stamp = d?.date ? isoDay(d.date) : 'export'
    try {
      await exportPng(wrapRef.current, `jnt-dashboard-${stamp}.png`, 'shoot-main')
    } catch (ex) {
      setErr((ex as Error).message)
    }
  }

  /* -------------------------------------------------------- empty state */

  if (!model || !current) {
    return (
      <div className="wrap">
        <TopBar meta="Unggah file Excel Anda untuk memulai — tidak ada data yang disimpan." />
        {err && <div className="err"><b>File tersebut tidak dapat dibaca.</b><br />{err}</div>}
        <div
          className={`dropzone${hot ? ' hot' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setHot(true) }}
          onDragLeave={() => setHot(false)}
          onDrop={(e) => { e.preventDefault(); setHot(false); handleFile(e.dataTransfer.files?.[0]) }}
        >
          <h2>Letakkan laporan Excel J&amp;T Anda di sini <Zh>请拖入报表文件</Zh></h2>
          <p>
            File dibaca <b>sepenuhnya di browser Anda</b> — tidak ada yang diunggah, dikirim, atau
            disimpan. Tutup tab ini dan datanya hilang.<br />
            <b>Semua sheet dibaca dan digabungkan otomatis</b>, sehingga workbook yang memisahkan
            kategori ke beberapa tab (Pickup &amp; Retur, 6.30/7.30/12.00, R-2/TPTW/TTD …) tetap
            menghasilkan satu dashboard gabungan per agen. Tab per agen (AG12, AG13 …) dibaca
            terpisah sebagai data DP/CP.
          </p>
          <button className="btn primary" onClick={() => fileRef.current?.click()}>Pilih file…</button>
          {picker}
          <div className="lock">Didukung: .xlsx · .xlsm · .xls · .csv</div>
        </div>
      </div>
    )
  }

  /* ------------------------------------------------------------- render */

  const dates = model.dates
  const di = Math.max(0, Math.min(dateIdx, dates.length - 1))
  const dToday = dates[di]
  const dPrev = di > 0 ? dates[di - 1] : null
  const todayLabel = dToday.date ? fmtDateFull(dToday.date) : `Hari ${di + 1}`

  const axisLabels: AxisLabel[] = dates.map((d, i) =>
    d.date ? { top: fmtDate(d.date), sub: dayName(d.date) } : { top: `Hari ${i + 1}` })
  const prevAxisLabel = dPrev ? (dPrev.date ? fmtDate(dPrev.date) : `hari ${di}`) : 'hari sebelumnya'

  const trendKpis = kpis.filter((k) => k.inTrend)

  /* The DP tabs carry fewer days than the agent tabs, so the section shows the
     closest day it actually has rather than going blank — see `resolveDpDate`. */
  const dpDay = resolveDpDate(model.dpDates, dToday)

  const okSheets = model.sheets.filter((s) => s.ok && s.kind === 'agent')
  const dpSheets = model.sheets.filter((s) => s.ok && s.kind === 'dp')
  const badSheets = model.sheets.filter((s) => !s.ok)

  return (
    <div className="wrap" ref={wrapRef}>
      <TopBar
        meta={
          <>Wilayah: <b>{model.region}</b> &nbsp;|&nbsp; Agen: <b>{current.label}</b>
            &nbsp;|&nbsp; Tanggal: <b>{todayLabel}</b>
            &nbsp;|&nbsp; Sumber: <b>{fileName}</b> ({okSheets.length} sheet)</>
        }
      />

      {/* -------- toolbar -------- */}
      <div className="toolbar">
        <button className="btn primary" onClick={() => fileRef.current?.click()}>Unggah Excel</button>
        {picker}
        <Field label="Tanggal laporan · 报表日期">
          <select value={di} onChange={(e) => setDateIdx(Number(e.target.value))}>
            {dates.map((d, i) => (
              <option key={d.key} value={i}>
                {d.date ? `${fmtDateFull(d.date)} (${dayName(d.date)})` : `Hari ${i + 1}`}
                {i === dates.length - 1 ? ' — terbaru' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Agen · 代理区 — ${model.region}`}>
          <select className="agentsel" value={agentKey} onChange={(e) => setAgentKey(e.target.value)}>
            <option value="TOTAL">SEMUA AGEN ({model.rows.length})</option>
            {model.rows.map((r) => (
              <option key={r.key} value={r.key}>{r.label}{r.code ? ` · ${r.code}` : ''}</option>
            ))}
          </select>
        </Field>
        <div className="spacer" />
        <span className="filechip">
          {model.region} · {model.rows.length} agen · {kpis.length} KPI · {dates.length} hari
          {model.dps.length > 0 && ` · ${model.dps.length} DP/CP dari ${dpSheets.length} tab agen`}
        </span>
        <button className="btn" onClick={savePng}>Simpan PNG</button>
        <button className="btn" onClick={() => window.print()}>Cetak / PDF</button>
        <button className="btn" onClick={() => { setModel(null); setFileName(''); setErr('') }}>Hapus data</button>
      </div>

      {err && <div className="err">{err}</div>}

      {badSheets.length > 0 && (
        <div className="warnbox">
          {badSheets.length} sheet dilewati:{' '}
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
              <div className="kname">{k.label}<Zh>{CATEGORY_ZH[k.label] ?? ''}</Zh></div>
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
        <Panel title={<>Tren KPI ({dates.length} hari) <Zh>KPI趋势</Zh></>}>
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
        <Panel title={<>Ringkasan KPI (Hari Terpilih) <Zh>KPI汇总</Zh></>} red flush>
          <table>
            <thead>
              <tr>
                <th>KPI<Zh>指标</Zh></th>
                <th className="num">Nilai<Zh>数值</Zh></th>
                <th className="num">Target<Zh>目标</Zh></th>
                <th className="ctr">Status<Zh>状态</Zh></th>
              </tr>
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

        <Panel
          title={<>Perbandingan Harian ({dates.length} hari) <Zh>每日对比</Zh></>}
          right={barChoices.length > 1 && (
            <select
              className="hsel" value={barK ? barK.key : ''} aria-label="KPI yang ditampilkan pada grafik batang"
              onChange={(e) => setBarKey(e.target.value)}
            >
              {barChoices.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          )}
        >
          {barK
            ? <BarChart
                values={kpiSeries(barK, current.rec, dates)}
                labels={axisLabels}
                targetLine={targetFor(barK, current.rec)}
                lowerBetter={barK.lowerBetter}
              />
            : <div className="empty-mini">Tidak ada KPI yang tersedia</div>}
        </Panel>
      </div>

      {/* -------- bottom row -------- */}
      <div className="row-bot">
        <Panel title={<>Detail KPI (Hari Ini vs Hari Sebelumnya) <Zh>KPI明细</Zh></>} flush>
          <table>
            <thead>
              <tr>
                <th>KPI<Zh>指标</Zh></th>
                <th className="num">
                  Hari Ini ({dToday.date ? fmtDate(dToday.date) : `H${di + 1}`})<Zh>今日</Zh>
                </th>
                <th className="num">
                  {dPrev ? `Sebelumnya (${dPrev.date ? fmtDate(dPrev.date) : `H${di}`})` : 'Sebelumnya'}
                  <Zh>前一日</Zh>
                </th>
                <th className="num">Selisih<Zh>差异</Zh></th>
                <th className="num">Bulanan<Zh>月度达成</Zh></th>
                <th className="ctr">Status<Zh>状态</Zh></th>
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
                    <td className="num">{pct(v)}</td>
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

        <Panel title={<>Ringkasan Hari Ini <Zh>今日总结</Zh></>}>
          <SummaryPanel kpis={kpis} rec={current.rec} dates={dates} di={di}
                        sub={current.sub} count={current.count} />
        </Panel>
      </div>

      {dpDay && (
        <DpSection
          model={model} kpis={kpis} agentKey={agentKey}
          agentLabel={current.label} day={dpDay} wanted={dToday} onError={setErr}
        />
      )}

      <div className="note">
        Data hanya diproses di memori. Menyegarkan halaman atau menekan “Hapus data” akan menghilangkan
        semuanya — tidak ada yang ditulis ke disk maupun dikirim melalui jaringan.
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ sub-views */

/**
 * The J&T Express wordmark, drawn inline as SVG.
 *
 * Inline rather than an <img>: it stays sharp at every zoom level, it survives
 * the html2canvas snapshot and the print sheet without a CORS or missing-file
 * risk, and the viewBox is cropped tight to the letters so the red plate has no
 * dead margin around it.
 */
function JntLogo() {
  const FONT = "'Arial Black','Arial Bold','Helvetica Neue',Arial,sans-serif"
  return (
    <svg className="jtlogo" viewBox="0 0 262 58" role="img" aria-label="J&T Express">
      <g fill="#fff" transform="skewX(-11)">
        {/* kept on one line: SVG would otherwise fold the surrounding JSX
            indentation into a leading space and nudge the glyphs right */}
        <text x="24" y="46" fontFamily={FONT} fontSize="48" fontWeight="900" letterSpacing="-1.5">J&amp;T</text>
        <text x="132" y="46" fontFamily={FONT} fontSize="26" fontWeight="900" letterSpacing="0.5">EXPRESS</text>
        {/* speed lines: they meet the top-right of the T and fan out to the
            right, matching the swoosh on the printed mark */}
        <rect x="118" y="2" width="52" height="5" />
        <rect x="124" y="10" width="46" height="5" />
        <rect x="130" y="18" width="40" height="5" />
      </g>
    </svg>
  )
}

function TopBar({ meta, right }: { meta: ReactNode; right?: ReactNode }) {
  return (
    <div className="topbar">
      <div className="logo"><JntLogo /></div>
      <div className="titleblock">
        <h1>DASHBOARD PERFORMA AGEN HARIAN <Zh>每日代理区绩效看板</Zh></h1>
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
  title, children, red, flush, className, right,
}: {
  /** ReactNode rather than string, so a title can carry its `<Zh>` gloss */
  title: ReactNode; children: ReactNode
  red?: boolean; flush?: boolean; className?: string
  /** control rendered at the right end of the header, e.g. a KPI switcher */
  right?: ReactNode
}) {
  return (
    <div className={`panel${red ? ' red' : ''}${className ? ' ' + className : ''}`}>
      <h3><span className="ptitle">{title}</span>{right}</h3>
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
    ratio >= 0.85 ? ['Sangat Baik', 'good'] :
    ratio >= 0.6 ? ['Baik', 'good'] :
    ratio >= 0.4 ? ['Cukup', 'fair'] : ['Perlu Perhatian', 'poor']

  return (
    <div className="sumlist">
      <Item ico="📊" lab="Performa Keseluruhan" zh="整体表现" strong={verdict} tone={tone}
            detail={`${on.length} KPI sesuai target / ${off.length} di bawah target${count > 1 ? ` • ${sub}` : ''}`} />
      <Item ico="⭐" lab="KPI Terbaik" zh="最佳指标" strong={best ? best.k.label : '—'} tone="good"
            detail={best ? `${pct(best.v)} terhadap target ${pct(best.t)}` : ''} />
      <Item ico="⚠️" lab="Perlu Perhatian" zh="需关注" tone={off.length ? 'poor' : 'good'}
            strong={off.length ? `${off.length} KPI di bawah target` : 'Tidak ada'}
            detail={off.length ? off.map((k) => k.label).join(', ') : 'Semua KPI sesuai target'} />
      <Item ico="👥" lab="Tindak Lanjut" zh="后续行动" strong="Prioritas" tone=""
            detail={off.length ? nextAction(off) : 'Pertahankan performa saat ini dan jaga disiplin briefing harian.'} />
    </div>
  )
}

function Item({ ico, lab, zh, strong, detail, tone }: {
  ico: string; lab: string; zh: string; strong: string; detail: string; tone: string
}) {
  return (
    <div className="sumitem">
      <div className="ico">{ico}</div>
      <div className="lab">{lab}<Zh>{zh}</Zh></div>
      <div className={`val ${tone}`}><span className="strong">{strong}</span>{detail}</div>
    </div>
  )
}

/* ----------------------------------------------------------- small utils */

function nextAction(off: Kpi[]): string {
  const tips = off.map((k) => {
    const l = k.label
    if (/absensi|kehadiran/i.test(l)) return 'perketat kehadiran sprinter sebelum 06:30'
    if (/gudang/i.test(l)) return 'percepat sortir agar armada keluar gudang sebelum 07:30'
    if (/12:00|1200/i.test(l)) return 'dorong pengiriman ritase pertama agar TTD sebelum jam 12:00'
    if (/ritase 2/i.test(l)) return 'perkuat dispatch dan tindak lanjut ritase kedua'
    if (/tptw|on time/i.test(l)) return 'tinjau ketepatan waktu serah terima di drop point'
    if (/retur|return/i.test(l)) return 'tekan retur COD dengan konfirmasi telepon sebelum pengantaran'
    if (/pickup|otpu/i.test(l)) return 'perbaiki rute penjemputan tepat waktu untuk shipper non-ecommerce'
    if (/full day|persentase ttd/i.test(l)) return 'tingkatkan capaian TTD seharian di kedua ritase'
    return `tinjau ${l.toLowerCase()}`
  })
  const s = [...new Set(tips)].slice(0, 3).join('; ') + '.'
  return s.charAt(0).toUpperCase() + s.slice(1)
}