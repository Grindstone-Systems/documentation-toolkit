import type { Collector } from "./adapters/collector.ts";
import { collectAlarm, flattenMembers, tagId, type TagNode, type TagStore, type UdtDef } from "./adapters/ignition-tags.ts";
import type { Entity, Evidence, Relationship } from "./types.ts";

/**
 * Cross-input work, done once every input is read: expand UDT instances into
 * their member tags and alarms, then resolve references to entity ids.
 */

const MAX_EXPANDED = 60_000;

/** Materialise UDT members for each instance, with parameters substituted into OPC paths. */
export function expandUdts(c: Collector, store: TagStore) {
  const byKey = new Map<string, UdtDef>();
  for (const d of store.udts) byKey.set(`${d.provider}|${d.typePath}`.toLowerCase(), d);
  const find = (provider: string, typeId: string) =>
    byKey.get(`${provider}|${typeId}`.toLowerCase()) ?? store.udts.find((d) => d.typePath.toLowerCase() === typeId.toLowerCase());

  let expanded = 0;
  let missing = 0;
  for (const inst of store.instances) {
    const typeId = inst.node.typeId;
    if (!typeId) continue;
    const def = find(inst.provider, typeId);
    if (!def) {
      missing++;
      continue;
    }
    const members = membersWithParents(def, find);
    const params = { ...paramsOf(def.node), ...paramsOf(inst.node) };
    const overrides = new Map(flattenMembers(inst.node.tags ?? []).map((m) => [m.path, m.node]));
    for (const m of members) {
      if (expanded >= MAX_EXPANDED) break;
      const node: TagNode = { ...m.node, ...(overrides.get(m.path) ?? {}) };
      const path = `${inst.path}/${m.path}`;
      const id = tagId(inst.provider, path);
      const fields: Record<string, string | number | boolean | null | string[]> = { udtMember: true, definedIn: typeId };
      for (const k of ["dataType", "valueSource", "opcServer", "opcItemPath", "engUnit", "documentation", "tooltip", "historyEnabled"] as const) {
        // Members often bind to parameters: { bindType: "parameter", binding: "ns=1;s=[{PLC}]…" }.
        const raw = node[k];
        const v = raw && typeof raw === "object" && typeof (raw as { binding?: unknown }).binding === "string" ? (raw as { binding: string }).binding : raw;
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") fields[k] = typeof v === "string" ? substitute(v, params) : v;
      }
      const source = c.src(def.file);
      c.add({ id, kind: "tag", name: m.path.split("/").pop()!, path, scope: inst.provider, source: { ...source, input: def.input }, fields });
      expanded++;
      if (typeof node.opcServer === "string") {
        c.rel({ from: id, type: "uses-connection", target: node.opcServer, to: `opc-connection:${node.opcServer}`, explicit: true, source: { ...source, input: def.input } });
      }
      for (const a of node.alarms ?? []) collectAlarm(c, a, id, `[${inst.provider}]${path}`, def.file, { definedIn: typeId });
    }
  }
  if (expanded) c.countMany("ignition.udt-member", "UDT member tags (expanded from definitions)", expanded, expanded);
  if (expanded >= MAX_EXPANDED) c.diag("warning", "udt-expansion-capped", `UDT expansion stopped at ${MAX_EXPANDED.toLocaleString()} member tags.`);
  if (missing) {
    c.diag("warning", "udt-definition-missing", `${missing} UDT instance${missing > 1 ? "s reference definitions" : " references a definition"} that aren't in the input. For a tag export, include the _types_ folder; in a backup, the definition may have been deleted or live in another provider.`);
  }
}

function membersWithParents(def: UdtDef, find: (p: string, t: string) => UdtDef | undefined, depth = 0): { path: string; node: TagNode }[] {
  const own = flattenMembers(def.node.tags ?? []);
  const parentId = def.node.typeId;
  if (!parentId || depth > 8) return own;
  const parent = find(def.provider, parentId);
  if (!parent) return own;
  const merged = new Map(membersWithParents(parent, find, depth + 1).map((m) => [m.path, m]));
  for (const m of own) merged.set(m.path, { path: m.path, node: { ...(merged.get(m.path)?.node ?? {}), ...m.node } });
  return [...merged.values()];
}

function paramsOf(n: TagNode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(n.parameters ?? {})) {
    const val = v && typeof v === "object" && "value" in v ? (v as { value: unknown }).value : v;
    if (val !== undefined && val !== null && typeof val !== "object") out[k] = String(val);
  }
  return out;
}

const substitute = (s: string, params: Record<string, string>) => s.replace(/\{([A-Za-z_][\w]*)\}/g, (m, k: string) => params[k] ?? m);

/* ------------------------------ resolution ------------------------------ */

/** Parse `[provider]Folder/Tag.Prop` into its parts; undefined for relative or dynamic paths. */
export function parseTagPath(raw: string): { provider?: string; path: string } | undefined {
  const s = raw.trim();
  if (!s || /\{|%s|\[[.~]\]/.test(s)) return undefined;
  const m = s.match(/^\[([^\]]*)\](.*)$/);
  const provider = m ? m[1] || undefined : undefined;
  let path = (m ? m[2]! : s).replace(/^\/+|\/+$/g, "");
  // Property references (…/Tag.Quality): tag names can't contain dots.
  const i = path.lastIndexOf("/");
  const last = path.slice(i + 1);
  if (last.includes(".")) path = path.slice(0, i + 1) + last.slice(0, last.indexOf("."));
  return path ? { provider, path } : undefined;
}

export function resolve(ev: Evidence): Evidence {
  const ids = new Set(ev.entities.map((e) => e.id));
  const exact = new Map<string, string>();
  const noProvider = new Map<string, string | null>();
  const instances = new Map<string, string>();
  for (const e of ev.entities) {
    if ((e.kind !== "tag" && e.kind !== "udt-instance" && e.kind !== "tag-folder") || !e.path) continue;
    const key = e.path.toLowerCase();
    const full = `${(e.scope ?? "").toLowerCase()}|${key}`;
    if (e.kind === "udt-instance") instances.set(full, e.id);
    exact.set(full, e.id);
    noProvider.set(key, noProvider.has(key) && noProvider.get(key) !== e.id ? null : e.id);
  }
  const lookup = (provider: string | undefined, path: string) => {
    const key = path.toLowerCase();
    if (provider) {
      const hit = exact.get(`${provider.toLowerCase()}|${key}`);
      if (hit) return hit;
    }
    return noProvider.get(key) ?? undefined;
  };

  const seen = new Set<string>();
  const out: Relationship[] = [];
  for (const r of ev.relationships) {
    const key = `${r.from}|${r.type}|${r.target}|${r.explicit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rel: Relationship = { ...r };
    if (rel.type === "binds-tag" && !rel.dynamic) {
      const p = parseTagPath(rel.target);
      let to = p ? lookup(p.provider, p.path) : undefined;
      // A member of a UDT instance whose members weren't expanded resolves to the instance.
      if (!to && p) {
        const parts = p.path.split("/");
        for (let n = parts.length - 1; n > 0 && !to; n--) {
          const prefix = parts.slice(0, n).join("/").toLowerCase();
          to = (p.provider && instances.get(`${p.provider.toLowerCase()}|${prefix}`)) || undefined;
        }
      }
      if (to) rel.to = to;
      else delete rel.to;
    } else if (rel.to && !ids.has(rel.to)) {
      delete rel.to;
    }
    out.push(rel);
  }
  return { ...ev, relationships: out };
}

/** Entities sorted by id and coverage merged by key, so output is deterministic. */
export function finalize(ev: Evidence): Evidence {
  const coverage = new Map<string, Evidence["coverage"][number]>();
  for (const c of ev.coverage) {
    const prev = coverage.get(c.key);
    coverage.set(c.key, prev ? { ...prev, found: prev.found + c.found, read: prev.read + c.read, note: prev.note ?? c.note } : { ...c });
  }
  const byId = new Map<string, Entity>();
  for (const e of ev.entities) if (!byId.has(e.id)) byId.set(e.id, e);
  return {
    ...ev,
    entities: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    relationships: [...ev.relationships].sort((a, b) => a.from.localeCompare(b.from) || a.type.localeCompare(b.type) || a.target.localeCompare(b.target)),
    coverage: [...coverage.values()].sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/**
 * Unresolved, non-dynamic references: the gaps worth reporting. Connections
 * are defined on the gateway, so without a backup they're a known limit of
 * the input (see `missingConnections`), not a gap per tag.
 */
export function unresolved(ev: Evidence) {
  const gateway = ev.entities.some((e) => e.kind === "gateway");
  return ev.relationships.filter((r) => !r.to && !r.dynamic && r.type !== "contains" && (gateway || r.type !== "uses-connection"));
}

/** Connection names referenced by tags and queries when no gateway backup was supplied. */
export function missingConnections(ev: Evidence): string[] {
  if (ev.entities.some((e) => e.kind === "gateway")) return [];
  return [...new Set(ev.relationships.filter((r) => r.type === "uses-connection" && !r.to).map((r) => r.target))].sort();
}
