# J&T Daily Agent Performance Dashboard

Two builds of the same dashboard. Both read the Excel file **entirely in the browser** — no data is
uploaded, stored, or written to disk. Close the tab and it's gone.

---

## 1. Standalone — `jnt-dashboard.html`

Double-click it. That's the whole setup. No install, no server, no build step — email it or drop it on
a shared drive for the regional team.

**Offline use:** it pulls the Excel reader (SheetJS) from a CDN. If the machine has no internet,
download `xlsx.full.min.js` from cdn.sheetjs.com into the same folder — the page falls back to it.

## 2. React app — `npm run dev`

```bash
npm install      # installs xlsx (added to package.json)
npm run dev
```

| File | Purpose |
| --- | --- |
| `src/lib/jnt.ts` | Parser + KPI model. Framework-free, reusable. |
| `src/components/Charts.tsx` | Hand-rolled SVG line/bar/sparkline. No chart library. |
| `src/Dashboard.tsx` | All UI. |
| `src/dashboard.css` | Styling. |

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

## Status colours

Binary, no middle ground: **green = met the target, red = missed it.** A card that misses turns red,
tints its background, and its status dot pulses gently.

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
