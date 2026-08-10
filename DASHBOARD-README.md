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
| `src/App.tsx` | Session gate — login screen or dashboard. |
| `src/Login.tsx` | Sign-in screen. |
| `src/components/Zh.tsx` | Mandarin gloss shown beside a heading. |
| `src/dashboard.css` | Styling. |
| `api/` | Serverless routes: login, logout, session, report. |
| `data/` | The workbook. Server-side only — never bundled, never public. |

The app is behind a login, and the workbook is served by `/api/report` to a
signed-in session rather than shipped as a static asset. `npm run dev` serves the
UI with no API behind it, so use `vercel dev` to work on anything that touches
sign-in. **Setup, and what the login does and does not protect: [`SECURITY-SETUP.md`](SECURITY-SETUP.md).**

### Language

The interface is in **Bahasa Indonesia**. Every *heading* — page title, panel title, table column
header, KPI card name, stat label — also carries a Mandarin gloss in lighter type, the same way the
workbook labels its own headers (`代理区 / Agent`, `网点 / Nama Drop point`). Running text, tooltips,
hints and footnotes stay in Indonesian alone: glossing whole sentences doubles the reading load
without helping anyone find anything.

Category names come from `CATEGORY_ZH` in `src/lib/jnt.ts` and are lifted **verbatim from the
workbook's header rows**, not translated — so someone reading the dashboard and someone reading the
Excel see the same words. The Excel export carries both languages for the same reason.

Agent cities come from `AGENT_ZH` in the same file (`JAKARTA 雅加达`, `TANGERANG 唐格朗`, …). The
per-agent tabs already write the combined form in their Agent column, but the summary tabs are Latin
only and the summary name is the one that wins the join — so the Mandarin comes from a lookup rather
than from keeping CJK the parser strips. `agentZh()` returns the gloss for JSX; `agentFull()` returns
`"TANGERANG 唐格朗"` for the places that can only take a string — `<option>` text, SVG axis labels and
the Excel export.

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

### What each site actually runs

The status badge says which halves of the operation a site was running that day. It is read off the data,
in this order — each rule is a more specific answer than the one below it, so the first match wins:

| Status | Rule | Why |
| --- | --- | --- |
| **Tutup** (closed) | every category reads 0 | The site is shut. Tested first: a closed site is zero on 06:30 and 07:30 too, so any later rule would mislabel it. |
| **Pick up Only** | 06:30 **and** 07:30 both read 0 | Nobody clocks in and nothing leaves the warehouse, so no sprinter is based there — the site only takes parcels in. Every delivery category is then structurally zero, not bad. |
| **Delivery Only** | TPTW reads 0 | Couriers deliver out of the site but it hands nothing over to the pickup flow. Tested after pickup-only, which is also zero on TPTW. |
| **Delivery and Pick up** | anything else | Both flows run. |

12:00 is deliberately **not** part of the pickup-only rule even though it is a sprinter category. It is a
*result* — the share of the first ritase signed by noon — so a site whose couriers all clocked in and left
on time can still read 0 there on a bad day. Attendance and warehouse-exit are the two that cannot be zero
while a courier is present.

**Pick up Only** and **Tutup** are kept out of the two ranking charts; **Delivery Only** and **Delivery and
Pick up** are ranked. All four are still listed in the DP/CP table with a badge, and the structural zeros
are greyed rather than reddened — "why is this one missing from the chart?" has to have a visible answer.
A **Delivery Only** site is scored over the categories it actually runs, so the zeros it is *supposed* to
have do not drag its "Sesuai target" ratio down.

### Model bisnis: FR and AG

The per-agent tabs carry a `商业模式 / Model Bisnis` column beside the drop-point name, saying whether the
site is partner-run (**Franchise**) or ours (**Agent**). On screen it is the two-letter tag in front of
every name — **FR** / **AG**, grey **?** when the workbook does not say — plus a filter in the toolbar.
There is no separate column: the tag already carries it in space the table was spending anyway. The tag
replaced the old DP/CP one because the name is already prefixed `CP_` where that distinction matters, so
the two letters are better spent on the thing the name does not tell you. The Excel export *does* keep a
`Model Bisnis` column, because a spreadsheet has no tag to read it off. The DP vs CP filter and the
export's `Jenis` column are unchanged.

**Finding the column** is done twice over, because a header-only match is fragile — one renamed title and
every site silently reads `?`. First the header block is swept from row 0 (not from the 网点 row: that
title's merge can start lower than the Model Bisnis one, which put the column out of reach) for
`Model Bisnis` / `商业模式` / `Bisnis` / `模式`. If nothing matches, the columns step 3 did not claim as a
KPI are read instead, and one is accepted when a **majority** of its non-empty cells are exactly the word
`Franchise` or `Agent`. The match there is strict — "contains" would have handed the job to `Kode Agent`,
whose every cell reads `AGENT12`.

### The third exclusion: zero in the ranked category

Status is judged across all eight categories, but a ranking looks at one. A site can run a delivery shift
and still read exactly `0` in the category being ranked — `CP_ARIF_RAHMAN_HAKIM` scores 100% at 07:30 and
12:00 but 0 at 06:30. In this report that 0 means *nothing happened in this category today*, not
*performed at 0%*, so those rows are dropped from the top five and worst five as well. Left in, they
would own the worst-five every single day and say nothing.

This applies to `RETUR COD` too, where low is good: a 0.00% return rate at a site that handled no COD
parcels is not the region's best performer, it is an empty cell wearing a medal.

The exclusion is **only** applied to the two ranking charts. The status counters, the below-target count
and the per-agent chart still count every delivery-running site, so a caption under each chart says how
many rows the zero rule held back — otherwise the counters and the bars would disagree with no explanation.

### Ranking on the whole scorecard

Picking one category answers "who is worst at 06:30?". **SEMUA KPI · jumlah sesuai target** answers the
broader question the eight categories are there to support: *which site is failing on the most fronts?*
It counts, per site, how many of the eight KPIs met their target, and ranks on that count.

The counts are the ones already in the table's **Sesuai target** column, computed once and shared, so a
bar reading `6 / 8` and the row reading `6/8` can never drift apart — a chart that contradicts the table
beneath it is worse than no chart at all.

The two charts count **opposite things**, on purpose: worst-five counts misses, best-five counts hits. In
both, the bar grows in the direction the title promises. A best-five drawn on misses would give its
winner no bar at all, which reads as missing data rather than as a clean sheet. The caption under each
chart says which is which, because `6 / 8` alone is ambiguous in exactly the way that matters.

**Ties are the normal case,** not the exception — on a count of eight, a dozen sites can all sit at three
misses. So the count is only the first sort key; sites level on it are then ordered by total distance from
target, summed across the eight categories and signed so positive is good. Two sites both missing three
KPIs are not equally bad, and without the tiebreak "worst five" would be five arbitrary picks out of
twenty.

Only sites that run a delivery shift are ranked, as everywhere else. Sites with nothing scored are
dropped — met 0 of 0 is neither an achievement nor a failure. The **zero rule** below does *not* apply
here: a `0` in one category is a real miss on a real KPI, and the site is being judged on eight of them
rather than on that one. A bar is green only for a clean sheet; anything short of it is red, the same
binary the rest of the dashboard uses.

### What the section shows

- **Counters** — total, delivery-and-pickup, delivery-only, pickup-only, closed, and how many are below
  target in the chosen category
- **Top 5 / Worst 5** — horizontal bars, each chart with its **own** category dropdown, target line drawn
  in. "Worst" respects direction, so for `RETUR COD` it means the highest, not the lowest. The first
  entry in that dropdown, **SEMUA KPI · jumlah sesuai target**, ranks on the whole scorecard instead —
  see below
- **Below-target DP/CP by agent** — only in the all-agents view
- **DP/CP list** — every site with all eight categories in one grid. Only the **misses** are tinted;
  values that met their target stay plain, and the structural zeros of a pickup-only, delivery-only or
  closed site are greyed rather than reddened. Search, status filter, DP vs CP filter, model-bisnis
  filter, below-target-only filter, day vs MTD toggle, sort on any column, a tick box per column, and an
  Excel export of whatever the filters currently show

### The column switch

A row of tick boxes sits between the filter bar and the grid — one per column, in the order the columns
appear, clustered under the same section names the header band uses. Everything is ticked to begin with;
unticking one takes the column and its figures out of the table, and the section band above narrows to
match. Ticking it back brings it — and the order it was sorting by, if it was — straight back.
**Pilih semua** switches the lot, and carries the third state: a dash, not a tick, while some columns are
on and others off.

**It is spelled out rather than folded into a dropdown**, and that is a correction. The first version was
a 290px popover anchored to a button, which on a narrow window opened off the edge of the screen with no
way to reach the rest of it. But the clipping only exposed the real problem: which columns you are reading
is the *state of the table*, and a menu hides it. Laid flat, the boxes are that state — eleven labels with
three unticked answers "why is TPTW not here?" with nothing to open.

- **The name column cannot be switched off.** It is shown, ticked and locked: a table of unlabelled
  percentages is not a narrower table, it is an unreadable one
- **Hidden columns are still scored.** `Sesuai target` stays *n*/8 with three columns showing, because it
  counts what the site did, not what the screen is displaying. So do the counters and both ranking charts
- **The count carries it across a scroll.** The grid scrolls sideways, so a hidden column leaves no gap
  behind it. `8/11` in red is the standing evidence that something is switched off — without it a narrowed
  table looks like a workbook that lost a KPI
- A switched-off column is drawn as a dashed outline rather than a filled chip. The tick box is 14px; at
  arm's length the fill is what you actually read
- Sorting by a column and then hiding it drops the order back to the name rather than leaving the rows
  in an arrangement nothing on screen explains
- It is not a filter and is never disabled with them. The filters choose which **rows** the table is
  about; this chooses how wide it is, and narrowing a three-site comparison to the two indicators under
  discussion is exactly when it is most wanted — which is when the basket has the bar above switched off
- Both exports follow it: the `.xlsx` is written with the columns on screen, and the PNG photographs
  what is there. Like the filter bar, the switch itself is dropped from the shot

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

- The Agent column appears only in the all-agents view, exactly as it does on screen, and any column
  switched off in **Kolom** is left out of the sheet too. `Jenis` and `Model Bisnis` are the exception and
  are always written: on screen they are the tag in front of the name rather than columns of their own
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
