import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  CATEGORY_ZH, KPI_SECTIONS, PALETTE, STATUS_COLOR, agentFull, agentZh, averageRows,
  dayName, explain, fmtDate, fmtDateFull, iconFor, exportPng, isIgnoredSheet, isoDay, kpiSeries,
  parseWorkbook, pct, readSheetNames, readWorkbookSheets, resolveDpDate, statusOf, targetFor,
} from './lib/jnt'
import type { Explanation, Kpi, Model } from './lib/jnt'
import { LineChart, Sparkline } from './components/Charts'
import type { AxisLabel } from './components/Charts'
import BtnIcon from './components/BtnIcon'
import DpSection from './components/DpSection'
import JntLogo from './components/JntLogo'
import Sidebar, { NavButton } from './components/Sidebar'
import type { NavGroup } from './components/Sidebar'
import Zh from './components/Zh'
import type { Identity } from './lib/session'
import type { Theme } from './lib/theme'
import './dashboard.css'

/* ------------------------------------------------------------- navigation */

/**
 * The two reports this page holds, and the shape the rail is built from.
 *
 * A list rather than two buttons in the markup: the next report is an entry
 * here and nothing else. The groups are already named for what is coming —
 * "Performa Operasional" has room under it, and a second group can be added
 * without touching `Sidebar`.
 */
const VIEW_AGEN = 'agen'
const VIEW_DP = 'dp'

type View = typeof VIEW_AGEN | typeof VIEW_DP

/** Below this the rail goes off-canvas and the hamburger appears. */
const DRAWER_BP = 900

/* ------------------------------------------------------- protected workbook */

/**
 * The report no longer travels with the code.
 *
 * It used to: an `import.meta.glob` over `src/` turned any spreadsheet found
 * there into a Vite asset, and the dashboard fetched it on startup. That worked,
 * and it also meant the numbers had a public URL. Anyone who loaded the site
 * could open the Network tab, copy the `.xlsx` link and take the whole regional
 * report, and no login rendered on this side could have stopped them — a gate
 * drawn in JavaScript is a gate the visitor's own browser is free to ignore.
 *
 * So the workbook moved to `/data` at the repo root, outside everything Vite
 * compiles, and is served by `/api/report` — which reads the session cookie
 * before it opens the file. The change from the dashboard's point of view is one
 * URL. The change from an outsider's point of view is that there is nothing at
 * the end of the wire without a session.
 *
 * A 401 here means the session died while the tab was open. That is reported
 * upward rather than shown as a parse error, so the user gets the login screen
 * instead of "file tersebut tidak dapat dibaca".
 */
const REPORT_URL = '/api/report'

/** `X-Report-Filename`, percent-decoded, or a sensible stand-in. */
function reportName(res: Response): string {
  const raw = res.headers.get('X-Report-Filename')
  if (!raw) return 'laporan.xlsx'
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/* --------------------------------------------------------------- helpers */

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

export default function Dashboard({
  who, onSignedOut, theme, onToggleTheme,
}: {
  /** who the server says is signed in — see App.tsx */
  who: Identity
  /** called when the session ends, by the button or by a 401 from the API */
  onSignedOut: () => void
  /** the colour scheme, and the switch for it — see lib/theme.ts */
  theme: Theme
  onToggleTheme: () => void
}) {
  const [model, setModel] = useState<Model | null>(null)
  /* The toolbar picture is locked while it is being taken — a second press used
     to start a second capture and save the same file twice. */
  const [pngBusy, setPngBusy] = useState(false)
  const [fileName, setFileName] = useState('')
  const [err, setErr] = useState('')
  const [agentKey, setAgentKey] = useState('TOTAL')
  const [dateIdx, setDateIdx] = useState(0)
  const [hot, setHot] = useState(false)
  // true while the report is in flight, so the drop zone does not flash up for a
  // moment before the data it was asking for arrives anyway
  const [booting, setBooting] = useState(true)
  const [tick, force] = useState(0)      // Kpi objects are edited in place

  /* ------------------------------------------------------------- the rail */

  const [view, setView] = useState<View>(VIEW_AGEN)
  /** desktop: icons only. Two separate states — see the note in Sidebar.tsx. */
  const [mini, setMini] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  /**
   * Widening past the breakpoint puts the rail back in the layout, and a drawer
   * flag left set would then show it permanently open with a scrim over the page
   * and no obvious way out — the scrim's click target is the thing covering the
   * button you would reach for.
   *
   * Only the one direction is handled. Narrowing does not need to force the
   * drawer shut: it starts shut, and `mini` is simply ignored below the
   * breakpoint rather than meaning something different there.
   */
  useEffect(() => {
    if (!drawerOpen) return
    const mq = window.matchMedia(`(min-width:${DRAWER_BP + 1}px)`)
    const sync = () => { if (mq.matches) setDrawerOpen(false) }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [drawerOpen])

  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  /** Choosing a destination on a phone also puts the drawer away. */
  const pickView = useCallback((id: string) => {
    setView(id as View)
    setDrawerOpen(false)
    /* An error belongs to the page it happened on. Carried over, a failed PNG
       on the DP/CP list sat above the other page as if it had failed. */
    setErr('')
    /* Back to the top: the two reports are different documents, and arriving at
       the second one scrolled halfway down because the first one was, is
       disorienting in the way that reads as a broken link. */
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [])

  const fileRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const rerender = () => force((n) => n + 1)

  /* ------------------------------------------------------------ loading */

  /** One path in for both sources — an upload and the served report differ only
   *  in how the bytes arrive, never in how they are read. */
  const loadBuffer = useCallback((buf: ArrayBuffer, name: string) => {
    try {
      /*
       * Two reads, and the first one reads nothing.
       *
       * The names come back for a fraction of the cost of the cells, and they
       * are enough to leave out the tabs this dashboard does not show (see
       * `isIgnoredSheet`) before paying to read any of them.
       */
      const names = readSheetNames(buf)
      const wb = readWorkbookSheets(buf, names.filter((n) => !isIgnoredSheet(n)))
      const mdl = parseWorkbook(wb)
      setModel(mdl)
      setFileName(name)
      setAgentKey('TOTAL')
      setDateIdx(Math.max(0, mdl.dates.length - 1))
      setErr('')
    } catch (ex) {
      setModel(null)
      setErr((ex as Error).message)
    }
  }, [])

  const handleFile = useCallback((f: File | undefined | null) => {
    if (!f) return
    const reader = new FileReader()
    reader.onload = (e) => loadBuffer(e.target!.result as ArrayBuffer, f.name)
    reader.onerror = () => setErr('Browser menolak membuka file ini.')
    reader.readAsArrayBuffer(f)
  }, [loadBuffer])

  /* Fetch the protected report once on startup. `cancelled` guards the unmount:
     without it a fast navigate-away lands a setState on a dead component. */
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const res = await fetch(REPORT_URL, { credentials: 'same-origin' })

        /* The session expired while the tab sat open. Hand the user back to the
           login screen rather than showing them a read error about a file they
           are no longer allowed to read. */
        if (res.status === 401) {
          if (!cancelled) onSignedOut()
          return
        }

        if (!res.ok) {
          const why = await res.json().catch(() => null) as { error?: string } | null
          throw new Error(why?.error || `${res.status} ${res.statusText}`)
        }

        const buf = await res.arrayBuffer()
        if (!cancelled) loadBuffer(buf, reportName(res))
      } catch (ex) {
        if (!cancelled) setErr(`Laporan di server tidak dapat dibaca: ${(ex as Error).message}`)
      } finally {
        if (!cancelled) setBooting(false)
      }
    })()

    return () => { cancelled = true }
  }, [loadBuffer, onSignedOut])

  /**
   * End the session on the server, not just in this tab.
   *
   * Clearing local state alone would leave the cookie alive: closing the tab and
   * reopening it would walk straight back in, which is not what anyone means by
   * signing out on a shared machine. The local state is dropped either way — if
   * the network call fails the user still gets the login screen, and the cookie
   * expires on its own within the shift.
   */
  const signOut = useCallback(async () => {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' })
    } catch {
      /* offline, or the server is down — fall through and clear locally */
    }
    onSignedOut()
  }, [onSignedOut])

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
   * The toolbar's picture, of whichever report the rail is pointing at.
   *
   * One button, two scopes — and the scope is the whole fix. It used to pass
   * `shoot-main` unconditionally, whose one job was to hide `.dpsection` so the
   * agent shot stopped above the drop-point list. That made sense when both
   * reports were on one page. Once they became separate views the class was
   * still applied on the DP/CP page, where `.dpsection` is not a section further
   * down — it is the entire contents. The button hid everything it was meant to
   * photograph and produced a picture of the header, or nothing at all.
   *
   * `shoot-dp` drops the table instead, because the table has its own button in
   * its own panel header: it is wider than the rest of the page and can run to
   * hundreds of rows, and one image holding both is unreadable at any scale.
   */
  const savePng = async () => {
    if (!wrapRef.current || pngBusy) return
    const d = model?.dates[dateIdx]
    const stamp = d?.date ? isoDay(d.date) : 'export'
    /*
     * Which picture this button takes, per destination.
     *
     * The rule is the same in both cases: photograph the page, minus whatever
     * on it has an export button of its own. The DP/CP list is wider than the
     * page and can run to hundreds of rows — one image holding a summary *and*
     * that list is unreadable at any scale, so the summary shot leaves it out
     * and its own button takes it full width.
     */
    const shot: Record<View, { stem: string; cls: string }> = {
      [VIEW_AGEN]: { stem: `jnt-agen-${stamp}`, cls: 'shoot-main' },
      [VIEW_DP]: { stem: `jnt-dp-cp-${stamp}`, cls: 'shoot-dp' },
    }
    const pick = shot[view]
    setPngBusy(true)
    setErr('')
    try {
      await exportPng(wrapRef.current, `${pick.stem}.png`, pick.cls)
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setPngBusy(false)
    }
  }

  /* -------------------------------------------------------- empty state */

  if (booting) {
    return (
      <div className="wrap">
        <TopBar meta="Memuat laporan dari server…" />
        <div className="dropzone"><h2>Memuat data… <Zh>正在加载</Zh></h2></div>
      </div>
    )
  }

  if (!model || !current) {
    return (
      <div className="wrap">
        <TopBar meta={`Masuk sebagai ${who.user} — laporan server belum dapat dibaca.`} />
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
          {/* Why the upload screen is showing at all. Without this the failure is
              silent and indistinguishable from "the feature was never built" —
              which is exactly how it looked on the first deploy. */}
          <div className="lock">
            Didukung: .xlsx · .xlsm · .xls · .csv
            <br />
            <b>Server tidak memiliki laporan yang dapat dibaca.</b> Agar dashboard langsung
            terbuka tanpa unggah, taruh file Excel di folder <b>data/</b> pada repo
            (bukan di dalam <code>src/</code>) lalu <b>commit dan push</b> — build hanya
            melihat file yang ada di repo, bukan yang ada di komputer Anda.
          </div>
          <div className="lock">
            File yang Anda pilih di sini dibaca <b>hanya di browser ini</b> dan tidak
            dikirim ke mana pun.
          </div>
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

  /*
   * The rail's contents.
   *
   * The counts are in the hints rather than in a badge on the right: "10 agen"
   * and "1.666 titik" say what the destination *is*, and a bare number in a pill
   * beside a label says only that there is a number. The DP entry is offered
   * whether or not today has drop-point data — hiding a destination on a day the
   * file happens to be short is how you get someone convinced the feature was
   * removed. It says so on arrival instead.
   */
  const nav: NavGroup[] = [
    {
      id: 'performa',
      label: 'Performa Operasional',
      items: [
        {
          id: VIEW_AGEN, label: 'Data Agen', zh: '代理区数据', icon: 'grid',
          hint: `${model.rows.length} agen · ${kpis.length} indikator`,
        },
        {
          id: VIEW_DP, label: 'Data per DP/CP', zh: '网点数据', icon: 'pin',
          hint: model.dps.length
            ? `${model.dps.length.toLocaleString('id-ID')} titik`
            : 'belum ada data',
        },
      ],
    },
  ]

  const onAgen = view === VIEW_AGEN

  /* The report itself, bound to a name rather than returned inline — the shell
     around it is three elements and putting them at the top would push 300 lines
     of document one indent to the right for no reading benefit. */
  const report = (
    <div className="wrap" ref={wrapRef}>
      <TopBar
        onMenu={() => setDrawerOpen(true)}
        meta={
          <>
            {/* Who this is for, stated on the page rather than left to whoever
                remembers. It sits inside the top bar, so it is also carried into
                every PNG and PDF export — a screenshot that leaves the dashboard
                takes its own handling instruction with it. */}
            <span className="hqtag">Khusus Tim Internal HQ<Zh>仅限总部内部团队</Zh></span>
            <br />
            Wilayah: <b>{model.region}</b> &nbsp;|&nbsp; Agen: <b>{current.label}<Zh>{agentZh(current.label)}</Zh></b>
            &nbsp;|&nbsp; Tanggal: <b>{todayLabel}</b>
            &nbsp;|&nbsp; Sumber: <b>{fileName}</b> ({okSheets.length} sheet)
          </>
        }
      />

      {/* -------- toolbar -------- */}
      <div className="toolbar">
        {/* No upload button here any more. The report comes from the server now,
            and a control that swaps it for a local file only invited someone to
            look at yesterday's copy and believe it was live. The drop zone on
            the empty state keeps the ability, where it is a recovery path rather
            than a standing offer. */}
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
            {/* a plain string, not <Zh> — an <option> renders text only */}
            {model.rows.map((r) => (
              <option key={r.key} value={r.key}>
                {agentFull(r.label)}{r.code ? ` · ${r.code}` : ''}
              </option>
            ))}
          </select>
        </Field>
        {/*
          The right-hand end, grouped rather than left as four loose flex items
          after a `.spacer`.

          Loose, they wrapped one at a time: opening the rail takes 300px off the
          bar, "Cetak / PDF" no longer fitted by about forty pixels, and it alone
          dropped to a second line — left-aligned under the date picker, nowhere
          near the button it belongs beside. The spacer made it worse rather than
          better, since a `flex:1` item on a wrapped line grows to fill the row it
          landed on.

          As one group the chip and both buttons move together and stay
          right-aligned, whether they share the fields' line or take their own.
        */}
        <div className="toolbar-end">
          <span className="filechip">
            {model.region} · {model.rows.length} agen · {kpis.length} Indikator · {dates.length} hari
            {model.dps.length > 0 && ` · ${model.dps.length} DP/CP dari ${dpSheets.length} tab agen`}
          </span>
          {/* Named for what it will contain. Two buttons on the DP/CP page read
              "Simpan PNG" and take different pictures, so each has to say which. */}
          <button
            className={`btn act act-png${pngBusy ? ' is-busy' : ''}`}
            onClick={savePng}
            disabled={pngBusy}
            title="Simpan halaman ini sebagai gambar PNG"
          >
            <BtnIcon name={pngBusy ? 'spin' : 'image'} />
            <span>
              {pngBusy ? 'Menyimpan…' : view === VIEW_DP ? 'Simpan PNG · Ringkasan' : 'Simpan PNG'}
            </span>
          </button>
          {/* "Cetak / PDF" used to sit here. The print stylesheet it drove is
              still in dashboard.css and still correct — the browser's own
              Ctrl+P uses it — so this only takes away the button, not the
              ability. */}
        </div>
        {/* Sign-out has moved to the foot of the rail. It was here because the
            top bar is inside the PNG export and nobody wants a "LogOut" button
            baked into the picture they send to the region — the rail is outside
            that export too, and it is where the account it ends is named. */}
      </div>

      {/* Dismissable, and cleared by the next export or page change — it used to
          stay up for the rest of the session once anything had failed. */}
      {err && (
        <div className="err errbar" role="alert">
          <span className="errmsg">{err}</span>
          <button className="errclose" onClick={() => setErr('')} aria-label="Tutup pesan" title="Tutup pesan">
            <BtnIcon name="close" />
          </button>
        </div>
      )}

      {badSheets.length > 0 && (
        <div className="warnbox">
          {badSheets.length} sheet dilewati:{' '}
          {badSheets.map((s) => `“${s.name}” (${s.reason})`).join(' · ')}
        </div>
      )}

      {/*
        Part A, and now only when the rail is pointing at it.

        The band stays even though the rail already says which report is open.
        They are not the same statement: the rail says where you are in the app,
        the band says what this document is — and the band is the one that
        survives into the PNG and the PDF, where there is no rail at all.
      */}
      {onAgen && (<>
      <div className="partband">
        <span className="partnum">A</span>
        <span className="parttext">
          <span className="parttitle">Data Agen<Zh>代理区数据</Zh></span>
          <span className="partsub">
            Performa tingkat agen — {model.region} · {model.rows.length} agen · {dates.length} hari
          </span>
        </span>
      </div>

      {/* -------- KPI cards, one block per section -------- */}
      {(() => {
        const card = (k: Kpi) => {
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
              <div className="kmtd">{mtd != null ? `Pencapaian Bulan Ini: ${pct(mtd)}` : ' '}</div>
              <div className="kcmp">
                <span>Hari Sebelumnya {pct(p)}</span>
                <Delta diff={v != null && p != null ? v - p : null} lowerBetter={k.lowerBetter} />
              </div>
              <Sparkline values={series} color={PALETTE[ki % PALETTE.length]} />
              <TipBox ex={ex} placement="below" />
            </div>
          )
        }

        /* Anything the file carries that no section claims still gets shown —
           an unfamiliar column must never vanish just because it is unfamiliar. */
        const claimed = new Set(KPI_SECTIONS.flatMap((s) => s.labels))
        const extras = kpis.filter((k) => !claimed.has(k.label))

        return (
          <>
            {KPI_SECTIONS.map((sec, i) => {
              const mine = kpis.filter((k) => sec.labels.includes(k.label))
              if (!mine.length) return null
              return (
                <section className="kpisec" key={sec.id}>
                  <h2 className="sechead">
                    <span className="secnum">{i + 1}</span>
                    <span className="sectext">{sec.label}<Zh>{sec.zh}</Zh></span>
                    <span className="seccount">{mine.length} Indikator</span>
                  </h2>
                  <div className="cards">{mine.map(card)}</div>
                </section>
              )
            })}
            {extras.length > 0 && (
              <section className="kpisec">
                <h2 className="sechead">
                  <span className="secnum">+</span>
                  <span className="sectext">Lainnya<Zh>其他</Zh></span>
                  <span className="seccount">{extras.length} Indikator</span>
                </h2>
                <div className="cards">{extras.map(card)}</div>
              </section>
            )}
          </>
        )
      })()}

      {/* -------- trend, full width -------- */}
      <div className="row-trend">
        <Panel title={<>Tren Operasional ({dates.length} Hari) <Zh>运营趋势</Zh></>}>
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

      </>)}

      {/* Part B. It carries its own band and its own export buttons — see
          DpSection — so there is nothing to add around it here. */}
      {view === VIEW_DP && dpDay && (
        <DpSection
          model={model} kpis={kpis} agentKey={agentKey}
          agentLabel={current.label} day={dpDay} wanted={dToday} onError={setErr}
        />
      )}

      {/* The destination exists in the rail whether or not the file has anything
          behind it, so the empty case has to be answered here rather than by an
          entry that quietly disappears. It names the tab the data should have
          come from, because that is the thing to go and check. */}
      {view === VIEW_DP && !dpDay && (
        <div className="dropzone">
          <h2>Belum ada data DP / CP <Zh>暂无网点数据</Zh></h2>
          <p>
            Laporan ini tidak memuat tab data drop point. Tambahkan sheet
            {' '}<b>ALL DP DATA</b> (atau tab per agen <b>AG12</b>, <b>AG13</b> …) ke file di
            folder <b>data/</b>, lalu muat ulang halaman ini.
          </p>
        </div>
      )}

      {/* Rewritten with the "Hapus data" button: the old wording pointed at a
          control that no longer exists, and the claim itself has changed — the
          report now arrives from the server for this session rather than being
          read from a file the browser already had. */}
      <div className="note">
        Laporan diambil dari server hanya untuk sesi yang sudah masuk, lalu diproses di memori
        browser — tidak ada yang ditulis ke disk. Menutup atau menyegarkan halaman menghapus semuanya.
      </div>
    </div>
  )

  return (
    <div className={`app${mini ? ' mini' : ''}${drawerOpen ? ' navopen' : ''}`}>
      <Sidebar
        groups={nav} active={view} onSelect={pickView}
        mini={mini} onToggleMini={() => setMini(!mini)}
        drawerOpen={drawerOpen} onCloseDrawer={closeDrawer}
        onSignOut={signOut} user={who.user}
        theme={theme} onToggleTheme={onToggleTheme}
      />
      <div className="main">{report}</div>
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
function TopBar({ meta, right, onMenu }: {
  meta: ReactNode
  right?: ReactNode
  /** opens the drawer; omitted on the states that render without a rail */
  onMenu?: () => void
}) {
  return (
    <div className="topbar">
      {/* The hamburger leads, before the mark — it is the first thing a thumb
          reaches for and the only route into the rail on a phone. Hidden above
          the breakpoint, where the rail is simply there. */}
      {onMenu && <NavButton onClick={onMenu} />}
      {/* `plain` by name, not by luck: src/assets holds two J&T files and the
          other one has a red field baked in. The plate is dropped to match (see
          `.logo.plain`) — red lettering on a red plate is invisible, so the
          artwork and the surface behind it are one decision, not two. */}
      <div className="logo plain"><JntLogo variant="plain" /></div>
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
