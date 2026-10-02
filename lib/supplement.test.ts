import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sampleEvidence, sampleInputs, sampleSupplementJson, sampleWithSupplement, supplementFile } from "../test/helpers.ts";
import { readZip, treeFromTexts } from "./archive.ts";
import { defaultConfig, type ToolkitConfig } from "./config.ts";
import { PACKS, type Block, type PackId } from "./document/model.ts";
import { buildDocument, REDACTED } from "./document/packs.ts";
import { extract } from "./extract.ts";
import { inventoryCsvs } from "./render/csv.ts";
import { markdownToSection, sectionToMarkdown } from "./render/markdown.ts";
import { unresolved } from "./resolve.ts";
import { readWorkspace, workspaceFiles, zipFiles } from "./workspace.ts";

const config = (over: Partial<ToolkitConfig> = {}): ToolkitConfig => ({ ...defaultConfig(), identity: { ...defaultConfig().identity, date: "2026-09-29", customer: "City of Riverbend" }, ...over });
const SUPPLIED_SECTIONS = ["controllers", "disagreements", "runtime", "appendix-io"];
const ids = (pack: PackId, ev: Parameters<typeof buildDocument>[0]) => buildDocument(ev, config({ pack })).sections.map((s) => s.id);
const tableText = (blocks: Block[]) => JSON.stringify(blocks.filter((b) => b.type === "table"));

describe("supplement adapter (oic.docs.supplement/v0)", () => {
  it("is detected by its schema field, before any tag-export check", async () => {
    const ev = await extract([supplementFile()]);
    expect(ev.inputs[0]).toMatchObject({ name: "supplement.json", format: "oic-docs-supplement", adapter: "oic.supplement", adapterVersion: "0.1.0" });
    // Shaped like a tag export too, but the schema wins.
    const both = await extract([supplementFile({ ...sampleSupplementJson(), tagType: "Provider", name: "", tags: [{ name: "X", tagType: "AtomicTag" }] })]);
    expect(both.inputs[0]!.format).toBe("oic-docs-supplement");
    expect(both.entities.some((e) => e.kind === "tag")).toBe(false);
  });

  it("is read from a folder of JSON files too", async () => {
    const tree = treeFromTexts({ "fate/supplement.json": JSON.stringify(sampleSupplementJson()) });
    const ev = await extract([{ name: "fate", tree }]);
    expect(ev.inputs[0]!.format).toBe("oic-docs-supplement");
    expect(ev.entities.some((e) => e.id === "controller:PLC_Pumps")).toBe(true);
  });

  it("adds supplied entities and relationships, each citing its own document", async () => {
    const ev = await sampleWithSupplement();
    const byId = new Map(ev.entities.map((e) => [e.id, e]));
    expect(byId.get("controller:PLC_Pumps")?.source).toEqual({ input: "line1-controller.L5X", path: "Controller[@Name='PLC_Pumps']", at: "line 12" });
    expect(byId.get("io-point:Local:1:I.Data.0")?.source).toEqual({ input: "line1-io-list.xlsx", path: "I/O", at: "row 4" });
    expect(byId.get("runtime-fact:normal-range:tag:[default]Riverbend/Clearwell/Level")?.source.input).toBe("tag history");
    for (const k of ["controller", "plc-tag", "io-point", "disagreement", "runtime-fact"]) expect(ev.entities.some((e) => e.kind === k)).toBe(true);
    const has = (from: string, type: string, to: string) => ev.relationships.some((r) => r.from === from && r.type === type && r.to === to);
    expect(has("tag:[default]Riverbend/Pumps/P101/Running", "reads-plc-tag", "plc-tag:PLC_Pumps/Pump")).toBe(true);
    expect(has("io-point:Local:2:I.Ch0Data", "wired-to", "plc-tag:PLC_Pumps/Clearwell")).toBe(true);
    expect(has("runtime-fact:last-change:view:Riverbend/Pumps/PumpStation", "about", "view:Riverbend/Pumps/PumpStation")).toBe(true);
    // A `to` that isn't in the evidence is dropped; the readable target stays.
    const missing = ev.relationships.find((r) => r.from === "disagreement:alarm-missing:Clearwell.LowLow" && r.target.includes("Low Low"))!;
    expect(missing.to).toBeUndefined();
    expect(ev.coverage.find((c) => c.key === "fate.l5x")).toMatchObject({ found: 1, read: 1 });
    expect(ev.diagnostics.some((d) => d.code === "fate-note")).toBe(true);
    expect(ev.diagnostics.find((d) => d.code === "supplement-read")?.message).toMatch(/^Evidence supplied by FATE: 16 items and 19 relationships/);
  });

  it("refuses Ignition kinds, bad ids and relationship types it can't add, and counts them", async () => {
    const plain = await sampleEvidence();
    const ev = await sampleWithSupplement();
    const mode = (e: typeof ev) => e.entities.find((x) => x.id === "tag:[default]Riverbend/Plant/Mode");
    expect(mode(ev)).toEqual(mode(plain));
    expect(JSON.stringify(ev)).not.toContain("OVERRIDDEN BY SUPPLEMENT");
    expect(ev.entities.some((e) => e.id === "alarm:[default]Riverbend/Clearwell/Level#Low Low Level")).toBe(false);
    expect(ev.entities.some((e) => e.id === "plc:PLC_Filters")).toBe(false);
    expect(ev.relationships.some((r) => r.from === "view:Riverbend/Overview" && r.target === "[default]Riverbend/Plant/Mode")).toBe(false);
    expect(ev.diagnostics.find((d) => d.code === "supplement-kind-refused")?.message).toMatch(/^Refused 2 supplied entities of an Ignition kind \(alarm, tag\): a supplement adds evidence/);
    expect(ev.diagnostics.filter((d) => d.code === "supplement-refused").map((d) => d.message)).toEqual([
      expect.stringContaining("entity whose id doesn't start with “controller:”"),
      expect.stringContaining("relationship of type “binds-tag”, which a supplement can't add"),
    ]);
    expect(ev.coverage.find((c) => c.key === "supplement.refused")).toMatchObject({ found: 2, read: 0 });
    expect(ev.coverage.find((c) => c.key === "supplement.controller")).toMatchObject({ found: 2, read: 1 });
    expect(ev.coverage.find((c) => c.key === "supplement.relationship")).toMatchObject({ found: 20, read: 19 });
  });

  it("never reads credentials and keeps only short scalar fields", async () => {
    const ev = await sampleWithSupplement();
    const text = JSON.stringify(ev);
    expect(text).not.toContain("SUPPLEMENT-NOT-A-REAL-SECRET");
    expect(text).not.toContain("supplement-key-never-shown");
    expect(ev.entities.find((e) => e.id === "controller:PLC_Pumps")?.fields).toEqual({ processorType: "1756-L83E", softwareRevision: "35.11", tags: 3 });
    expect(ev.diagnostics.find((d) => d.code === "secrets-excluded")?.message).toMatch(/^2 credential values were found in supplied evidence/);
    expect(ev.diagnostics.some((d) => d.code === "supplement-fields-dropped")).toBe(true);
    // Who made a change is a username, so it's redactable.
    expect(ev.entities.find((e) => e.id === "runtime-fact:last-change:view:Riverbend/Pumps/PumpStation")?.sensitive).toEqual({ by: "username" });
  });

  it("bounds what it reads", async () => {
    const big = sampleSupplementJson({ entities: Array.from({ length: 100_002 }, (_, i) => ({ id: `plc-tag:PLC_Big/T${i}`, kind: "plc-tag", name: `T${i}`, source: { input: "big.L5X", path: "" }, fields: i ? {} : { description: "x".repeat(2000) } })), relationships: [] });
    const ev = await extract([supplementFile(big)]);
    expect(ev.entities).toHaveLength(100_000);
    expect(ev.coverage.find((c) => c.key === "supplement.over-limit")).toMatchObject({ found: 2, read: 0 });
    expect(String(ev.entities[0]!.fields.description).length).toBe(500);
  });

  it("reports a PLC tag that isn't there as a gap, but not a disagreement's missing side", async () => {
    const gaps = unresolved(await sampleWithSupplement());
    expect(gaps.filter((r) => r.type === "wired-to").map((r) => r.target)).toEqual(["Pump[3].CmdStart"]);
    expect(gaps.some((r) => r.type === "concerns" || r.type === "about")).toBe(false);
  });

  it("is deterministic", async () => {
    const a = await sampleWithSupplement();
    const b = await sampleWithSupplement();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (const p of PACKS) expect(JSON.stringify(buildDocument(a, config({ pack: p.id })))).toBe(JSON.stringify(buildDocument(b, config({ pack: p.id }))));
  });
});

describe("supplied evidence in the packs", () => {
  it("leaves the Riverbend sample's packs and CSVs byte-identical", async () => {
    // Digests of the sample's documents before supplements existed (main at e35cbcb).
    // A change here means an Ignition-only document changed; make it deliberately.
    const ev = await sampleEvidence();
    const h = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
    const digests = Object.fromEntries(PACKS.map((p) => [p.id, h(JSON.stringify(buildDocument(ev, config({ pack: p.id }))))]));
    expect(digests).toEqual({ "engineering-reference": "d5e23c0014357c1e", "operator-manual": "c8bdcd6871070277", "maintenance-guide": "b30b42ee824c69ba", "complete-handoff": "e9f71665db5df1e0" });
    expect(h(JSON.stringify(inventoryCsvs(ev, config())))).toBe("d8aa41b3b0874502");
    for (const p of PACKS) for (const id of SUPPLIED_SECTIONS) expect(ids(p.id, ev)).not.toContain(id);
  });

  it("places each section where the contract says", async () => {
    const ev = await sampleWithSupplement();
    const after = (pack: PackId, a: string, b: string) => {
      const s = ids(pack, ev);
      expect(s.indexOf(b), `${b} in ${pack}`).toBe(s.indexOf(a) + 1);
    };
    after("engineering-reference", "alarms", "runtime");
    after("engineering-reference", "connections", "controllers");
    after("engineering-reference", "dependencies", "disagreements");
    after("engineering-reference", "appendix-tags", "appendix-io");
    after("operator-manual", "alarms", "runtime");
    expect(ids("operator-manual", ev)).not.toContain("controllers");
    after("maintenance-guide", "mg-equipment", "controllers");
    after("maintenance-guide", "alarms", "runtime");
    after("maintenance-guide", "disagreements", "mg-troubleshooting");
    after("maintenance-guide", "appendix-tags", "appendix-io");
    for (const id of SUPPLIED_SECTIONS) expect(ids("complete-handoff", ev).filter((x) => x === id)).toHaveLength(1);
  });

  it("lists controllers, PLC tags with their HMI readers and I/O with its PLC tag", async () => {
    const doc = buildDocument(await sampleWithSupplement(), config());
    const s = doc.sections.find((x) => x.id === "controllers")!;
    expect(s).toMatchObject({ title: "Controllers and I/O", status: "extracted" });
    const t = tableText(s.blocks);
    expect(t).toContain("1756-L83E");
    expect(t).toContain("`[default]Riverbend/Pumps/P101/Running`, `[default]Riverbend/Pumps/P102/Running`");
    expect(t).toContain("`Pump[3].CmdStart` (not in the PLC program)");
    const appendix = doc.sections.find((x) => x.id === "appendix-io")!;
    expect(appendix.appendix).toBe(true);
    expect(tableText(appendix.blocks)).toContain("PLC_Pumps/Program:MainProgram.P101_SpeedRef");
  });

  it("shows each disagreement with both citations", async () => {
    const s = buildDocument(await sampleWithSupplement(), config()).sections.find((x) => x.id === "disagreements")!;
    const table = s.blocks.find((b) => b.type === "table") as Extract<Block, { type: "table" }>;
    expect(table.rows.map((r) => r[0])).toEqual(["Renamed", "I/O point with no PLC tag", "Ignition tag with no PLC tag", "Alarm missing"]);
    const renamed = table.rows[0]!;
    expect(renamed[1]).toContain("names the member SpeedPercent");
    expect(renamed.slice(2).join(" | ")).toContain("riverbend-tags.json, Riverbend/Pumps/P102/Speed");
    expect(renamed.slice(2).join(" | ")).toContain("line1-controller.L5X, DataType[@Name='Pump_UDT'], line 88");
    for (const r of table.rows) expect(r[2] !== "—" && r[3] !== "—").toBe(true);
  });

  it("states runtime facts in order, says what wasn't measured, and gives no advice", async () => {
    const cfg = config({ redact: { addresses: false, usernames: false, code: false } });
    const s = buildDocument(await sampleWithSupplement(), cfg).sections.find((x) => x.id === "runtime")!;
    const tables = s.blocks.filter((b) => b.type === "table") as Extract<Block, { type: "table" }>[];
    expect(tables[0]!.rows.map((r) => [r[0], r[1]])).toEqual([
      ["High Turbidity on `[default]Riverbend/Filters/Filter1/Turbidity`", "31"],
      ["Low Level on `[default]Riverbend/Clearwell/Level`", "12"],
      ["Pump Fault on `[default]Riverbend/Pumps/P101/Fault`", "12"],
    ]);
    expect(tables[1]!.rows[0]).toEqual(["`[default]Riverbend/Clearwell/Level`", "2.1", "2.4", "3.6", "4.4", "4.7", "m", "43200", "2026-09-01T00:00:00Z to 2026-10-01T00:00:00Z"]);
    expect(tables[2]!.rows[0]).toEqual(["`Riverbend/Pumps/PumpStation`", "2026-09-21T14:02:00Z", "jdoe", "Saved view"]);
    expect(s.blocks.some((b) => b.type === "callout" && /weren't measured/.test(b.text))).toBe(false);
    expect(JSON.stringify(s)).not.toMatch(/\b(should|must|procedure|respond|recommend)/i);

    // Default redaction hides who made the change.
    const redacted = buildDocument(await sampleWithSupplement(), config()).sections.find((x) => x.id === "runtime")!;
    expect(JSON.stringify(redacted)).toContain(REDACTED);
    expect(JSON.stringify(redacted)).not.toContain("jdoe");

    // Only one metric supplied: the other two say so.
    const json = sampleSupplementJson();
    const only = (json.entities as { id: string }[]).filter((e) => !e.id.startsWith("runtime-fact:") || e.id.startsWith("runtime-fact:last-change:"));
    const partial = buildDocument(await sampleWithSupplement({ ...json, entities: only }), config()).sections.find((x) => x.id === "runtime")!;
    const notes = partial.blocks.filter((b) => b.type === "callout").map((b) => (b as { text: string }).text);
    expect(notes).toEqual(expect.arrayContaining([expect.stringMatching(/^Alarm activations weren't measured/), expect.stringMatching(/^Normal ranges weren't measured/)]));
  });

  it("round-trips every supplied section through Markdown", async () => {
    const doc = buildDocument(await sampleWithSupplement(), config({ pack: "complete-handoff" }));
    for (const s of doc.sections.filter((x) => SUPPLIED_SECTIONS.includes(x.id))) {
      const back = markdownToSection(sectionToMarkdown(s));
      expect(back.meta).toMatchObject({ id: s.id, status: s.status, origin: s.origin });
      expect(back.blocks).toEqual(s.blocks);
    }
  });

  it("writes PLC tag, I/O and disagreement CSVs before coverage, only when supplied", async () => {
    const paths = inventoryCsvs(await sampleWithSupplement(), config()).map((c) => c.path);
    expect(paths.slice(-4)).toEqual(["plc-tags.csv", "io-points.csv", "disagreements.csv", "coverage.csv"]);
    const plain = inventoryCsvs(await sampleEvidence(), config()).map((c) => c.path);
    for (const p of ["plc-tags.csv", "io-points.csv", "disagreements.csv"]) expect(plain).not.toContain(p);
    const ds = inventoryCsvs(await sampleWithSupplement(), config()).find((c) => c.path === "disagreements.csv")!.content;
    expect(ds).toContain("line1-io-list.xlsx, I/O, row 9");
    expect(ds).toContain("line1-controller.L5X, Controller/Tags, line 38");
  });

  it("survives a workspace round trip with every supplied kind", async () => {
    const evidence = await sampleWithSupplement();
    const cfg = config({ pack: "complete-handoff" });
    const ws = { config: cfg, evidence, document: buildDocument(evidence, cfg), assets: new Map() };
    const back = readWorkspace(readZip(zipFiles(workspaceFiles(ws), "riverbend-docs/"), () => true).tree);
    expect(back.evidence.entities).toHaveLength(evidence.entities.length);
    for (const k of ["controller", "plc-tag", "io-point", "disagreement", "runtime-fact"]) expect(back.evidence.entities.some((e) => e.kind === k)).toBe(true);
    expect(back.document).toEqual(ws.document);
    expect(buildDocument(back.evidence, cfg).sections.map((s) => s.id)).toEqual(expect.arrayContaining(SUPPLIED_SECTIONS));
  });

  it("works with the supplement listed first", async () => {
    const a = await sampleWithSupplement();
    const b = await extract([supplementFile(), ...sampleInputs()]);
    expect(b.entities.map((e) => e.id)).toEqual(a.entities.map((e) => e.id));
  });
});
