import { describe, expect, it } from "vitest";
import { sampleEvidence, sampleProjectZip, zipOf } from "../test/helpers.ts";
import { InputError, listZip, normalizePath, readZip } from "./archive.ts";
import { detectArchive, extract } from "./extract.ts";
import { parseTagPath, unresolved } from "./resolve.ts";

describe("archive safety", () => {
  it("rejects traversal and absolute paths", () => {
    expect(normalizePath("../etc/passwd")).toBeUndefined();
    expect(normalizePath("a/../../b")).toBeUndefined();
    expect(normalizePath("/abs/file.json")).toBe("abs/file.json");
    expect(normalizePath("a\\b\\c.json")).toBe("a/b/c.json");
    expect(normalizePath("dir/")).toBeUndefined();
    expect(normalizePath("nul\0byte")).toBeUndefined();
  });

  it("reports truncated archives cleanly", () => {
    const zip = sampleProjectZip();
    expect(() => listZip(zip.slice(0, zip.length - 40))).toThrow(InputError);
  });

  it("enforces entry-count and size limits", () => {
    const zip = zipOf({ "a.json": "{}", "b.json": "{}", "c.json": "x".repeat(5000) });
    expect(() => listZip(zip, { maxEntries: 2, maxEntryBytes: 1e6, maxTotalBytes: 1e6 })).toThrow(/more than 2/);
    const { tree, skipped } = readZip(zip, () => true, { maxEntries: 10, maxEntryBytes: 1000, maxTotalBytes: 1e6 });
    expect(skipped.map((s) => s.path)).toEqual(["c.json"]);
    expect(tree.has("c.json")).toBe(true); // listed…
    expect(tree.bytes("c.json")).toBeUndefined(); // …but not read
  });

  it("fails cleanly on files it doesn't understand", async () => {
    const ev = await extract([{ name: "notes.txt", bytes: new TextEncoder().encode("hello") }, { name: "random.zip", bytes: zipOf({ "readme.md": "hi" }) }]);
    expect(ev.entities).toEqual([]);
    expect(ev.diagnostics.map((d) => d.code)).toEqual(["unknown-file", "unknown-archive"]);
    expect(ev.inputs.every((i) => i.format === "unknown")).toBe(true);
  });
});

describe("detection", () => {
  it("tells backups from project exports", () => {
    expect(detectArchive("x.gwbk", [{ path: "backupinfo.xml", size: 1 }]).format).toBe("ignition-gateway-backup");
    expect(detectArchive("p.zip", [{ path: "project.json", size: 1 }])).toMatchObject({ format: "ignition-project-export", prefix: "" });
    expect(detectArchive("p.zip", [{ path: "Plant/project.json", size: 1 }])).toMatchObject({ prefix: "Plant/" });
  });
});

describe("sample project + tag export", () => {
  it("documents every resource type in the sample", async () => {
    const ev = await sampleEvidence();
    const count = (k: string) => ev.entities.filter((e) => e.kind === k).length;
    expect(count("view")).toBe(10);
    expect(count("page")).toBe(6);
    expect(count("named-query")).toBe(3);
    expect(count("script")).toBe(2);
    expect(count("udt-type")).toBe(2);
    expect(count("udt-instance")).toBe(7);
    // 7 atomic tags + 3 pumps × 6 members + 4 filters × 3 members.
    expect(count("tag")).toBe(37);
    // 4 standalone alarms + 3 pump faults + 4 filters × 2.
    expect(count("alarm")).toBe(15);
  });

  it("substitutes UDT parameters into member OPC paths", async () => {
    const ev = await sampleEvidence();
    const p102 = ev.entities.find((e) => e.id === "tag:[default]Riverbend/Pumps/P102/Running");
    expect(p102?.fields.opcItemPath).toBe("ns=1;s=[PLC_Pumps]Pump[1].Running");
    expect(p102?.fields.definedIn).toBe("Pump");
  });

  it("links bindings, queries, scripts and routes", async () => {
    const ev = await sampleEvidence();
    const has = (from: string, type: string, to: string) => ev.relationships.some((r) => r.from === from && r.type === type && r.to === to);
    expect(has("page:Riverbend/pumps", "routes-to", "view:Riverbend/Pumps/PumpStation")).toBe(true);
    expect(has("view:Riverbend/Overview", "embeds-view", "view:Riverbend/Components/PumpTile")).toBe(true);
    expect(has("view:Riverbend/Components/PumpTile", "embeds-view", "view:Riverbend/Popups/PumpControl")).toBe(true);
    expect(has("view:Riverbend/Overview", "binds-tag", "tag:[default]Riverbend/Plant/TotalFlow")).toBe(true);
    expect(has("view:Riverbend/Overview", "calls-query", "named-query:Riverbend/Reports/DailyFlow")).toBe(true);
    expect(has("view:Riverbend/Popups/PumpControl", "calls-script", "script:Riverbend/riverbend.pumps")).toBe(true);
    expect(has("script:Riverbend/riverbend.pumps", "calls-query", "named-query:Riverbend/Maintenance/LogRuntime")).toBe(true);
    expect(has("tag:[default]Riverbend/Plant/TotalFlow", "binds-tag", "tag:[default]Riverbend/Intake/RawFlow")).toBe(true);
    // Script links are inferred, configuration links explicit.
    expect(ev.relationships.find((r) => r.type === "calls-script")?.explicit).toBe(false);
  });

  it("keeps indirect bindings dynamic and reports the missing tag", async () => {
    const ev = await sampleEvidence();
    expect(ev.relationships.filter((r) => r.from === "view:Riverbend/Components/PumpTile" && r.dynamic)).toHaveLength(2);
    const gaps = unresolved(ev).filter((r) => r.type === "binds-tag");
    expect(gaps.map((r) => r.target)).toEqual(["[default]Riverbend/Chemical/ChlorineResidual"]);
  });

  it("lists what it can't read instead of dropping it", async () => {
    const ev = await sampleEvidence();
    expect(ev.coverage.find((c) => c.label === "Vision windows")).toMatchObject({ found: 1, read: 0 });
    expect(ev.entities.find((e) => e.kind === "resource")).toMatchObject({ name: "Main Window", interpreted: false });
  });

  it("reads tables from named query SQL", async () => {
    const ev = await sampleEvidence();
    expect(ev.entities.find((e) => e.id === "named-query:Riverbend/Maintenance/RuntimeHours")?.fields.tables).toEqual(["maint.equipment", "maint.pump_runtime"]);
  });

  it("is deterministic", async () => {
    const a = await sampleEvidence();
    const b = await sampleEvidence();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("reads the same project from a ZIP", async () => {
    const ev = await extract([{ name: "Riverbend_2026-09-29.zip", bytes: sampleProjectZip() }]);
    expect(ev.inputs[0]).toMatchObject({ format: "ignition-project-export" });
    expect(ev.entities.filter((e) => e.kind === "view")).toHaveLength(10);
    expect(ev.entities.some((e) => e.id === "project:Riverbend")).toBe(true);
    expect(ev.inputs[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("gateway backups", () => {
  const cfg = (o: unknown) => JSON.stringify(o);
  const backup83 = () =>
    zipOf({
      "backupinfo.xml": "<gateway-backup><version>8.3.9.2026082511</version><timestamp>2026-09-29 11:42:30</timestamp><backup-type>ALL</backup-type></gateway-backup>",
      "db_backup_sqlite.idb": new Uint8Array(16),
      "config/resources/core/ignition/system-properties/resource.json": "{}",
      "config/resources/core/ignition/system-properties/config.json": cfg({ settings: { systemName: "Plant-GW" } }),
      "config/resources/core/ignition/tag-provider/default/resource.json": "{}",
      "config/resources/core/ignition/tag-provider/default/config.json": cfg({ profile: { type: "STANDARD" } }),
      "config/resources/core/ignition/tag-definition/default/Area/unary-resource.json": "{}",
      "config/resources/core/ignition/tag-definition/default/Area/tags.json": cfg([{ name: "Flow", tagType: "AtomicTag", valueSource: "opc", dataType: "Float4", opcServer: "Local OPC", opcItemPath: "ns=1;s=Flow" }]),
      "config/resources/core/ignition/opc-connection/Local OPC/resource.json": "{}",
      "config/resources/core/ignition/opc-connection/Local OPC/config.json": cfg({
        profile: { type: "com.inductiveautomation.OpcUaServerType" },
        settings: { endpoint: { endpointUrl: "opc.tcp://10.1.2.3:62541" }, authentication: { username: "opcuser", password: { type: "Embedded", data: { ciphertext: "SECRET-CIPHER" } } } },
      }),
      "config/resources/core/ignition/database-connection/PlantDB/resource.json": "{}",
      "config/resources/core/ignition/database-connection/PlantDB/config.json": cfg({ profile: { type: "MSSQL" }, settings: { connectURL: "jdbc:sqlserver://db01:1433", username: "sa", password: "hunter2" } }),
      "config/resources/core/ignition/images/Builtin/icons/a.png/resource.json": "{}",
      "config/resources/local/com.inductiveautomation.opcua/server-keystore/resource.json": "{}",
      "opcua/server/security/certificates.pfx": new Uint8Array(8),
      "projects/Plant/project.json": cfg({ title: "Plant" }),
      "projects/Plant/com.inductiveautomation.perspective/views/Main/resource.json": "{}",
      "projects/Plant/com.inductiveautomation.perspective/views/Main/view.json": cfg({ root: { type: "ia.container.flex", meta: { name: "root" }, children: [{ type: "ia.display.label", meta: { name: "L" }, propConfig: { "props.text": { binding: { type: "tag", config: { tagPath: "[default]Area/Flow" } } } } }] } }),
    });

  it("reads 8.3 file-based configuration", async () => {
    const ev = await extract([{ name: "plant.gwbk", bytes: backup83() }]);
    expect(ev.inputs[0]).toMatchObject({ format: "ignition-gateway-backup", platformVersion: "8.3.9" });
    expect(ev.entities.find((e) => e.kind === "gateway")?.name).toBe("Plant-GW");
    expect(ev.relationships.find((r) => r.from === "view:Plant/Main")?.to).toBe("tag:[default]Area/Flow");
    expect(ev.relationships.find((r) => r.from === "tag:[default]Area/Flow" && r.type === "uses-connection")?.to).toBe("opc-connection:Local OPC");
    expect(ev.entities.find((e) => e.id === "database-connection:PlantDB")?.sensitive).toMatchObject({ connectURL: "address", username: "username" });
  });

  it("never extracts credentials", async () => {
    const ev = await extract([{ name: "plant.gwbk", bytes: backup83() }]);
    const text = JSON.stringify(ev);
    expect(text).not.toContain("SECRET-CIPHER");
    expect(text).not.toContain("hunter2");
    expect(ev.diagnostics.some((d) => d.code === "secrets-excluded")).toBe(true);
    expect(ev.coverage.find((c) => c.label === "Certificates and keystores")).toMatchObject({ read: 0 });
  });

  it("documents 8.1 projects and says why gateway config is missing when the database can't be read", async () => {
    const zip = zipOf({
      "db_backup_sqlite.idb": new Uint8Array(16),
      "gateway.xml": "<x/>",
      "projects/Old/project.json": cfg({ title: "Old" }),
      "projects/Old/com.inductiveautomation.vision/windows/Main/resource.json": "{}",
      "projects/Old/com.inductiveautomation.vision/windows/Main/window.bin": new Uint8Array([1, 2, 3]),
    });
    const ev = await extract([{ name: "old.gwbk", bytes: zip }]);
    expect(ev.entities.some((e) => e.id === "project:Old")).toBe(true);
    expect(ev.diagnostics.some((d) => d.code === "legacy-gateway-config")).toBe(true);
    expect(ev.coverage.find((c) => c.key === "ignition.internal-db")).toMatchObject({ found: 1, read: 0 });
  });
});

describe("tag paths", () => {
  it("parses providers, properties and dynamic paths", () => {
    expect(parseTagPath("[default]A/B/Tag.Quality")).toEqual({ provider: "default", path: "A/B/Tag" });
    expect(parseTagPath("A/B/")).toEqual({ provider: undefined, path: "A/B" });
    expect(parseTagPath("[.]Relative")).toBeUndefined();
    expect(parseTagPath("[default]A/{1}/B")).toBeUndefined();
  });
});

describe("demo backup (demo/riverbend-demo.gwbk)", () => {
  it("documents the whole synthetic gateway without leaking its planted secrets", async () => {
    const { readFileSync } = await import("node:fs");
    const bytes = new Uint8Array(readFileSync(new URL("../demo/riverbend-demo.gwbk", import.meta.url)));
    const ev = await extract([{ name: "riverbend-demo.gwbk", bytes }]);
    const count = (k: string) => ev.entities.filter((e) => e.kind === k).length;
    expect(ev.inputs[0]).toMatchObject({ format: "ignition-gateway-backup", platformVersion: "8.3.9" });
    expect([count("project"), count("opc-connection"), count("database-connection"), count("device"), count("udt-type"), count("alarm")]).toEqual([2, 2, 1, 3, 2, 15]);
    expect(ev.relationships.some((r) => r.type === "uses-connection" && r.to === "opc-connection:Plant OPC UA Server")).toBe(true);
    const text = JSON.stringify(ev);
    for (const s of ["DEMO-NOT-A-REAL-SECRET", "demo-password-never-shown", "demo-hash-", "operator1"]) expect(text).not.toContain(s);
    expect(ev.diagnostics.find((d) => d.code === "secrets-excluded")?.message).toMatch(/^4 credential values/);
  });
});
