import type { ToolkitConfig } from "../config.ts";
import { PACKS, STATUS_LABEL, sectionText, type Block, type DocumentModel, type Section } from "../document/model.ts";
import { renderSystemMap } from "./diagram.ts";
import { esc, inline, plain, scriptJson, slug } from "./escape.ts";

/**
 * The offline reference: one self-contained HTML file with its styles, search
 * index and images inline. It opens from disk with no server, CDN or network,
 * and prints to a paginated PDF from any browser.
 */

export interface HtmlOptions {
  /** data: URIs keyed by workspace asset path (assets/logo.png). */
  assets?: Record<string, string>;
  /** Show review status badges (on by default; off gives a clean customer copy). */
  statuses?: boolean;
  /** Include the search box and its script (off for the in-app preview, which runs no scripts). */
  search?: boolean;
}

export const THEME_TOKENS = {
  graphite: { ink: "#1d2126", muted: "#5a616b", line: "#d9dce1", tint: "#f4f5f7", paper: "#ffffff", cover: "#1d2126", onCover: "#f6f6f4" },
  harbor: { ink: "#132a3e", muted: "#4d6378", line: "#cfdce7", tint: "#eef4f9", paper: "#ffffff", cover: "#132a3e", onCover: "#f2f7fb" },
  mono: { ink: "#111111", muted: "#555555", line: "#cccccc", tint: "#f2f2f2", paper: "#ffffff", cover: "#ffffff", onCover: "#111111" },
} as const;

export function renderHtml(doc: DocumentModel, cfg: ToolkitConfig, opts: HtmlOptions = {}): string {
  const t = THEME_TOKENS[cfg.appearance.theme];
  const accent = cfg.appearance.theme === "mono" ? "#111111" : cfg.appearance.accent;
  const statuses = opts.statuses !== false;
  const search = opts.search !== false;
  const pack = PACKS.find((p) => p.id === doc.pack)!;
  const id = cfg.identity;
  const logo = cfg.logo ? opts.assets?.[cfg.logo] : undefined;
  const main = doc.sections.filter((s) => !s.appendix);
  const appx = doc.sections.filter((s) => s.appendix);
  const number = new Map(doc.sections.map((s, i) => [s.id, s.appendix ? String.fromCharCode(65 + appx.indexOf(s)) : String(main.indexOf(s) + 1)]));

  const toc = doc.sections
    .map((s) => `<li${s.appendix ? ' class="appx"' : ""}><a href="#${sid(s)}"><span class="n">${number.get(s.id)}</span>${esc(s.title.replace(/^Appendix: /, ""))}</a>${statuses && s.status !== "extracted" ? `<i class="dot st-${s.status}" title="${STATUS_LABEL[s.status]}"></i>` : ""}</li>`)
    .join("");

  const body = doc.sections.map((s) => renderSection(s, number.get(s.id)!, statuses, opts)).join("\n");
  const index = !search ? [] : doc.sections.map((s) => ({ id: sid(s), t: s.title, x: plain(sectionText(s)).replace(/\s+/g, " ").slice(0, 20000) }));
  const meta = [id.customer, id.revision && `Revision ${id.revision}`, id.date, id.author].filter(Boolean).map((x) => esc(String(x)));
  const footer = [id.confidentiality, id.customer, doc.title, id.revision && `Rev ${id.revision}`].filter(Boolean).map((x) => esc(String(x))).join(" · ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<meta name="generator" content="Documentation Toolkit">
<title>${esc(doc.title)} · ${esc(pack.label)}</title>
<style>${css(t, accent, cfg)}</style>
</head>
<body class="density-${cfg.appearance.density}">
<header class="cover">
  <div class="cover-top">${logo ? `<img class="logo" src="${esc(logo)}" alt="${esc(id.customer || "Customer")} logo">` : `<span></span>`}${id.confidentiality ? `<span class="conf">${esc(id.confidentiality)}</span>` : ""}</div>
  <p class="kicker">${esc(pack.label)}</p>
  <h1>${esc(doc.title)}</h1>
  ${meta.length ? `<p class="meta">${meta.join('<span class="sep">·</span>')}</p>` : ""}
  ${pack.framework ? `<p class="framework">This pack includes framework sections. Anything marked Unresolved must be completed and approved by the site before use.</p>` : ""}
</header>
<div class="layout">
<nav class="toc" aria-label="Contents">
  ${search ? `<input id="q" type="search" placeholder="Search this document" aria-label="Search this document" autocomplete="off">
  <ol id="results" class="results" hidden></ol>` : ""}
  <p class="toc-title">Contents</p>
  <ol class="toc-list">${toc}</ol>
</nav>
<main>
${body}
</main>
</div>
<footer class="foot"><span>${footer}</span>${cfg.credit ? `<span class="credit">Generated with Documentation Toolkit (experimental)</span>` : ""}</footer>
${search ? `<script type="application/json" id="search-index">${scriptJson(index)}</script>\n<script>${SEARCH_JS}</script>\n` : ""}</body>
</html>
`;
}

const sid = (s: Section) => `s-${slug(s.id)}`;

function renderSection(s: Section, n: string, statuses: boolean, opts: HtmlOptions): string {
  const badge = statuses ? `<span class="status st-${s.status}">${STATUS_LABEL[s.status]}</span>` : "";
  const review = s.review ? `<p class="review">${s.review === "evidence-changed" ? "The configuration behind this section changed since it was written. Review it." : "The configuration this section described is no longer in the input. Review it."}</p>` : "";
  return `<section id="${sid(s)}" class="sec${s.appendix ? " appendix" : ""}" data-status="${s.status}">
<h2><span class="n">${esc(n)}</span>${esc(s.title)}${badge}</h2>
${review}${s.blocks.map((b) => renderBlock(b, opts)).join("\n")}
</section>`;
}

function renderBlock(b: Block, opts: HtmlOptions): string {
  switch (b.type) {
    case "heading":
      return `<h3>${inline(b.text)}</h3>`;
    case "paragraph":
      return `<p>${inline(b.text)}</p>`;
    case "list": {
      const tag = b.ordered ? "ol" : "ul";
      return `<${tag}>${b.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${tag}>`;
    }
    case "table":
      if (!b.rows.length) return `<p class="empty">None.</p>`;
      return `<div class="table"><table>${b.caption ? `<caption>${inline(b.caption)}</caption>` : ""}<thead><tr>${b.columns.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${b.rows
        .map((r) => `<tr>${r.map((c) => `<td>${c ? inline(c) : '<span class="blank"></span>'}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>`;
    case "facts":
      return `<dl class="facts">${b.items.map(([k, v]) => `<div><dt>${inline(k)}</dt><dd>${inline(v)}</dd></div>`).join("")}</dl>`;
    case "callout": {
      const label = b.tone === "gap" ? "To complete" : b.tone === "warning" ? "Important" : "Note";
      return `<aside class="callout ${b.tone}"><strong>${label}</strong><span>${inline(b.text)}</span></aside>`;
    }
    case "figure": {
      const src = opts.assets?.[b.asset];
      return src
        ? `<figure><img src="${esc(src)}" alt="${esc(b.alt ?? b.caption)}"><figcaption>${inline(b.caption)}</figcaption></figure>`
        : `<aside class="callout gap"><strong>Missing image</strong><span>${esc(b.asset)} — ${inline(b.caption)}</span></aside>`;
    }
    case "code":
      return `<pre><code>${esc(b.text)}</code></pre>`;
    case "diagram":
      return `<figure class="diagram">${renderSystemMap(b.diagram)}</figure>`;
  }
}

/* Search runs locally over the embedded index; no network, works from file://. */
const SEARCH_JS = `(function(){var q=document.getElementById('q'),r=document.getElementById('results');if(!q||!r)return;var idx=[];try{idx=JSON.parse(document.getElementById('search-index').textContent)}catch(e){}
function h(s){return s.replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
q.addEventListener('input',function(){var v=q.value.trim().toLowerCase();r.innerHTML='';if(v.length<2){r.hidden=true;return}var terms=v.split(/\\s+/),n=0;
idx.forEach(function(s){var x=s.x.toLowerCase();if(!terms.every(function(t){return x.indexOf(t)>=0}))return;var i=x.indexOf(terms[0]),a=Math.max(0,i-40),snip=s.x.slice(a,i+80);
var li=document.createElement('li');li.innerHTML='<a href="#'+s.id+'"><b>'+h(s.t)+'</b><span>'+(a>0?'… ':'')+h(snip)+' …</span></a>';r.appendChild(li);n++});
if(!n){r.innerHTML='<li class="none">No matches</li>'}r.hidden=false});})();`;

function css(t: (typeof THEME_TOKENS)[keyof typeof THEME_TOKENS], accent: string, cfg: ToolkitConfig): string {
  const compact = cfg.appearance.density === "compact";
  return `
:root{--ink:${t.ink};--muted:${t.muted};--line:${t.line};--tint:${t.tint};--paper:${t.paper};--cover:${t.cover};--on-cover:${t.onCover};--accent:${accent};
--font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;--fs:${compact ? 13 : 14.5}px}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:16px}
body{margin:0;background:var(--paper);color:var(--ink);font:var(--fs)/1.55 var(--font);-webkit-font-smoothing:antialiased}
.cover{background:var(--cover);color:var(--on-cover);padding:40px clamp(20px,5vw,64px) 44px;border-bottom:4px solid var(--accent)}
.cover-top{display:flex;justify-content:space-between;align-items:center;gap:16px;min-height:44px;margin-bottom:40px}
.logo{max-height:56px;max-width:220px;object-fit:contain;background:#fff;padding:6px 10px;border-radius:6px}
.conf{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border:1px solid currentColor;padding:4px 8px;border-radius:4px;opacity:.85}
.kicker{margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;opacity:.75}
.cover h1{margin:0;font-size:clamp(28px,4vw,42px);line-height:1.1;letter-spacing:-.02em;max-width:900px}
.meta{margin:14px 0 0;opacity:.85}.sep{margin:0 10px;opacity:.5}
.framework{margin:22px 0 0;max-width:720px;font-size:13px;padding:10px 14px;border-left:3px solid var(--accent);background:color-mix(in srgb,var(--on-cover) 8%,transparent)}
.layout{display:grid;grid-template-columns:260px minmax(0,1fr);max-width:1320px;margin:0 auto}
.toc{position:sticky;top:0;align-self:start;max-height:100vh;overflow:auto;padding:24px 18px;border-right:1px solid var(--line)}
.toc input{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:7px;font:inherit;font-size:13px;background:var(--paper);color:var(--ink)}
.toc-title{margin:20px 0 8px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.toc ol{list-style:none;margin:0;padding:0}
.toc-list li{display:flex;align-items:center;gap:6px}
.toc-list a{flex:1;display:flex;gap:10px;padding:5px 6px;border-radius:6px;color:var(--ink);text-decoration:none;font-size:13px}
.toc-list a:hover{background:var(--tint)}
.toc-list .n{min-width:18px;color:var(--muted);font-variant-numeric:tabular-nums}
.toc-list li.appx:first-of-type,.toc-list li:not(.appx)+li.appx{margin-top:10px;padding-top:10px;border-top:1px solid var(--line)}
.dot{width:7px;height:7px;border-radius:50%;flex:none}
.results{margin-top:8px!important;display:grid;gap:4px}
.results a{display:grid;gap:2px;padding:7px 8px;border-radius:6px;background:var(--tint);color:var(--ink);text-decoration:none;font-size:12px}
.results a span{color:var(--muted)}.results .none{font-size:12px;color:var(--muted);padding:6px}
main{padding:12px clamp(20px,4vw,56px) 64px;min-width:0}
.sec{padding:${compact ? 22 : 30}px 0 ${compact ? 8 : 14}px;border-bottom:1px solid var(--line)}
.sec:last-child{border-bottom:0}
h2{display:flex;align-items:baseline;flex-wrap:wrap;gap:12px;margin:0 0 14px;font-size:${compact ? 20 : 23}px;line-height:1.2;letter-spacing:-.01em}
h2 .n{color:var(--accent);font-variant-numeric:tabular-nums}
h3{margin:${compact ? 18 : 24}px 0 8px;font-size:${compact ? 14.5 : 16}px}
p{margin:0 0 ${compact ? 8 : 12}px;max-width:78ch}
ul,ol{margin:0 0 12px;padding-left:22px}li{margin:2px 0}
code{font-family:var(--mono);font-size:.88em;background:var(--tint);padding:1px 5px;border-radius:4px;overflow-wrap:anywhere}
pre{margin:0 0 14px;padding:12px 14px;background:var(--tint);border-radius:8px;overflow:auto;font:12px/1.5 var(--mono);white-space:pre-wrap}
pre code{background:none;padding:0}
.status{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:3px 8px;border-radius:99px;border:1px solid var(--line);color:var(--muted);align-self:center}
.st-unresolved{color:#9a3412;border-color:#fdba74;background:#fff7ed}.dot.st-unresolved{background:#ea580c}
.st-ai-draft{color:#6d28d9;border-color:#c4b5fd;background:#f5f3ff}.dot.st-ai-draft{background:#7c3aed}
.st-confirmed{color:#166534;border-color:#86efac;background:#f0fdf4}.dot.st-confirmed{background:#16a34a}
.review{padding:8px 12px;border-radius:6px;background:#fef9c3;color:#713f12;font-size:13px}
.table{overflow-x:auto;margin:0 0 16px;border:1px solid var(--line);border-radius:8px}
table{width:100%;border-collapse:collapse;font-size:${compact ? 12 : 13}px}
caption{caption-side:top;text-align:left;padding:10px 12px 0;font-weight:600;color:var(--muted);font-size:12px}
th{text-align:left;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);background:var(--tint);padding:${compact ? "6px 10px" : "8px 12px"};border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:${compact ? "5px 10px" : "7px 12px"};border-bottom:1px solid var(--line);vertical-align:top}
tbody tr:last-child td{border-bottom:0}
.blank{display:inline-block;width:100%;min-width:120px;border-bottom:1px dotted var(--muted);height:1em}
.facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));margin:0 0 16px;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.facts div{padding:${compact ? "7px 10px" : "10px 12px"};border-right:1px solid var(--line);border-bottom:1px solid var(--line);margin:0 -1px -1px 0}
.facts dt{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.facts dd{margin:2px 0 0}
.callout{display:grid;gap:2px;margin:0 0 14px;padding:10px 14px;border-radius:8px;border-left:3px solid var(--muted);background:var(--tint);font-size:13px;max-width:90ch}
.callout strong{font-size:11px;letter-spacing:.05em;text-transform:uppercase}
.callout.gap{border-left-color:#ea580c;background:#fff7ed}.callout.gap strong{color:#9a3412}
.callout.warning{border-left-color:var(--accent)}
figure{margin:0 0 18px}figure img{max-width:100%;max-height:70vh;border:1px solid var(--line);border-radius:8px}
figcaption{font-size:12px;color:var(--muted);margin-top:6px}
.diagram{padding:16px;border:1px solid var(--line);border-radius:10px;background:var(--paper)}
.system-map{width:100%;height:auto;display:block;font-family:var(--font)}
.sm-head{font-size:11px;font-weight:700;letter-spacing:.08em;fill:var(--muted)}
.sm-nodes rect{fill:var(--tint);stroke:var(--line)}
.sm-label{font-size:12.5px;font-weight:600;fill:var(--ink)}.sm-detail{font-size:10.5px;fill:var(--muted)}
.sm-edges path{fill:none;stroke:var(--accent);stroke-opacity:.45;stroke-width:1.4}
.empty{color:var(--muted)}
.foot{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:18px clamp(20px,5vw,64px);border-top:1px solid var(--line);font-size:12px;color:var(--muted)}
@media (max-width:860px){.layout{grid-template-columns:minmax(0,1fr)}.toc{position:static;max-height:none;border-right:0;border-bottom:1px solid var(--line)}}
@page{size:${cfg.appearance.paper === "a4" ? "A4" : "letter"};margin:18mm 16mm 20mm}
@media print{
 body{font-size:${compact ? 9.5 : 10.5}pt}
 .toc,.results{display:none}
 .layout{display:block}
 main{padding:0}
 .cover{min-height:92vh;display:flex;flex-direction:column;justify-content:center;break-after:page;print-color-adjust:exact;-webkit-print-color-adjust:exact}
 .sec{break-inside:auto;border-bottom:0}
 .sec.appendix{break-before:page}
 h2,h3{break-after:avoid}
 thead{display:table-header-group}
 tr,.facts div,.callout,figure{break-inside:avoid}
 .table{overflow:visible;border:0}
 th{background:none;border-bottom:1.5px solid var(--ink)}
 a{color:inherit;text-decoration:none}
 .status{print-color-adjust:exact;-webkit-print-color-adjust:exact}
 .foot{border-top:1px solid var(--line)}
}`;
}
