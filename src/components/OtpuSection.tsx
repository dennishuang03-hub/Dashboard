/**
 * On Time Pick Up — the three pages the rail offers under one heading.
 *
 * The report has two halves that answer two different questions and are read by
 * two different people. "Which agent is behind GTL this week?" is a ten-row
 * table a regional manager reads on a Monday. "Which of my sellers is dragging
 * the hub down?" is seventeen thousand rows a hub supervisor filters. Stacking
 * them on one page means everybody scrolls past somebody else's report, which is
 * the exact mistake the DP/CP split already fixed once on this dashboard.
 *
 * So: three destinations, one component.
 *
 *   'all'      the parent — the four headline cards, the agent table, and a
 *              seller roll-up. Enough to answer "how was the week?" without
 *              opening either detail page.
 *   'agent'    the agent table on its own, with the weekly trend behind it.
 *   'seller'   the seller list, filtered and sortable.
 *
 * One component rather than three files because the four cards and the agent
 * table appear on two of the three pages, and a shared table that is genuinely
 * the same table beats two that are supposed to stay in step.
 *
 * ── Everything here is internal ──────────────────────────────────────────────
 *
 * Seller names and their volumes are commercially sensitive in a way the agent
 * numbers are not, and these pages are exportable as PNGs that leave the
 * building. Every page therefore states its handling class in the band itself,
 * where it is part of the picture rather than part of the chrome.
 */
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { agentZh } from '../lib/jnt'
import {
  dfmt, isActive, longDate, nfmt, pfmt, poolPct, shortDate, toneOf,
} from '../lib/otpu'
import type {
  OtpuAgentReport, OtpuAgentRow, OtpuReport, OtpuSellerReport, OtpuSellerRow,
} from '../lib/otpu'
import { HBarChart } from './Charts'
import MultiSelect from './MultiSelect'
import type { MsOption } from './MultiSelect'
import Zh from './Zh'

export type OtpuPart = 'all' | 'agent' | 'seller'

/**
 * The smallest weekly volume a seller needs before it can win or lose a
 * ranking.
 *
 * Without a floor the worst-ten list is ten sellers who shipped one parcel and
 * missed it, every single week — 0,00% and nothing to act on. The number is
 * deliberately round and deliberately stated on the page, because a threshold
 * that silently removes rows from a chart is the kind of thing that costs
 * somebody an afternoon.
 */
const MIN_RANK_VOL = 100

/** How many rows the seller table shows before "tampilkan semua". */
const PAGE = 40

/* --------------------------------------------------------------- utilities */

type SortDir = 'asc' | 'desc'

const cmpText = (a: string, b: string) => a.localeCompare(b, 'id-ID')

/** `null` sorts to the bottom whichever way the column is pointing. */
function cmpNum(a: number | null, b: number | null, dir: SortDir): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return dir === 'asc' ? a - b : b - a
}

/* ------------------------------------------------------------- small parts */

/** A signed percentage on a tinted plate — the table's comparison columns. */
function DeltaPill({ v, title }: { v: number | null; title?: string }) {
  if (v == null || !Number.isFinite(v)) return <span className="muted">—</span>
  const tone = toneOf(v)
  return (
    <span className={`otpill ${tone || 'flatp'}`} title={title}>{dfmt(v)}</span>
  )
}

function Card({
  label, zh, sub, value, tone, foot,
}: {
  label: string; zh: string; sub?: string
  value: string
  tone?: '' | 'up' | 'down'
  foot?: ReactNode
}) {
  return (
    <div className={`otcard${tone ? ` t-${tone}` : ''}`}>
      <div className="otc-lab">{label}<Zh>{zh}</Zh></div>
      {sub && <div className="otc-sub">{sub}</div>}
      <div className="otc-val">{value}</div>
      {foot && <div className="otc-foot">{foot}</div>}
    </div>
  )
}

function Stat({ n, lab, zh, tone = '' }: { n: string; lab: string; zh: string; tone?: string }) {
  return (
    <div className={`dpstat${tone ? ` ${tone}` : ''}`}>
      <span className="n">{n}</span>
      <span className="l">{lab}<Zh>{zh}</Zh></span>
    </div>
  )
}

/* ------------------------------------------------------------- the cards */

/**
 * The four headline figures, straight off the agent tab's TOTAL row.
 *
 * They are the agent tab's totals and not a sum over the seller tab on purpose,
 * even on the parent page: the two tabs cover slightly different populations —
 * the seller tab is the GTL channel only — and a headline that disagreed with
 * the table three inches below it would be worse than no headline at all. The
 * seller roll-up says so where it appears.
 */
function Cards({ agent, period }: { agent: OtpuAgentReport; period: string }) {
  const t = agent.total
  return (
    <div className="otcards">
      <Card
        label="TOTAL ORDER" zh="订单量" sub={`Total order ${period}`}
        value={nfmt(t?.ordersTotal ?? null)}
      />
      <Card
        label="ACTUAL PICKUP" zh="实际揽收件量" sub={`Paket berhasil dijemput ${period}`}
        value={nfmt(t?.pickedTotal ?? null)}
      />
      <Card
        label="OTPU KUMULATIF" zh="实际揽收及时率" sub={`%OTPU kumulatif ${period}`}
        value={pfmt(t?.pctTotal ?? null)}
        foot={
          <>
            vs minggu lalu{' '}
            <span className={toneOf(t?.delta ?? null) || 'flat'}>{dfmt(t?.delta ?? null)}</span>
          </>
        }
      />
      <Card
        label="BANDING GTL" zh="对比GTL"
        sub={`${agent.gtlLabel}: ${pfmt(agent.gtl)}`}
        value={dfmt(t?.vsGtl ?? null)}
        tone={toneOf(t?.vsGtl ?? null)}
        foot={
          (t?.vsGtl ?? 0) >= 0
            ? `J&T unggul dari ${agent.gtlLabel}`
            : `J&T masih di bawah ${agent.gtlLabel}`
        }
      />
    </div>
  )
}

/* -------------------------------------------------------- the agent table */

/**
 * One column of the agent table, described rather than written out.
 *
 * The table used to be JSX: a header row, a body row, and the weekly cells
 * mapped inline in both. That works exactly until the columns become
 * switchable, at which point every `visible?` test has to be written twice and
 * kept in agreement, and the section band above has to count something it
 * cannot see. Describing each column once — how it sorts, how it renders, which
 * band it belongs under — means the header, the body, the band spans and the
 * switch are four reads of one list instead of four lists.
 */
interface ACol {
  id: string
  /** which band it sits under; `cmp` has no band */
  band: 'order' | 'picked' | 'pct' | 'cmp'
  /** the short head — `W2`, `Total`, `Kumulatif` */
  label: string
  zh?: string
  /** second line under the head, e.g. the week's date range */
  sub?: string
  /** the full name used by the column switch, where there is no band above it */
  chip: string
  ctr?: boolean
  sort: (r: OtpuAgentRow) => number | null
  cell: (r: OtpuAgentRow) => ReactNode
}

const BAND_HEAD: Record<ACol['band'], { label: string; zh: string }> = {
  order: { label: 'Total Order', zh: '订单量' },
  picked: { label: 'Jumlah Paket OTPU', zh: '实际揽收件量' },
  pct: { label: '%OTPU', zh: '实际揽收及时率' },
  cmp: { label: 'Pembanding', zh: '对比' },
}

/**
 * Every column the agent table can show, in the order it shows them.
 *
 * The weekly counts are built from the same `agent.weeks` list as the weekly
 * percentages, so a file with two weeks or five produces a table with two or
 * five of each and nothing here changes.
 */
function agentCols(agent: OtpuAgentReport): ACol[] {
  const out: ACol[] = []

  agent.weeks.forEach((w, i) => out.push({
    id: `o${i}`, band: 'order', label: w.short, sub: w.label, chip: `Total Order ${w.short}`,
    sort: (r) => r.orders[i] ?? null,
    cell: (r) => nfmt(r.orders[i] ?? null),
  }))
  out.push({
    id: 'oT', band: 'order', label: 'Total', zh: '合计', chip: 'Total Order — Total',
    sort: (r) => r.ordersTotal,
    cell: (r) => nfmt(r.ordersTotal),
  })

  agent.weeks.forEach((w, i) => out.push({
    id: `p${i}`, band: 'picked', label: w.short, sub: w.label, chip: `Jumlah Paket ${w.short}`,
    sort: (r) => r.picked[i] ?? null,
    cell: (r) => nfmt(r.picked[i] ?? null),
  }))
  out.push({
    id: 'pT', band: 'picked', label: 'Total', zh: '合计', chip: 'Jumlah Paket — Total',
    sort: (r) => r.pickedTotal,
    cell: (r) => nfmt(r.pickedTotal),
  })

  agent.weeks.forEach((w, i) => out.push({
    id: `c${i}`, band: 'pct', label: w.short, sub: w.label, chip: `%OTPU ${w.short}`,
    sort: (r) => r.pct[i] ?? null,
    cell: (r) => pfmt(r.pct[i] ?? null),
  }))
  out.push({
    id: 'cK', band: 'pct', label: 'Kumulatif', zh: '累计', chip: '%OTPU Kumulatif',
    sort: (r) => r.pctTotal,
    cell: (r) => <span className="otkumv">{pfmt(r.pctTotal)}</span>,
  })

  const lastWeek = agent.weeks.length ? agent.weeks[agent.weeks.length - 1].short : ''
  const prevWeek = agent.weeks.length > 1 ? agent.weeks[agent.weeks.length - 2].short : ''
  out.push({
    id: 'delta', band: 'cmp', label: 'Perbandingan', zh: '占比', chip: 'Perbandingan',
    ctr: true,
    sort: (r) => r.delta,
    cell: (r) => (
      <DeltaPill
        v={r.delta}
        title={prevWeek ? `${lastWeek} dibanding ${prevWeek}` : 'Minggu terakhir dibanding sebelumnya'}
      />
    ),
  })
  out.push({
    id: 'gtl', band: 'cmp', label: agent.gtlLabel, chip: agent.gtlLabel,
    sort: (r) => r.gtl,
    cell: (r) => <span className="muted">{pfmt(r.gtl)}</span>,
  })
  out.push({
    id: 'vsgtl', band: 'cmp', label: 'Banding GTL', zh: '对比GTL', chip: 'Banding GTL',
    ctr: true,
    sort: (r) => r.vsGtl,
    cell: (r) => <DeltaPill v={r.vsGtl} title={`%OTPU kumulatif dibanding ${agent.gtlLabel}`} />,
  })

  return out
}

/**
 * What the table opens on.
 *
 * The weekly *counts* start switched off, and the reason is the reference this
 * table was drawn from: it shows one Total Order figure, one Jumlah Paket
 * figure, and then the weekly split of the percentage — because the percentage
 * is what the meeting is about and the counts are what it is computed from.
 * Turning all of them on gives a fifteen-column table where twelve columns are
 * seven-digit numbers, which nobody reads across.
 *
 * They are one tick away rather than absent, which is the whole point of the
 * switch: "how many parcels was that 92,88% actually about?" is a fair question
 * and the answer should not require opening the spreadsheet.
 */
const agentHiddenDefault = (cols: ACol[]): Set<string> =>
  new Set(cols.filter((c) => /^[op]\d+$/.test(c.id)).map((c) => c.id))

/** Contiguous runs of one band, for the header's section row. */
function bandRuns(cols: ACol[]): { band: ACol['band']; n: number }[] {
  const runs: { band: ACol['band']; n: number }[] = []
  for (const c of cols) {
    const last = runs[runs.length - 1]
    if (last && last.band === c.band) last.n++
    else runs.push({ band: c.band, n: 1 })
  }
  return runs
}

/**
 * The agent table — the one in the brief, built to take however many weeks the
 * file happens to carry.
 *
 * The screenshot it was drawn from has four weekly columns; the file it is
 * being built against has three. Neither number is written down anywhere here:
 * the weeks come out of the header block, and each band spans however many
 * columns of its own are currently switched on. A file with five weeks widens
 * the table and nothing else.
 */
function AgentTable({
  agent, cityOf, title,
}: {
  agent: OtpuAgentReport
  cityOf: (code: string) => string
  title: ReactNode
}) {
  const cols = useMemo(() => agentCols(agent), [agent])

  /* Keyed by the workbook's own week count, so loading a file with a different
     number of weeks resets the switch instead of leaving it holding ids that no
     longer exist. */
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => agentHiddenDefault(cols))
  const [colsKey, setColsKey] = useState(() => cols.map((c) => c.id).join(','))
  const liveKey = cols.map((c) => c.id).join(',')
  if (liveKey !== colsKey) {
    setColsKey(liveKey)
    setHidden(agentHiddenDefault(cols))
  }

  const [agentOff, setAgentOff] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [sortKey, setSortKey] = useState<string>('')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const visible = cols.filter((c) => !hidden.has(c.id))
  const runs = bandRuns(visible)

  const toggleCol = (id: string) => {
    const next = new Set(hidden)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setHidden(next)
  }

  /**
   * The whole band at once — "Total Order (all three weeks)" as one action.
   *
   * A band that is fully on goes fully off; a band that is partly on fills up.
   * Filling up rather than emptying is the one that matches the intent: you
   * clicked the group because you want to see the group.
   */
  const toggleBand = (band: ACol['band']) => {
    const mine = cols.filter((c) => c.band === band)
    const allOn = mine.every((c) => !hidden.has(c.id))
    const next = new Set(hidden)
    for (const c of mine) {
      if (allOn) next.add(c.id)
      else next.delete(c.id)
    }
    setHidden(next)
  }

  const showEvery = () => setHidden(new Set<string>())
  const hideEvery = () => setHidden(new Set(cols.map((c) => c.id)))
  const allColsOn = visible.length === cols.length

  const sortOn = (key: string) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'code' ? 'asc' : 'desc') }
  }
  const arrow = (key: string) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '')

  const agentOpts = useMemo<MsOption[]>(
    () => agent.rows.map((r) => {
      const city = cityOf(r.code)
      return { value: r.code, label: city ? `${r.code} · ${city}` : r.code }
    }),
    [agent.rows, cityOf],
  )

  const rows = useMemo(() => {
    const list = agent.rows.filter((r) => !agentOff.has(r.code))
    if (!sortKey) return list
    const dir = sortDir
    const col = cols.find((c) => c.id === sortKey)
    list.sort((a, b) => {
      if (sortKey === 'code') {
        const r = cmpText(a.code, b.code)
        return dir === 'asc' ? r : -r
      }
      return col ? cmpNum(col.sort(a), col.sort(b), dir) : 0
    })
    return list
  }, [agent.rows, agentOff, cols, sortKey, sortDir])

  /*
   * The TOTAL row is the file's own, and it stays that way while the filter is
   * on.
   *
   * Recomputing it from the visible agents was the other option and it is the
   * wrong one here: this row is the regional figure the GTL comparison is made
   * against, and a "TOTAL" that silently means "total of the four agents I
   * happen to have ticked" is a number somebody will quote in a meeting. The
   * chip's own count says how many rows are showing; the label says what the
   * summary is of.
   */
  const filtered = agentOff.size > 0

  const body = (r: OtpuAgentRow) =>
    visible.map((c) => (
      <td key={c.id} className={c.ctr ? 'ctr' : 'num'}>{c.cell(r)}</td>
    ))

  return (
    <>
      <h3>
        <span className="ptitle">{title}</span>
        <span className="otlegend">
          <span className="otleg up">● Naik vs minggu lalu</span>
          <span className="otleg down">● Turun vs minggu lalu</span>
        </span>
      </h3>

      <div className="dpfilters">
        <MultiSelect
          name="Agen" zh="代理区" allLabel={`Semua agen (${agent.rows.length})`}
          options={agentOpts} off={agentOff} onChange={setAgentOff}
        />
        {filtered && (
          <span className="otfilternote">
            {rows.length} dari {agent.rows.length} agen — baris <b>TOTAL</b> tetap total wilayah
          </span>
        )}
      </div>

      {/*
        The column switch, laid out flat rather than hidden in a dropdown — the
        same decision, for the same reasons, as the one over the DP/CP table.
        Which columns are on is the state of the table, and spelling it out is
        what answers "where did Jumlah Paket go?" without a click.

        The band name is itself a button, because "Total Order, all three weeks"
        is one thought and should be one press.
      */}
      <div className="dpcolbar" role="group" aria-label="Kolom yang ditampilkan">
        <div className="dpcolhead">
          <span className="dpcoltitle">Kolom <Zh>列</Zh></span>
          <span className={`dpcoln${allColsOn ? '' : ' off'}`}>
            <b>{visible.length}</b>/{cols.length}
          </span>
          <label className="colchip master">
            <input
              type="checkbox"
              checked={allColsOn}
              ref={(el) => { if (el) el.indeterminate = visible.length > 0 && !allColsOn }}
              onChange={(e) => (e.target.checked ? showEvery() : hideEvery())}
            />
            Pilih semua
          </label>
        </div>

        <div className="dpcolwrap">
          {(['order', 'picked', 'pct', 'cmp'] as const).map((band) => {
            const mine = cols.filter((c) => c.band === band)
            if (!mine.length) return null
            const on = mine.filter((c) => !hidden.has(c.id)).length
            return (
              <div className="colgrp" key={band}>
                <button
                  type="button"
                  className={`colgrph tap${on === 0 ? ' off' : ''}`}
                  onClick={() => toggleBand(band)}
                  title={`Tampilkan atau sembunyikan seluruh kolom ${BAND_HEAD[band].label}`}
                >
                  {BAND_HEAD[band].label} <em>{on}/{mine.length}</em>
                </button>
                {mine.map((c) => (
                  <label
                    key={c.id}
                    className={`colchip${hidden.has(c.id) ? ' off' : ''}`}
                    title={c.chip}
                  >
                    <input
                      type="checkbox"
                      checked={!hidden.has(c.id)}
                      onChange={() => toggleCol(c.id)}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            )
          })}
        </div>
      </div>

      <div className="body" style={{ padding: 0 }}>
        <div className="dpscroll">
          <table className="dpgrid otgrid">
            <thead>
              {/* The bands above the columns. They are what makes a run of
                  narrow `W1 W2 W3` heads read as one measurement rather than
                  three unrelated ones, and they follow the switch — hide every
                  Jumlah Paket column and its band goes with them. */}
              <tr className="secrow">
                <th className="sticky" />
                {runs.map((run, i) => (
                  <th
                    key={`${run.band}-${i}`}
                    className={`secband s-${run.band}${i > 0 ? ' seam' : ''}`}
                    colSpan={run.n}
                  >
                    {run.band === 'cmp'
                      ? ''
                      : <>{BAND_HEAD[run.band].label}<Zh>{BAND_HEAD[run.band].zh}</Zh></>}
                  </th>
                ))}
              </tr>
              <tr className="catrow">
                <th className="sticky" onClick={() => sortOn('code')}>
                  AGENT PU{arrow('code')}<Zh>揽收代理</Zh>
                </th>
                {visible.map((c, i) => {
                  const seam = i > 0 && visible[i - 1].band !== c.band ? ' seam' : ''
                  return (
                    <th
                      key={c.id}
                      className={`${c.ctr ? 'ctr' : 'num'} cat${seam}`}
                      onClick={() => sortOn(c.id)}
                      title={c.chip}
                    >
                      {c.label}{arrow(c.id)}
                      {c.zh && <Zh>{c.zh}</Zh>}
                      {c.sub && <span className="otsub">{c.sub}</span>}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {agent.total && (
                /* Pinned to the top rather than sorted with the rest: it is not
                   one of the agents and it must not move when a column is
                   sorted, because everything below it is read against it. */
                <tr className="ottotal">
                  <td className="sticky"><b>TOTAL</b><Zh>全部</Zh></td>
                  {body(agent.total)}
                </tr>
              )}
              {rows.map((r) => {
                const city = cityOf(r.code)
                return (
                  <tr key={r.code}>
                    <td className="sticky">
                      <span className="otname">
                        <span className="otcode">{r.code}</span>
                        <span className="otcity">{city || '—'}<Zh>{agentZh(city)}</Zh></span>
                      </span>
                    </td>
                    {body(r)}
                  </tr>
                )
              })}
              {!rows.length && (
                <tr><td colSpan={visible.length + 1} className="ctr muted" style={{ padding: 24 }}>
                  {agent.rows.length
                    ? 'Tidak ada agen yang dipilih pada filter di atas.'
                    : 'Sheet OTPU Agent tidak memuat baris agen.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

/* ------------------------------------------------------- where a row stands */

/**
 * A seller's position against its own GTL benchmark, as one of four words.
 *
 * The half-point dead band is the part that matters. Without it "Di atas GTL"
 * includes a seller three hundredths of a point ahead, and the filter that is
 * supposed to isolate the problem returns half the list — the comparison is
 * between two percentages computed from different populations, and it is simply
 * not precise enough to call a hundredth of a point a direction.
 *
 * Module scope rather than inside the component so the two `useMemo`s that use
 * it have honest dependency lists instead of a suppression comment.
 */
type Band = 'bawah' | 'setara' | 'atas' | 'kosong'

const BAND_ORDER: Band[] = ['bawah', 'setara', 'atas', 'kosong']

const BAND_LABEL: Record<Band, string> = {
  bawah: 'Di bawah GTL',
  setara: 'Setara GTL',
  atas: 'Di atas GTL',
  kosong: 'Tanpa GTL',
}

function bandOf(r: OtpuSellerRow): Band {
  if (r.vsGtl == null) return 'kosong'
  if (r.vsGtl < -0.5) return 'bawah'
  if (r.vsGtl > 0.5) return 'atas'
  return 'setara'
}

/* --------------------------------------------------------- seller roll-ups */

interface Pool {
  key: string
  label: string
  orders: number
  picked: number
  pct: number | null
  gtl: number | null
}

/** Group the seller rows by one of their identity fields and weight each pool. */
function poolBy(
  rows: OtpuSellerRow[],
  pick: (r: OtpuSellerRow) => string,
  sub: (r: OtpuSellerRow) => string = () => '',
): Pool[] {
  const map = new Map<string, { rows: OtpuSellerRow[]; sub: string }>()
  for (const r of rows) {
    const k = pick(r) || '—'
    const hit = map.get(k)
    if (hit) hit.rows.push(r)
    else map.set(k, { rows: [r], sub: sub(r) })
  }
  const out: Pool[] = []
  for (const [key, v] of map) {
    const p = poolPct(v.rows)
    /* The GTL benchmark is a per-seller figure, so a pool's benchmark is the
       same weighted average its %OTPU is — otherwise the two sides of the
       comparison would be measuring different populations. */
    let gw = 0, gAcc = 0
    for (const r of v.rows) {
      if (r.gtl == null) continue
      const w = r.orders ?? 0
      if (w <= 0) continue
      gw += w; gAcc += r.gtl * w
    }
    out.push({
      key, label: key,
      orders: p.orders, picked: p.picked, pct: p.pct,
      gtl: gw > 0 ? gAcc / gw : null,
    })
  }
  return out
}

/* ------------------------------------------------------- the seller table */

function SellerTable({
  seller, agentOf,
}: {
  seller: OtpuSellerReport
  agentOf: (code: string) => string
}) {
  const [q, setQ] = useState('')
  const [agentOff, setAgentOff] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [hubOff, setHubOff] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [bandOff, setBandOff] = useState<ReadonlySet<string>>(() => new Set<string>())
  /* Off by default: eleven thousand of the seventeen thousand rows shipped
     nothing this week, and a list that opens on them buries the six thousand
     that did. It is a switch rather than a silent filter for the usual reason —
     "where did my seller go?" has to have an answer on the page. */
  const [showZero, setShowZero] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [showDaily, setShowDaily] = useState(false)
  const [sortKey, setSortKey] = useState<string>('orders')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const active = useMemo(() => seller.rows.filter(isActive), [seller.rows])
  const zeroCount = seller.rows.length - active.length

  const opts = useMemo(() => {
    const agents = new Map<string, number>()
    const hubs = new Map<string, number>()
    for (const r of seller.rows) {
      if (!showZero && !isActive(r)) continue
      agents.set(r.agent || '—', (agents.get(r.agent || '—') ?? 0) + 1)
      hubs.set(r.hub || '—', (hubs.get(r.hub || '—') ?? 0) + 1)
    }
    const mk = (m: Map<string, number>, label?: (k: string) => string): MsOption[] =>
      [...m.entries()]
        .sort((a, b) => cmpText(a[0], b[0]))
        .map(([value, n]) => ({ value, label: label ? label(value) : value, n }))
    return {
      agent: mk(agents, (k) => {
        const city = agentOf(k)
        return city ? `${k} · ${city}` : k
      }),
      hub: mk(hubs),
    }
  }, [seller.rows, showZero, agentOf])

  /** Three bands against GTL, so the list can be narrowed to the problem. */
  const bandOpts = useMemo<MsOption[]>(() => {
    const m = new Map<Band, number>()
    for (const r of seller.rows) {
      if (!showZero && !isActive(r)) continue
      const b = bandOf(r)
      m.set(b, (m.get(b) ?? 0) + 1)
    }
    /* Listed in the fixed order rather than in the order they happen to turn
       up, so the filter reads as a scale; a band nobody is in is left out
       instead of offered as a zero. */
    return BAND_ORDER
      .filter((b) => m.has(b))
      .map((b) => ({ value: b, label: BAND_LABEL[b], n: m.get(b) }))
  }, [seller.rows, showZero])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const out = seller.rows.filter((r) => {
      if (!showZero && !isActive(r)) return false
      if (agentOff.has(r.agent || '—')) return false
      if (hubOff.has(r.hub || '—')) return false
      if (bandOff.has(bandOf(r))) return false
      if (needle) {
        const hay = `${r.seller} ${r.hub} ${r.dp} ${r.agent}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })

    const dir = sortDir
    out.sort((a, b) => {
      switch (sortKey) {
        case 'seller': { const r = cmpText(a.seller, b.seller); return dir === 'asc' ? r : -r }
        case 'hub': { const r = cmpText(a.hub, b.hub); return dir === 'asc' ? r : -r }
        case 'dp': { const r = cmpText(a.dp, b.dp); return dir === 'asc' ? r : -r }
        case 'agent': { const r = cmpText(a.agent, b.agent); return dir === 'asc' ? r : -r }
        case 'picked': return cmpNum(a.picked, b.picked, dir)
        case 'pct': return cmpNum(a.pct, b.pct, dir)
        case 'gtl': return cmpNum(a.gtl, b.gtl, dir)
        case 'vsgtl': return cmpNum(a.vsGtl, b.vsGtl, dir)
        default: {
          if (sortKey.startsWith('d')) {
            const i = Number(sortKey.slice(1))
            return cmpNum(a.dailyPct[i] ?? null, b.dailyPct[i] ?? null, dir)
          }
          return cmpNum(a.orders, b.orders, dir)
        }
      }
    })
    return out
  }, [seller.rows, q, agentOff, hubOff, bandOff, showZero, sortKey, sortDir])

  const shown = showAll ? filtered : filtered.slice(0, PAGE)
  const pool = useMemo(() => poolPct(filtered), [filtered])

  const sortOn = (key: string) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'seller' || key === 'hub' || key === 'dp' || key === 'agent' ? 'asc' : 'desc') }
  }
  const arrow = (key: string) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '')

  /*
   * There is no "Simpan PNG · Tabel" here any more.
   *
   * The table used to take its own picture, on the same reasoning the DP/CP list
   * does: it is wider than the page and can run long, so folding it into the
   * page shot makes an image too big to read. That reasoning does not survive
   * contact with this report — the agent table is ten rows, and the seller table
   * opens on forty. What two buttons actually produced was a choice nobody
   * wanted to make, and a page shot that was missing the thing the page is for.
   *
   * One button in the toolbar now, and it photographs everything. The table
   * overflows the pinned capture width rather than being cropped by it —
   * `body.shooting .dpscroll{overflow:visible}` releases the scroll box and
   * `capturedSize` measures the descendants, so the canvas grows to fit.
   */

  const dailyCols = showDaily ? seller.days : []
  /* seller, hub, DP, agent · the daily block · order, volume, %OTPU, GTL, selisih */
  const colCount = 4 + dailyCols.length + 5

  return (
    <div className="panel dptable">
      <h3>
        <span className="ptitle">
          Daftar Seller <Zh>商家清单</Zh> — {nfmt(filtered.length)} dari {nfmt(seller.rows.length)}
          {' · '}%OTPU {pfmt(pool.pct)}
        </span>
      </h3>

      <div className="dpfilters">
        <input
          type="text" placeholder="Cari seller, GTL Hub, DP atau agen…" value={q}
          onChange={(e) => setQ(e.target.value)} aria-label="Cari seller"
        />
        <MultiSelect
          name="Agen" zh="寄件代理" allLabel="Semua agen"
          options={opts.agent} off={agentOff} onChange={setAgentOff}
        />
        <MultiSelect
          name="GTL Hub" zh="抖音网点" allLabel="Semua GTL Hub"
          options={opts.hub} off={hubOff} onChange={setHubOff}
        />
        <MultiSelect
          name="Banding GTL" zh="对比GTL" allLabel="Semua posisi GTL"
          options={bandOpts} off={bandOff} onChange={setBandOff}
        />
        <label className="colchip">
          <input type="checkbox" checked={showZero} onChange={() => setShowZero(!showZero)} />
          Tampilkan {nfmt(zeroCount)} baris tanpa order
        </label>
        <label className="colchip">
          <input type="checkbox" checked={showDaily} onChange={() => setShowDaily(!showDaily)} />
          Kolom harian ({seller.days.length} hari)
        </label>
      </div>

      <div className="body" style={{ padding: 0 }}>
        <div className="dpscroll">
          <table className="dpgrid otgrid">
            <thead>
              <tr className="secrow">
                <th className="sticky" />
                <th /><th /><th />
                {dailyCols.length > 0 && (
                  <th className="secband seam" colSpan={dailyCols.length}>
                    %OTPU Harian<Zh>日度</Zh>
                  </th>
                )}
                <th className="seam" colSpan={3}>Mingguan<Zh>周度</Zh></th>
                <th colSpan={2} className="seam">Banding GTL<Zh>对比GTL</Zh></th>
              </tr>
              <tr className="catrow">
                <th className="sticky" onClick={() => sortOn('seller')}>
                  Nama Seller{arrow('seller')}<Zh>商家名称</Zh>
                </th>
                <th onClick={() => sortOn('hub')}>GTL Hub{arrow('hub')}<Zh>抖音网点</Zh></th>
                <th onClick={() => sortOn('dp')}>DP Pickup{arrow('dp')}<Zh>实际取件网点</Zh></th>
                <th onClick={() => sortOn('agent')}>Agent{arrow('agent')}<Zh>寄件代理</Zh></th>
                {dailyCols.map((d, i) => (
                  <th
                    key={d.key} className={`num cat${i === 0 ? ' seam' : ''}`}
                    onClick={() => sortOn(`d${i}`)}
                  >
                    {d.short}{arrow(`d${i}`)}
                  </th>
                ))}
                <th className="num cat seam" onClick={() => sortOn('orders')}>
                  Total Order{arrow('orders')}<Zh>订单量</Zh>
                </th>
                <th className="num cat" onClick={() => sortOn('picked')}>
                  Volume OTPU{arrow('picked')}<Zh>实际揽收件量</Zh>
                </th>
                <th className="num cat" onClick={() => sortOn('pct')}>
                  %OTPU{arrow('pct')}<Zh>及时率</Zh>
                </th>
                <th className="num cat seam" onClick={() => sortOn('gtl')}>
                  {seller.gtlLabel}{arrow('gtl')}
                </th>
                <th className="ctr cat" onClick={() => sortOn('vsgtl')}>
                  Selisih{arrow('vsgtl')}<Zh>差值</Zh>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key} className={isActive(r) ? '' : 'otzero'}>
                  <td className="sticky" title={r.seller}>
                    <span className="otname"><span className="otseller">{r.seller}</span></span>
                  </td>
                  <td className="muted">{r.hub || '—'}</td>
                  <td className="muted">{r.dp || '—'}</td>
                  <td>{r.agent || '—'}</td>
                  {dailyCols.map((d, i) => {
                    const v = r.dailyPct[i] ?? null
                    if (v == null) return <td key={d.key} className={`num muted${i === 0 ? ' seam' : ''}`}>—</td>
                    const bad = r.gtl != null && v < r.gtl
                    return (
                      <td
                        key={d.key}
                        className={`num hm ${bad ? 'bad' : 'ok'}${i === 0 ? ' seam' : ''}`}
                        title={`${shortDate(d.from!)} · ${nfmt(r.dailyPicked[i])} dari ${nfmt(r.dailyOrders[i])}`}
                      >
                        {pfmt(v, 1)}
                      </td>
                    )
                  })}
                  <td className="num seam">{nfmt(r.orders)}</td>
                  <td className="num">{nfmt(r.picked)}</td>
                  <td className="num otkum">{pfmt(r.pct)}</td>
                  <td className="num muted seam">{pfmt(r.gtl)}</td>
                  <td className="ctr"><DeltaPill v={r.vsGtl} /></td>
                </tr>
              ))}
              {!shown.length && (
                <tr><td colSpan={colCount} className="ctr muted" style={{ padding: 24 }}>
                  Tidak ada yang cocok dengan filter ini.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {filtered.length > PAGE && (
          <div className="dpmore">
            <button className="btn" onClick={() => setShowAll(!showAll)}>
              {showAll ? `Tampilkan ${PAGE} pertama` : `Tampilkan semua ${nfmt(filtered.length)}`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- the section */

/*
 * No `onError` any more.
 *
 * It existed to carry a failed PNG export back up to the dashboard's error bar,
 * and both per-table export buttons are gone — the toolbar's single button owns
 * the picture now, and it already reports its own failures where it lives.
 * Nothing else in here can fail: the parser hands over a finished report or
 * `null`, and `null` is a page that says so rather than an error.
 */
export default function OtpuSection({
  report, part, cityOf,
}: {
  report: OtpuReport
  part: OtpuPart
  /** `AGENT12` → `TANGERANG`, resolved against the daily report's agent rows */
  cityOf: (code: string) => string
}) {
  const { agent, seller } = report

  /** What the period covered is called, for the cards and the band. */
  const period = useMemo(() => {
    if (!agent?.weeks.length) return ''
    const a = agent.weeks[0], b = agent.weeks[agent.weeks.length - 1]
    if (a.from && b.to) return `${shortDate(a.from)} – ${longDate(b.to)}`
    return `${a.label} – ${b.label}`
  }, [agent])

  const sellerDays = seller?.days ?? []
  const sellerPeriod = sellerDays.length && sellerDays[0].from && sellerDays[sellerDays.length - 1].to
    ? `${shortDate(sellerDays[0].from)} – ${longDate(sellerDays[sellerDays.length - 1].to!)}`
    : ''

  /* Ranked pools, computed once and used by whichever page is open. */
  const sellerRanked = useMemo(() => {
    if (!seller) return null
    const active = seller.rows.filter(isActive)
    const byAgent = poolBy(active, (r) => r.agent || '—').sort((a, b) => b.orders - a.orders)
    const byHub = poolBy(active, (r) => r.hub || '—')
    const rankable = active.filter((r) => (r.orders ?? 0) >= MIN_RANK_VOL && r.pct != null)
    const worst = [...rankable].sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0)).slice(0, 10)
    const best = [...rankable].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0)).slice(0, 10)
    const worstHubs = byHub
      .filter((h) => h.orders >= MIN_RANK_VOL && h.pct != null)
      .sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0))
      .slice(0, 10)
    return { active, byAgent, byHub, rankable, worst, best, worstHubs, pool: poolPct(active) }
  }, [seller])

  const warnings = [...(agent?.warnings ?? []), ...(seller?.warnings ?? [])]

  /* --------------------------------------------------------------- header */

  const head =
    part === 'agent' ? { num: 'C1', title: 'OTPU Agent', zh: '揽收代理及时率', sub: `Rincian per Agent PU${period ? ` · ${period}` : ''}` }
    : part === 'seller' ? { num: 'C2', title: 'OTPU Seller', zh: '商家揽收及时率', sub: `Rincian per seller × DP${sellerPeriod ? ` · ${sellerPeriod}` : ''}` }
    : { num: 'C', title: 'On Time Pick Up', zh: '及时揽收', sub: `Ringkasan Agent & Seller${period ? ` · ${period}` : ''}` }

  return (
    <div className="otpusection">
      <div className="dphead">
        <span className={`partnum${head.num.length > 1 ? ' two' : ''}`}>{head.num}</span>
        <span className="dptitles">
          <h2>{head.title} <Zh>{head.zh}</Zh></h2>
          <span className="partsub">{head.sub}</span>
        </span>
        {/* Stated in the band rather than in the page chrome: the band is inside
            every PNG this page exports, and the handling class has to travel
            with the picture. */}
        <span className="dpday"><em>Internal J&amp;T — dilarang dibagikan ke luar</em></span>
      </div>

      {warnings.length > 0 && (
        <div className="warnbox">
          {warnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}

      {!agent && part !== 'seller' && (
        <div className="dropzone">
          <h2>Sheet OTPU Agent tidak terbaca <Zh>无法读取</Zh></h2>
          <p>
            File di folder <b>data/</b> tidak memuat tab <b>OTPU Agent</b>, atau susunan
            kolomnya berubah. Tab tersebut harus memuat kolom <b>Total Order</b>,
            {' '}<b>Volume OTPU</b> dan <b>%OTPU</b> per minggu.
          </p>
        </div>
      )}

      {agent && part !== 'seller' && <Cards agent={agent} period={period} />}

      {agent && part !== 'seller' && (
        <div className="panel dptable">
          <AgentTable
            agent={agent}
            cityOf={cityOf}
            title={
              <>
                Rincian per Agent PU <Zh>揽收代理</Zh>
                {' · '}{agent.rows.length} agen{period ? ` · ${period}` : ''}
              </>
            }
          />
        </div>
      )}

      {/* A "%OTPU per Minggu" bar chart stood here, on the agent page only. It
          plotted three bars off the TOTAL row — the same three numbers the
          table's own TOTAL row already spells out one line above, in the same
          order, with the week ranges attached. Two readings of one three-number
          series is not a chart, it is a repetition, and it pushed the table
          down the page to make room for itself. */}

      {/* ----------------------------------------------------------- seller */}

      {!seller && part === 'seller' && (
        <div className="dropzone">
          <h2>Sheet OTPU Seller tidak terbaca <Zh>无法读取</Zh></h2>
          <p>
            File di folder <b>data/</b> tidak memuat tab <b>OTPU Seller</b>, atau susunan
            kolomnya berubah.
          </p>
        </div>
      )}

      {/* Nothing about sellers on the agent page. The counters below are the
          seller tab's population, and a row of them under a table of ten agents
          reads as a breakdown of that table, which is the one thing they are
          not. */}
      {seller && sellerRanked && part !== 'agent' && (
        <>
          <div className="dpstats">
            <Stat n={nfmt(seller.rows.length)} lab="Baris seller × DP" zh="商家网点行数" />
            <Stat n={nfmt(sellerRanked.active.length)} lab="Ada order minggu ini" zh="本周有单" tone="good" />
            <Stat n={nfmt(seller.rows.length - sellerRanked.active.length)} lab="Tanpa order" zh="本周无单" tone="mute" />
            <Stat n={nfmt(sellerRanked.byHub.length)} lab="GTL Hub" zh="抖音网点" />
            <Stat n={pfmt(sellerRanked.pool.pct)} lab="%OTPU seller" zh="商家及时率" tone="good" />
          </div>

          {/* The roll-up belongs to the summary. On the seller page the two
              charts below it — worst ten and best ten sellers — are the ranking
              somebody came for, and four charts stacked above a seventeen
              thousand row table pushes the table off the first screen. */}
          {part === 'all' && (
            <div className="row-dp">
              <div className="panel">
                <h3>
                  <span className="ptitle">%OTPU per Agen — jalur seller <Zh>各代理区</Zh></span>
                </h3>
                <div className="body">
                  <HBarChart
                    bars={(sellerRanked.byAgent
                      .filter((p) => p.pct != null)
                      .sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0))
                      .map((p) => ({
                        name: cityOf(p.key) ? `${p.key} · ${cityOf(p.key)}` : p.key,
                        sub: `${nfmt(p.orders)} order`,
                        value: p.pct as number,
                      })))}
                    targetLine={agent?.gtl ?? null}
                  />
                </div>
              </div>

              <div className="panel">
                <h3>
                  <span className="ptitle">10 GTL Hub Terendah <Zh>后十名网点</Zh></span>
                </h3>
                <div className="body">
                  <HBarChart
                    bars={(sellerRanked.worstHubs.map((h) => ({
                      name: h.label,
                      sub: `${nfmt(h.orders)} order`,
                      value: h.pct as number,
                    })))}
                    targetLine={agent?.gtl ?? null}
                  />
                  <div className="chartnote">
                    Hub dengan kurang dari {MIN_RANK_VOL} order dalam periode ini tidak
                    diperingkat — persentase dari volume sangat kecil tidak dapat dibandingkan.
                  </div>
                </div>
              </div>
            </div>
          )}

          {part === 'seller' && (
            <div className="row-dp">
              <div className="panel">
                <h3><span className="ptitle">10 Seller Terendah <Zh>后十名商家</Zh></span></h3>
                <div className="body">
                  <HBarChart
                    bars={(sellerRanked.worst.map((r) => ({
                      name: r.seller,
                      sub: `${r.hub || '—'} · ${nfmt(r.orders)} order`,
                      value: r.pct as number,
                    })))}
                    targetLine={agent?.gtl ?? null}
                  />
                  <div className="chartnote">
                    Hanya seller dengan minimal {MIN_RANK_VOL} order pada periode ini.
                    {' '}{nfmt(sellerRanked.active.length - sellerRanked.rankable.length)} seller
                    aktif lainnya bervolume terlalu kecil untuk diperingkat.
                  </div>
                </div>
              </div>
              <div className="panel">
                <h3><span className="ptitle">10 Seller Tertinggi <Zh>前十名商家</Zh></span></h3>
                <div className="body">
                  <HBarChart
                    bars={(sellerRanked.best.map((r) => ({
                      name: r.seller,
                      sub: `${r.hub || '—'} · ${nfmt(r.orders)} order`,
                      value: r.pct as number,
                    })))}
                    targetLine={agent?.gtl ?? null}
                  />
                  <div className="chartnote">Ambang volume yang sama: minimal {MIN_RANK_VOL} order.</div>
                </div>
              </div>
            </div>
          )}

          {part === 'seller' && (
            <SellerTable
              seller={seller}
              agentOf={cityOf}
            />
          )}
        </>
      )}

      <div className="note">
        <b>On Time Pick Up (OTPU)</b> = jumlah paket yang benar-benar dijemput tepat waktu dibagi
        jumlah order pada periode yang sama. <b>{agent?.gtlLabel ?? 'GTL'}</b> adalah pembanding
        dari kanal GTL; <b>Banding GTL</b> positif berarti J&amp;T di atas pembanding tersebut.
        {' '}%OTPU sebuah kelompok dihitung tertimbang dari jumlah paket, bukan rata-rata persentase
        barisnya — satu seller dengan 40.000 order dan satu seller dengan 1 order bukan dua suara
        yang sama.
        {' '}Angka pada halaman ini berasal dari tab <b>OTPU Agent</b> dan <b>OTPU Seller</b> di file
        yang sama dengan dashboard harian; keduanya mencakup populasi yang sedikit berbeda, sehingga
        total agen dan total seller tidak harus sama persis.
        {' '}<b>Data ini khusus untuk penggunaan internal J&amp;T</b> — nama seller dan volumenya
        tidak boleh dibagikan ke luar perusahaan.
      </div>
    </div>
  )
}
