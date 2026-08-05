/* J&T Daily Agent Performance Dashboard */

/* ---------- J&T black + red ----------
   The brand is red on black on white. Chrome — top bar, panel headers, section
   bands — is black; red is the accent that marks what matters and the fill on
   table headers; data surfaces stay white, because a wall of numbers reversed
   out of black is slower to read and this is a sheet someone scans every
   morning. Type is a step up in both size and weight throughout: the previous
   13px/500 was sized for a laptop at arm's length, not a screen across a desk. */
:root{
  --jt-red:#E2231A;
  --jt-red-dark:#B81810;
  --jt-black:#12151A;
  --jt-black-2:#1D222B;
  --green:#00913F;
  --amber:#F5A623;
  --red-soft:#FDECEB;
  --ink:#12151A;
  --ink-2:#4A5462;
  --ink-3:#77818F;
  --line:#DFE3EA;
  --bg:#F2F4F8;
  --card:#FFFFFF;
  --radius:12px;
  --shadow:0 1px 3px rgba(16,24,40,.08), 0 4px 14px rgba(16,24,40,.06);
}

*{box-sizing:border-box}
html,body,#root{margin:0;padding:0;min-height:100%}
body{
  font-family:"Segoe UI",Inter,-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,"Noto Sans",sans-serif;
  background:var(--bg);color:var(--ink);font-size:14.5px;font-weight:500;
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1480px;margin:0 auto;padding:10px 14px 20px}

/* ---------- Mandarin gloss on headings ----------
   Lighter and slightly smaller than the Indonesian it sits beside, so a heading
   still reads as one heading rather than two competing ones. Inside anything
   narrow — a table header, a KPI card name, a stat label — it drops to its own
   line, because those boxes have no horizontal room to spare. */
.zh{
  font-weight:500;font-size:.85em;letter-spacing:0;text-transform:none;
  opacity:.6;margin-left:.45em;white-space:nowrap;
}
/* on the dark chrome the gloss is white-on-black, where .6 reads as grey mush */
.panel.red > h3 .zh,.panel > h3 .zh,thead th .zh,.topbar .zh,.sechead .zh{opacity:.78}

th .zh,.kname .zh,.dpstat .l .zh,.sumitem .lab .zh{
  display:block;margin-left:0;margin-top:1px;font-size:.94em;white-space:normal;
}
/* inside a table body the gloss sits on already-muted grey, and .55 on top of
   that fades it out of legibility */
tbody td .zh{opacity:.85}

/* ---------- Top bar ---------- */
.topbar{
  display:flex;align-items:center;gap:14px;
  background:var(--jt-black);color:#fff;border-radius:var(--radius);box-shadow:var(--shadow);
  overflow:hidden;margin-bottom:10px;border-bottom:3px solid var(--jt-red);
}
/* The plate hugs the wordmark: the SVG viewBox is already cropped to the
   letters, so only this small optical padding is left. */
.logo{
  background:var(--jt-red);align-self:stretch;flex:none;
  display:flex;align-items:center;justify-content:center;padding:0 18px;
}
.logo .jtlogo{display:block;width:146px;height:auto}
.titleblock{flex:1;padding:11px 0;text-align:center}
.titleblock h1{margin:0;font-size:23px;font-weight:800;letter-spacing:.2px;color:#fff}
.titleblock .meta{margin-top:4px;color:#B7C0CC;font-size:13.5px;font-weight:500}
.titleblock .meta b{color:#fff;font-weight:700}
/* the title block no longer shares the bar with the agent picker, so give it
   the full width between the logo and the right edge */
.topbar .titleblock{padding-right:14px}

/* ---------- Toolbar ---------- */
.toolbar{
  display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;
  background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);
  padding:9px 12px;margin-bottom:10px;
}
.field{display:flex;flex-direction:column;gap:3px}
.field label{font-size:11.5px;font-weight:700;color:var(--ink-3);letter-spacing:.2px}
.field select,.field input[type=text]{
  border:1.5px solid var(--line);border-radius:8px;padding:7px 10px;font-size:14px;font-weight:600;
  background:#fff;color:var(--ink);min-width:150px;font-family:inherit;
}
/* the agent picker is the primary filter on the bar — agent names are long, so
   it gets more room and heavier type than the neighbouring date select */
.field select.agentsel{min-width:260px;max-width:360px;font-size:14.5px;font-weight:700}
.btn{
  border:1.5px solid var(--line);background:#fff;color:var(--ink);border-radius:8px;
  padding:8px 14px;font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit;
}
.btn:hover{background:#F7F8FB;border-color:#C4CBD6}
.btn.primary{background:var(--jt-red);border-color:var(--jt-red);color:#fff}
.btn.primary:hover{background:var(--jt-red-dark);border-color:var(--jt-red-dark)}
.spacer{flex:1}
.filechip{
  font-size:12.5px;font-weight:600;color:#fff;background:var(--jt-black-2);
  border-radius:99px;padding:6px 13px;white-space:nowrap;
}

/* ---------- Drop zone ---------- */
.dropzone{
  border:2px dashed #CBD3E1;border-radius:16px;background:var(--card);
  padding:56px 24px;text-align:center;margin-bottom:14px;transition:.15s;
}
.dropzone.hot{border-color:var(--jt-red);background:#FFF6F5}
.dropzone h2{margin:0 0 6px;font-size:19px}
.dropzone p{margin:0 auto 16px;color:var(--ink-2);max-width:640px;line-height:1.6}
.dropzone .lock{margin-top:16px;font-size:11.5px;color:var(--ink-3)}

/* ---------- Section band ----------
   The eight KPIs split into punctuality and completion/quality. A black bar with
   a red numeral: heavy enough to break the card grid into two readable halves
   from across a desk, which an all-caps grey caption was not. */
.kpisec{margin-bottom:14px}
.sechead{
  display:flex;align-items:center;gap:11px;margin:0 0 8px;
  background:var(--jt-black);color:#fff;border-radius:10px;
  padding:9px 14px;border-left:5px solid var(--jt-red);
  font-size:16px;font-weight:800;letter-spacing:.2px;
}
.sechead .secnum{
  display:inline-flex;align-items:center;justify-content:center;flex:none;
  width:26px;height:26px;border-radius:7px;background:var(--jt-red);color:#fff;
  font-size:15px;font-weight:800;
}
.sechead .sectext{flex:1;min-width:0}
.sechead .seccount{
  flex:none;font-size:12px;font-weight:700;color:#C3CAD6;
  background:rgba(255,255,255,.10);border-radius:99px;padding:3px 10px;
}

/* ---------- KPI cards ---------- */
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.kcard{
  background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);
  padding:10px 12px 7px;position:relative;border-top:3px solid transparent;
  transition:transform .16s ease, box-shadow .16s ease;
}
/* z-index is required: the hover transform creates a stacking context, and without
   it the tooltip would be painted underneath the panels further down the page. */
.kcard:hover{transform:translateY(-2px);box-shadow:0 3px 8px rgba(16,24,40,.08),0 12px 26px rgba(16,24,40,.10);z-index:50}
/* below target — a light tint is enough to find the card; the red value and the
   red top border already say what is wrong, so nothing here pulses or flashes */
.kcard.st-bad{background:#FFF9F8}
@media (prefers-reduced-motion:reduce){
  .kcard,.tipbox{transition:none;animation:none}
}
.kcard .dot{position:absolute;top:12px;right:12px;width:10px;height:10px;border-radius:50%}
/* min-height keeps every card's value row on the same baseline; it allows for
   a two-line Indonesian name plus its Mandarin gloss underneath */
/* min-height keeps every card's value row on the same baseline; it allows for
   a two-line name plus its Mandarin gloss underneath */
.kcard .kname{
  font-size:12.5px;font-weight:800;letter-spacing:.2px;color:var(--ink);
  padding-right:18px;line-height:1.3;min-height:46px;
}
.kcard .krow{display:flex;align-items:center;gap:9px;margin-top:6px}
.kcard .kicon{font-size:20px;line-height:1;opacity:.75}
.kcard .kval{font-size:33px;font-weight:800;letter-spacing:-.7px;line-height:1}
.kcard .ktgt{font-size:12.5px;font-weight:700;color:var(--ink-2);margin-top:5px}
.kcard .kmtd{font-size:12px;font-weight:600;color:var(--ink-3);margin-top:3px;min-height:16px}
.kcard .kcmp{
  display:flex;justify-content:space-between;align-items:center;
  font-size:12.5px;font-weight:600;color:var(--ink-2);
  border-top:1px solid var(--line);margin-top:9px;padding-top:7px;
}
.up{color:var(--green);font-weight:800}
.down{color:var(--jt-red);font-weight:800}
.flat{color:var(--ink-3);font-weight:700}
.spark{display:block;width:100%;height:30px;margin-top:4px}

/* ---------- Panels ---------- */
.panel{
  background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);
  display:flex;flex-direction:column;
  overflow:visible;               /* tooltips must be able to escape the panel */
}
/* Sentence case, no tracking. The titles are already written the way they should
   read; uppercasing them in CSS only made eight panels shout at once. */
.panel > h3{
  margin:0;padding:10px 14px;font-size:15px;font-weight:800;letter-spacing:.1px;
  background:var(--jt-black);color:#fff;border-bottom:3px solid var(--jt-red);
  border-radius:var(--radius) var(--radius) 0 0;
  display:flex;align-items:center;gap:12px;min-height:40px;
}
.panel > h3 .ptitle{flex:1;min-width:0}
/* in-header control (the bar-chart KPI switcher): normal case and weight, so it
   reads as something you can click rather than as part of the heading */
.panel > h3 .hsel{
  flex:none;max-width:60%;font-family:inherit;font-size:13px;font-weight:700;
  text-transform:none;letter-spacing:0;color:#fff;background:rgba(255,255,255,.12);
  border:1.5px solid rgba(255,255,255,.28);border-radius:7px;padding:5px 9px;cursor:pointer;
}
.panel > h3 .hsel:hover{background:rgba(255,255,255,.2);border-color:rgba(255,255,255,.45)}
/* the popup list is rendered by the OS in its own colours — force dark text so
   the options are not white-on-white once the menu opens */
.panel > h3 .hsel option{color:var(--ink);background:#fff}
/* re-round the bottom corners now that the panel no longer clips */
.panel .body table tbody tr:last-child td:first-child{border-bottom-left-radius:var(--radius)}
.panel .body table tbody tr:last-child td:last-child{border-bottom-right-radius:var(--radius)}
.panel.red > h3{background:var(--jt-red);color:#fff;border-bottom:none}
.panel .body{padding:10px 13px;flex:1;min-height:0}

/* the trend chart gets the full width — it is the one panel where cramped
   width made the plotted numbers unreadable */
.row-trend{margin-bottom:10px}
.row-mid{display:grid;grid-template-columns:.9fr 1fr;gap:10px;margin-bottom:10px}
.row-bot{display:grid;grid-template-columns:1.3fr 1fr;gap:10px}
@media (max-width:1180px){ .row-bot{grid-template-columns:1fr} }
@media (max-width:760px){ .row-mid{grid-template-columns:1fr} }

/* ---------- Tables ---------- */
table{width:100%;border-collapse:collapse;font-size:13.5px;font-weight:600}
thead th{
  background:var(--jt-red);color:#fff;text-align:left;padding:9px 10px;font-size:12.5px;
  letter-spacing:.2px;font-weight:800;
}
tbody td{padding:9px 10px;border-bottom:1px solid var(--line)}
tbody tr:last-child td{border-bottom:none}
tbody tr:nth-child(even){background:#FAFBFD}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
td.ctr,th.ctr{text-align:center}
.kpiname{font-weight:500}
.badge{
  display:inline-flex;align-items:center;justify-content:center;
  width:18px;height:18px;border-radius:50%;font-size:10.5px;font-weight:600;color:#fff;
}
.badge.ok{background:var(--green)}
.badge.warn{background:var(--amber)}
.badge.bad{background:var(--jt-red)}

/* ---------- Legend ---------- */
.legend{display:flex;flex-wrap:wrap;gap:8px 18px;margin-bottom:10px}
.legend button{
  display:flex;align-items:center;gap:5px;background:none;border:none;cursor:pointer;
  font-size:12px;color:var(--ink-2);padding:2px 0;font-family:inherit;
}
.legend button.off{opacity:.35;text-decoration:line-through}
.legend .sw{width:16px;height:3px;border-radius:2px}

/* ---------- Summary list ---------- */
.sumlist{display:flex;flex-direction:column}
.sumitem{display:flex;gap:12px;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--line)}
.sumitem:last-child{border-bottom:none}
.sumitem .ico{font-size:19px;width:26px;text-align:center;flex:none;line-height:1.2}
.sumitem .lab{width:150px;flex:none;font-weight:600;font-size:12px}
.sumitem .val{flex:1;font-size:12px;color:var(--ink-2);line-height:1.5}
.sumitem .val .strong{font-weight:600;display:block;margin-bottom:1px}
.val.good .strong{color:var(--green)}
.val.fair .strong{color:var(--amber)}
.val.poor .strong{color:var(--jt-red)}

.warnbox{
  background:#FEF4E4;border:1px solid #F3D8A6;color:#8A5A08;
  border-radius:10px;padding:9px 14px;margin-bottom:12px;font-size:12px;line-height:1.5;
}

/* ---------- Hover tooltips ---------- */
.tip{position:relative}
span.tip{display:inline-block}
.tipbox{
  position:absolute;z-index:60;width:238px;
  background:#1F2430;color:#EDF0F5;border-radius:10px;padding:9px 11px;
  font-size:11px;line-height:1.55;font-weight:400;text-transform:none;letter-spacing:0;
  text-align:left;white-space:normal;
  box-shadow:0 10px 28px rgba(16,24,40,.26);
  opacity:0;pointer-events:none;
  transition:opacity .16s ease, transform .2s cubic-bezier(.2,.9,.3,1.4);
}
.tipbox::after{content:"";position:absolute;width:9px;height:9px;background:#1F2430;transform:rotate(45deg)}

.tipbox.tip-below{top:calc(100% - 4px);left:14px;transform:translateY(5px) scale(.96);transform-origin:top left}
.tipbox.tip-below::after{top:-4px;left:16px}
.kcard:hover .tipbox.tip-below{opacity:1;transform:translateY(0) scale(1)}
/* right-most cards: flip the anchor so the tooltip can't run off the page */
.cards .kcard:nth-last-child(-n+2) .tipbox.tip-below{left:auto;right:0;transform-origin:top right}
.cards .kcard:nth-last-child(-n+2) .tipbox.tip-below::after{left:auto;right:16px}

.tipbox.tip-left{right:calc(100% + 11px);top:50%;transform:translateY(-50%) translateX(7px) scale(.96);transform-origin:right center}
.tipbox.tip-left::after{right:-4px;top:calc(50% - 4px)}
.tip:hover > .tipbox.tip-left{opacity:1;transform:translateY(-50%) translateX(0) scale(1)}

.tiptitle{display:block;font-weight:600;margin-bottom:4px;font-size:11.5px}
.tiptitle.ok{color:#4ADE80}
.tiptitle.bad{color:#FF9A90}
.tiptitle.na{color:#C6CCD8}
.tipline{display:block;color:#C3CAD6}
.tipline:first-of-type{color:#fff;font-weight:500}

/* below-target rows */
tbody tr.st-bad td{background:#FFF7F6}
tbody tr.st-bad .kpiname{color:var(--jt-red)}

.muted{color:var(--ink-3)}
.note{font-size:12.5px;font-weight:500;color:var(--ink-2);margin-top:10px;line-height:1.55}
.note b{font-weight:800;color:var(--ink)}
.err{
  background:var(--red-soft);border:1px solid #F6C6C3;color:#9B1C15;
  border-radius:10px;padding:11px 14px;margin-bottom:12px;font-size:12.5px;line-height:1.55;
}
.empty-mini{color:var(--ink-3);font-size:12px;padding:26px 0;text-align:center}

/* ---------- DP / CP section ---------- */
.dpsection{margin-top:16px}
.dphead{
  display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px;
  padding:0 2px 7px;border-bottom:1px solid var(--line);margin-bottom:12px;
}
.dphead h2{margin:0;font-size:18px;font-weight:800;letter-spacing:.1px;color:var(--ink)}
.dphead h2 b{color:var(--jt-red);font-weight:800}
.dphead .dpday{font-size:13px;font-weight:600;color:var(--ink-3)}
.dphead .dpday em{font-style:normal;color:#B47607}

/* The number carries the colour; the card itself stays plain. Five tinted,
   bordered, bold boxes in a row competed with the charts underneath them. */
.dpstats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:10px}
.dpstat{
  background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);
  padding:9px 13px;display:flex;flex-direction:column;gap:2px;
}
.dpstat{border-left:4px solid var(--jt-black)}
.dpstat.good{border-left-color:var(--green)}
.dpstat.warn{border-left-color:#B47607}
.dpstat.bad {border-left-color:var(--jt-red)}
.dpstat.mute{border-left-color:#C4CBD6}
.dpstat .n{font-size:28px;font-weight:800;letter-spacing:-.5px;line-height:1.1}
.dpstat .l{font-size:12.5px;font-weight:700;color:var(--ink-2);line-height:1.3}
.dpstat.good .n{color:var(--green)}
.dpstat.warn .n{color:#B47607}
.dpstat.bad  .n{color:var(--jt-red)}
.dpstat.mute .n{color:var(--ink-3)}

.row-dp{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}
@media (max-width:900px){ .row-dp{grid-template-columns:1fr} }
/* caption under a ranking chart — explains an exclusion, so it stays visible in
   the PNG and the print sheet rather than being treated as chrome */
.chartnote{
  font-size:12px;font-weight:500;color:var(--ink-2);line-height:1.5;
  padding-top:8px;margin-top:8px;border-top:1px solid var(--line);
}
.chartnote b{font-weight:800;color:var(--ink)}

/* inside the now-black panel header, so it has to read on dark like .hsel does */
.btn.tiny{
  padding:4px 10px;font-size:12.5px;font-weight:700;flex:none;
  background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.28);
}
.btn.tiny:hover{background:rgba(255,255,255,.2);border-color:rgba(255,255,255,.45)}

/* ---------- DP / CP table ---------- */
.dptable{margin-top:10px}
.dpfilters{
  display:flex;flex-wrap:wrap;gap:8px;align-items:center;
  padding:9px 13px;border-bottom:1px solid var(--line);background:#FBFCFE;
}
.dpfilters input[type=text],.dpfilters select{
  border:1.5px solid var(--line);border-radius:8px;padding:6px 10px;font-size:13.5px;font-weight:600;
  background:#fff;color:var(--ink);font-family:inherit;
}
.dpfilters input[type=text]{min-width:220px;flex:1;max-width:330px}
.dpfilters .chk{
  display:flex;align-items:center;gap:6px;font-size:13.5px;font-weight:700;
  color:var(--ink-2);cursor:pointer;
}
.dpfilters .seg{display:flex;border:1.5px solid var(--line);border-radius:8px;overflow:hidden;background:#fff}
.dpfilters .seg button{
  border:none;background:#fff;color:var(--ink-2);padding:6px 12px;font-size:13px;
  font-weight:700;cursor:pointer;font-family:inherit;
}
.dpfilters .seg button.on{background:var(--jt-red);color:#fff;font-weight:800}

/* The grid is wider than the panel by design: 8 category columns plus identity
   never fit at full type size, and shrinking the type to make them fit is worse
   than a scrollbar. The name column is pinned so a row stays identifiable while
   scrolling sideways. */
.dpscroll{overflow:auto;max-height:680px}
table.dpgrid{font-size:13px;min-width:100%}
table.dpgrid thead th{
  position:sticky;z-index:3;cursor:pointer;user-select:none;
  padding:8px 9px;white-space:nowrap;
}
/* Two sticky header rows. The band's height is pinned so the category row can be
   offset by exactly that much — `top` takes a length, not "whatever is above me",
   so a band free to grow would leave a gap or overlap as rows scrolled under it. */
table.dpgrid thead tr.secrow th{
  top:0;height:30px;padding:0 9px;background:var(--jt-black);
  font-size:12.5px;font-weight:800;letter-spacing:.4px;text-align:center;cursor:default;
}
/* the fallback only covers the first paint; DpSection measures the band and
   overwrites --secrow-h, because the real height moves with border and font */
table.dpgrid thead tr.catrow th{top:var(--secrow-h,30px)}
table.dpgrid thead tr.secrow th:hover{background:var(--jt-black)}
/* the two halves are told apart by a red underline vs a white one, not by two
   different fills — the band has to stay black to read as one bar */
table.dpgrid thead tr.secrow th.secband{border-bottom:3px solid var(--jt-red)}
table.dpgrid thead tr.secrow th.s-penyelesaian{border-bottom-color:#8A94A6}
/* the seam between the two halves, carried down through the body so a column can
   be traced back to its section without scrolling up to the band */
table.dpgrid thead th.seam,table.dpgrid tbody td.seam{border-left:2px solid #B9C1CE}
table.dpgrid thead th:not(.secband):hover{background:var(--jt-red-dark)}
table.dpgrid th.cat{max-width:104px;white-space:normal;line-height:1.25}
table.dpgrid tbody td{padding:6px 9px;white-space:nowrap}
table.dpgrid th.sticky,table.dpgrid td.sticky{position:sticky;left:0;z-index:2}
table.dpgrid thead th.sticky{z-index:4}
table.dpgrid tbody td.sticky{background:#fff}
table.dpgrid tbody tr:nth-child(even) td.sticky{background:#FAFBFD}
.dpname{font-weight:700;display:flex;align-items:center;gap:8px}
/* Solid fill, because this is the one thing on the row you scan for rather than
   read. A fixed min-width keeps the two tags the same size so the names below
   them stay in a straight column instead of stepping in and out. */
.ptag{
  display:inline-flex;align-items:center;justify-content:center;flex:none;
  min-width:28px;font-size:11px;font-weight:800;letter-spacing:.4px;
  border-radius:4px;padding:3px 6px;background:#1D6FC0;color:#fff;
}
/* FR / AG — the business model out of the workbook. Two distinct hues rather
   than two shades of one, because this is the tag you scan a column for; both
   are dark enough to carry white text at 9.5px. Grey when the file did not say,
   so an unknown model reads as missing instead of as one of the two. */
.ptag.franchise{background:#8E44AD}
.ptag.agent{background:#1D6FC0}
.ptag.unknown{background:#98A1B0}
.sbadge{
  display:inline-block;font-size:12px;font-weight:700;
  border-radius:99px;padding:3px 10px;white-space:nowrap;
}
/* green for the two kinds that run a delivery shift and are ranked, amber for
   pickup-only and grey for closed — the same "is this in the ranking?" reading
   the stat cards above the table use */
.sbadge.both{background:#EDF6F1;color:#2A7A52}
.sbadge.delivery{background:#EAF2FA;color:#1B5C99}
.sbadge.pickup{background:#FBF3E4;color:#8A5A08}
.sbadge.closed{background:#F1F3F7;color:#798394}

/* Only the misses are tinted. Colouring the passes as well turned the grid into
   a wall of green that took just as long to read as plain numbers — the point
   of the grid is to find the red.
   The tint is deliberately strong enough to pick out from across a desk, and
   paired with a dark red rather than the brand red so the number on top of it
   stays comfortable to read. */
td.hm{font-variant-numeric:tabular-nums;font-weight:600}
td.hm.ok {color:var(--ink)}
td.hm.bad{background:#F9D3CF;color:#8E1109;font-weight:800}
td.hm.off{color:#AAB2C0;font-weight:500}
tbody tr.k-closed td.sticky{color:#8A94A6}
.dpmore{padding:10px 13px;border-top:1px solid var(--line);text-align:center}

/* ---------- PNG snapshot mode ----------
   The snapshot must contain every panel that is on screen, so unlike the print
   sheet nothing is dropped here except the controls themselves (buttons, file
   picker, hover tooltips) — those carry no data.

   The width is pinned so the capture never depends on how wide the window
   happened to be: a narrow window would otherwise collapse .row-mid/.row-bot to
   one column and squeeze the tables, and html2canvas would bake that in. */
body.shooting{background:var(--bg) !important}
body.shooting .wrap{width:1480px;max-width:none;padding:14px 16px}

body.shooting .toolbar,
body.shooting .tipbox,
body.shooting .dpfilters,
body.shooting .dpmore,
body.shooting .legend button.off{display:none !important}

/* the DP list scrolls on screen; a scroll container photographs as its visible
   slice only, so it is unrolled to full height for the shot */
body.shooting .dpscroll{overflow:visible !important;max-height:none !important}
body.shooting table.dpgrid thead th,
body.shooting table.dpgrid th.sticky,
body.shooting table.dpgrid td.sticky{position:static !important}

/* fixed 4-up grid: auto-fit leaves a lone orphan card on the second row */
body.shooting .cards{grid-template-columns:repeat(4,1fr)}

/* no clipping, no lifted cards, no scroll containers — everything must be
   laid out at full height for html2canvas to see it */
body.shooting .kcard{transform:none !important;box-shadow:var(--shadow) !important}
body.shooting .panel,
body.shooting .panel .body{overflow:visible !important;max-height:none !important}

/* the KPI switcher photographs as an empty box; the chosen KPI is what matters,
   so it is flattened to plain text for the shot */
body.shooting .panel > h3 .hsel,
body.shooting .panel > h3 .hsel:hover{
  border-color:transparent;background:transparent;
  -webkit-appearance:none;appearance:none;padding-left:0;
}
/* the export buttons are chrome, not data — never in the picture */
body.shooting .btn{display:none !important}

/* ---------- Two capture scopes ----------
   The dashboard and the DP/CP list are two different documents that happen to
   share a page: one is a daily summary for an agent, the other is a working
   list of sites. Photographing them together produced an image too tall to read
   and too wide to send, so each has its own button and its own scope.

   These rules must come after the body.shooting block — the .wrap selectors
   have identical specificity, so source order is what decides. */

/* dashboard only — the DP/CP section has its own button */
body.shoot-main .dpsection{display:none !important}

/* DP/CP list only. The wrap is sized to the table instead of the fixed capture
   width: the grid is wider than the dashboard, and pinning it to 1480px would
   cut the right-hand categories off. */
body.shoot-table .wrap > *:not(.dpsection){display:none !important}
body.shoot-table .dpsection > *:not(.dptable){display:none !important}
body.shoot-table .wrap{width:max-content;max-width:none;padding:0}
body.shoot-table .dptable{margin-top:0}

@media print{
  /* landscape and colour-accurate: without print-color-adjust Chrome drops the
     red table headers and the green/red status colours entirely */
  @page{ size:A4 landscape; margin:8mm }
  *{-webkit-print-color-adjust:exact !important; print-color-adjust:exact !important}
  html,body{background:#fff}

  /* zoom (not transform) so the layout actually reflows to the smaller size */
  .wrap{max-width:none;padding:0;zoom:.62}

  /* only the interactive chrome is dropped — every data panel is kept, so the
     PDF carries the same information as the on-screen dashboard */
  .toolbar,.dropzone,.legend button.off,.filechip,.tipbox,
  .dpfilters,.dpmore{display:none !important}
  .dpscroll{overflow:visible !important;max-height:none !important}
  table.dpgrid thead th,table.dpgrid th.sticky,table.dpgrid td.sticky{position:static !important}
  .panel > h3 .hsel{border-color:transparent;background:transparent;-webkit-appearance:none;appearance:none;padding-left:0}

  /* THE page-break fix: a panel that straddled a break printed its header on one
     page and its chart on the next, which is why charts looked missing */
  .panel,.kcard,.sumitem,tr,svg,
  .row-trend,.row-mid,.row-bot,.row-dp,.dpstat{break-inside:avoid !important; page-break-inside:avoid !important}
  /* a section band stranded at the foot of a page labels nothing */
  .sechead{break-after:avoid !important; page-break-after:avoid !important}
  /* the DP list is the one table allowed to run across pages — it can be
     hundreds of rows long, and forcing it onto one page would shrink it away */
  .dptable{break-inside:auto !important; page-break-inside:auto !important}
  .dpsection{break-before:page; page-break-before:always}

  .panel,.kcard,.topbar{box-shadow:none !important;border:1px solid var(--line)}
  .panel,.panel .body{overflow:visible !important;max-height:none !important}
  .cards{grid-template-columns:repeat(4,1fr);gap:6px}
  .kcard{padding:8px 8px 4px}
  .kcard .kname{font-size:8.5px;min-height:34px;padding-right:10px}
  .kcard .kval{font-size:20px}
  .kcard .ktgt,.kcard .kmtd{font-size:9px}
  .kcard .spark{height:22px}
  .panel .body{padding:8px 10px}
  .row-bot{grid-template-columns:1.35fr 1fr}
}