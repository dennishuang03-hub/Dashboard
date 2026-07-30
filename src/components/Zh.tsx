/**
 * Mandarin gloss for a heading.
 *
 * The workbook itself labels every header twice — `代理区 / Agent`,
 * `网点 / Nama Drop point` — so the dashboard follows the same convention: the
 * Indonesian wording leads, the Chinese sits beside it in lighter type.
 *
 * Headings only. Panel titles, table column headers, section titles and card
 * names get a gloss; sentences, tooltips, hints and footnotes stay in
 * Indonesian alone, because glossing running prose doubles the reading load
 * without helping anyone find anything.
 *
 * Inside a `<th>` the gloss drops onto its own line (see `.zh` in
 * dashboard.css) — column headers are too narrow to carry both on one.
 */
export default function Zh({ children }: { children: string }) {
  return <span className="zh" lang="zh-Hans">{children}</span>
}
