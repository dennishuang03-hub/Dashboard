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
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { agentZh } from '../lib/jnt'
import {
  dfmt, isActive, longDate, nfmt, pfmt, poolPct, shortDate, toneOf,
} from '../lib/otpu'
import type {
  OtpuAgentReport, OtpuAgentRow, OtpuPeriod, OtpuReport, OtpuSellerReport, OtpuSellerRow,
} from '../lib/otpu'
import { HBarChart } from './Charts'
import MultiSelect from './MultiSelect'
import OrderFilter from './OrderFilter'
import type { OrderFilterValue } from './OrderFilter'
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

  /* No Perbandingan (占比) column. It carried last week against the week
     before, which is a different question from the one the rest of the
     comparison band asks — everything beside it measures against GTL. The
     figure itself is still on the OTPU KUMULATIF card as "vs minggu lalu",
     which is where a single week-on-week number belongs. */
  out.push({
    id: 'gtl', band: 'cmp', label: agent.gtlLabel, chip: agent.gtlLabel,
    sort: (r) => r.gtl,
    cell: (r) => <span className="gtlv">{pfmt(r.gtl)}</span>,
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

/**
 * Which side of GTL a difference sits on.
 *
 * Takes the number rather than the row, because there are now two of them —
 * the daily difference and the weekly one — and a seller can be above the
 * benchmark on the week while below it on the last day.
 */
function bandOfValue(v: number | null): Band {
  if (v == null) return 'kosong'
  if (v < -0.5) return 'bawah'
  if (v > 0.5) return 'atas'
  return 'setara'
}

/**
 * The three figures the sheet carries for every day, in the order the columns
 * appear. `%OTPU` is last because it is the one computed from the other two.
 */
const DAILY_METRICS = [
  { id: 'orders', label: 'Total Order', zh: '订单量', field: 'dailyOrders' },
  { id: 'picked', label: 'Volume OTPU', zh: '实际揽收件量', field: 'dailyPicked' },
  { id: 'pct', label: '%OTPU', zh: '实际揽收及时率', field: 'dailyPct' },
] as const

type DailyMetric = (typeof DAILY_METRICS)[number]

/**
 * The two weekly counts that can be switched off.
 *
 * `%OTPU` is not in the list on purpose: it is the column the row is judged on
 * and the one every comparison beside it refers to, so it is not offered as
 * something to hide.
 */
const WEEK_COLS = [
  { id: 'orders', label: 'Total Order', zh: '订单量', sort: 'orders' },
  { id: 'picked', label: 'Volume OTPU', zh: '实际揽收件量', sort: 'picked' },
] as const

/* One shared empty set for the figures nobody has narrowed yet. A fresh
   `new Set()` in the render would be a new prop identity every pass. */
const NO_DAYS_OFF: ReadonlySet<string> = new Set<string>()

/**
 * How many days each figure opens on, counted back from the most recent.
 *
 * Not the whole week for any of them. Twenty-one daily columns is the *capacity*
 * of this block, not a sensible first screen — it pushes Total Order, %OTPU and
 * Banding GTL off to the right, which are the columns the page is read for. The
 * counts here are what the report is usually opened to answer: yesterday's two
 * volumes, and enough of a percentage run to see which way it is moving.
 *
 * Every one of them is a tick away from the full seven.
 */
const DEFAULT_DAYS: Record<string, number> = { orders: 1, picked: 1, pct: 3 }

/** The opening day picks, as the off-sets `MultiSelect` speaks in. */
function defaultDayOff(days: OtpuPeriod[]): Record<string, ReadonlySet<string>> {
  const out: Record<string, ReadonlySet<string>> = {}
  for (const m of DAILY_METRICS) {
    /* `days` is oldest-first, so the newest N are the tail and everything
       before them starts switched off. */
    const keep = DEFAULT_DAYS[m.id] ?? days.length
    out[m.id] = new Set(days.slice(0, Math.max(0, days.length - keep)).map((d) => d.key))
  }
  return out
}

/** `d#pct#3` — metric and day index, kept apart from the weekly sort keys. */
const dailySortKey = (id: string, i: number) => `d#${id}#${i}`
const DAILY_SORT_RE = /^d#(orders|picked|pct)#(\d+)$/

/* The floors offered by the daily-order filter, biggest first — the list is
   read as "at least this big", so the strictest choice sits at the top. */
const ORDER_FLOORS = [800, 700, 600, 500, 400, 300, 200, 100]

/**
 * Does this seller clear `min` orders on any of the chosen days?
 *
 * A missing daily figure is a no rather than a zero: the column being absent
 * means the day was not reported, and answering "under 800" for a day nobody
 * measured would put the row on the wrong side of the filter.
 */
function meetsDailyFloor(
  r: OtpuSellerRow, days: OtpuPeriod[], picked: ReadonlySet<string>, min: number,
): boolean {
  return days.some((d, i) => {
    if (!picked.has(d.key)) return false
    const v = r.dailyOrders[i] ?? null
    return v != null && v >= min
  })
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
  /* Two GTL comparisons, filtered apart. The sheet gives a daily difference and
     a weekly one, and they disagree often enough that folding them into a
     single control would hide the disagreement. */
  /* The daily comparison opens on "Di bawah GTL" alone. Six thousand active
     sellers is not a list anybody reads top to bottom, and the ones under the
     benchmark yesterday are the reason this page gets opened. The other three
     bands are one tick away, and the trigger says which band is showing rather
     than leaving a narrowed table to be discovered. */
  const [dayBandOff, setDayBandOff] = useState<ReadonlySet<string>>(
    () => new Set(BAND_ORDER.filter((b) => b !== 'bawah')),
  )
  const [weekBandOff, setWeekBandOff] = useState<ReadonlySet<string>>(() => new Set<string>())
  /* The harian block: which of the three figures are showing, and which days
     each of them is showing. The day list is kept *per figure* rather than
     shared — "Total Order for the whole week, but %OTPU only for the days it
     went wrong" is the shape of the question, and one shared list cannot say
     it. All three figures start ticked; the days they open on are in
     `DEFAULT_DAYS`. */
  const [metricOff, setMetricOff] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [dayOffBy, setDayOffBy] = useState<Record<string, ReadonlySet<string>>>(
    () => defaultDayOff(seller.days),
  )

  /* The two weekly counts, off to begin with. They are what the weekly %OTPU is
     computed *from* rather than what the page is read for, and the same
     reasoning already keeps them off by default in the agent table above. */
  const [weekOff, setWeekOff] = useState<ReadonlySet<string>>(
    () => new Set(WEEK_COLS.map((c) => c.id)),
  )
  const toggleWeek = useCallback((id: string) => {
    setWeekOff((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const weekShown = useMemo(() => WEEK_COLS.filter((c) => !weekOff.has(c.id)), [weekOff])

  const setDayOffFor = useCallback((id: string, next: ReadonlySet<string>) => {
    setDayOffBy((prev) => ({ ...prev, [id]: next }))
  }, [])

  const toggleMetric = useCallback((id: string) => {
    setMetricOff((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  /* Volume floor on the daily order count, and the day it is read on.
     Two controls rather than one because the day is the interesting half:
     a seller that clears 800 on Saturday and 40 on Tuesday is a different
     conversation depending on which day is being asked about. `'any'` keeps
     the row if *any* single day clears the floor. */
  const [order, setOrder] = useState<OrderFilterValue>(
    () => ({ min: null, days: new Set(seller.days.map((d) => d.key)) }),
  )
  /* Off by default: eleven thousand of the seventeen thousand rows shipped
     nothing this week, and a list that opens on them buries the six thousand
     that did. It is a switch rather than a silent filter for the usual reason —
     "where did my seller go?" has to have an answer on the page. */
  const [showZero, setShowZero] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [sortKey, setSortKey] = useState<string>('orders')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const active = useMemo(() => seller.rows.filter(isActive), [seller.rows])
  const zeroCount = seller.rows.length - active.length

  const opts = useMemo(() => {
    const agents = new Map<string, number>()
    for (const r of seller.rows) {
      if (!showZero && !isActive(r)) continue
      agents.set(r.agent || '—', (agents.get(r.agent || '—') ?? 0) + 1)
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
    }
  }, [seller.rows, showZero, agentOf])

  /** Bands against GTL, so the list can be narrowed to the problem. */
  const bandOptsFor = useCallback((pick: (r: OtpuSellerRow) => number | null): MsOption[] => {
    const m = new Map<Band, number>()
    for (const r of seller.rows) {
      if (!showZero && !isActive(r)) continue
      const b = bandOfValue(pick(r))
      m.set(b, (m.get(b) ?? 0) + 1)
    }
    /* Listed in the fixed order rather than in the order they happen to turn
       up, so the filter reads as a scale; a band nobody is in is left out
       instead of offered as a zero. */
    return BAND_ORDER
      .filter((b) => m.has(b))
      .map((b) => ({ value: b, label: BAND_LABEL[b], n: m.get(b) }))
  }, [seller.rows, showZero])

  const dayBandOpts = useMemo(() => bandOptsFor((r) => r.vsDaily), [bandOptsFor])
  /* `vsGtl`, not the sheet's `vsWeekly`: the Selisih Mingguan column draws
     `vsGtl`, and a filter that sorted rows by a number the table does not show
     can put a row the user asked for "below GTL" on screen reading `+0,4%`.
     The two agree almost everywhere — `vsGtl` is `pct - gtl` recomputed — which
     is exactly why the disagreements would be impossible to account for. */
  const weekBandOpts = useMemo(() => bandOptsFor((r) => r.vsGtl), [bandOptsFor])

  const dayOpts = useMemo<MsOption[]>(
    () => seller.days.map((d) => ({ value: d.key, label: d.from ? shortDate(d.from) : d.label })),
    [seller.days],
  )

  /*
   * The daily blocks actually drawn, in column order.
   *
   * Each carries the days it survived with the index each day has in the row
   * arrays. The index has to travel with the day: once days can be switched off
   * per figure, position in this list stops matching position in `dailyOrders`.
   *
   * A figure whose days are all unticked drops out here rather than rendering a
   * band nought columns wide, which would leave a stray header over nothing.
   */
  const dailyBands = useMemo(() => DAILY_METRICS
    .filter((m) => !metricOff.has(m.id))
    .map((m) => ({
      m: m as DailyMetric,
      days: seller.days
        .map((d, i) => ({ d, i }))
        .filter(({ d }) => !dayOffBy[m.id]?.has(d.key)),
    }))
    .filter((b) => b.days.length > 0),
  [seller.days, metricOff, dayOffBy])

  const dailyWidth = dailyBands.reduce((n, b) => n + b.days.length, 0)

  /**
   * Publish the band row's real height as `--secrow-h`, which is what the
   * category row sticks below — the same measurement `DpSection` takes, for the
   * same reason.
   *
   * This table was running on the 30px fallback, which was already a guess and
   * became a wrong one the moment the band heads were allowed to wrap. A band
   * that grows to two lines under a category row pinned at 30px leaves the two
   * overlapping as the body scrolls under them.
   */
  const secRowRef = useRef<HTMLTableRowElement>(null)
  useLayoutEffect(() => {
    const row = secRowRef.current
    if (!row) return
    const table = row.closest('table') as HTMLElement | null
    if (!table) return
    const apply = () => {
      /* Floored, for the reason spelled out in DpSection: a fractional height
         resolves to a device pixel that can land either side of the band's edge,
         and rounding down always takes the invisible overlap over the seam. */
      const h = row.getBoundingClientRect().height
      table.style.setProperty('--secrow-h', `${Math.max(0, Math.floor(h))}px`)
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(row)
    return () => ro.disconnect()
  }, [dailyBands])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const out = seller.rows.filter((r) => {
      if (!showZero && !isActive(r)) return false
      if (agentOff.has(r.agent || '—')) return false
      if (dayBandOff.has(bandOfValue(r.vsDaily))) return false
      if (weekBandOff.has(bandOfValue(r.vsGtl))) return false
      if (order.min != null && !meetsDailyFloor(r, seller.days, order.days, order.min)) return false
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
        case 'vsdaily': return cmpNum(a.vsDaily, b.vsDaily, dir)
        default: {
          const m = DAILY_SORT_RE.exec(sortKey)
          if (m) {
            const field = m[1] === 'orders' ? 'dailyOrders' : m[1] === 'picked' ? 'dailyPicked' : 'dailyPct'
            const i = Number(m[2])
            return cmpNum(a[field][i] ?? null, b[field][i] ?? null, dir)
          }
          return cmpNum(a.orders, b.orders, dir)
        }
      }
    })
    return out
  }, [seller.rows, seller.days, q, agentOff, dayBandOff, weekBandOff, order, showZero, sortKey, sortDir])

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

  /* seller, hub, DP, agent · the daily block · the weekly counts still showing,
     then %OTPU, GTL and the two selisih columns */
  const colCount = 4 + dailyWidth + weekShown.length + 4

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
          name="Banding GTL Harian" zh="日度对比GTL" allLabel="Banding GTL Harian"
          options={dayBandOpts} off={dayBandOff} onChange={setDayBandOff}
        />
        <MultiSelect
          name="Banding GTL Mingguan" zh="周度对比GTL" allLabel="Banding GTL Mingguan"
          options={weekBandOpts} off={weekBandOff} onChange={setWeekBandOff}
        />
        <OrderFilter
          days={seller.days} floors={ORDER_FLOORS} value={order} onApply={setOrder}
        />
        <label className="colchip">
          <input type="checkbox" checked={showZero} onChange={() => setShowZero(!showZero)} />
          Tampilkan {nfmt(zeroCount)} baris tanpa order
        </label>
      </div>

      {/* The daily switches get their own bar rather than a place in the filter
          row above. They answer a different question — what the table *shows*,
          not which rows it keeps — and six more controls in that row pushed the
          search box onto a line of its own. */}
      <div className="dailybar">
        <span className="dailybar-lab">Data harian<Zh>日度数据</Zh></span>
        {DAILY_METRICS.map((m) => {
          const on = !metricOff.has(m.id)
          return (
            <div className="dailyrow" key={m.id}>
              <label className={`colchip${on ? '' : ' off'}`}>
                <input type="checkbox" checked={on} onChange={() => toggleMetric(m.id)} />
                {m.label} Harian<Zh>{`日度${m.zh}`}</Zh>
              </label>
              <MultiSelect
                name={`Hari ${m.label}`} zh="日期"
                allLabel={`Semua hari (${seller.days.length})`}
                options={dayOpts}
                off={dayOffBy[m.id] ?? NO_DAYS_OFF}
                onChange={(next) => setDayOffFor(m.id, next)}
                /* Greyed rather than hidden when the figure is switched off: the
                   day picks survive the tick, and a control that vanished would
                   make it look as though they had been forgotten. */
                disabled={!on}
              />
            </div>
          )
        })}

        <span className="dailybar-lab">Data mingguan<Zh>周度数据</Zh></span>
        {WEEK_COLS.map((c) => (
          <div className="dailyrow" key={c.id}>
            <label className={`colchip${weekOff.has(c.id) ? ' off' : ''}`}>
              <input
                type="checkbox"
                checked={!weekOff.has(c.id)}
                onChange={() => toggleWeek(c.id)}
              />
              {c.label} Mingguan<Zh>{`周度${c.zh}`}</Zh>
            </label>
          </div>
        ))}
      </div>

      <div className="body" style={{ padding: 0 }}>
        <div className="dpscroll">
          <table className="dpgrid otgrid">
            <thead>
              <tr className="secrow" ref={secRowRef}>
                {/* The frozen name column keeps an empty band cell — it is one
                    column wide and the row beneath already says "Nama Seller",
                    so a label here would only repeat it. The three that follow
                    get a head of their own rather than three more empty black
                    cells: they are a group, and an unlabelled gap over them read
                    as the table missing something. */}
                <th className="sticky" />
                <th className="secband" colSpan={3}>Lokasi &amp; Agen<Zh>网点与代理</Zh></th>
                {dailyBands.map(({ m, days }) => (
                  <th key={m.id} className="secband seam" colSpan={days.length}>
                    {m.label} Harian<Zh>{`日度${m.zh}`}</Zh>
                  </th>
                ))}
                <th className="seam" colSpan={weekShown.length + 1}>Mingguan<Zh>周度</Zh></th>
                <th colSpan={3} className="seam">Banding GTL<Zh>对比GTL</Zh></th>
              </tr>
              <tr className="catrow">
                <th className="sticky" onClick={() => sortOn('seller')}>
                  Nama Seller{arrow('seller')}<Zh>商家名称</Zh>
                </th>
                <th onClick={() => sortOn('hub')}>GTL Hub{arrow('hub')}<Zh>抖音网点</Zh></th>
                <th onClick={() => sortOn('dp')}>DP Pickup{arrow('dp')}<Zh>实际取件网点</Zh></th>
                <th onClick={() => sortOn('agent')}>Agent{arrow('agent')}<Zh>寄件代理</Zh></th>
                {dailyBands.map(({ m, days }) => (
                  days.map(({ d, i }, k) => {
                    const key = dailySortKey(m.id, i)
                    return (
                      <th
                        key={`${m.id}-${d.key}`} className={`num cat${k === 0 ? ' seam' : ''}`}
                        onClick={() => sortOn(key)}
                      >
                        {d.short}{arrow(key)}
                      </th>
                    )
                  })
                ))}
                {weekShown.map((c, k) => (
                  <th
                    key={c.id} className={`num cat${k === 0 ? ' seam' : ''}`}
                    onClick={() => sortOn(c.sort)}
                  >
                    {c.label}{arrow(c.sort)}<Zh>{c.zh}</Zh>
                  </th>
                ))}
                <th
                  className={`num cat${weekShown.length === 0 ? ' seam' : ''}`}
                  onClick={() => sortOn('pct')}
                >
                  %OTPU{arrow('pct')}<Zh>及时率</Zh>
                </th>
                <th className="num cat seam" onClick={() => sortOn('gtl')}>
                  {seller.gtlLabel}{arrow('gtl')}
                </th>
                <th className="ctr cat" onClick={() => sortOn('vsdaily')}>
                  Selisih Harian{arrow('vsdaily')}<Zh>日度差值</Zh>
                </th>
                <th className="ctr cat" onClick={() => sortOn('vsgtl')}>
                  Selisih Mingguan{arrow('vsgtl')}<Zh>周度差值</Zh>
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
                  {dailyBands.map(({ m, days }) => (
                    days.map(({ d, i }, k) => {
                      const seam = k === 0 ? ' seam' : ''
                      const when = d.from ? shortDate(d.from) : d.label
                      const tip = `${when} · ${nfmt(r.dailyPicked[i])} dari ${nfmt(r.dailyOrders[i])}`
                      const cellKey = `${m.id}-${d.key}`
                      /* Counts read as plain numbers; only the percentage gets the
                         heat, and it is measured against the same GTL the rest of
                         the row is. */
                      if (m.id !== 'pct') {
                        const n = r[m.field][i] ?? null
                        return (
                          <td key={cellKey} className={`num${n == null ? ' muted' : ''}${seam}`} title={tip}>
                            {nfmt(n)}
                          </td>
                        )
                      }
                      const v = r.dailyPct[i] ?? null
                      if (v == null) return <td key={cellKey} className={`num muted${seam}`}>—</td>
                      const bad = r.gtl != null && v < r.gtl
                      return (
                        <td key={cellKey} className={`num hm ${bad ? 'bad' : 'ok'}${seam}`} title={tip}>
                          {pfmt(v, 1)}
                        </td>
                      )
                    })
                  ))}
                  {weekShown.map((c, k) => (
                    <td key={c.id} className={`num${k === 0 ? ' seam' : ''}`}>
                      {nfmt(c.id === 'orders' ? r.orders : r.picked)}
                    </td>
                  ))}
                  <td className={`num otkum${weekShown.length === 0 ? ' seam' : ''}`}>
                    {pfmt(r.pct)}
                  </td>
                  <td className="num gtlv seam">{pfmt(r.gtl)}</td>
                  <td className="ctr">
                    <DeltaPill v={r.vsDaily} title={`%OTPU harian dibanding ${seller.gtlLabel}`} />
                  </td>
                  <td className="ctr">
                    <DeltaPill v={r.vsGtl} title={`%OTPU mingguan dibanding ${seller.gtlLabel}`} />
                  </td>
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
    /* No per-seller worst/best ten any more — the two charts that read them are
       gone, and the seller table sorts on %OTPU for the same question. Hubs are
       still ranked: that chart lives on the summary page. */
    const worstHubs = byHub
      .filter((h) => h.orders >= MIN_RANK_VOL && h.pct != null)
      .sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0))
      .slice(0, 10)
    return { active, byAgent, byHub, worstHubs, pool: poolPct(active) }
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
                    honest
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
                    honest
                  />
                  <div className="chartnote">
                    Hub dengan kurang dari {MIN_RANK_VOL} order dalam periode ini tidak
                    diperingkat — persentase dari volume sangat kecil tidak dapat dibandingkan.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* The worst-ten and best-ten seller charts used to sit here. They
              ranked by %OTPU, which the table already sorts on, and the table
              is what this page is for — the charts only pushed it further down
              the first screen. */}

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
