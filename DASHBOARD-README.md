# J&T Daily Agent Performance Dashboard

Two builds of the same dashboard. Both read the Excel file **entirely in the browser** — no data is
uploaded, stored, or written to disk. Close the tab and it's gone.

---

## 1. Standalone — `jnt-dashboard.html`

Double-click it. That's the whole setup. No install, no server, no build step — email it or drop it on
a shared drive for the regional team.

**Offline use:** it pulls the Excel reader (SheetJS) from a CDN. If the machine has no internet,
download `xlsx.full.min.js` from cdn.sheetjs.com into the same folder — the page falls back to it.

> **Note:** the standalone file does **not** include the DP/CP section described below — that lives in
> the React app only. Run `npm run dev` for the drop-point view.

## 2. React app — `npm run dev`

```bash
npm install      # installs xlsx (added to package.json)
npm run dev
```

| File | Purpose |
| --- | --- |
| `src/lib/jnt.ts` | Parser + KPI model. Framework-free, reusable. |
| `src/components/Charts.tsx` | Hand-rolled SVG line/bar/h-bar/sparkline. No chart library. |
| `src/components/DpSection.tsx` | Drop point / collection point view. |
| `src/Dashboard.tsx` | All UI. |
| `src/components/Zh.tsx` | Mandarin gloss shown beside a heading. |
| `src/dashboard.css` | Styling. |

### Language

The interface is in **Bahasa Indonesia**. Every *heading* — page title, panel title, table column
header, KPI card name, stat label — also carries a Mandarin gloss in lighter type, the same way the
workbook labels its own headers (`代理区 / Agent`, `网点 / Nama Drop point`). Running text, tooltips,
hints and footnotes stay in Indonesian alone: glossing whole sentences doubles the reading load
without helping anyone find anything.

Category names come from `CATEGORY_ZH` in `src/lib/jnt.ts` and are lifted **verbatim from the
workbook's header rows**, not translated — so someone reading the dashboard and someone reading the
Excel see the same words. The CSV export carries both languages in its header row for the same reason.

---

## How it reads your workbook

**Every sheet is parsed and merged into one dashboard.** Your report splits the categories across
tabs — `Pickup & Retur Non Ecom`, `6.30, 7,3, & 12.00`, `R-2, TPTW, & Persentase TTD` — and each tab
repeats the same agent list. Agents are matched on **Kode Agent** (falling back to the agent name), so
selecting `JAKARTA · AGENT40` shows all eight KPIs on one screen even though they came from three tabs.

Sheets that aren't KPI tables (e.g. `Sheet1`) are skipped, and a small amber banner tells you which
ones and why.

**Layout it expects** — three identity columns, then any number of KPI groups:

```
┌──────┬───────────┬────────────┬──────────────────────────────────────────────────┐
│ Area │  Agent    │ Kode Agent │            Kualitas Non Platform                 │
│      │           │            ├───────────────────────┬──────────────────────────┤
│      │           │            │ Pickup Non-Ecommerce  │ Retur COD Non-Ecommerce  │
│      │           │            ├──────┬──────────┬─────┼──────┬──────────┬────────┤
│      │           │            │Target│26/07/2026│ …   │Target│26/07/2026│   …    │
├──────┼───────────┼────────────┼──────┼──────────┼─────┼──────┼──────────┼────────┤
│ Jawa │ TANGERANG │  AGENT12   │ 85%  │  90.00%  │ …   │ 85%  │  90.00%  │   …    │
│ &Bali│    …      │            │      │          │     │      │          │        │
├──────┴───────────┴────────────┼──────┼──────────┼─────┼──────┼──────────┼────────┤
│            Total              │      │  93.11%  │ …   │      │  93.11%  │   …    │
└───────────────────────────────┴──────┴──────────┴─────┴──────┴──────────┴────────┘
```

- Identity columns (`Area`, `Agent`, `Kode Agent`, `No`, …) are detected and skipped automatically
- **Group** = outermost header · **KPI** = innermost header
- Sub-columns: `Target` → per-agent target · a date → that day's value · `Pencapaian Bulanan` → MTD
- Days are listed newest-first in the file; the charts re-sort them oldest → newest
- Dates are matched at **day precision**, so a date cell in one tab lines up with a text date in another
- `Total` is used for the all-agents view instead of being treated as an agent
- **Jawa & Bali only.** Rows whose Area doesn't match `jawa` / `java` / `bali` are dropped, and if any
  are dropped the file's own `Total` row goes with them (it would be a national total, not a regional
  one) — the all-agents figure is then averaged from the regional agents instead. If the Area column is
  blank throughout, every row is kept.
- If an export loses its merged-cell metadata, group rows are forward-filled instead

**Values.** `90.00%`, `90`, and `0.90` (percent-formatted) all resolve to `90.00%`. Em dashes, `--`,
`#####` (column too narrow), and `N/A` become "no data". European decimal commas are handled.

**Targets**, in priority order: your manual entry in the mapping panel → the `Target` column for that
specific agent → `≥ 95%` (or `≤ 2%` for return-type KPIs).

---

## The eight categories

These are the only boxes shown, in this order. Labels are resolved from **group + KPI name together**,
because `Persentase TTD` means different things in different groups:

| # | Shown as | Group | Column in the file |
| --- | --- | --- | --- |
| 1 | 06:30 ABSENSI | Ritase Pertama | Tingkat Kecepatan Waktu Kehadiran Sprinter |
| 2 | 07:30 KELUAR GUDANG | Ritase Pertama | Persentase Keluar Gudang 0730 |
| 3 | TTD PAKET JAM 12:00 | Ritase Pertama | Persentase TTD |
| 4 | TTD RITASE 2 | Ritase Kedua | Persentase TTD Delivery Kedua |
| 5 | TPTW (ON TIME) | Operational Harian | TPTW |
| 6 | TTD FULL DAY | Operational Harian | Persentase TTD |
| 7 | PICKUP NON-ECOMMERCE | Kualitas Non Platform | Pickup Non-Ecommerce |
| 8 | RETUR COD NON-ECOMMERCE | Kualitas Non Platform | Retur COD Non-Ecommerce |

There is **no OTPU (T-1) box** — that metric was in the original blueprint but isn't in the data, so it
isn't rendered. If the file ever contains a column that isn't one of the eight above, it's still parsed
but starts switched off; tick it in the mapping panel to bring it in. All labels are editable there too.

---

## DP / CP level — the per-agent tabs

Alongside the three summary tabs the workbook now carries one tab per agent (`AG12`, `AG13`, … `AG40`),
each listing that agent's drop points (DP) and collection points (CP):

```
┌───────────┬────────────┬─────────────────────┬────────────────────────────────────┐
│   Agent   │ Kode Agent │  Nama Drop point    │   Penilaian Kualitas Ritase Pertama │
│           │            │                     ├──────┬──────────┬──────────┬───────┤
│           │            │                     │Target│29/07/2026│28/07/2026│  MTD  │
├───────────┼────────────┼─────────────────────┼──────┼──────────┼──────────┼───────┤
│ TANGERANG │  AGENT12   │  SERANG_JAYA        │90.00%│  85.33%  │  89.23%  │86.02% │
│           │            │  KASEMEN_JAYA       │90.00%│  89.13%  │  90.38%  │88.54% │
└───────────┴────────────┴─────────────────────┴──────┴──────────┴──────────┴───────┘
```

These tabs are detected by their `Nama Drop point` / `网点` column and parsed **separately** — they are
never merged into the agent rows, or the Chinese-named columns would produce a second copy of every KPI
card. Drop points join their agent on **Kode Agent**, falling back to the tab name (`AG12` → `AGENT12`),
so the section follows whatever the agent picker is set to. Category names are resolved through the same
`shortLabel()` aliases as the summary tabs, which is what makes
`快递员出勤准点率 / Tingkat Ketepatan Waktu Kehadiran Spirnter` and `06:30 ABSENSI` the same thing.

The DP tabs carry fewer days than the summary tabs. Picking a date they don't have shows the closest day
they do have, and says so, rather than blanking the section.

### Pickup-only and closed sites

Two shapes of zero are not underperformance, and both are kept out of the rankings:

| Status | Rule | Why |
| --- | --- | --- |
| **Pickup only** | 06:30, 07:30 **and** 12:00 all read 0 | No sprinter is based there, so the delivery categories are structurally zero. A `0.00%` worst-five entry would be meaningless. |
| **Closed** | every category reads 0 | The site is shut. |
| **Active** | anything else | Eligible for the rankings. |

Both are still listed in the DP/CP table with a badge and their cells greyed rather than red — "why is
this one missing from the chart?" has to have a visible answer.

### The third exclusion: zero in the ranked category

Status is judged across all eight categories, but a ranking looks at one. A site can be **active** and
still read exactly `0` in the category being ranked — `CP_ARIF_RAHMAN_HAKIM` scores 100% at 07:30 and
12:00 but 0 at 06:30. In this report that 0 means *nothing happened in this category today*, not
*performed at 0%*, so those rows are dropped from the top five and worst five as well. Left in, they
would own the worst-five every single day and say nothing.

This applies to `RETUR COD` too, where low is good: a 0.00% return rate at a site that handled no COD
parcels is not the region's best performer, it is an empty cell wearing a medal.

The exclusion is **only** applied to the two ranking charts. The status counters, the below-target count
and the per-agent chart still count every active site, so a caption under each chart says how many rows
the zero rule held back — otherwise the counters and the bars would disagree with no explanation.

### What the section shows

- **Counters** — total, active, pickup-only, closed, and how many are below target in the chosen category
- **Top 5 / Worst 5** — horizontal bars, each chart with its **own** category dropdown, target line drawn
  in. "Worst" respects direction, so for `RETUR COD` it means the highest, not the lowest
- **Below-target DP/CP by agent** — only in the all-agents view
- **DP/CP list** — every site with all eight categories in one grid. Only the **misses** are tinted;
  values that met their target stay plain, and the structural zeros of a pickup-only or closed site are
  greyed rather than reddened. Search, status filter, DP vs CP filter, below-target-only filter, day vs
  MTD toggle, sort on any column, and an Excel export of whatever the filters currently show

The whole section is deliberately low-contrast: one accent colour, no uppercase tracking, no heavy
weights beyond a single semibold for headings. The red is reserved for things that are actually wrong.

### The Excel export

**Ekspor Excel** writes a real `.xlsx` — not a CSV. CSV was the wrong container here: this report is
opened in an Indonesian Excel, where the list separator is `;` and `90,00` is a number, so a
comma-delimited file has no separator Excel recognises and every row arrives whole in column A. A
workbook carries its own typing instead: numbers arrive as numbers, text as text, nothing depends on the
reader's regional settings, and the Mandarin survives without a BOM.

**One sheet, and it is the table** — same columns as **Daftar DP / CP** on screen, same order, and only
the rows the filters are currently showing. Nothing else is added: no summary sheet, no extra columns.

- The Agent column appears only in the all-agents view, exactly as it does on screen
- Percentages are stored as real numbers (`98.25`) and formatted `0.00"%"`, so the cell *displays* 98.25%
  while still averaging and sorting correctly. A true percent format would multiply by 100 and print 9825%
- Autofilter is already switched on and the column widths are set
- Column headers carry both languages, the same way the source workbook writes its own
- Filename: `Daftar DP-CP TANGERANG 2026-07-28.xlsx` (or `… bulanan.xlsx` on the MTD toggle)

**No header colour, and it is not an oversight.** The community build of SheetJS writes `styles.xml`
with `<fonts count="1">` and `<fills count="2">` hardcoded (`write_sty_xml`, `xlsx.mjs`) — the only part
it varies is the number-format table. Fills, colours and bold are therefore unreachable, and so is a
frozen header row. Getting them needs a swap to `xlsx-js-style`, a drop-in fork with the same API.
Column widths and autofilter come through the supported `!cols` / `!autofilter` keys, and they are what
actually make the sheet workable.

## Two PNG buttons, two scopes

**Simpan PNG** in the toolbar captures the dashboard and stops above the DP/CP section. The DP/CP list
has its own **Simpan PNG** next to **Ekspor Excel**, which captures that panel alone.

They are separate because they are separate documents that happen to share a page: one is a daily
summary for an agent, the other a working list of sites. Photographed together the image came out too
tall to read and too wide to send. The scopes are two body classes applied for the duration of the shot
(`shoot-main`, `shoot-table`); the table shot also lets the wrap size to the grid instead of the fixed
1480px capture width, so the right-hand categories are not cropped off. Both shots drop the buttons and
the filter bar, which is why the day is printed in the panel title.

---

## Status colours

Binary, no middle ground: **green = met the target, red = missed it.** A card that misses turns its
value red and takes a light background tint. Nothing pulses, flashes or animates — a dashboard that
someone reads every morning should sit still.

Hovering any card — or any status badge in the two tables — fades in a small dark panel explaining the
call, e.g.

> **⚠ Below target**
> 89.32% against target ≥ 85.00%
> Short by 4.32 points.
> Declined −0.50 vs 25 Jul.
> Penilaian Kualitas Delivery Ritase Pertama

The animation is disabled automatically for anyone with "reduce motion" turned on.

---

## Controls

- **Agent** (top right) — every agent with its kode, plus an all-agents total
- **Report date** — pick which of the 7 days is "today"; the comparison column becomes the day before
- **Search agent / kode** — matches `JAKARTA` or `AGENT40`
- **Column mapping** — rename KPIs, override targets, flip direction, hide KPIs, choose trend lines
- **Print / PDF** — clean print layout with the toolbar stripped

## Direction (≥ or ≤) is inferred from the data

Not from the column name. `Retur COD Non-Ecommerce` *sounds* like a return rate you want small, but the
file scores it against an `85%` target that the readings sit above — so it's really a `≥` metric.

Where a `Target` column exists, the parser counts how many readings fall above vs below it across every
agent and every day, and takes the majority side as the intended direction. A genuine return-rate KPI
(target `≤ 2%`, values around `1.4%`) lands on the other side and is correctly read as `≤`. The column
name is only used as a fallback when there's no target to compare against. Always overridable in the
mapping panel.

## A note on Excel dates

Dates are converted from the raw Excel serial number rather than through SheetJS's date conversion.
SheetJS builds dates from an 1899 baseline and corrects for the timezone offset difference between then
and now — and in zones with an odd historical offset (Jakarta was **+07:07** in 1899) the result lands a
few minutes *before* midnight, so every column reads as the previous day. Converting the serial directly
through UTC removes the machine's timezone from the equation entirely.

## If a file doesn't parse

Open **Column mapping** first — it shows which sheet each column came from and how it was classified.
The parser is header-name driven, not position driven, so adding agents, adding days, or reordering
KPI groups won't break it.
