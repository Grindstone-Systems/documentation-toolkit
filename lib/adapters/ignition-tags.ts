import type { Collector } from "./collector.ts";
import { asText, clip } from "./collector.ts";

/**
 * Ignition tag configuration: the JSON the Designer exports, and the
 * `tags.json` files inside 8.3 gateway backups share one node shape.
 */

export interface TagNode {
  name?: string;
  tagType?: string;
  tags?: TagNode[];
  typeId?: string;
  parameters?: Record<string, unknown>;
  alarms?: AlarmNode[];
  [key: string]: unknown;
}

export interface AlarmNode {
  name?: string;
  [key: string]: unknown;
}

/** UDT definitions and instances, kept whole so instances can be expanded after all inputs are read. */
export interface UdtDef {
  provider: string;
  typePath: string;
  node: TagNode;
  file: string;
  input: string;
}

export interface UdtInstanceRaw {
  provider: string;
  path: string;
  node: TagNode;
  file: string;
  input: string;
}

export interface TagStore {
  udts: UdtDef[];
  instances: UdtInstanceRaw[];
}

export const newTagStore = (): TagStore => ({ udts: [], instances: [] });

export interface TagContext {
  provider: string;
  /** Folder path of the parent, without provider, e.g. `Riverbend/Pumps`. */
  folder: string;
  file: string;
  /** True under `_types_` or a tag-type-definition resource. */
  inTypes: boolean;
  store: TagStore;
}

export const tagId = (provider: string, path: string) => `tag:[${provider}]${path}`;
export const udtTypeId = (provider: string, typePath: string) => `udt-type:[${provider}]${typePath}`;
const join = (a: string, b: string) => (a ? `${a}/${b}` : b);

/** Tag references inside expressions: {[default]Area/Tag} or {[.]Relative}. */
export const EXPRESSION_TAG_REF = /\{(\[[^\]]*\][^{}]+)\}/g;

const TAG_FIELDS = ["dataType", "valueSource", "opcServer", "opcItemPath", "sourceTagPath", "engUnit", "documentation", "tooltip", "historyEnabled", "historyProvider", "datasource", "tagGroup", "readOnly"] as const;

const ALARM_FIELDS = ["priority", "mode", "setpointA", "setpointB", "label", "displayPath", "notes", "ackMode", "enabled"] as const;

export function collectTagNodes(c: Collector, nodes: TagNode[], ctx: TagContext) {
  for (const n of nodes) collectTag(c, n, ctx);
}

function collectTag(c: Collector, n: TagNode, ctx: TagContext) {
  const name = typeof n.name === "string" ? n.name : "";
  const type = n.tagType ?? "AtomicTag";
  if (type === "Provider") {
    collectTagNodes(c, n.tags ?? [], ctx);
    return;
  }
  if (!name) {
    c.diag("warning", "tag-without-name", "A tag without a name was skipped.", c.src(ctx.file));
    return;
  }
  const path = join(ctx.folder, name);

  if (type === "Folder") {
    const inTypes = ctx.inTypes || (!ctx.folder && name === "_types_");
    if (!inTypes) {
      c.add({ id: `tag-folder:[${ctx.provider}]${path}`, kind: "tag-folder", name, path, scope: ctx.provider, file: ctx.file, fields: {} });
    }
    collectTagNodes(c, n.tags ?? [], { ...ctx, folder: inTypes && name === "_types_" && !ctx.folder ? "" : path, inTypes });
    return;
  }

  if (type === "UdtType" || ctx.inTypes) {
    if (type === "UdtType") collectUdtType(c, n, path, ctx);
    return;
  }

  if (type === "UdtInstance") {
    const params = Object.entries(n.parameters ?? {}).map(([k, v]) => `${k}=${paramValue(v)}`);
    const id = `udt-instance:[${ctx.provider}]${path}`;
    c.add({
      id,
      kind: "udt-instance",
      name,
      path,
      scope: ctx.provider,
      file: ctx.file,
      fields: { typeId: n.typeId ?? null, parameters: params, overrides: countOverrides(n) },
    });
    c.count("ignition.udt-instance", "UDT instances", true);
    ctx.store.instances.push({ provider: ctx.provider, path, node: n, file: ctx.file, input: c.input });
    if (n.typeId) c.rel({ from: id, type: "instance-of", target: n.typeId, to: udtTypeId(ctx.provider, n.typeId), explicit: true, source: c.src(ctx.file) });
    return;
  }

  // Atomic tags (and anything else that carries a value).
  const id = tagId(ctx.provider, path);
  const fields: Record<string, string | number | boolean | null | string[]> = {};
  for (const k of TAG_FIELDS) {
    const v = asText(n[k]);
    if (v !== undefined && v !== "") fields[k] = clip(v, 240);
  }
  if (n.enabled === false) fields.enabled = false;
  const expression = typeof n.expression === "string" ? n.expression : undefined;
  if (expression) fields.expression = clip(expression, 400);
  if (typeof n.query === "string") fields.query = clip(n.query, 400);
  if (type !== "AtomicTag") fields.tagType = type;
  c.add({ id, kind: "tag", name, path, scope: ctx.provider, file: ctx.file, fields, sensitive: fields.query ? { query: "code" } : undefined });
  c.count("ignition.tag", "Standalone tags", true);

  if (expression) linkExpression(c, id, expression, ctx.file);
  if (typeof n.sourceTagPath === "string") c.rel({ from: id, type: "binds-tag", target: n.sourceTagPath, explicit: true, source: c.src(ctx.file) });
  if (typeof n.opcServer === "string") c.rel({ from: id, type: "uses-connection", target: n.opcServer, to: `opc-connection:${n.opcServer}`, explicit: true, source: c.src(ctx.file) });
  if (typeof n.datasource === "string") c.rel({ from: id, type: "uses-connection", target: n.datasource, to: `database-connection:${n.datasource}`, explicit: true, source: c.src(ctx.file) });

  for (const a of n.alarms ?? []) collectAlarm(c, a, id, `[${ctx.provider}]${path}`, ctx.file);
}

export function collectAlarm(c: Collector, a: AlarmNode, ownerId: string, ownerPath: string, file: string, extra: Record<string, string> = {}) {
  const name = typeof a.name === "string" && a.name ? a.name : "Alarm";
  const id = `alarm:${ownerPath}#${name}`;
  const fields: Record<string, string | number | boolean | null | string[]> = { tag: ownerPath, ...extra };
  for (const k of ALARM_FIELDS) {
    const v = asText(a[k]);
    if (v !== undefined && v !== "") fields[k] = clip(v, 300);
  }
  c.add({ id, kind: "alarm", name, path: `${ownerPath}#${name}`, file, fields });
  c.count("ignition.alarm", "Alarms", true);
  c.rel({ from: ownerId, to: id, type: "has-alarm", target: id, explicit: true, source: c.src(file) });
}

function collectUdtType(c: Collector, n: TagNode, typePath: string, ctx: TagContext) {
  const id = udtTypeId(ctx.provider, typePath);
  const members = flattenMembers(n.tags ?? []);
  c.add({
    id,
    kind: "udt-type",
    name: n.name ?? typePath,
    path: typePath,
    scope: ctx.provider,
    file: ctx.file,
    fields: {
      members: members.map((m) => m.path).slice(0, 60),
      memberCount: members.length,
      parameters: Object.keys(n.parameters ?? {}),
      alarmCount: members.reduce((s, m) => s + (m.node.alarms?.length ?? 0), 0),
      ...(n.typeId ? { parentType: n.typeId } : {}),
    },
  });
  c.count("ignition.udt-type", "UDT definitions", true);
  if (n.typeId) c.rel({ from: id, type: "instance-of", target: n.typeId, to: udtTypeId(ctx.provider, n.typeId), explicit: true, source: c.src(ctx.file) });
  ctx.store.udts.push({ provider: ctx.provider, typePath, node: n, file: ctx.file, input: c.input });
}

export function flattenMembers(nodes: TagNode[], prefix = ""): { path: string; node: TagNode }[] {
  const out: { path: string; node: TagNode }[] = [];
  for (const m of nodes) {
    if (typeof m.name !== "string") continue;
    const path = join(prefix, m.name);
    if (m.tagType === "Folder") out.push(...flattenMembers(m.tags ?? [], path));
    else out.push({ path, node: m });
  }
  return out;
}

function countOverrides(n: TagNode): number {
  let count = 0;
  const walk = (ts: TagNode[]) => {
    for (const t of ts) {
      count += Object.keys(t).filter((k) => k !== "name" && k !== "tagType" && k !== "tags").length;
      walk(t.tags ?? []);
    }
  };
  walk(n.tags ?? []);
  return count;
}

function paramValue(v: unknown): string {
  if (v && typeof v === "object" && "value" in v) return clip(String((v as { value: unknown }).value), 60);
  return clip(String(v), 60);
}

export function linkExpression(c: Collector, from: string, expression: string, file: string) {
  for (const m of expression.matchAll(EXPRESSION_TAG_REF)) {
    const target = m[1]!;
    c.rel({ from, type: "binds-tag", target, explicit: true, dynamic: /\[[.~]\]|\{/.test(target) || undefined, source: c.src(file) });
  }
}

/** Accept a Designer tag export: an array, a provider/folder object, or a single tag. */
export function tagRoots(json: unknown): TagNode[] | undefined {
  if (Array.isArray(json)) return json.every((x) => x && typeof x === "object") ? (json as TagNode[]) : undefined;
  if (json && typeof json === "object") {
    const o = json as TagNode;
    if (Array.isArray(o.tags) && (o.tagType === undefined || o.tagType === "Provider" || o.tagType === "Folder")) {
      return o.tagType === "Folder" && o.name ? [o] : o.tags;
    }
    if (typeof o.tagType === "string" && typeof o.name === "string") return [o];
  }
  return undefined;
}
