/**
 * Build demo/riverbend-demo.gwbk: a synthetic Ignition 8.3 gateway backup for
 * demonstrating Documentation Toolkit.
 *
 *   pnpm demo:backup
 *
 * It has the layout of a real 8.3 backup (backupinfo.xml, projects/,
 * config/resources/…) around the Riverbend sample, plus gateway configuration:
 * tag providers, tags and UDTs, OPC and database connections, devices, user
 * sources and alarm notification. It deliberately includes things the toolkit
 * must refuse to read (fake passwords, keystores, certificates) so the demo
 * shows them excluded and counted.
 *
 * Everything is fictional. It is NOT a restorable backup: never load it into a
 * real gateway.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { zipSync, type Zippable } from "fflate";
import { treeFromDir } from "../cli/fs.ts";
import type { TagNode } from "../lib/adapters/ignition-tags.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = `${root}demo/riverbend-demo.gwbk`;
const enc = new TextEncoder();
const files: Record<string, Uint8Array> = {};
const put = (path: string, content: string | Uint8Array | object) =>
  (files[path] = content instanceof Uint8Array ? content : enc.encode(typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`));
const bytes = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed * 17) & 0xff);

const resource = (files: string[], attributes: object = {}, extra: object = {}) => ({ scope: "G", version: 1, restricted: false, overridable: true, files, attributes, ...extra });
/** A fake Ignition embedded secret. The toolkit must never read these. */
const secret = (n: number) => ({ type: "Embedded", data: { ciphertext: `DEMO-NOT-A-REAL-SECRET-${n}`, encrypted_key: "demo", iv: "demo", protected: "demo", tag: "demo" } });

/* ------------------------------ backup metadata ------------------------------ */

put("backupinfo.xml", `<?xml version="1.0" encoding="UTF-8"?>
<gateway-backup>
\t<version>8.3.9.2026082511</version>
\t<timestamp>2026-09-29 09:00:00</timestamp>
\t<backup-type>ALL</backup-type>
\t<ts>1790672400000</ts>
\t<edition></edition>
</gateway-backup>
`);
put("README-DEMO.txt", "Synthetic demo backup for Documentation Toolkit. Fictional plant, fictional data.\nNOT a restorable gateway backup: never load it into a real Ignition gateway.\n");
// Present in real 8.3 backups; the toolkit reports these without reading them.
put("db_backup_sqlite.idb", bytes(4096, 1));
put("ignition.conf", "# Demo service configuration (placeholder)\nwrapper.java.initmemory=1024\nwrapper.java.maxmemory=4096\n");
put("logback.xml", "<configuration><!-- demo placeholder --></configuration>\n");
put("redundancy.xml", "<redundancy><!-- demo placeholder --></redundancy>\n");
put("gateway.xml", "<gateway><!-- demo placeholder --></gateway>\n");
put("opcua/server/security/certificates.pfx", bytes(2048, 2));
put("opcua/client/security/certificates.pfx", bytes(2048, 3));
put("user-lib/pylib/riverbend_helpers/__init__.py", "# Third-party style helper library (demo)\n");
put("user-lib/pylib/riverbend_helpers/units.py", "def gpm_to_mgd(gpm):\n    return gpm * 0.00144\n");
put("user-lib/jdbc/mssql-jdbc-demo.jar", bytes(1024, 4));
put("modules/com.inductiveautomation.perspective/themes/light/palette/demo.css", ":root{}\n");

/* ------------------------------ projects ------------------------------ */

// The Riverbend sample project, now inheriting shared resources from a global project.
const sample = treeFromDir(`${root}fixtures/sample/riverbend-project`);
for (const e of sample.entries) {
  let data = sample.bytes(e.path)!;
  if (e.path === "project.json") {
    const meta = JSON.parse(new TextDecoder().decode(data));
    data = enc.encode(`${JSON.stringify({ ...meta, description: "Fictional water treatment plant used to demonstrate Documentation Toolkit.", parent: "Riverbend_Global" }, null, 2)}\n`);
  }
  put(`projects/Riverbend/${e.path}`, data);
}

const G = "projects/Riverbend_Global";
put(`${G}/project.json`, { title: "Riverbend shared resources", description: "Inheritable scripts and queries shared by Riverbend projects (fictional).", enabled: true, inheritable: true });
put(`${G}/ignition/script-python/shared/alarms/code.py`, `"""Shared alarm helpers (demo)."""

def activeCount(priority="High"):
    """Number of active, unacknowledged alarms at or above a priority."""
    events = system.alarm.queryStatus(priority=[priority], state=["ActiveUnacked"])
    return len(events)

def shelveForMaintenance(tagPath, minutes=60):
    """Shelve a tag's alarms while it is under maintenance."""
    system.alarm.shelve(path=[tagPath + "*"], timeoutMinutes=minutes)
`);
put(`${G}/ignition/script-python/shared/alarms/resource.json`, resource(["code.py"]));
put(`${G}/ignition/named-query/Shared/ShiftLog/query.sql`, "SELECT t_stamp, operator, note\nFROM ops.shift_log\nWHERE t_stamp >= :Since\nORDER BY t_stamp DESC");
put(`${G}/ignition/named-query/Shared/ShiftLog/resource.json`, resource(["query.sql"], { type: "Query", database: "RiverbendSQL", enabled: true, parameters: [{ type: "Parameter", identifier: "Since", sqlType: 8 }] }));
put(`${G}/com.inductiveautomation.perspective/views/Shared/AlarmBanner/view.json`, {
  params: {},
  props: { defaultSize: { width: 1200, height: 48 } },
  root: {
    type: "ia.container.flex",
    meta: { name: "root" },
    children: [
      { type: "ia.display.label", meta: { name: "Count" }, propConfig: { "props.text": { binding: { type: "expr", config: { expression: "'Critical alarms: ' + {[default]Riverbend/Intake/LowFlowInterlock}" } } } } },
      { type: "ia.display.label", meta: { name: "Mode" }, propConfig: { "props.text": { binding: { type: "tag", config: { mode: "direct", tagPath: "[default]Riverbend/Plant/Mode" } } } } },
    ],
  },
});
put(`${G}/com.inductiveautomation.perspective/views/Shared/AlarmBanner/resource.json`, resource(["view.json"]));

/* ------------------------------ gateway configuration ------------------------------ */

const C = "config/resources/core";
const cfg = (dir: string, config: object, res: object = resource(["config.json"])) => {
  put(`${dir}/resource.json`, res);
  put(`${dir}/config.json`, config);
};
put(`${C}/config-mode.json`, { mode: "core" });

cfg(`${C}/ignition/system-properties`, { settings: { systemName: "Riverbend-GW", httpPort: 8088, httpsPort: 8043, homepageNotes: "Fictional demo gateway" } });

cfg(`${C}/ignition/tag-provider/default`, { profile: { type: "STANDARD", allowBackfill: false }, settings: { readOnly: false, valuePersistence: "Database" } });
cfg(`${C}/ignition/tag-provider/System`, { profile: { type: "SYSTEM" }, settings: {} });
cfg(`${C}/ignition/tag-group/default/Default`, { settings: { mode: "Direct", rate: 1000 } });
cfg(`${C}/ignition/tag-group/default/Slow`, { settings: { mode: "Direct", rate: 10000 } });

// OPC connections: the loopback server and a fictional plant server, with fake credentials.
cfg(`${C}/ignition/opc-connection/Ignition OPC UA Server`, {
  profile: { type: "com.inductiveautomation.OpcUaServerType" },
  settings: {
    endpoint: { discoveryUrl: "opc.tcp://localhost:62541/discovery", endpointUrl: "opc.tcp://localhost:62541", securityPolicy: "Basic256Sha256", securityMode: "SignAndEncrypt" },
    authentication: { authenticationType: "USERNAME", username: "opcuauser", password: secret(1) },
    advanced: { connectTimeout: 5000, requestTimeout: 60000 },
  },
}, resource(["config.json"], {}, { description: "Default loopback connection to Ignition's OPC UA server" }));
cfg(`${C}/ignition/opc-connection/Plant OPC UA Server`, {
  profile: { type: "com.inductiveautomation.OpcUaServerType" },
  settings: {
    endpoint: { discoveryUrl: "opc.tcp://10.20.1.15:4840", endpointUrl: "opc.tcp://10.20.1.15:4840", securityPolicy: "Basic256Sha256", securityMode: "Sign" },
    authentication: { authenticationType: "USERNAME", username: "svc_scada", password: secret(2) },
  },
}, resource(["config.json"], {}, { description: "Fictional plant-floor OPC UA server" }));

// Database connection with a plaintext fake password the toolkit must drop.
cfg(`${C}/ignition/database-connection/RiverbendSQL`, {
  profile: { type: "MSSQL" },
  settings: { connectURL: "jdbc:sqlserver://sql01.riverbend.example:1433;databaseName=Riverbend", username: "svc_ignition", password: "demo-password-never-shown", validationQuery: "SELECT 1", maxConnections: 8 },
}, resource(["config.json"], {}, { description: "Historian, maintenance and shift log database (fictional)" }));

// Devices, one per PLC the tags reference.
for (const [name, host, type] of [
  ["PLC_Intake", "10.20.1.21", "ModbusTcp"],
  ["PLC_Filters", "10.20.1.22", "ModbusTcp"],
  ["PLC_Pumps", "10.20.1.23", "EtherNetIp"],
] as const) {
  cfg(`${C}/com.inductiveautomation.opcua/device/${name}`, { profile: { type, enabled: true }, settings: { hostname: host, port: type === "ModbusTcp" ? 502 : 44818, communicationTimeout: 2000 } }, resource(["config.json"], {}, { description: `${name.replace("PLC_", "")} PLC (fictional)` }));
}

// User sources: users are counted, never listed; password hashes are dropped.
cfg(`${C}/ignition/user-source/default`, { profile: { type: "INTERNAL" }, settings: { failoverMode: "Hard" } }, resource(["config.json", "users.json"]));
put(`${C}/ignition/user-source/default/users.json`, [
  { username: "operator1", firstName: "Demo", lastName: "Operator", roles: ["Operator"], password: "demo-hash-1" },
  { username: "operator2", firstName: "Demo", lastName: "Operator", roles: ["Operator"], password: "demo-hash-2" },
  { username: "engineer", firstName: "Demo", lastName: "Engineer", roles: ["Engineer", "Administrator"], password: "demo-hash-3" },
]);
cfg(`${C}/ignition/identity-provider/default`, { profile: { type: "internal" }, settings: { userSource: "default" } });
cfg(`${C}/ignition/security-levels`, { settings: { levels: ["Authenticated", "Roles"] } });

// Alarm notification, schedules and journal.
cfg(`${C}/ignition/alarm-notification-profile/Operations Email`, { profile: { type: "SMTP" }, settings: { hostname: "smtp.riverbend.example", port: 587, useSslPort: false, username: "alarms@riverbend.example", password: secret(3) } });
cfg(`${C}/ignition/alarm-journal/Journal`, { profile: { type: "DATASOURCE" }, settings: { datasource: "RiverbendSQL", tableName: "alarm_events", minPriority: "Low" } });
cfg(`${C}/ignition/schedule/Weekday Day Shift`, { settings: { description: "Mon–Fri 06:00–18:00", allDays: false } });
cfg(`${C}/ignition/general-alarm-settings`, { settings: { defaultAckMode: "Manual" } });

// Built-in assets and local security material: counted, never read.
put(`${C}/ignition/images/Builtin/icons/32/pump.png/resource.json`, resource(["pump.png"]));
put(`${C}/ignition/images/Builtin/icons/32/pump.png/pump.png`, bytes(256, 5));
put(`${C}/ignition/database-translator/MSSQL/resource.json`, resource(["config.json"]));
put(`${C}/ignition/database-translator/MSSQL/config.json`, { settings: {} });
put("config/resources/local/com.inductiveautomation.opcua/server-keystore/resource.json", resource(["server.keystore"]));
put("config/resources/local/com.inductiveautomation.opcua/server-keystore/server.keystore", bytes(1024, 6));

/* ------------------------------ tags (8.3 layout) ------------------------------ */

// Reuse the sample tag export, split the way 8.3 stores it: one tags.json per folder.
const exported = JSON.parse(readFileSync(`${root}fixtures/sample/riverbend-tags.json`, "utf8")) as TagNode;
const TD = `${C}/ignition/tag-definition/default`;
const TT = `${C}/ignition/tag-type-definition/default`;
const unary = resource(["tags.json"], { config: {} });
const writeFolder = (dir: string, nodes: TagNode[]) => {
  const leaves = nodes.filter((n) => n.tagType !== "Folder");
  put(`${dir}/unary-resource.json`, unary);
  put(`${dir}/tags.json`, leaves);
  for (const f of nodes.filter((n) => n.tagType === "Folder")) writeFolder(`${dir}/${f.name}`, f.tags ?? []);
};
put(`${TD}/unary-resource.json`, resource([], { config: {} }));
for (const top of exported.tags ?? []) {
  if (top.name === "_types_") {
    // Filters read from the plant OPC server; pumps stay on the loopback server.
    const types = (top.tags ?? []).map((t) => (t.name === "Filter" ? { ...t, tags: (t.tags ?? []).map((m) => ({ ...m, opcServer: "Plant OPC UA Server" })) } : t));
    put(`${TT}/unary-resource.json`, unary);
    put(`${TT}/tags.json`, types);
  } else writeFolder(`${TD}/${top.name}`, top.tags ?? []);
}
// A few extra gateway-only tags: a status folder and a reference tag.
put(`${TD}/Riverbend/Status/unary-resource.json`, unary);
put(`${TD}/Riverbend/Status/tags.json`, [
  { name: "GatewayUptime", tagType: "AtomicTag", valueSource: "reference", dataType: "Int8", sourceTagPath: "[System]Gateway/UptimeSeconds" },
  { name: "HeadLossMax", tagType: "AtomicTag", valueSource: "expr", dataType: "Float4", engUnit: "psi", expression: "max({[default]Riverbend/Filters/Filter1/HeadLoss}, {[default]Riverbend/Filters/Filter2/HeadLoss}, {[default]Riverbend/Filters/Filter3/HeadLoss}, {[default]Riverbend/Filters/Filter4/HeadLoss})" },
]);

/* ------------------------------ write ------------------------------ */

const zip: Zippable = {};
const mtime = new Date(Date.UTC(2026, 8, 29, 9));
for (const path of Object.keys(files).sort()) zip[path] = [files[path]!, { mtime }];
mkdirSync(`${root}demo`, { recursive: true });
writeFileSync(out, zipSync(zip, { level: 9 }));
console.log(`✓ ${out} (${Object.keys(files).length} files, ${(readFileSync(out).length / 1024).toFixed(0)} KB)`);
