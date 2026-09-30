import { SqliteDb, SqliteError, type SqlRow, type SqlValue } from "../sqlite.ts";
import type { EntityKind, FieldValue, Sensitivity } from "../types.ts";
import { clip, type Collector } from "./collector.ts";
import { collectTagNodes, type TagNode, type TagStore } from "./ignition-tags.ts";

/**
 * Ignition 8.1 and earlier keep gateway configuration in an internal SQLite
 * database, `db_backup_sqlite.idb`. Tags are one TAGCONFIG row per node (the
 * same JSON as a tag export, minus children) linked by FOLDERID; connections,
 * devices and providers are ordinary tables. Only named, non-credential
 * columns are read (`SqliteDb.select` refuses credential names). Every other
 * table with rows is counted in coverage with a reason.
 */

export const INTERNAL_DB = "db_backup_sqlite.idb";

export type InternalDb = { db: SqliteDb; systemName?: string } | { error: string };

export function openInternalDb(bytes: Uint8Array): InternalDb {
  try {
    const db = new SqliteDb(bytes);
    const name = db.select("SYSPROPS", ["SYSTEMNAME"])[0]?.SYSTEMNAME;
    return { db, systemName: typeof name === "string" && name ? name : undefined };
  } catch (e) {
    return { error: e instanceof SqliteError ? e.message : "The file couldn't be read." };
  }
}

const str = (v: SqlValue | undefined) => (typeof v === "string" && v !== "" ? v : undefined);
const num = (v: SqlValue | undefined) => (typeof v === "number" ? v : undefined);
const src = (c: Collector, table: string, id?: SqlValue | undefined) => c.src(INTERNAL_DB, id === undefined || id === null ? table : `${table}/${String(id)}`);

/** Tables read below, so the rest can be counted. */
const READ = new Set([
  "SYSPROPS",
  "TAGCONFIG",
  "TAGPROVIDERSETTINGS",
  "SIMPLETAGPROVIDERPROFILE",
  "INTERNALTAGPROVIDER",
  "OPCSERVERS",
  "OPCUACONNECTIONSETTINGS",
  "DATASOURCES",
  "DEVICESETTINGS",
  "AUTHPROFILES",
]);

/** Profile tables that become `resource` entities, keyed like their 8.3 counterparts so ids survive an upgrade. */
const PROFILES: { table: string; type: string; label: string }[] = [
  { table: "TAGGROUPS", type: "tag-group", label: "Tag groups" },
  { table: "ALARMJOURNALS", type: "alarm-journal", label: "Alarm journals" },
  { table: "ALARMNOTIFICATIONPROFILES", type: "alarm-notification-profile", label: "Alarm notification profiles" },
  { table: "SCHEDULE_PROFILES", type: "schedule", label: "Schedules" },
  { table: "TAGHISTORYPROVIDEREP", type: "historian", label: "Historians" },
  { table: "STOREANDFORWARDSYSSETTINGS", type: "store-and-forward", label: "Store and forward engines" },
  { table: "AUDITPROFILES", type: "audit-profile", label: "Audit profiles" },
];

/** Never read: people, credentials and security material. Rows are counted without decoding them. */
const NEVER = /^INTERNAL(USER|CONTACT|AUTH|ROLE)|CERTIFICATE|KEYSTORE|SMTP|EMAIL|OAUTH|AUTHPROFILEPROPERTIES|^IDP_|REMEMBERED|FALLBACKCACHE|SECUREDENTITY|LICENSE|^ROSTER|SMSNOTIFICATION|SIPNOTIFICATION|ONEWAYNOTIFICATION|REMOTENOTIFICATION/;
/** Shipped with Ignition or internal bookkeeping, not site configuration. */
const DEFAULTS = /^(IMAGES|DBTRANSLATORS|JDBCDRIVERS|SEQUENCES|DUAL|SRFEATURES|STARTERSTEPS|EULAS|KEYBOARDLAYOUTS|TRANSLATIONTERMS|TRANSLATIONSETTINGS|COBRANDING|TAGSTORAGEPROPS|HOMEPAGE_SETTINGS|REGIONSETTINGS)$/;
/** Logs and runtime state. */
const RUNTIME = /^(AUDITEVENTS|ALERTLOG|TASKEVENTLOG|PROJECT_CHANGES|GATEWAYTASKRECORD|REMOTEUPGRADE|LOCALHISTORIANSYNC|TAGREPORTSEARCH|WSQUEUE_OVERRIDES)$/;
/** Projects in the database (8.0 layout); backups also carry them under projects/, which is what's read. */
const PROJECT_TABLES = /^PROJECT(S|_RESOURCES)$/;

const DEVICE_ADDRESS = ["HOSTNAME", "PORT", "ADDRESS", "REMOTEADDRESS", "REMOTEPORT", "SERIALPORT"];

export function collectInternalDb(c: Collector, db: SqliteDb, store: TagStore) {
  // A damaged table stops only its own section; what was read stays, and the damage is counted.
  const guard = <T>(what: string, fallback: T, fn: () => T): T => {
    try {
      return fn();
    } catch (e) {
      const why = e instanceof SqliteError ? e.message : "The data is damaged.";
      c.count("ignition.internal-db.damaged", "Damaged parts of the internal database", false, "Couldn't be read; the backup may be truncated or damaged.");
      c.diag("warning", "internal-db-damaged", `Couldn't read ${what} from the internal database: ${why}`, c.src(INTERNAL_DB));
      return fallback;
    }
  };
  const providers = guard("tag providers", new Map<number, string>(), () => collectProviders(c, db));
  guard("tags", undefined, () => collectTags(c, db, providers, store));
  guard("OPC connections", undefined, () => collectOpc(c, db));
  guard("database connections", undefined, () => collectDatabases(c, db));
  const deviceTables = guard("devices", new Set<string>(), () => collectDevices(c, db));
  guard("user sources", undefined, () => collectUserSources(c, db));
  for (const p of PROFILES) guard(p.label.toLowerCase(), undefined, () => collectProfiles(c, db, p, providers));
  if (db.table("SYSPROPS")) c.count("ignition.internal-db.SYSPROPS", "System properties", true);

  // Count, don't drop: every other table with rows.
  const groups = new Map<string, { label: string; note: string; rows: number; tables: string[] }>();
  const group = (key: string, label: string, note: string, table: string, rows: number) => {
    const g = groups.get(key) ?? { label, note, rows: 0, tables: [] };
    g.rows += rows;
    g.tables.push(table);
    groups.set(key, g);
  };
  for (const t of [...db.tables.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const name = t.name.toUpperCase();
    if (READ.has(name) || deviceTables.has(name) || PROFILES.some((p) => p.table === name)) continue;
    const rows = guard(t.name, 0, () => db.count(t.name));
    if (!rows) continue;
    if (NEVER.test(name)) group("never", "Users, credentials and security material", "Never read. Users, contact details, passwords and certificates stay out of documentation", name, rows);
    else if (DEFAULTS.test(name)) group("defaults", "Built-in assets and platform defaults", "Images, drivers, translators and bookkeeping that ship with Ignition aren't documented", name, rows);
    else if (RUNTIME.test(name)) group("runtime", "Logs and runtime state", "Audit, alert and task logs are history, not configuration", name, rows);
    else if (PROJECT_TABLES.test(name)) group("projects", "Projects stored in the internal database", "Projects are read from the backup's projects/ folder instead", name, rows);
    else c.countMany(`ignition.internal-db.${name}`, `Gateway settings (${name})`, rows, 0, t.withoutRowid ? "This table's storage format isn't read." : "This settings table isn't documented yet.");
  }
  for (const [key, g] of groups) c.countMany(`ignition.internal-db.${key}`, g.label, g.rows, 0, `${g.note} (${g.tables.join(", ")}).`);
  c.diag("info", "internal-db-read", "Gateway configuration was read from the backup's internal database (Ignition 8.1 layout). Password, key and certificate columns are never read.", c.src(INTERNAL_DB));
}

/* ------------------------------ tag providers ------------------------------ */

function collectProviders(c: Collector, db: SqliteDb): Map<number, string> {
  const byId = new Map<number, string>();
  const readOnly = new Map(db.select("INTERNALTAGPROVIDER", ["PROFILEID", "READONLY"]).map((r) => [num(r.PROFILEID), r.READONLY === 1]));
  for (const r of db.select("TAGPROVIDERSETTINGS", ["TAGPROVIDERSETTINGS_ID", "NAME", "TYPEID", "DESCRIPTION", "ENABLED"])) {
    const name = str(r.NAME);
    const id = num(r.TAGPROVIDERSETTINGS_ID);
    if (!name || id === undefined) continue;
    byId.set(id, name);
    const fields: Record<string, FieldValue> = { type: str(r.TYPEID) ?? null };
    if (str(r.DESCRIPTION)) fields.description = clip(str(r.DESCRIPTION)!, 240);
    if (r.ENABLED === 0) fields.enabled = false;
    if (readOnly.get(id)) fields.readOnly = true;
    c.add({ id: `tag-provider:${name}`, kind: "tag-provider", name, path: name, source: src(c, "TAGPROVIDERSETTINGS", id), fields });
    c.count("gateway.ignition/tag-provider", "Tag providers", true);
  }
  // Managed providers such as System.
  for (const r of db.select("SIMPLETAGPROVIDERPROFILE", ["NAME", "PROVIDERID"])) {
    const name = str(r.NAME);
    const id = num(r.PROVIDERID);
    if (!name) continue;
    if (id !== undefined && !byId.has(id)) byId.set(id, name);
    c.add({ id: `tag-provider:${name}`, kind: "tag-provider", name, path: name, source: src(c, "SIMPLETAGPROVIDERPROFILE", name), fields: { type: "SIMPLE" } });
    c.count("gateway.ignition/tag-provider", "Tag providers", true);
  }
  return byId;
}

/* ------------------------------ tags ------------------------------ */

interface TagRow {
  id: string;
  folder?: string;
  provider: string;
  cfg: TagNode;
}

const TYPES_FOLDER = "_types_";
const byName = (a: TagRow, b: TagRow) => {
  const x = String(a.cfg.name ?? "");
  const y = String(b.cfg.name ?? "");
  return x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/**
 * Rebuild each provider's tag tree from TAGCONFIG rows, then read it with the
 * same code as a tag export. UDT definitions sit under the `_types_` folder
 * id; instance overrides are rows with an `<instance>.<member>` id that
 * carry only the overridden properties.
 */
function collectTags(c: Collector, db: SqliteDb, providers: Map<number, string>, store: TagStore) {
  const raw = db.select("TAGCONFIG", ["ID", "PROVIDERID", "FOLDERID", "CFG", "NAME"]);
  if (!raw.length) return;
  let bad = 0;
  let empty = 0;
  const rows: TagRow[] = [];
  const unknownProviders = new Set<number>();
  for (const r of raw) {
    const id = str(r.ID);
    let cfg: unknown;
    try {
      cfg = typeof r.CFG === "string" ? JSON.parse(r.CFG) : undefined;
    } catch {
      cfg = undefined;
    }
    if (r.CFG === null) {
      empty++;
      continue;
    }
    if (!id || !cfg || typeof cfg !== "object" || Array.isArray(cfg)) {
      bad++;
      continue;
    }
    const pid = num(r.PROVIDERID) ?? -1;
    const provider = providers.get(pid) ?? `provider-${pid}`;
    if (!providers.has(pid)) unknownProviders.add(pid);
    const node = { ...(cfg as TagNode) };
    if (typeof node.name !== "string" && str(r.NAME)) node.name = str(r.NAME);
    rows.push({ id, folder: str(r.FOLDERID), provider, cfg: node });
  }

  const children = new Map<string, TagRow[]>();
  for (const r of rows) {
    const key = r.folder === undefined ? `root|${r.provider}` : r.folder === TYPES_FOLDER ? `types|${r.provider}` : r.folder;
    children.set(key, [...(children.get(key) ?? []), r]);
  }
  for (const list of children.values()) list.sort(byName);

  // UDT members by their own id segment, so instance overrides can find the member they change.
  const typeRows = rows.filter((r) => r.cfg.tagType === "UdtType");
  const memberPath = new Map<string, string>();
  const walkMembers = (parent: string, prefix: string, depth: number) => {
    for (const m of children.get(parent) ?? []) {
      if (typeof m.cfg.name !== "string" || depth > 32) continue;
      const path = prefix ? `${prefix}/${m.cfg.name}` : m.cfg.name;
      memberPath.set(m.id.slice(m.id.lastIndexOf(".") + 1), path);
      if (m.cfg.tagType === "Folder") walkMembers(m.id, path, depth + 1);
    }
  };
  for (const t of typeRows) walkMembers(t.id, "", 0);

  const used = new Set<string>();
  let orphanOverrides = 0;
  const build = (r: TagRow, depth: number): TagNode | undefined => {
    if (used.has(r.id) || depth > 64) return undefined;
    used.add(r.id);
    const node: TagNode = { ...r.cfg };
    if (node.tagType === "UdtInstance") {
      node.tags = overridesOf(r);
      return node;
    }
    const kids = (children.get(r.id) ?? []).map((k) => build(k, depth + 1)).filter((k): k is TagNode => !!k);
    if (kids.length || node.tagType === "Folder" || node.tagType === "UdtType") node.tags = kids;
    return node;
  };
  // Overrides can sit directly under the instance or under an overridden member folder.
  const overridesOf = (inst: TagRow): TagNode[] => {
    const root: TagNode[] = [];
    const pending = [...(children.get(inst.id) ?? [])];
    for (let i = 0; i < pending.length; i++) {
      const o = pending[i]!;
      used.add(o.id);
      pending.push(...(children.get(o.id) ?? []));
      const path = memberPath.get(o.id.slice(o.id.lastIndexOf(".") + 1));
      if (!path) {
        orphanOverrides++;
        continue;
      }
      if (o.cfg.tagType === "Folder") continue;
      insertAt(root, path.split("/"), o.cfg);
    }
    return root;
  };

  const byProvider = new Map<string, TagNode[]>();
  for (const provider of [...new Set(rows.map((r) => r.provider))].sort()) {
    const roots = (children.get(`root|${provider}`) ?? []).map((r) => build(r, 0)).filter((n): n is TagNode => !!n);
    const types = (children.get(`types|${provider}`) ?? []).map((r) => build(r, 0)).filter((n): n is TagNode => !!n);
    if (types.length) roots.push({ name: TYPES_FOLDER, tagType: "Folder", tags: types });
    byProvider.set(provider, roots);
  }
  for (const [provider, roots] of byProvider) {
    if (!c.entities.has(`tag-provider:${provider}`)) c.add({ id: `tag-provider:${provider}`, kind: "tag-provider", name: provider, path: provider, source: src(c, "TAGCONFIG"), fields: {} });
    collectTagNodes(c, roots, { provider, folder: "", file: INTERNAL_DB, inTypes: false, store });
  }

  const unreached = rows.filter((r) => !used.has(r.id)).length;
  const unread = empty + bad + unreached + orphanOverrides;
  const why = [
    empty ? `${empty} with no configuration` : "",
    bad ? `${bad} with configuration that isn't valid JSON` : "",
    unreached ? `${unreached} whose parent folder isn't in the database` : "",
    orphanOverrides ? `${orphanOverrides} overriding a UDT member that isn't in its definition` : "",
  ].filter(Boolean);
  c.countMany("ignition.internal-db.TAGCONFIG", "Tag configuration rows", raw.length, raw.length - unread, why.length ? `Not read: ${why.join("; ")}.` : undefined);
  if (unread) c.diag("warning", "tag-rows-unread", `${unread} tag configuration row${unread > 1 ? "s" : ""} couldn't be placed in the tag tree: ${why.join("; ")}.`, src(c, "TAGCONFIG"));
  if (unknownProviders.size) c.diag("warning", "tag-provider-unknown", `Tags reference ${unknownProviders.size} tag provider id${unknownProviders.size > 1 ? "s" : ""} with no provider settings; they're documented under provider-<id>.`, src(c, "TAGCONFIG"));
}

/** Place an override at a member path, creating the member folders it sits in. */
function insertAt(nodes: TagNode[], path: string[], cfg: TagNode) {
  const [head, ...rest] = path;
  if (!head) return;
  let n = nodes.find((x) => x.name === head);
  if (!n) {
    n = rest.length ? { name: head, tagType: "Folder", tags: [] } : { name: head };
    nodes.push(n);
  }
  if (rest.length) insertAt((n.tags ??= []), rest, cfg);
  else Object.assign(n, cfg, { name: head });
}

/* ------------------------------ connections and devices ------------------------------ */

function entity(c: Collector, kind: EntityKind, name: string, table: string, id: SqlValue | undefined, fields: Record<string, FieldValue>, sensitive: Record<string, Sensitivity>) {
  const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && v !== ""));
  const marks = Object.fromEntries(Object.entries(sensitive).filter(([k]) => k in clean));
  c.add({ id: `${kind}:${name}`, kind, name, path: name, source: src(c, table, id), fields: clean, sensitive: Object.keys(marks).length ? marks : undefined });
}

function common(r: SqlRow): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  if (str(r.DESCRIPTION)) out.description = clip(str(r.DESCRIPTION)!, 240);
  if (r.ENABLED === 0) out.enabled = false;
  return out;
}

function collectOpc(c: Collector, db: SqliteDb) {
  const ua = new Map(
    db
      .select("OPCUACONNECTIONSETTINGS", ["SERVERSETTINGSID", "ENABLED", "DISCOVERYURL", "ENDPOINTURL", "SECURITYPOLICY", "SECURITYMODE", "USERNAME", "HOSTOVERRIDE", "FAILOVERENABLED"])
      .map((r) => [num(r.SERVERSETTINGSID), r]),
  );
  for (const r of db.select("OPCSERVERS", ["OPCSERVERS_ID", "NAME", "TYPE", "DESCRIPTION", "READONLY"])) {
    const name = str(r.NAME);
    if (!name) continue;
    const s = ua.get(num(r.OPCSERVERS_ID));
    const fields: Record<string, FieldValue> = { type: str(r.TYPE) ?? null, ...common(r) };
    if (r.READONLY === 1) fields.readOnly = true;
    if (s) {
      Object.assign(fields, {
        "endpoint.endpointUrl": str(s.ENDPOINTURL),
        "endpoint.discoveryUrl": str(s.DISCOVERYURL),
        "endpoint.securityPolicy": str(s.SECURITYPOLICY),
        "endpoint.securityMode": str(s.SECURITYMODE),
        username: str(s.USERNAME),
        hostOverride: str(s.HOSTOVERRIDE),
      });
      if (s.ENABLED === 0) fields.enabled = false;
      if (s.FAILOVERENABLED === 1) fields.failoverEnabled = true;
    }
    entity(c, "opc-connection", name, "OPCSERVERS", r.OPCSERVERS_ID, fields, {
      "endpoint.endpointUrl": "address",
      "endpoint.discoveryUrl": "address",
      hostOverride: "address",
      username: "username",
    });
    c.count("gateway.ignition/opc-connection", "OPC connections", true);
  }
}

function collectDatabases(c: Collector, db: SqliteDb) {
  const drivers = new Map(db.select("JDBCDRIVERS", ["JDBCDRIVERS_ID", "NAME", "DBTYPE"]).map((r) => [num(r.JDBCDRIVERS_ID), r]));
  const rows = db.select("DATASOURCES", ["DATASOURCES_ID", "NAME", "DESCRIPTION", "DRIVERID", "CONNECTURL", "USERNAME", "ENABLED", "POOLMAXACTIVE", "VALIDATIONQUERY", "FAILOVERPROFILEID"]);
  const names = new Map(rows.map((r) => [num(r.DATASOURCES_ID), str(r.NAME)]));
  for (const r of rows) {
    const name = str(r.NAME);
    if (!name) continue;
    const d = drivers.get(num(r.DRIVERID));
    // CONNECTIONPROPS isn't read: extra connection properties can carry passwords.
    entity(
      c,
      "database-connection",
      name,
      "DATASOURCES",
      r.DATASOURCES_ID,
      {
        type: str(d?.DBTYPE) ?? null,
        driver: str(d?.NAME),
        ...common(r),
        connectURL: str(r.CONNECTURL),
        username: str(r.USERNAME),
        maxConnections: num(r.POOLMAXACTIVE),
        validationQuery: str(r.VALIDATIONQUERY),
        failover: names.get(num(r.FAILOVERPROFILEID)),
      } as Record<string, FieldValue>,
      { connectURL: "address", username: "username" },
    );
    c.count("gateway.ignition/database-connection", "Database connections", true);
  }
}

/** Devices, with the address from each driver's settings table. Returns the driver tables it consulted. */
function collectDevices(c: Collector, db: SqliteDb): Set<string> {
  const tables = new Set<string>();
  const address = new Map<number, SqlRow>();
  let driverRows = 0;
  let addressRows = 0;
  for (const t of db.tables.values()) {
    if (!db.hasColumn(t.name, "DEVICESETTINGSID")) continue;
    tables.add(t.name.toUpperCase());
    const cols = DEVICE_ADDRESS.filter((col) => db.hasColumn(t.name, col));
    const n = db.count(t.name);
    driverRows += n;
    if (!cols.length) continue;
    addressRows += n;
    for (const r of db.select(t.name, ["DEVICESETTINGSID", ...cols])) {
      const id = num(r.DEVICESETTINGSID);
      if (id !== undefined && !address.has(id)) address.set(id, r);
    }
  }
  for (const r of db.select("DEVICESETTINGS", ["DEVICESETTINGS_ID", "NAME", "TYPE", "DESCRIPTION", "ENABLED"])) {
    const name = str(r.NAME);
    if (!name) continue;
    const a = address.get(num(r.DEVICESETTINGS_ID) ?? -1);
    entity(
      c,
      "device",
      name,
      "DEVICESETTINGS",
      r.DEVICESETTINGS_ID,
      {
        type: str(r.TYPE) ?? null,
        ...common(r),
        hostname: str(a?.HOSTNAME) ?? str(a?.ADDRESS) ?? str(a?.REMOTEADDRESS),
        port: num(a?.PORT) ?? num(a?.REMOTEPORT) ?? str(a?.PORT),
        serialPort: str(a?.SERIALPORT),
      } as Record<string, FieldValue>,
      { hostname: "address" },
    );
    c.count("gateway.com.inductiveautomation.opcua/device", "Devices", true);
  }
  if (driverRows) c.countMany("ignition.internal-db.driver-settings", "Device driver settings", driverRows, addressRows, "Only the address and port are read from driver settings.");
  return tables;
}

function collectUserSources(c: Collector, db: SqliteDb) {
  // Users themselves (INTERNALUSERTABLE) are never read, so there's no user count for 8.1.
  for (const r of db.select("AUTHPROFILES", ["AUTHPROFILES_ID", "NAME", "TYPE", "DESCRIPTION", "ENABLED"])) {
    const name = str(r.NAME);
    if (!name) continue;
    entity(c, "user-source", name, "AUTHPROFILES", r.AUTHPROFILES_ID, { type: str(r.TYPE) ?? null, ...common(r) }, {});
    c.count("gateway.ignition/user-source", "User sources", true);
  }
}

function collectProfiles(c: Collector, db: SqliteDb, p: (typeof PROFILES)[number], providers: Map<number, string>) {
  const t = db.table(p.table);
  if (!t) return;
  const cols = ["NAME", "TYPE", "DESCRIPTION", "ENABLED", "PROVIDERID", "CFG"].filter((col) => db.hasColumn(p.table, col));
  for (const r of db.select(p.table, cols)) {
    const name = str(r.NAME);
    if (!name) {
      c.count(`gateway.ignition/${p.type}`, p.label, false, "Rows without a name aren't documented.");
      continue;
    }
    // Tag groups belong to a provider, like 8.3's tag-group/<provider>/<name>.
    const provider = num(r.PROVIDERID) !== undefined ? providers.get(num(r.PROVIDERID)!) : undefined;
    const path = provider ? `${provider}/${name}` : name;
    const fields: Record<string, FieldValue> = { resourceType: p.label, ...common(r) };
    if (str(r.TYPE)) fields.type = str(r.TYPE)!;
    if (typeof r.CFG === "string") {
      try {
        const cfg = JSON.parse(r.CFG) as Record<string, unknown>;
        for (const k of ["mode", "rate", "leasedRate"]) if (typeof cfg[k] === "string" || typeof cfg[k] === "number") fields[k] = cfg[k] as string | number;
      } catch {
        // Settings that don't parse are left out; the group is still documented by name.
      }
    }
    c.add({ id: `resource:gateway/ignition/${p.type}/${path}`, kind: "resource", name: path, path, source: src(c, p.table, name), fields });
    c.count(`gateway.ignition/${p.type}`, p.label, true);
  }
}
