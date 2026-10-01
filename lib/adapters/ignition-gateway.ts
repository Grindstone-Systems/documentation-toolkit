import type { FileTree } from "../archive.ts";
import type { EntityKind } from "../types.ts";
import { flattenSettings, type Collector } from "./collector.ts";
import { collectInternalDb, INTERNAL_DB, openInternalDb } from "./ignition-internal-db.ts";
import { collectProject, wantProjectFile } from "./ignition-project.ts";
import { collectTagNodes, tagRoots, type TagStore } from "./ignition-tags.ts";

/**
 * Ignition gateway backups (.gwbk). 8.3 stores gateway configuration as files
 * under `config/resources/`. 8.1 and earlier keep it in an internal SQLite
 * database, read by ignition-internal-db.ts.
 */

const CONFIG = "config/resources/";

/** Resource types that are platform defaults or assets, not site configuration. */
const SKIP_TYPES = /^(images|keyboard_layout|database-translator|database-driver|translations|themes|cobranding|quickstart|fonts|icons)$/;
const SECRET_TYPES = /keystore|certificate|pki|uuid|secret/i;

/** `legacy` is true when the backup has no `config/resources/`, so the internal database holds the configuration. */
export const wantGatewayFile = (path: string, size: number, legacy = false) => {
  if (path === "backupinfo.xml") return true;
  if (path === INTERNAL_DB) return legacy;
  if (path.startsWith("projects/")) return wantProjectFile(path, size);
  if (!path.startsWith(CONFIG) || !path.endsWith(".json") || size > 16 * 1024 * 1024) return false;
  // config/resources/<collection>/<module>/<type>/…
  const type = path.split("/")[4];
  return !(type && (SKIP_TYPES.test(type) || SECRET_TYPES.test(type)));
};

export interface GatewayInfo {
  version?: string;
  timestamp?: string;
  backupType?: string;
}

export function backupInfo(xml: string | undefined): GatewayInfo {
  if (!xml) return {};
  const tag = (t: string) => xml.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1]?.trim() || undefined;
  return { version: tag("version"), timestamp: tag("timestamp"), backupType: tag("backup-type") };
}

/** "8.3.9.2026082511" → "8.3.9". */
export const shortVersion = (v?: string) => v?.match(/^\d+\.\d+(?:\.\d+)?/)?.[0];

export function collectGateway(c: Collector, tree: FileTree, store: TagStore): GatewayInfo {
  const info = backupInfo(tree.text("backupinfo.xml"));
  const fileBased = tree.entries.some((e) => e.path.startsWith(CONFIG));
  const sys = findConfig(tree, "ignition", "system-properties");
  const idb = !fileBased && tree.has(INTERNAL_DB) ? tree.bytes(INTERNAL_DB) : undefined;
  const internal = idb ? openInternalDb(idb) : undefined;
  const sysName = typeof sys?.settings === "object" ? ((sys.settings as Record<string, unknown>).systemName as string | undefined) : internal && "db" in internal ? internal.systemName : undefined;

  c.add({
    id: "gateway:gateway",
    kind: "gateway",
    name: sysName || "Gateway",
    file: "backupinfo.xml",
    fields: {
      version: info.version ?? null,
      platform: "Ignition",
      backupTimestamp: info.timestamp ?? null,
      backupType: info.backupType ?? null,
      configFormat: fileBased ? "file-based (8.3+)" : "internal database (8.1 and earlier)",
    },
  });

  // Projects: one folder per project.
  const projects = new Set<string>();
  for (const e of tree.entries) {
    const m = e.path.match(/^projects\/([^/]+)\/project\.json$/);
    if (m) projects.add(m[1]!);
  }
  for (const p of [...projects].sort()) {
    collectProject(c, tree, `projects/${p}/`, p);
    c.rel({ from: "gateway:gateway", type: "contains", target: p, to: `project:${p}`, explicit: true, source: c.src(`projects/${p}/project.json`) });
  }

  if (fileBased) collectConfig(c, tree, store);
  else if (internal && "db" in internal) collectInternalDb(c, internal.db, store);
  else if (tree.has(INTERNAL_DB)) {
    const why = internal ? `It couldn't be read: ${internal.error}` : "It was too large to read.";
    c.count("ignition.internal-db", "Gateway configuration (internal database)", false, `${why} Add a tag export (JSON) to document tags.`);
    c.diag("warning", "legacy-gateway-config", `This backup stores gateway configuration in the internal database (Ignition 8.1 or earlier). ${why} Projects are documented; tags, connections and devices are not. Export tags from the Designer as JSON and add the file.`, c.src(INTERNAL_DB));
  }

  // Things we deliberately don't read, counted so nothing is silently omitted.
  const userLib = tree.entries.filter((e) => e.path.startsWith("user-lib/")).length;
  if (userLib) c.countMany("ignition.user-lib", "Python libraries and drivers (user-lib)", userLib, 0, "Third-party libraries and drivers aren't documented.");
  const modules = tree.entries.filter((e) => e.path.startsWith("modules/")).length;
  if (modules) c.countMany("ignition.module-files", "Module data files", modules, 0, "Module assets such as fonts and theme files aren't documented.");
  const keystores = tree.entries.filter((e) => /\.(keystore|pfx|der|jks|p12|pem)$/i.test(e.path)).length;
  if (keystores) c.countMany("ignition.keystores", "Certificates and keystores", keystores, 0, "Never read. Security material stays out of documentation.");
  const confs = tree.entries.filter((e) => /^[^/]+\.(conf|xml|properties)$/.test(e.path) && e.path !== "backupinfo.xml").length;
  if (confs) c.countMany("ignition.service-config", "Service configuration files", confs, 0, "ignition.conf, logging and redundancy files aren't documented yet.");
  return info;
}

function findConfig(tree: FileTree, module: string, type: string): Record<string, unknown> | undefined {
  for (const col of ["core", "local"]) {
    const j = tree.json<Record<string, unknown>>(`${CONFIG}${col}/${module}/${type}/config.json`);
    if (j) return j;
  }
  return undefined;
}

interface ConfigResource {
  collection: string;
  module: string;
  type: string;
  /** Segments after the type: name, or provider + folder path. */
  rest: string[];
  dir: string;
  files: string[];
}

function configResources(tree: FileTree): ConfigResource[] {
  const byDir = new Map<string, string[]>();
  for (const e of tree.entries) {
    if (!e.path.startsWith(CONFIG)) continue;
    const i = e.path.lastIndexOf("/");
    const dir = e.path.slice(0, i);
    byDir.set(dir, [...(byDir.get(dir) ?? []), e.path.slice(i + 1)]);
  }
  const out: ConfigResource[] = [];
  for (const [dir, files] of byDir) {
    if (!files.includes("resource.json") && !files.includes("unary-resource.json")) continue;
    const [collection, module, type, ...rest] = dir.slice(CONFIG.length).split("/");
    if (!collection || !module || !type) continue;
    out.push({ collection, module, type, rest, dir, files });
  }
  // Core first, so deployment-mode overrides don't shadow the base definition.
  return out.sort((a, b) => (a.collection === "core" ? 0 : 1) - (b.collection === "core" ? 0 : 1) || a.dir.localeCompare(b.dir));
}

const KIND_FOR: [RegExp, EntityKind, string][] = [
  [/^opc-connection$/, "opc-connection", "OPC connections"],
  [/^(database-connection|datasource|db-connection)s?$/, "database-connection", "Database connections"],
  [/device/, "device", "Devices"],
  [/^user-source$/, "user-source", "User sources"],
  [/^tag-provider$/, "tag-provider", "Tag providers"],
];

const TYPE_LABELS: Record<string, string> = {
  "tag-group": "Tag groups",
  "alarm-notification-profile": "Alarm notification profiles",
  "alarm-journal": "Alarm journals",
  "general-alarm-settings": "Alarm settings",
  "identity-provider": "Identity providers",
  "security-levels": "Security levels",
  "security-properties": "Security properties",
  schedule: "Schedules",
  "gateway-network-settings": "Gateway network",
  "gateway-network-proxy-rules": "Gateway network proxy rules",
  "gateway-network-queue-settings": "Gateway network queues",
  "outgoing-connection": "Gateway network connections",
  "system-properties": "System properties",
  "edge-system-properties": "Edge system properties",
  "local-system-properties": "Local system properties",
  "historian": "Historians",
  "store-and-forward": "Store and forward engines",
};

function collectConfig(c: Collector, tree: FileTree, store: TagStore) {
  let excludedSecrets = 0;
  let skipped = 0;
  for (const r of configResources(tree)) {
    const where = `${r.module}/${r.type}`;
    if (SKIP_TYPES.test(r.type) || SECRET_TYPES.test(r.type)) {
      skipped++;
      continue;
    }
    const name = r.rest.join("/") || r.type;

    if (r.module === "ignition" && (r.type === "tag-definition" || r.type === "tag-type-definition")) {
      const [provider, ...folder] = r.rest;
      if (!provider) continue;
      const file = `${r.dir}/tags.json`;
      if (!r.files.includes("tags.json")) continue;
      const roots = tagRoots(tree.json(file));
      if (!roots) {
        c.count("ignition.tag-files", "Tag definition files", false, "Some tag files couldn't be parsed.");
        c.diag("warning", "tags-unreadable", `Couldn't parse ${file}.`, c.src(file));
        continue;
      }
      collectTagNodes(c, roots, { provider, folder: folder.join("/"), file, inTypes: r.type === "tag-type-definition", store });
      if (r.type === "tag-definition" && folder.length) {
        c.add({ id: `tag-folder:[${provider}]${folder.join("/")}`, kind: "tag-folder", name: folder[folder.length - 1]!, path: folder.join("/"), scope: provider, file, fields: {} });
      }
      c.count("ignition.tag-files", "Tag definition files", true);
      continue;
    }

    const config = tree.json<Record<string, unknown>>(`${r.dir}/config.json`);
    const res = tree.json<Record<string, unknown>>(`${r.dir}/resource.json`) ?? tree.json<Record<string, unknown>>(`${r.dir}/unary-resource.json`) ?? {};
    const hit = KIND_FOR.find(([re]) => re.test(r.type));
    const label = hit?.[2] ?? TYPE_LABELS[r.type] ?? `${r.type} (${r.module})`;
    if (!config && !r.files.some((f) => f.endsWith(".json") && !/resource\.json$/.test(f))) {
      c.count(`gateway.${where}`, label, true);
      continue;
    }
    const flat = flattenSettings(config ?? {}, { maxFields: hit ? 30 : 16 });
    excludedSecrets += flat.excluded;
    const profile = (config?.profile ?? {}) as Record<string, unknown>;
    const fields = { ...flat.fields };
    if (typeof res.description === "string" && res.description) fields.description = res.description;
    if (res.enabled === false || profile.enabled === false) fields.enabled = false;
    if (r.type === "user-source") {
      const users = tree.json<unknown>(`${r.dir}/users.json`);
      if (Array.isArray(users)) fields.userCount = users.length;
      else if (users && typeof users === "object" && Array.isArray((users as { users?: unknown[] }).users)) fields.userCount = (users as { users: unknown[] }).users.length;
    }
    const kind: EntityKind = hit?.[1] ?? "resource";
    c.add({
      id: kind === "resource" ? `resource:gateway/${where}/${name}` : `${kind}:${name}`,
      kind,
      name,
      path: name,
      scope: r.collection === "core" ? undefined : r.collection,
      file: `${r.dir}/${config ? "config.json" : "resource.json"}`,
      fields: kind === "resource" ? { resourceType: label, ...fields } : { type: String(profile.type ?? "") || null, ...fields },
      sensitive: flat.sensitive,
    });
    c.count(`gateway.${where}`, label, true);
  }
  if (skipped) c.countMany("gateway.defaults", "Built-in assets and platform defaults", skipped, 0, "Images, themes, drivers and translations that ship with Ignition aren't documented.");
  if (excludedSecrets) {
    c.diag("info", "secrets-excluded", `${excludedSecrets} credential value${excludedSecrets > 1 ? "s were" : " was"} found in gateway configuration and excluded. Credentials are never read into documentation.`);
  }
}
