import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeBackup81, makeIdb81, PLANTED } from "../test/idb81.ts";
import { defaultConfig } from "./config.ts";
import { buildDocument } from "./document/packs.ts";
import { extract } from "./extract.ts";
import { SqliteDb, SqliteError } from "./sqlite.ts";

const extract81 = (bytes = makeBackup81()) => extract([{ name: "riverbend-81.gwbk", bytes }]);

describe("SQLite reader", () => {
  const build = (sql: string, rows: [string, unknown[]][]) => {
    const dir = mkdtempSync(join(tmpdir(), "oic-sqlite-"));
    try {
      const db = new DatabaseSync(join(dir, "t.db"));
      db.exec(sql);
      for (const [q, args] of rows) db.prepare(q).run(...(args as never[]));
      db.close();
      return new Uint8Array(readFileSync(join(dir, "t.db")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("reads named columns across interior and overflow pages", () => {
    const long = "x".repeat(20_000);
    const rows: [string, unknown[]][] = [];
    for (let i = 1; i <= 600; i++) rows.push(["INSERT INTO t (id, name, n, f, b, secret_password) VALUES (?, ?, ?, ?, ?, ?)", [i, i === 7 ? long : `row ${i}`, i * -1000003, i / 4, new Uint8Array([i & 0xff]), "hidden"]]);
    const db = new SqliteDb(build('CREATE TABLE t (id INTEGER PRIMARY KEY, "name" TEXT, n INTEGER, f REAL, b BLOB, secret_password TEXT, missing_later TEXT)', rows));
    const out = db.select("T", ["id", "name", "n", "f", "b", "nope"]);
    expect(out).toHaveLength(600);
    expect(out[0]).toEqual({ id: 1, name: "row 1", n: -1000003, f: 0.25, b: new Uint8Array([1]), nope: null });
    expect(out[6]!.name).toBe(long);
    expect(out.map((r) => r.id)).toEqual(Array.from({ length: 600 }, (_, i) => i + 1));
    expect(db.count("t")).toBe(600);
  });

  it("refuses credential columns and bad files", () => {
    const bytes = build("CREATE TABLE t (a TEXT, password TEXT)", [["INSERT INTO t VALUES ('x', 'y')", []]]);
    expect(() => new SqliteDb(bytes).select("t", ["a", "password"])).toThrow(SqliteError);
    expect(() => new SqliteDb(new Uint8Array(4096))).toThrow(SqliteError);
    const big = build("CREATE TABLE t (a TEXT)", Array.from({ length: 300 }, (_, i) => ["INSERT INTO t VALUES (?)", [`value ${i} ${"y".repeat(100)}`]] as [string, unknown[]]));
    expect(() => new SqliteDb(big.slice(0, big.length / 2)).select("t", ["a"])).toThrow(SqliteError);
  });
});

describe("gateway backups, 8.1 internal database", () => {
  it("documents tags, UDTs and alarms from TAGCONFIG", async () => {
    const ev = await extract81();
    expect(ev.inputs[0]).toMatchObject({ format: "ignition-gateway-backup", platformVersion: "8.1.45", adapterVersion: "0.2.0" });
    expect(ev.entities.find((e) => e.kind === "gateway")).toMatchObject({ name: "Riverbend-GW81", fields: { configFormat: "internal database (8.1 and earlier)" } });

    const raw = ev.entities.find((e) => e.id === "tag:[Riverbend]Intake/RawFlow");
    expect(raw?.fields).toMatchObject({ dataType: "Float4", opcServer: "Ignition OPC UA Server", opcItemPath: "ns=1;s=[PLC_Intake]HR100", engUnit: "gpm" });
    expect(String(raw?.fields.documentation)).toMatch(/^Raw water flow/);
    expect(ev.entities.some((e) => e.id === "alarm:[Riverbend]Intake/RawFlow#High Flow")).toBe(true);
    expect(ev.entities.filter((e) => e.kind === "tag" && e.path?.startsWith("Bulk/"))).toHaveLength(400);
    expect(ev.entities.some((e) => e.id === "tag:[System]UptimeSeconds")).toBe(true);
    expect(ev.entities.some((e) => e.id === "tag-folder:[Riverbend]Intake")).toBe(true);

    // UDT definition, instances and expanded members with parameters substituted.
    expect(ev.entities.find((e) => e.id === "udt-type:[Riverbend]Pump")?.fields).toMatchObject({ members: ["Running", "Status/Fault"], parameters: ["PumpNum"], alarmCount: 1 });
    expect(ev.entities.find((e) => e.id === "udt-instance:[Riverbend]Pumps/P102")?.fields).toMatchObject({ typeId: "Pump", parameters: ["PumpNum=2"], overrides: 1 });
    expect(ev.entities.find((e) => e.id === "tag:[Riverbend]Pumps/P102/Running")?.fields).toMatchObject({ opcItemPath: "ns=1;s=[PLC_Pumps]Pump2.Running", documentation: "Standby pump", definedIn: "Pump" });
    expect(ev.entities.find((e) => e.id === "tag:[Riverbend]Pumps/P101/Status/Fault")?.fields.opcItemPath).toBe("ns=1;s=[PLC_Pumps]Pump1.Fault");
    expect(ev.entities.some((e) => e.id === "alarm:[Riverbend]Pumps/P101/Status/Fault#Pump Fault")).toBe(true);

    // References resolve against the decoded tags and connections.
    expect(ev.relationships.find((r) => r.from === "view:Riverbend/Main")?.to).toBe("tag:[Riverbend]Intake/RawFlow");
    expect(ev.relationships.find((r) => r.from === "tag:[Riverbend]Pumps/P101/Running" && r.type === "uses-connection")?.to).toBe("opc-connection:Ignition OPC UA Server");
    expect(ev.relationships.find((r) => r.from === "tag:[Riverbend]Intake/TotalFlow" && r.type === "binds-tag")?.to).toBe("tag:[Riverbend]Intake/RawFlow");
  });

  it("documents providers, connections, devices and user sources", async () => {
    const ev = await extract81();
    const get = (id: string) => ev.entities.find((e) => e.id === id);
    expect(get("tag-provider:Riverbend")?.fields).toEqual({ type: "STANDARD", description: "Plant tags (fictional)", readOnly: true });
    expect(get("tag-provider:System")?.fields).toEqual({ type: "SIMPLE" });
    expect(get("opc-connection:Ignition OPC UA Server")).toMatchObject({
      fields: { type: "com.inductiveautomation.OpcUaServerType", "endpoint.endpointUrl": "opc.tcp://localhost:62541", "endpoint.securityPolicy": "Basic256Sha256", username: "opcuauser" },
      sensitive: { "endpoint.endpointUrl": "address", username: "username" },
      source: { path: "db_backup_sqlite.idb", at: "OPCSERVERS/1" },
    });
    expect(get("database-connection:RiverbendSQL")).toMatchObject({ fields: { type: "MSSQL", maxConnections: 8 }, sensitive: { connectURL: "address", username: "username" } });
    expect(get("device:PLC_Intake")?.fields).toMatchObject({ type: "ModbusTcp", hostname: "10.20.1.21", port: 502 });
    expect(get("device:PLC_Pumps")?.fields).toMatchObject({ type: "LogixDriver", hostname: "10.20.1.23", enabled: false });
    expect(get("device:Sim_Lab")?.fields.hostname).toBeUndefined();
    expect(get("user-source:default")?.fields).toEqual({ type: "INTERNAL" });
    expect(get("resource:gateway/ignition/tag-group/Riverbend/Default")?.fields).toMatchObject({ resourceType: "Tag groups", mode: "Direct", rate: 1000 });
    expect(get("resource:gateway/ignition/alarm-journal/Journal")?.fields).toMatchObject({ type: "DATASOURCE" });

    // The existing sections pick them up unchanged.
    const doc = buildDocument(ev, defaultConfig());
    const section = doc.sections.find((s) => s.id === "connections");
    expect(section?.refs).toEqual(expect.arrayContaining(["opc-connection:Ignition OPC UA Server", "database-connection:RiverbendSQL", "device:PLC_Intake", "tag-provider:Riverbend"]));
  });

  it("never reads credentials or users", async () => {
    const ev = await extract81();
    const text = JSON.stringify(ev);
    for (const s of PLANTED) expect(text).not.toContain(s);
    expect(text).not.toContain("operator1");
    expect(ev.coverage.find((c) => c.key === "ignition.internal-db.never")).toMatchObject({ found: 1, read: 0, note: expect.stringContaining("INTERNALUSERTABLE") });
  });

  it("counts what it doesn't read", async () => {
    const ev = await extract81();
    const cov = (key: string) => ev.coverage.find((c) => c.key === key);
    expect(cov("ignition.internal-db.TAGCONFIG")).toMatchObject({ found: 416, read: 413 });
    expect(cov("ignition.internal-db.TAGCONFIG")?.note).toBe("Not read: 1 with no configuration; 1 with configuration that isn't valid JSON; 1 whose parent folder isn't in the database.");
    expect(ev.diagnostics.some((d) => d.code === "tag-rows-unread")).toBe(true);
    expect(cov("ignition.internal-db.SECURITYZONES")).toMatchObject({ found: 1, read: 0 });
    expect(cov("ignition.internal-db.defaults")).toMatchObject({ found: 2, read: 0 }); // IMAGES + JDBCDRIVERS
    expect(cov("ignition.internal-db.runtime")).toMatchObject({ found: 1, read: 0 });
    expect(cov("ignition.internal-db.driver-settings")).toMatchObject({ found: 3, read: 2 });
    expect(cov("ignition.internal-db")).toBeUndefined();
    expect(ev.diagnostics.some((d) => d.code === "legacy-gateway-config")).toBe(false);
  });

  it("is deterministic", async () => {
    const bytes = makeBackup81();
    const a = await extract81(bytes);
    const b = await extract81(bytes);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // Rebuilding the database from the same SQL gives the same evidence too.
    const c = await extract81(makeBackup81(makeIdb81()));
    expect(JSON.stringify(c.entities)).toBe(JSON.stringify(a.entities));
  });

  it("keeps the projects when the database is damaged", async () => {
    const idb = makeIdb81();
    let seed = 7;
    let damaged = 0;
    for (let round = 0; round < 12; round++) {
      const bad = idb.slice();
      // Scribble over a run of bytes past the header.
      for (let i = 0; i < 64; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        bad[100 + (seed % (bad.length - 100))] = seed & 0xff;
      }
      const ev = await extract81(makeBackup81(bad));
      expect(ev.entities.some((e) => e.id === "project:Riverbend")).toBe(true);
      expect(ev.diagnostics.some((d) => d.code === "input-failed")).toBe(false);
      if (ev.diagnostics.some((d) => d.code === "internal-db-damaged" || d.code === "legacy-gateway-config" || d.code === "tag-rows-unread")) damaged++;
    }
    expect(damaged).toBeGreaterThan(0);
  });
});
