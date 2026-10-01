import type { Block, Section, SectionStatus } from "../document/model.ts";

/**
 * Sections as plain Markdown files: the part of a workspace people and agents
 * edit. The mapping is small and round-trips: headings, paragraphs, lists,
 * pipe tables, **Key:** value facts, > callouts, images, fenced code, and
 * <!-- refs: … --> comments that keep source ids attached to text.
 */

const STATUSES: SectionStatus[] = ["extracted", "ai-draft", "confirmed", "unresolved"];
const TONE_LABEL = { note: "Note", gap: "Gap", warning: "Warning" } as const;

const cell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const refsComment = (refs?: string[]) => (refs?.length ? `\n<!-- refs: ${refs.join(", ")} -->` : "");

export function blockToMarkdown(b: Block): string {
  switch (b.type) {
    case "heading":
      return `### ${b.text}`;
    case "paragraph":
      return b.text + refsComment(b.refs);
    case "list":
      return b.items.map((i, n) => `${b.ordered ? `${n + 1}.` : "-"} ${i.replace(/\r?\n/g, " ")}`).join("\n") + refsComment(b.refs);
    case "table": {
      const head = `| ${b.columns.map(cell).join(" | ")} |\n| ${b.columns.map(() => "---").join(" | ")} |`;
      const rows = b.rows.map((r) => `| ${r.map(cell).join(" | ")} |`).join("\n");
      return `${head}${rows ? `\n${rows}` : ""}${b.caption ? `\n\nTable: ${b.caption}` : ""}${refsComment(b.refs)}`;
    }
    case "facts":
      return b.items.map(([k, v]) => `**${k.replace(/\*/g, "")}:** ${v.replace(/\r?\n/g, " ")}`).join("  \n");
    case "callout":
      return `> **${TONE_LABEL[b.tone]}:** ${b.text.replace(/\r?\n/g, " ")}`;
    case "figure":
      return `![${b.caption.replace(/[[\]]/g, "")}](${b.asset})`;
    case "code":
      return `\`\`\`${b.language ?? ""}\n${b.text.replace(/```/g, "ʼʼʼ")}\n\`\`\``;
    case "diagram":
      return "<!-- diagram: system map (generated; edit the configuration, not this line) -->";
  }
}

export function sectionToMarkdown(s: Section): string {
  const front = [
    "---",
    `id: ${s.id}`,
    `title: ${s.title.replace(/\r?\n/g, " ")}`,
    `status: ${s.status}`,
    `origin: ${s.origin}`,
    ...(s.evidence ? [`evidence: ${s.evidence}`] : []),
    ...(s.review ? [`review: ${s.review}`] : []),
    "---",
  ].join("\n");
  return `${front}\n\n${s.blocks.map(blockToMarkdown).join("\n\n")}\n`;
}

export interface ParsedSection {
  meta: { id?: string; title?: string; status?: SectionStatus; origin?: Section["origin"]; evidence?: string; review?: Section["review"] };
  blocks: Block[];
  /** True when the file keeps the generated diagram marker. */
  diagram: boolean;
}

const splitRow = (line: string) => {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (ch === "\\" && i + 1 < inner.length) {
      cur += inner[++i];
      continue;
    }
    if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
};

/** Parse a section file. Unknown constructs become paragraphs; nothing is executed or trusted as HTML. */
export function markdownToSection(text: string): ParsedSection {
  const src = text.replace(/\r\n?/g, "\n");
  const meta: ParsedSection["meta"] = {};
  let body = src;
  const fm = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    body = src.slice(fm[0].length);
    for (const line of fm[1]!.split("\n")) {
      const m = line.match(/^([a-z]+):\s*(.*)$/);
      if (!m) continue;
      const v = m[2]!.trim();
      if (m[1] === "id" && /^[a-z0-9-]{1,40}$/.test(v)) meta.id = v;
      else if (m[1] === "title") meta.title = v.slice(0, 200);
      else if (m[1] === "status" && STATUSES.includes(v as SectionStatus)) meta.status = v as SectionStatus;
      else if (m[1] === "origin" && ["generated", "user", "agent"].includes(v)) meta.origin = v as Section["origin"];
      else if (m[1] === "evidence" && /^[0-9a-f]{1,32}$/.test(v)) meta.evidence = v;
      else if (m[1] === "review" && (v === "evidence-changed" || v === "evidence-removed")) meta.review = v;
    }
  }

  const blocks: Block[] = [];
  let diagram = false;
  const lines = body.split("\n");
  let i = 0;
  const attachRefs = (refs: string[]) => {
    const last = blocks[blocks.length - 1];
    if (last && (last.type === "paragraph" || last.type === "list" || last.type === "table")) last.refs = [...(last.refs ?? []), ...refs];
  };

  while (i < lines.length) {
    const line = lines[i]!;
    const t = line.trim();
    if (!t) {
      i++;
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^<!--\s*refs:\s*(.*?)\s*-->$/))) {
      attachRefs(m[1]!.split(/\s*,\s*/).filter(Boolean));
      i++;
    } else if (/^<!--\s*diagram\b/.test(t)) {
      diagram = true;
      blocks.push({ type: "diagram", diagram: { columns: [], edges: [] } });
      i++;
    } else if (/^<!--/.test(t)) {
      // Other comments are dropped.
      while (i < lines.length && !lines[i]!.includes("-->")) i++;
      i++;
    } else if ((m = t.match(/^#{1,6}\s+(.*)$/))) {
      blocks.push({ type: "heading", text: m[1]!.trim() });
      i++;
    } else if (t.startsWith("```")) {
      const language = t.slice(3).trim() || undefined;
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) buf.push(lines[i++]!);
      i++;
      blocks.push(language ? { type: "code", text: buf.join("\n"), language } : { type: "code", text: buf.join("\n") });
    } else if (t.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) rows.push(splitRow(lines[i++]!));
      const [columns, sep, ...rest] = rows;
      const isSep = sep?.every((c) => /^:?-{2,}:?$/.test(c));
      const table: Block = { type: "table", columns: columns ?? [], rows: isSep ? rest : rows.slice(1) };
      // Optional "Table: caption" after a blank line.
      let j = i;
      while (j < lines.length && !lines[j]!.trim()) j++;
      const cap = lines[j]?.trim().match(/^Table:\s*(.+)$/);
      if (cap) {
        table.caption = cap[1];
        i = j + 1;
      }
      blocks.push(table);
    } else if ((m = t.match(/^>\s*\*\*(Note|Gap|Warning):\*\*\s*(.*)$/i))) {
      const tone = m[1]!.toLowerCase() as "note" | "gap" | "warning";
      const buf = [m[2]!];
      i++;
      while (i < lines.length && /^>\s?/.test(lines[i]!.trim()) && lines[i]!.trim() !== ">") buf.push(lines[i++]!.trim().replace(/^>\s?/, ""));
      blocks.push({ type: "callout", tone, text: buf.join(" ").trim() });
    } else if (t.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith(">")) buf.push(lines[i++]!.trim().replace(/^>\s?/, ""));
      blocks.push({ type: "callout", tone: "note", text: buf.join(" ").trim() });
    } else if ((m = t.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/))) {
      blocks.push({ type: "figure", caption: m[1]!, asset: m[2]! });
      i++;
    } else if (/^([-*+]|\d+[.)])\s+/.test(t)) {
      const ordered = /^\d/.test(t);
      const items: string[] = [];
      while (i < lines.length && /^([-*+]|\d+[.)])\s+/.test(lines[i]!.trim())) {
        items.push(lines[i]!.trim().replace(/^([-*+]|\d+[.)])\s+/, ""));
        i++;
        // Continuation lines belong to the previous item.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]!) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]!)) items[items.length - 1] += ` ${lines[i++]!.trim()}`;
      }
      blocks.push(ordered ? { type: "list", items, ordered } : { type: "list", items });
    } else if (/^\*\*[^*]+:\*\*\s/.test(t)) {
      const items: [string, string][] = [];
      while (i < lines.length && (m = lines[i]!.trim().match(/^\*\*([^*]+):\*\*\s*(.*?)\s*$/))) {
        items.push([m[1]!, m[2]!]);
        i++;
      }
      blocks.push({ type: "facts", items });
    } else {
      const buf: string[] = [];
      while (i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|```|\||>|<!--|!\[|([-*+]|\d+[.)])\s)/.test(lines[i]!.trim())) buf.push(lines[i++]!.trim());
      if (!buf.length) buf.push(lines[i++]!.trim());
      blocks.push({ type: "paragraph", text: buf.join(" ") });
    }
  }
  return { meta, blocks, diagram };
}
