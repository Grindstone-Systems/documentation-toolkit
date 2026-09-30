import type { SystemMap } from "../document/model.ts";
import { esc } from "./escape.ts";

/**
 * The system map as static SVG: columns of labelled boxes with curves between
 * neighbouring columns. Deterministic and bounded, with no scripts or links,
 * so it prints and embeds anywhere.
 */

const W = 960;
const NODE_H = 38;
const GAP = 10;
const HEAD = 34;
const COL_GAP = 56;

export function renderSystemMap(map: SystemMap): string {
  const cols = map.columns;
  if (!cols.length) return "";
  const colW = (W - COL_GAP * (cols.length - 1)) / cols.length;
  const rows = Math.max(...cols.map((c) => c.nodes.length), 1);
  const H = HEAD + rows * (NODE_H + GAP);
  const pos = new Map<string, { col: number; x: number; y: number }>();
  cols.forEach((c, ci) => {
    const x = ci * (colW + COL_GAP);
    // Centre shorter columns vertically.
    const offset = ((rows - c.nodes.length) * (NODE_H + GAP)) / 2;
    c.nodes.forEach((n, ni) => pos.set(n.id, { col: ci, x, y: HEAD + offset + ni * (NODE_H + GAP) }));
  });
  const maxChars = Math.floor((colW - 20) / 6.6);
  const fit = (s: string, n = maxChars) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  const edges = map.edges
    .map((e) => {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b || b.col !== a.col + 1) return "";
      const x1 = a.x + colW;
      const y1 = a.y + NODE_H / 2;
      const x2 = b.x;
      const y2 = b.y + NODE_H / 2;
      const mx = (x1 + x2) / 2;
      return `<path d="M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}"/>`;
    })
    .join("");

  const heads = cols.map((c, ci) => `<text class="sm-head" x="${ci * (colW + COL_GAP)}" y="16">${esc(c.title.toUpperCase())}</text>`).join("");
  const nodes = cols
    .flatMap((c) =>
      c.nodes.map((n) => {
        const p = pos.get(n.id)!;
        return `<g><rect x="${p.x}" y="${p.y}" width="${colW}" height="${NODE_H}" rx="7"/><text class="sm-label" x="${p.x + 10}" y="${p.y + 16}">${esc(fit(n.label))}</text>${
          n.detail ? `<text class="sm-detail" x="${p.x + 10}" y="${p.y + 30}">${esc(fit(n.detail, maxChars + 4))}</text>` : ""
        }</g>`;
      }),
    )
    .join("");

  return `<svg class="system-map" viewBox="0 0 ${W} ${H}" role="img" aria-label="System map: ${esc(cols.map((c) => c.title).join(", "))}" xmlns="http://www.w3.org/2000/svg"><g class="sm-edges">${edges}</g>${heads}<g class="sm-nodes">${nodes}</g></svg>`;
}
