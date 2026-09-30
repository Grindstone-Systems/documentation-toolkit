import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import type { ToolkitConfig } from "../config.ts";
import { PACKS, STATUS_LABEL, type Block, type DocumentModel, type Section } from "../document/model.ts";
import { imageMime } from "../workspace.ts";
import { imageSize } from "./image.ts";

/**
 * Editable Word output from the same document model as the HTML reference.
 * It uses real heading styles, tables with repeating header rows, captions,
 * headers and footers, so the file stays easy to edit downstream. Exact
 * pagination is Word's business, not ours.
 */

const TOKENS = {
  graphite: { ink: "1D2126", muted: "5A616B", line: "D9DCE1", tint: "F4F5F7" },
  harbor: { ink: "132A3E", muted: "4D6378", line: "CFDCE7", tint: "EEF4F9" },
  mono: { ink: "111111", muted: "555555", line: "CCCCCC", tint: "F2F2F2" },
} as const;

const PAGE = {
  letter: { width: 12240, height: 15840 },
  a4: { width: 11906, height: 16838 },
} as const;
const MARGIN = 1080; // 0.75 in
const FONT = "Calibri";
const MONO = "Consolas";

/** "`code` and **bold**" → runs. Text is never interpreted as markup beyond that. */
function runs(text: string, base: { size?: number; color?: string; bold?: boolean; italics?: boolean } = {}): TextRun[] {
  const out: TextRun[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    if (m[1] !== undefined) out.push(new TextRun({ text: m[1], ...base, font: MONO, size: (base.size ?? 21) - 2 }));
    else out.push(new TextRun({ text: m[2]!, ...base, bold: true }));
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }));
  return out.length ? out : [new TextRun({ text: "", ...base })];
}

interface Ctx {
  cfg: ToolkitConfig;
  t: (typeof TOKENS)[keyof typeof TOKENS];
  accent: string;
  contentWidth: number;
  assets: Map<string, Uint8Array>;
  lists: number;
}

const border = (color: string) => ({ style: BorderStyle.SINGLE, size: 4, color });

/**
 * Column widths (percent) from content, so a column of long unbroken tag paths
 * can't squeeze a short one until "Boolean" wraps mid-word. Each column gets at
 * least its longest word (capped), and the rest is shared by content length.
 */
function fitWidths(columns: string[], rows: string[][], contentWidth: number): number[] {
  // Rough character widths: headers are small capitals, code is monospace; 2 for cell padding.
  const len = (s: string, k: number) => Math.ceil(s.replace(/`|\*\*/g, "").length * (s.includes("`") ? 1.2 : k)) + 2;
  const words = (s: string, k: number) => (s.includes("`") ? s.replace(/\s+/g, "`\u0000`") : s).split(/\s+|\u0000/).map((w) => len(w, k));
  const body = (i: number) => rows.map((r) => r[i] ?? "");
  const floor = columns.map((c, i) => Math.min(18, Math.max(5, ...words(c, 1.15), ...body(i).flatMap((v) => words(v, 1)))));
  const want = columns.map((c, i) => Math.max(floor[i]!, Math.min(50, Math.max(len(c, 1.15), ...body(i).map((v) => len(v, 1))))));
  const budget = contentWidth / 100; // ~100 twips a character at the table's 9.5 pt
  const sumWant = want.reduce((a, b) => a + b, 0);
  const sumFloor = floor.reduce((a, b) => a + b, 0);
  const chars = sumWant <= budget || sumWant === sumFloor ? want : want.map((w, i) => floor[i]! + (Math.max(0, budget - sumFloor) * (w - floor[i]!)) / (sumWant - sumFloor));
  const total = chars.reduce((a, b) => a + b, 0);
  return chars.map((c) => Math.round((c / total) * 1000) / 10);
}

function table(ctx: Ctx, columns: string[], rows: string[][], opts: { widths?: number[]; header?: boolean } = {}): Table {
  const header = opts.header !== false;
  const widths = opts.widths ?? fitWidths(columns, rows, ctx.contentWidth);
  const b = border(ctx.t.line);
  const cell = (text: string, head: boolean, i: number) =>
    new TableCell({
      children: [new Paragraph({ children: runs(text || " ", head ? { bold: true, size: 17, color: ctx.t.muted } : { size: 19 }), spacing: { before: 40, after: 40 } })],
      shading: head ? { type: ShadingType.CLEAR, color: "auto", fill: ctx.t.tint } : undefined,
      margins: { left: 100, right: 100, top: 30, bottom: 30 },
      width: { size: Math.round((widths[i]! / 100) * ctx.contentWidth), type: WidthType.DXA },
    });
  return new Table({
    width: { size: ctx.contentWidth, type: WidthType.DXA },
    columnWidths: widths.map((w) => Math.round((w / 100) * ctx.contentWidth)),
    layout: TableLayoutType.FIXED,
    borders: { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b },
    rows: [
      ...(header ? [new TableRow({ tableHeader: true, cantSplit: true, children: columns.map((c, i) => cell(c.toUpperCase(), true, i)) })] : []),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: columns.map((_, i) => cell(r[i] ?? "", false, i)) })),
    ],
  });
}

function block(ctx: Ctx, b: Block): (Paragraph | Table)[] {
  switch (b.type) {
    case "heading":
      return [new Paragraph({ heading: HeadingLevel.HEADING_2, children: runs(b.text) })];
    case "paragraph":
      return [new Paragraph({ children: runs(b.text), spacing: { after: 120 } })];
    case "list": {
      const instance = ++ctx.lists;
      return b.items.map((i) => new Paragraph({ children: runs(i), numbering: { reference: b.ordered ? "ordered" : "bullets", level: 0, instance }, spacing: { after: 40 } }));
    }
    case "table": {
      const out: (Paragraph | Table)[] = [];
      if (b.caption) out.push(new Paragraph({ children: runs(b.caption, { bold: true, size: 18, color: ctx.t.muted }), keepNext: true, spacing: { before: 120, after: 60 } }));
      out.push(b.rows.length ? table(ctx, b.columns, b.rows) : new Paragraph({ children: runs("None.", { color: ctx.t.muted }) }));
      out.push(spacer());
      return out;
    }
    case "facts":
      return [table(ctx, ["", ""], b.items.map(([k, v]) => [`**${k}**`, v]), { header: false, widths: [30, 70] }), spacer()];
    case "callout": {
      const label = b.tone === "gap" ? "To complete" : b.tone === "warning" ? "Important" : "Note";
      const color = b.tone === "gap" ? "C2410C" : b.tone === "warning" ? ctx.accent : ctx.t.muted;
      const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: { top: none, bottom: none, right: none, left: { style: BorderStyle.SINGLE, size: 18, color }, insideHorizontal: none, insideVertical: none },
          rows: [
            new TableRow({
              cantSplit: true,
              children: [
                new TableCell({
                  shading: { type: ShadingType.CLEAR, color: "auto", fill: b.tone === "gap" ? "FFF7ED" : ctx.t.tint },
                  margins: { left: 160, right: 120, top: 60, bottom: 60 },
                  children: [new Paragraph({ children: [new TextRun({ text: `${label.toUpperCase()}  `, bold: true, size: 16, color }), ...runs(b.text, { size: 19 })] })],
                }),
              ],
            }),
          ],
        }),
        spacer(),
      ];
    }
    case "code":
      return [
        new Paragraph({
          shading: { type: ShadingType.CLEAR, color: "auto", fill: ctx.t.tint },
          spacing: { after: 160 },
          children: b.text.split("\n").map((line, i) => new TextRun({ text: line.replace(/\t/g, "    "), font: MONO, size: 16, break: i ? 1 : 0 })),
        }),
      ];
    case "figure":
      return figure(ctx, b.asset, b.caption);
    case "diagram": {
      const label = new Map(b.diagram.columns.flatMap((c) => c.nodes.map((n) => [n.id, n.label] as const)));
      const col = new Map(b.diagram.columns.flatMap((c, ci) => c.nodes.map((n) => [n.id, ci] as const)));
      const edges = b.diagram.edges.filter((e) => col.get(e.to) === (col.get(e.from) ?? -9) + 1);
      return [
        new Paragraph({ children: runs("System map, as a table. The HTML reference draws it as a diagram.", { italics: true, size: 18, color: ctx.t.muted }), keepNext: true }),
        table(
          ctx,
          ["From", "To"],
          edges.map((e) => [`${label.get(e.from) ?? e.from}`, `${label.get(e.to) ?? e.to}`]),
        ),
        spacer(),
      ];
    }
  }
}

function figure(ctx: Ctx, asset: string, caption: string): Paragraph[] {
  const bytes = ctx.assets.get(asset);
  const mime = bytes ? imageMime(bytes) : undefined;
  const size = bytes ? imageSize(bytes) : undefined;
  if (!bytes || !size || (mime !== "image/png" && mime !== "image/jpeg")) {
    return [new Paragraph({ children: runs(`[Image not available in Word output: ${asset}] ${caption}`, { italics: true, color: ctx.t.muted }) })];
  }
  // Fit the content width (twips → px at 96 dpi) and a sensible height.
  const maxW = (ctx.contentWidth / 1440) * 96;
  const scale = Math.min(1, maxW / size.width, 560 / size.height);
  return [
    new Paragraph({
      keepNext: true,
      children: [new ImageRun({ type: mime === "image/png" ? "png" : "jpg", data: bytes, transformation: { width: Math.round(size.width * scale), height: Math.round(size.height * scale) }, altText: { name: asset, description: caption, title: caption } })],
    }),
    new Paragraph({ style: "Caption", children: runs(caption) }),
  ];
}

const spacer = () => new Paragraph({ children: [], spacing: { after: 80 } });

function sectionContent(ctx: Ctx, s: Section, n: string, statuses: boolean): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: !!s.appendix,
      children: [new TextRun({ text: `${n}  `, color: ctx.accent }), new TextRun({ text: s.title })],
    }),
  ];
  if (statuses) out.push(new Paragraph({ children: [new TextRun({ text: STATUS_LABEL[s.status].toUpperCase(), bold: true, size: 15, color: s.status === "unresolved" ? "C2410C" : s.status === "confirmed" ? "166534" : s.status === "ai-draft" ? "6D28D9" : ctx.t.muted })], spacing: { after: 120 } }));
  if (s.review) out.push(new Paragraph({ shading: { type: ShadingType.CLEAR, color: "auto", fill: "FEF9C3" }, children: runs(s.review === "evidence-changed" ? "The configuration behind this section changed since it was written. Review it." : "The configuration this section described is no longer in the input. Review it.", { size: 19 }) }));
  for (const b of s.blocks) out.push(...block(ctx, b));
  return out;
}

export interface DocxOptions {
  assets?: Map<string, Uint8Array>;
  statuses?: boolean;
}

export async function renderDocx(doc: DocumentModel, cfg: ToolkitConfig, opts: DocxOptions = {}): Promise<Uint8Array> {
  const t = TOKENS[cfg.appearance.theme];
  const accent = cfg.appearance.theme === "mono" ? "111111" : cfg.appearance.accent.replace("#", "").toUpperCase();
  const page = PAGE[cfg.appearance.paper];
  const ctx: Ctx = { cfg, t, accent, contentWidth: page.width - 2 * MARGIN, assets: opts.assets ?? new Map(), lists: 0 };
  const statuses = opts.statuses !== false;
  const pack = PACKS.find((p) => p.id === doc.pack)!;
  const id = cfg.identity;
  const main = doc.sections.filter((s) => !s.appendix);
  const appx = doc.sections.filter((s) => s.appendix);
  const num = (s: Section) => (s.appendix ? String.fromCharCode(65 + appx.indexOf(s)) : String(main.indexOf(s) + 1));

  const cover: Paragraph[] = [];
  const logo = cfg.logo ? ctx.assets.get(cfg.logo) : undefined;
  const logoSize = logo && imageSize(logo);
  const logoMime = logo && imageMime(logo);
  if (logo && logoSize && (logoMime === "image/png" || logoMime === "image/jpeg")) {
    const scale = Math.min(220 / logoSize.width, 70 / logoSize.height, 1);
    cover.push(
      new Paragraph({
        children: [new ImageRun({ type: logoMime === "image/png" ? "png" : "jpg", data: logo, transformation: { width: Math.round(logoSize.width * scale), height: Math.round(logoSize.height * scale) }, altText: { name: "logo", description: `${id.customer} logo`, title: "Logo" } })],
      }),
    );
  }
  cover.push(
    new Paragraph({ spacing: { before: 2400 }, children: [new TextRun({ text: pack.label.toUpperCase(), bold: true, size: 20, color: accent })] }),
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(doc.title)] }),
    new Paragraph({ children: [new TextRun({ text: [id.customer, id.revision && `Revision ${id.revision}`, id.date, id.author].filter(Boolean).join("   ·   "), size: 22, color: t.muted })] }),
  );
  if (id.confidentiality) cover.push(new Paragraph({ spacing: { before: 400 }, children: [new TextRun({ text: id.confidentiality.toUpperCase(), bold: true, size: 18, color: t.muted })] }));
  if (pack.framework) cover.push(new Paragraph({ spacing: { before: 400 }, children: runs("This pack includes framework sections. Anything marked Unresolved must be completed and approved by the site before use.", { size: 19, color: t.muted }) }));
  cover.push(new Paragraph({ children: [new PageBreak()] }));

  const contents: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Contents")] }),
    ...doc.sections.map((s) => new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: `${num(s)}\t`, color: accent }), new TextRun(s.title)], tabStops: [{ type: "left", position: 500 }] })),
  ];

  const body = doc.sections.flatMap((s) => sectionContent(ctx, s, num(s), statuses));
  const muted = { size: 16, color: t.muted };
  const header = new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: [id.customer, doc.title].filter(Boolean).join(" · "), ...muted })] })] });
  const footer = new Footer({
    children: [
      new Paragraph({
        tabStops: [{ type: "right", position: page.width - 2 * MARGIN }],
        children: [
          new TextRun({ text: [id.confidentiality, id.revision && `Rev ${id.revision}`].filter(Boolean).join(" · "), ...muted }),
          new TextRun({ text: "\t", ...muted }),
          new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], ...muted }),
          ...(cfg.credit ? [new TextRun({ text: "   Generated with Documentation Toolkit (experimental)", ...muted })] : []),
        ],
      }),
    ],
  });

  const document = new Document({
    creator: id.author || "Documentation Toolkit",
    title: doc.title,
    subject: pack.label,
    description: `${pack.label} generated by Documentation Toolkit from exported configuration.`,
    keywords: "Ignition, documentation",
    lastModifiedBy: "Documentation Toolkit",
    styles: {
      default: { document: { run: { font: FONT, size: 21, color: t.ink }, paragraph: { spacing: { line: 276 } } } },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", run: { font: FONT, size: 60, bold: true, color: t.ink }, paragraph: { spacing: { after: 200 } } },
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 32, bold: true, color: t.ink }, paragraph: { spacing: { before: 360, after: 80 }, keepNext: true, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 24, bold: true, color: t.ink }, paragraph: { spacing: { before: 240, after: 80 }, keepNext: true, outlineLevel: 1 } },
        { id: "Caption", name: "Caption", basedOn: "Normal", next: "Normal", run: { font: FONT, size: 17, italics: true, color: t.muted }, paragraph: { spacing: { after: 200 } } },
      ],
    },
    numbering: {
      config: [
        { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] },
        { reference: "ordered", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 280 } } } }] },
      ],
    },
    sections: [
      {
        properties: { page: { size: page, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } }, titlePage: true },
        headers: { default: header, first: new Header({ children: [] }) },
        footers: { default: footer, first: new Footer({ children: [] }) },
        children: [...cover, ...contents, new Paragraph({ children: [new PageBreak()] }), ...body] as (Paragraph | Table)[],
      },
    ],
  });
  return deterministic(new Uint8Array(await Packer.toArrayBuffer(document)), id.date);
}

/** docx stamps "now" into the core properties; pin them to the document date and fix ZIP times. */
function deterministic(bytes: Uint8Array, date: string): Uint8Array {
  const when = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00Z` : "2026-01-01T00:00:00Z";
  const files = unzipSync(bytes);
  const core = files["docProps/core.xml"];
  if (core) files["docProps/core.xml"] = strToU8(strFromU8(core).replace(/(<dcterms:(?:created|modified)[^>]*>)[^<]*(<\/dcterms:(?:created|modified)>)/g, `$1${when}$2`));
  const z: Zippable = {};
  const mtime = new Date(Date.UTC(2026, 0, 1));
  // [Content_Types].xml must stay first for some readers.
  for (const name of Object.keys(files).sort((a, b) => (a === "[Content_Types].xml" ? -1 : b === "[Content_Types].xml" ? 1 : 0))) z[name] = [files[name]!, { mtime }];
  return zipSync(z, { level: 6 });
}
