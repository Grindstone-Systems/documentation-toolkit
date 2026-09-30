import { strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { sampleEvidence } from "../test/helpers.ts";
import { readZip, treeFromTexts } from "./archive.ts";
import { defaultConfig, sanitizeConfig, type ToolkitConfig } from "./config.ts";
import { PACKS } from "./document/model.ts";
import { buildDocument, REDACTED } from "./document/packs.ts";
import { csvCell, inventoryCsvs } from "./render/csv.ts";
import { renderHtml } from "./render/html.ts";
import { markdownToSection, sectionToMarkdown } from "./render/markdown.ts";
import { mergeDocument, readWorkspace, validateWorkspace, workspaceFiles, zipFiles, type Workspace } from "./workspace.ts";

const config = (over: Partial<ToolkitConfig> = {}): ToolkitConfig => ({ ...defaultConfig(), identity: { ...defaultConfig().identity, date: "2026-09-29", customer: "City of Riverbend" }, ...over });

describe("document packs", () => {
  it("builds every pack deterministically", async () => {
    const ev = await sampleEvidence();
    for (const p of PACKS) {
      const a = buildDocument(ev, config({ pack: p.id }));
      expect(JSON.stringify(a)).toBe(JSON.stringify(buildDocument(ev, config({ pack: p.id }))));
      expect(a.sections.at(-1)?.id === "coverage" || a.sections.some((s) => s.id === "coverage")).toBe(true);
    }
  });

  it("keeps coverage even when excluded", async () => {
    const doc = buildDocument(await sampleEvidence(), config({ exclude: ["coverage", "tags"] }));
    expect(doc.sections.map((s) => s.id)).toContain("coverage");
    expect(doc.sections.map((s) => s.id)).not.toContain("tags");
  });

  it("never invents procedures", async () => {
    const doc = buildDocument(await sampleEvidence(), config({ pack: "operator-manual" }));
    for (const id of ["op-alarm-response", "op-procedures", "op-safety"]) expect(doc.sections.find((s) => s.id === id)?.status).toBe("unresolved");
  });

  it("uses supplied context as confirmed user content", async () => {
    const doc = buildDocument(await sampleEvidence(), config({ context: { systemDescription: "Treats river water for 40,000 people.", procedures: "" } }));
    expect(doc.sections[0]).toMatchObject({ id: "about", status: "confirmed", origin: "user" });
  });

  it("places screenshots on their screens and collects the rest", async () => {
    const ev = await sampleEvidence();
    const cfg = config({ pack: "complete-handoff", screenshots: [{ asset: "assets/screen-1.jpg", caption: "Pump station", page: "page:Riverbend/pumps" }, { asset: "assets/screen-2.jpg", caption: "Control room" }] });
    const doc = buildDocument(ev, cfg);
    const figs = (id: string) => doc.sections.find((s) => s.id === id)!.blocks.filter((b) => b.type === "figure").map((b) => (b as { caption: string }).caption);
    expect(figs("navigation")).toEqual(["Pump station"]);
    expect(figs("op-screens")).toEqual(["Pump station"]);
    expect(figs("screenshots")).toEqual(["Control room"]);
    expect(doc.sections.find((s) => s.id === "screenshots")).toMatchObject({ status: "confirmed", origin: "user" });
    expect(JSON.stringify(doc.sections.find((s) => s.id === "op-screens"))).toContain("5 screens still need a screenshot");
  });

  it("applies redaction to documents and CSVs", async () => {
    const ev = await sampleEvidence();
    const doc = buildDocument(ev, config({ redact: { addresses: true, usernames: true, code: true } }));
    const queries = doc.sections.find((s) => s.id === "appendix-queries")!;
    expect(queries.blocks.some((b) => b.type === "code")).toBe(false);
    const csv = inventoryCsvs(ev, config({ redact: { addresses: false, usernames: false, code: true } })).find((c) => c.path === "named-queries.csv")!;
    expect(csv.content).toContain(REDACTED);
    expect(csv.content).not.toContain("SELECT");
  });
});

describe("HTML reference", () => {
  it("is self-contained and loads nothing remote", async () => {
    const html = renderHtml(buildDocument(await sampleEvidence(), config()), config());
    expect(html).not.toMatch(/(src|href)=["']https?:/i);
    expect(html).not.toMatch(/@import|url\(\s*["']?https?:/i);
    expect(html).toContain("default-src 'none'");
  });

  it("escapes everything from the input", async () => {
    const ev = await sampleEvidence();
    const evil = { ...ev, entities: ev.entities.map((e) => (e.kind === "view" ? { ...e, path: `${e.path}<script>alert(1)</script>`, name: '"><img src=x onerror=alert(1)>' } : e)) };
    const cfg = config({ identity: { ...config().identity, project: "</title><script>bad()</script>" } });
    const html = renderHtml(buildDocument(evil, cfg), cfg);
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain("<script>bad()");
    expect(html).not.toContain("<img src=x");
    expect(html.match(/<script/g)).toHaveLength(2); // the search index and the search code
  });
});

describe("Markdown sections", () => {
  it("round-trips every generated section", async () => {
    const doc = buildDocument(await sampleEvidence(), config({ pack: "complete-handoff" }));
    for (const s of doc.sections) {
      const back = markdownToSection(sectionToMarkdown(s));
      expect(back.meta).toMatchObject({ id: s.id, status: s.status, origin: s.origin });
      const strip = (bs: typeof s.blocks) => bs.map((b) => (b.type === "diagram" ? { type: "diagram" } : b));
      expect(strip(back.blocks)).toEqual(strip(s.blocks));
    }
  });
});

describe("CSV", () => {
  it("neutralises spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("-5")).toBe("-5");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("a,b")).toBe('"a,b"');
  });
});

describe("config", () => {
  it("sanitises untrusted settings", () => {
    const c = sanitizeConfig({ pack: "nope", appearance: { accent: "red; background:url(x)", theme: "harbor" }, logo: "../../etc/passwd", exclude: ["tags", "<bad>"], identity: { date: "tomorrow" } });
    expect(c.pack).toBe("engineering-reference");
    expect(c.appearance.accent).toBe("#2d6a8e");
    expect(c.appearance.theme).toBe("harbor");
    expect(c.logo).toBeUndefined();
    expect(c.exclude).toEqual(["tags"]);
    expect(c.identity.date).toBe("");
    expect(sanitizeConfig({ screenshots: [{ asset: "assets/a.jpg", caption: "ok", page: "page:X/y" }, { asset: "../x.svg", caption: "bad" }, { asset: "assets/b.svg" }] }).screenshots).toEqual([{ asset: "assets/a.jpg", caption: "ok", page: "page:X/y" }]);
  });
});

describe("workspace", () => {
  const make = async (): Promise<Workspace> => {
    const evidence = await sampleEvidence();
    const cfg = config();
    return { config: cfg, evidence, document: buildDocument(evidence, cfg), assets: new Map() };
  };
  const reopen = (files: { path: string; content: string | Uint8Array }[]) => readWorkspace(readZip(zipFiles(files, "riverbend-docs/"), () => true).tree);

  it("round-trips through a ZIP unchanged", async () => {
    const ws = await make();
    const back = reopen(workspaceFiles(ws));
    expect(back.document).toEqual(ws.document);
    expect(back.config).toEqual(ws.config);
    expect(back.evidence.entities).toEqual(ws.evidence.entities);
    expect(validateWorkspace(back).filter((i) => i.level === "error")).toEqual([]);
  });

  it("produces byte-identical ZIPs for identical input", async () => {
    const ws = await make();
    expect(zipFiles(workspaceFiles(ws))).toEqual(zipFiles(workspaceFiles(ws)));
  });

  it("turns edited extracted text into an AI draft and keeps it on regeneration", async () => {
    const ws = await make();
    const files = workspaceFiles(ws);
    const f = files.find((x) => x.path.endsWith("-scripts.md"))!;
    f.content = String(f.content).replace("origin: generated", "origin: agent") + "\nThe pump module starts and stops pumps.\n<!-- refs: script:Riverbend/riverbend.pumps -->\n";
    const edited = reopen(files);
    const s = edited.document.sections.find((x) => x.id === "scripts")!;
    expect(s).toMatchObject({ status: "ai-draft", origin: "agent" });

    // Regenerate from changed evidence: the edit survives and is flagged.
    const changed = { ...ws.evidence, entities: ws.evidence.entities.map((e) => (e.id === "script:Riverbend/riverbend.pumps" ? { ...e, fields: { ...e.fields, lines: 999 } } : e)) };
    const merged = mergeDocument(buildDocument(changed, ws.config), edited.document);
    const kept = merged.sections.find((x) => x.id === "scripts")!;
    expect(JSON.stringify(kept.blocks)).toContain("starts and stops pumps");
    expect(kept.review).toBe("evidence-changed");
    expect(merged.sections.find((x) => x.id === "tags")?.origin).toBe("generated");
  });

  it("validation catches bad refs and agent confirmations", async () => {
    const ws = await make();
    const files = workspaceFiles(ws);
    const f = files.find((x) => x.path.endsWith("-views.md"))!;
    f.content = String(f.content).replace("status: extracted", "status: confirmed").replace("origin: generated", "origin: agent") + "\nMade up.\n<!-- refs: view:Nowhere/Missing -->\n";
    const issues = validateWorkspace(reopen(files));
    expect(issues.some((i) => i.level === "error" && /not in the evidence/.test(i.message))).toBe(true);
    expect(issues.some((i) => i.level === "error" && /Only a person can confirm/.test(i.message))).toBe(true);
  });

  it("accepts sections an agent adds as new files", async () => {
    const files = workspaceFiles(await make());
    files.push({ path: "content/sections/99-glossary.md", content: "---\nid: glossary\ntitle: Glossary\nstatus: confirmed\n---\n\n**NTU:** Nephelometric turbidity unit\n" });
    const ws = reopen(files);
    const g = ws.document.sections.find((s) => s.id === "glossary")!;
    expect(g).toMatchObject({ status: "confirmed", origin: "agent" });
    expect(ws.document.sections.findIndex((s) => s.id === "glossary")).toBeLessThan(ws.document.sections.findIndex((s) => s.id === "coverage"));
  });

  it("strips redacted values from workspace evidence", async () => {
    const ws = await make();
    const files = workspaceFiles({ ...ws, config: config({ redact: { addresses: true, usernames: true, code: true } }) });
    const entities = String(files.find((f) => f.path === "evidence/entities.json")!.content);
    expect(entities).not.toContain("SELECT SUM(hours)");
    expect(entities).not.toContain("system.tag.writeBlocking");
  });

  it("rejects things that aren't workspaces", () => {
    expect(() => readWorkspace(treeFromTexts({ "readme.md": "x" }))).toThrow(/manifest/);
    expect(() => readWorkspace(treeFromTexts({ "manifest.json": '{"schema":"other"}' }))).toThrow(/Unsupported/);
  });

  it("includes rendered exports when asked", async () => {
    const files = workspaceFiles(await make(), { exports: true });
    expect(files.map((f) => f.path)).toEqual(expect.arrayContaining(["exports/reference.html", "exports/tags.csv", "AGENTS.md", "CLAUDE.md"]));
    expect(strFromU8(new TextEncoder().encode(String(files.find((f) => f.path === "CLAUDE.md")!.content)))).toBe("@AGENTS.md\n");
  });
});
