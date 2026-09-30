import { fingerprint } from "../archive.ts";
import type { ToolkitConfig } from "../config.ts";
import { ADAPTERS } from "../extract.ts";
import { missingConnections, unresolved } from "../resolve.ts";
import type { Entity, EntityKind, Evidence, FieldValue, Relationship } from "../types.ts";
import { DOCUMENT_SCHEMA, PACKS, type Block, type DocumentModel, type PackId, type Section, type SystemMap } from "./model.ts";

/**
 * Deterministic document generation: evidence + config → sections. No model,
 * no network, same output for the same input. Text here states only what the
 * configuration shows; everything a site must supply is marked Unresolved.
 */

export const REDACTED = "‹redacted›";
const MAIN_ROWS = 30;
const APPENDIX_ROWS = 5000;

class Index {
  readonly byKind = new Map<EntityKind, Entity[]>();
  readonly byId = new Map<string, Entity>();
  readonly out = new Map<string, Relationship[]>();
  readonly in = new Map<string, Relationship[]>();

  constructor(readonly ev: Evidence) {
    for (const e of ev.entities) {
      this.byId.set(e.id, e);
      const list = this.byKind.get(e.kind) ?? [];
      list.push(e);
      this.byKind.set(e.kind, list);
    }
    for (const r of ev.relationships) {
      push(this.out, r.from, r);
      if (r.to) push(this.in, r.to, r);
    }
  }
  kind(k: EntityKind) {
    return this.byKind.get(k) ?? [];
  }
  outgoing(id: string, type?: Relationship["type"]) {
    return (this.out.get(id) ?? []).filter((r) => !type || r.type === type);
  }
  incoming(id: string, type?: Relationship["type"]) {
    return (this.in.get(id) ?? []).filter((r) => !type || r.type === type);
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
}

interface Ctx {
  ix: Index;
  cfg: ToolkitConfig;
}

/* ------------------------------ formatting ------------------------------ */

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
/** Verb agreement: "1 reference is", "3 references are". */
const agree = (n: number, one: string, many: string) => (n === 1 ? one : many);
const list = (v: FieldValue | undefined) => (Array.isArray(v) ? v.join(", ") : v === null || v === undefined || v === "" ? "—" : String(v));
const code = (s: string) => `\`${s.replace(/`/g, "'")}\``;

/** A field value with the user's redaction choices applied. */
function val(ctx: Ctx, e: Entity, key: string): string {
  const s = e.sensitive?.[key];
  if ((s === "address" && ctx.cfg.redact.addresses) || (s === "username" && ctx.cfg.redact.usernames) || (s === "code" && ctx.cfg.redact.code)) return REDACTED;
  return list(e.fields[key]);
}

const fieldOf = (e: Entity, ...keys: string[]) => {
  for (const k of keys) {
    const v = e.fields[k];
    if (v !== undefined && v !== null && v !== "") return k;
  }
  return keys[0]!;
};

function evidenceHash(ix: Index, refs: string[]): string {
  return fingerprint(
    refs
      .map((id) => ix.byId.get(id))
      .filter(Boolean)
      .map((e) => `${e!.id}${JSON.stringify(e!.fields)}`)
      .join("\n"),
  );
}

function section(ctx: Ctx, s: Omit<Section, "origin" | "evidence" | "refs"> & { refs?: string[]; origin?: Section["origin"] }): Section {
  const refs = [...new Set(s.refs ?? [])].sort();
  return { origin: "generated", ...s, refs, evidence: evidenceHash(ctx.ix, refs) };
}

const gap = (text: string): Block => ({ type: "callout", tone: "gap", text });

/** Screenshots the user attached to a page (or, with no page, the unattached ones). */
function shots(ctx: Ctx, page?: string): Block[] {
  const pages = new Set(ctx.ix.kind("page").map((p) => p.id));
  return ctx.cfg.screenshots
    .filter((s) => (page ? s.page === page : !s.page || !pages.has(s.page)))
    .map((s) => ({ type: "figure", asset: s.asset, caption: s.caption || "Screenshot", alt: s.caption }));
}

/* ------------------------------ sections ------------------------------ */

function about(ctx: Ctx): Section {
  const text = ctx.cfg.context.systemDescription.trim();
  if (text) {
    return section(ctx, {
      id: "about",
      title: "About this system",
      status: "confirmed",
      origin: "user",
      blocks: text.split(/\n{2,}/).map((p) => ({ type: "paragraph", text: p.trim() })),
    });
  }
  return section(ctx, {
    id: "about",
    title: "About this system",
    status: "unresolved",
    blocks: [gap("Describe what this system does, the process or site it serves and who uses it. The toolkit documents configuration; it doesn't guess at purpose.")],
  });
}

function overview(ctx: Ctx): Section {
  const { ix } = ctx;
  const gw = ix.kind("gateway")[0];
  const projects = ix.kind("project");
  const tags = ix.kind("tag");
  const members = tags.filter((t) => t.fields.udtMember).length;
  const connections = [...ix.kind("opc-connection"), ...ix.kind("database-connection"), ...ix.kind("device")];
  const version = ix.ev.inputs.find((i) => i.platformVersion)?.platformVersion;
  const facts: [string, string][] = [
    ["Platform", version ? `Ignition ${version}` : "Ignition 8.x (version not recorded in the input)"],
    ...(gw ? ([["Gateway", gw.name]] as [string, string][]) : []),
    ["Projects", projects.map((p) => p.name).join(", ") || "—"],
    ["Perspective", `${plural(ix.kind("page").length, "page")}, ${plural(ix.kind("view").length, "view")}`],
    ["Tags", `${plural(tags.length, "tag")}${members ? ` (${members.toLocaleString()} from UDT definitions)` : ""}, ${plural(ix.kind("udt-type").length, "UDT definition")}`],
    ["Alarms", plural(ix.kind("alarm").length, "configured alarm")],
    ["Named queries", String(ix.kind("named-query").length)],
    ["Scripts", `${plural(ix.kind("script").length, "library module")}, ${plural(ix.kind("event-script").length, "event script")}`],
    ["Connections", connections.length ? `${ix.kind("opc-connection").length} OPC, ${ix.kind("database-connection").length} database, ${ix.kind("device").length} device` : "None in the input"],
  ];
  const inputs = ix.ev.inputs.map((i) => [i.name, ADAPTERS[i.format].label, i.platformVersion ?? "—", i.sha256 ? i.sha256.slice(0, 12) : "—"]);
  const blocks: Block[] = [
    {
      type: "paragraph",
      text: `This reference describes ${projects.length ? `the ${projects.map((p) => code(p.name)).join(", ")} project${projects.length > 1 ? "s" : ""}` : "the supplied configuration"}${gw ? ` on gateway ${code(gw.name)}` : ""}. It was generated from exported configuration files, so it shows how the system is configured, not how it is operated or how it is behaving now.`,
    },
    { type: "facts", items: facts },
    { type: "table", caption: "Source files", columns: ["File", "Read as", "Version", "SHA-256"], rows: inputs },
  ];
  return section(ctx, { id: "overview", title: "System overview", status: "extracted", blocks, refs: [...projects.map((p) => p.id), ...(gw ? [gw.id] : [])] });
}

function systemMap(ctx: Ctx): Section | undefined {
  const { ix } = ctx;
  const pages = ix.kind("page");
  const views = ix.kind("view");
  if (!pages.length && !views.length) return undefined;
  const MAX = 10;

  // Views that pages route to come first, then the most referenced.
  const routed = new Set(pages.flatMap((p) => ix.outgoing(p.id, "routes-to").map((r) => r.to).filter(Boolean) as string[]));
  const viewScore = (v: Entity) => (routed.has(v.id) ? 1000 : 0) + ix.incoming(v.id).length * 10 + ix.outgoing(v.id).length;
  const topViews = [...views].sort((a, b) => viewScore(b) - viewScore(a) || a.id.localeCompare(b.id)).slice(0, MAX);
  const topPages = pages.filter((p) => ix.outgoing(p.id, "routes-to").some((r) => r.to && topViews.some((v) => v.id === r.to))).slice(0, MAX);

  // Data: top-level tag folders, named queries and connections the views reach.
  const dataNodes = new Map<string, { id: string; label: string; detail?: string; weight: number }>();
  const edges: SystemMap["edges"] = [];
  const addData = (id: string, label: string, detail?: string) => {
    const n = dataNodes.get(id) ?? { id, label, detail, weight: 0 };
    n.weight++;
    dataNodes.set(id, n);
    return id;
  };
  // Group tags by top-level folder, or by the second level when everything shares one root folder.
  const tops = new Set(ix.kind("tag").map((t) => (t.path ?? "").split("/")[0]));
  const depth = tops.size === 1 ? 2 : 1;
  const tagArea = (target: Entity) => {
    const parts = (target.path ?? target.name).split("/");
    const area = parts.length > depth ? parts.slice(0, depth).join("/") : parts.length > 1 ? parts.slice(0, -1).join("/") : "(root)";
    return addData(`area:[${target.scope}]${area}`, `[${target.scope}]${area}`, "tag folder");
  };
  for (const v of topViews) {
    for (const r of ix.outgoing(v.id)) {
      if (!r.to) continue;
      const t = ix.byId.get(r.to);
      if (!t) continue;
      if (r.type === "binds-tag" && (t.kind === "tag" || t.kind === "udt-instance" || t.kind === "tag-folder")) edges.push({ from: v.id, to: tagArea(t) });
      else if (r.type === "calls-query") edges.push({ from: v.id, to: addData(t.id, t.name, "named query") });
    }
  }
  for (const [id] of dataNodes) {
    if (!id.startsWith("area:")) continue;
    // Which connections the tags in this area use.
    const [, prov, area] = id.match(/^area:\[([^\]]*)\](.*)$/) ?? [];
    for (const t of ix.kind("tag")) {
      if (t.scope !== prov || !(t.path ?? "").startsWith(area === "(root)" ? "" : `${area}/`)) continue;
      for (const r of ix.outgoing(t.id, "uses-connection")) {
        if (!r.to) continue;
        const conn = ix.byId.get(r.to);
        if (conn) edges.push({ from: id, to: addData(conn.id, conn.name, conn.kind === "opc-connection" ? "OPC connection" : "connection") });
      }
    }
  }
  const ranked = [...dataNodes.values()].sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label));
  const isConn = (id: string) => /^(opc|database)-connection:|^device:/.test(id);
  const data = ranked.filter((d) => !isConn(d.id)).slice(0, MAX);
  const conns = ranked.filter((d) => isConn(d.id)).slice(0, MAX);
  const shown = new Set([...topPages.map((p) => p.id), ...topViews.map((v) => v.id), ...data.map((d) => d.id), ...conns.map((d) => d.id)]);
  for (const p of topPages) for (const r of ix.outgoing(p.id, "routes-to")) if (r.to) edges.push({ from: p.id, to: r.to });
  const unique = [...new Map(edges.filter((e) => shown.has(e.from) && shown.has(e.to)).map((e) => [`${e.from}>${e.to}`, e])).values()];

  const diagram: SystemMap = {
    columns: [
      { title: "Pages", nodes: topPages.map((p) => ({ id: p.id, label: p.name, detail: p.scope })) },
      { title: "Views", nodes: topViews.map((v) => ({ id: v.id, label: v.path ?? v.name, detail: `${v.fields.components ?? 0} components` })) },
      { title: "Tags and queries", nodes: data.map((d) => ({ id: d.id, label: d.label, detail: d.detail })) },
      { title: "Connections", nodes: conns.map((d) => ({ id: d.id, label: d.label, detail: d.detail })) },
    ].filter((c) => c.nodes.length),
    edges: unique,
  };
  const trimmed = views.length > topViews.length || pages.length > topPages.length;
  return section(ctx, {
    id: "system-map",
    title: "System map",
    status: "extracted",
    blocks: [
      { type: "paragraph", text: "How screens reach data, from explicit page routes, bindings and query calls in the configuration." },
      { type: "diagram", diagram },
      ...(trimmed ? [{ type: "callout", tone: "note", text: `Showing the most connected ${topViews.length} of ${views.length} views. Every view is listed in the appendix.` } as Block] : []),
    ],
    refs: [...shown].filter((id) => ix.byId.has(id)),
  });
}

function projectsSection(ctx: Ctx): Section | undefined {
  const { ix } = ctx;
  const projects = ix.kind("project");
  if (!projects.length) return undefined;
  const count = (p: Entity, k: EntityKind) => ix.kind(k).filter((e) => e.scope === p.name).length;
  const rows = projects.map((p) => [p.name, list(p.fields.title), list(p.fields.description), list(p.fields.parent), String(count(p, "view")), String(count(p, "script")), String(count(p, "named-query"))]);
  const blocks: Block[] = [{ type: "table", columns: ["Project", "Title", "Description", "Inherits from", "Views", "Scripts", "Queries"], rows }];
  if (projects.some((p) => p.fields.parent)) blocks.push({ type: "callout", tone: "note", text: "Inherited resources are documented only when the parent project is part of the input." });
  return section(ctx, { id: "projects", title: "Projects", status: "extracted", blocks, refs: projects.map((p) => p.id) });
}

function navigation(ctx: Ctx): Section | undefined {
  const { ix } = ctx;
  const pages = ix.kind("page");
  if (!pages.length) return undefined;
  const rows = pages.map((p) => [code(p.name), p.fields.view ? code(String(p.fields.view)) : "—", p.scope ?? "—"]);
  return section(ctx, {
    id: "navigation",
    title: "Navigation and screens",
    status: "extracted",
    blocks: [
      { type: "paragraph", text: `Perspective sessions open views through ${plural(pages.length, "page URL")}. Each URL shows the view listed beside it.` },
      { type: "table", columns: ["Page URL", "View", "Project"], rows: rows.slice(0, 200) },
      ...pages.flatMap((p): Block[] => {
        const figs = shots(ctx, p.id);
        return figs.length ? [{ type: "heading", text: p.name }, ...figs] : [];
      }),
    ],
    refs: pages.map((p) => p.id),
  });
}

function screenshotsSection(ctx: Ctx): Section | undefined {
  const figs = shots(ctx);
  if (!figs.length) return undefined;
  return section(ctx, { id: "screenshots", title: "Screenshots", status: "confirmed", origin: "user", blocks: [{ type: "paragraph", text: "Screenshots of the running system, supplied by the project team." }, ...figs] });
}

function viewsSection(ctx: Ctx): Section | undefined {
  const { ix } = ctx;
  const views = ix.kind("view");
  if (!views.length) return undefined;
  const routed = new Set(ix.kind("page").flatMap((p) => ix.outgoing(p.id, "routes-to").map((r) => r.to)));
  const embeddedBy = (v: Entity) => ix.incoming(v.id, "embeds-view").length;
  const rows = [...views]
    .sort((a, b) => Number(routed.has(b.id)) - Number(routed.has(a.id)) || embeddedBy(b) - embeddedBy(a) || a.id.localeCompare(b.id))
    .slice(0, MAIN_ROWS)
    .map((v) => [code(v.path ?? v.name), v.scope ?? "—", routed.has(v.id) ? "Page" : embeddedBy(v) ? `Embedded ×${embeddedBy(v)}` : "—", list(v.fields.params), String(v.fields.components ?? 0), String(ix.outgoing(v.id, "binds-tag").length)]);
  return section(ctx, {
    id: "views",
    title: "Perspective views",
    status: "extracted",
    blocks: [
      { type: "paragraph", text: `${plural(views.length, "view")} in total. Views opened directly by a page come first, then views embedded in others.` },
      { type: "table", columns: ["View", "Project", "Used as", "Parameters", "Components", "Tag refs"], rows },
      ...(views.length > MAIN_ROWS ? [{ type: "callout", tone: "note", text: `${views.length - MAIN_ROWS} more views are described in Appendix: View details.` } as Block] : []),
    ],
    refs: views.map((v) => v.id),
  });
}

function tagsSection(ctx: Ctx): Section | undefined {
  const { ix } = ctx;
  const tags = ix.kind("tag");
  const types = ix.kind("udt-type");
  const instances = ix.kind("udt-instance");
  if (!tags.length && !types.length && !instances.length) return undefined;

  // Group by provider and top-level folder.
  const groups = new Map<string, { opc: number; memory: number; expr: number; other: number; alarms: number; instances: number }>();
  // Top-level folders, or the second level when everything shares one root folder.
  const depth = new Set([...tags, ...instances].map((t) => (t.path ?? "").split("/")[0])).size === 1 ? 2 : 1;
  const groupOf = (e: Entity) => {
    const parts = (e.path ?? e.name).split("/");
    return `[${e.scope}]${parts.slice(0, Math.min(depth, parts.length - 1)).join("/")}`;
  };
  const g = (k: string) => groups.get(k) ?? (groups.set(k, { opc: 0, memory: 0, expr: 0, other: 0, alarms: 0, instances: 0 }), groups.get(k)!);
  for (const t of tags) {
    const row = g(groupOf(t));
    const src = String(t.fields.valueSource ?? (t.fields.opcItemPath ? "opc" : "memory"));
    if (src === "opc") row.opc++;
    else if (src === "memory") row.memory++;
    else if (src === "expr") row.expr++;
    else row.other++;
    row.alarms += ix.outgoing(t.id, "has-alarm").length;
  }
  for (const i of instances) g(groupOf(i)).instances++;
  const rows = [...groups].sort((a, b) => a[0].localeCompare(b[0])).map(([k, r]) => [code(k), String(r.opc + r.memory + r.expr + r.other), String(r.opc), String(r.memory), String(r.expr), String(r.other), String(r.instances), String(r.alarms)]);

  const blocks: Block[] = [
    { type: "paragraph", text: `${plural(tags.length, "tag")} across ${plural(new Set(tags.map((t) => t.scope)).size, "provider")}, grouped by folder. OPC tags read from devices; memory tags hold values set by people or scripts; expression tags are calculated.` },
    { type: "table", columns: ["Folder", "Tags", "OPC", "Memory", "Expression", "Other", "UDT instances", "Alarms"], rows },
  ];
  if (types.length) {
    blocks.push({ type: "heading", text: "User-defined types (UDTs)" });
    blocks.push({
      type: "table",
      columns: ["Type", "Members", "Parameters", "Alarms", "Instances"],
      rows: types.map((t) => [code(`[${t.scope}]${t.path}`), String(t.fields.memberCount ?? 0), list(t.fields.parameters), String(t.fields.alarmCount ?? 0), String(ix.incoming(t.id, "instance-of").length)]),
    });
  }
  const missingTypes = instances.filter((i) => ix.outgoing(i.id, "instance-of").some((r) => !r.to)).length;
  if (missingTypes) blocks.push(gap(`${plural(missingTypes, "UDT instance")} reference definitions that aren't in the input, so their members aren't listed. For a tag export, include the _types_ folder; in a backup, the definition may have been deleted or live in another provider.`));
  blocks.push({ type: "callout", tone: "note", text: "The complete tag list is in Appendix: Tag inventory and in tags.csv." });
  return section(ctx, { id: "tags", title: "Tags and data model", status: "extracted", blocks, refs: [...types.map((t) => t.id), ...instances.map((i) => i.id)] });
}

const PRIORITY_ORDER = ["Critical", "High", "Medium", "Low", "Diagnostic"];
const priorityRank = (p: FieldValue | undefined) => {
  const i = PRIORITY_ORDER.indexOf(String(p ?? ""));
  return i < 0 ? PRIORITY_ORDER.length : i;
};
const sortedAlarms = (ix: Index) => [...ix.kind("alarm")].sort((a, b) => priorityRank(a.fields.priority) - priorityRank(b.fields.priority) || a.id.localeCompare(b.id));
const condition = (a: Entity) => [a.fields.mode, a.fields.setpointA !== undefined ? `setpoint ${a.fields.setpointA}` : ""].filter(Boolean).join(", ") || "—";

function alarmsSection(ctx: Ctx): Section | undefined {
  const { ix } = ctx;
  const alarms = sortedAlarms(ix);
  if (!alarms.length) return undefined;
  const byPriority = new Map<string, number>();
  for (const a of alarms) byPriority.set(String(a.fields.priority ?? "Unspecified"), (byPriority.get(String(a.fields.priority ?? "Unspecified")) ?? 0) + 1);
  const rows = alarms.slice(0, MAIN_ROWS).map((a) => [a.name, code(String(a.fields.tag)), list(a.fields.priority), condition(a), list(a.fields.label)]);
  return section(ctx, {
    id: "alarms",
    title: "Alarms",
    status: "extracted",
    blocks: [
      { type: "facts", items: [...byPriority].sort((a, b) => priorityRank(a[0]) - priorityRank(b[0])).map(([p, n]) => [p, plural(n, "alarm")]) },
      { type: "table", columns: ["Alarm", "Tag", "Priority", "Condition", "Label"], rows },
      ...(alarms.length > MAIN_ROWS ? [{ type: "callout", tone: "note", text: `Showing the ${MAIN_ROWS} highest-priority alarms of ${alarms.length}. All alarms are in Appendix: Alarm inventory and alarms.csv.` } as Block] : []),
    ],
    refs: alarms.map((a) => a.id),
  });
}

function connections(ctx: Ctx): Section | undefined {
  const { ix } = ctx;
  const opc = ix.kind("opc-connection");
  const db = ix.kind("database-connection");
  const devices = ix.kind("device");
  const providers = ix.kind("tag-provider");
  const users = ix.kind("user-source");
  if (!opc.length && !db.length && !devices.length && !providers.length && !users.length) return undefined;
  const blocks: Block[] = [];
  const usedBy = (e: Entity) => String(ix.incoming(e.id, "uses-connection").length);
  if (opc.length) {
    blocks.push({ type: "heading", text: "OPC connections" });
    blocks.push({
      type: "table",
      columns: ["Name", "Type", "Endpoint", "Security", "Tags using it"],
      rows: opc.map((e) => [e.name, shortType(val(ctx, e, "type")), val(ctx, e, fieldOf(e, "endpoint.endpointUrl", "endpoint.discoveryUrl", "endpointUrl", "discoveryUrl")), [val(ctx, e, "endpoint.securityPolicy"), val(ctx, e, "endpoint.securityMode")].filter((x) => x !== "—").join(" · ") || "—", usedBy(e)]),
    });
  }
  if (db.length) {
    blocks.push({ type: "heading", text: "Database connections" });
    blocks.push({ type: "table", columns: ["Name", "Type", "Connection", "Used by"], rows: db.map((e) => [e.name, shortType(val(ctx, e, "type")), val(ctx, e, fieldOf(e, "connectURL", "connectUrl", "url")), usedBy(e)]) });
  }
  if (devices.length) {
    blocks.push({ type: "heading", text: "Devices" });
    blocks.push({ type: "table", columns: ["Name", "Type", "Address"], rows: devices.map((e) => [e.name, shortType(val(ctx, e, "type")), val(ctx, e, fieldOf(e, "hostname", "host", "address", "endpointUrl"))]) });
  }
  if (providers.length) {
    blocks.push({ type: "heading", text: "Tag providers" });
    blocks.push({ type: "table", columns: ["Provider", "Type", "Tags"], rows: providers.map((e) => [e.name, shortType(val(ctx, e, "type")), String(ix.kind("tag").filter((t) => t.scope === e.name).length)]) });
  }
  if (users.length) {
    blocks.push({ type: "heading", text: "User sources" });
    blocks.push({ type: "table", columns: ["Name", "Type", "Users"], rows: users.map((e) => [e.name, shortType(val(ctx, e, "type")), list(e.fields.userCount)]) });
  }
  blocks.push({ type: "callout", tone: "note", text: "Passwords, keys and other credential values are never read from the input, so they can't appear in this document." });
  return section(ctx, { id: "connections", title: "Connections, devices and providers", status: "extracted", blocks, refs: [...opc, ...db, ...devices, ...providers, ...users].map((e) => e.id) });
}

/** "com.inductiveautomation.OpcUaServerType" → "OpcUaServerType". */
const shortType = (t: string) => (t.includes(".") && !t.includes(" ") ? t.split(".").pop()! : t);

function queries(ctx: Ctx): Section | undefined {
  const { ix } = ctx;
  const qs = ix.kind("named-query");
  if (!qs.length) return undefined;
  return section(ctx, {
    id: "queries",
    title: "Named queries",
    status: "extracted",
    blocks: [
      { type: "table", columns: ["Query", "Project", "Type", "Database", "Parameters", "Tables", "Used by"], rows: qs.map((q) => [code(q.path ?? q.name), q.scope ?? "—", list(q.fields.type), list(q.fields.database), list(q.fields.parameters), list(q.fields.tables), String(ix.incoming(q.id, "calls-query").length)]) },
      { type: "callout", tone: "note", text: "Tables are read from the SQL text and may miss dynamic SQL. Named queries don't reveal the complete database schema." },
    ],
    refs: qs.map((q) => q.id),
  });
}

function scripts(ctx: Ctx): Section | undefined {
  const { ix } = ctx;
  const mods = ix.kind("script");
  const events = ix.kind("event-script");
  if (!mods.length && !events.length) return undefined;
  const blocks: Block[] = [];
  if (mods.length) {
    blocks.push({ type: "paragraph", text: "Project library modules. Callers are found by reading script text, so indirect calls may be missed." });
    blocks.push({
      type: "table",
      columns: ["Module", "Project", "Functions", "Lines", "Called from"],
      rows: mods.map((m) => [code(m.name), m.scope ?? "—", String(Array.isArray(m.fields.functions) ? m.fields.functions.length : 0), String(m.fields.lines ?? "—"), String(new Set(ix.incoming(m.id, "calls-script").map((r) => r.from)).size)]),
    });
  }
  if (events.length) {
    blocks.push({ type: "heading", text: "Gateway event scripts" });
    blocks.push({ type: "table", columns: ["Event", "Project", "Lines", "Enabled"], rows: events.map((e) => [e.name, e.scope ?? "—", String(e.fields.lines ?? "—"), e.fields.enabled === false ? "No" : "Yes"]) });
  }
  blocks.push({ type: "callout", tone: "note", text: "Scripts are read as text and never executed. Plain-language explanations can be added with the agent extension and are marked AI draft until reviewed." });
  return section(ctx, { id: "scripts", title: "Scripts", status: "extracted", blocks, refs: [...mods, ...events].map((e) => e.id) });
}

function dependencies(ctx: Ctx): Section {
  const { ix } = ctx;
  const counts = new Map<string, number>();
  for (const r of ix.ev.relationships) if (r.type === "binds-tag" && r.to) counts.set(r.to, (counts.get(r.to) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 15);
  const gaps = unresolved(ix.ev);
  const missingConns = missingConnections(ix.ev);
  const grouped = new Map<string, { type: string; from: Set<string> }>();
  for (const r of gaps) {
    const k = `${r.type}|${r.target}`;
    const g = grouped.get(k) ?? { type: r.type, from: new Set<string>() };
    const src = ix.byId.get(r.from);
    g.from.add(src ? (src.path ?? src.name) : r.from);
    grouped.set(k, g);
  }
  const dynamic = ix.ev.relationships.filter((r) => r.dynamic).length;
  const inferred = ix.ev.relationships.filter((r) => !r.explicit).length;
  const blocks: Block[] = [];
  if (top.length) {
    blocks.push({ type: "heading", text: "Most referenced tags" });
    blocks.push({ type: "table", columns: ["Tag", "References"], rows: top.map(([id, n]) => [code(ix.byId.get(id)?.path ? `[${ix.byId.get(id)!.scope}]${ix.byId.get(id)!.path}` : id), String(n)]) });
  }
  blocks.push({ type: "heading", text: "Unresolved references" });
  if (grouped.size) {
    blocks.push({
      type: "table",
      columns: ["Reference", "Kind", "Referenced from"],
      rows: [...grouped]
        .slice(0, 100)
        .map(([k, g]) => [code(k.slice(k.indexOf("|") + 1)), g.type.replace(/-/g, " "), [...g.from].slice(0, 4).join(", ") + (g.from.size > 4 ? ` +${g.from.size - 4}` : "")]),
    });
    blocks.push(gap(`${plural(grouped.size, "reference")} ${agree(grouped.size, "points", "point")} to something that isn't in the input. ${agree(grouped.size, "It", "They")} may live in another provider, project or backup, or be out of date.`));
  } else blocks.push({ type: "paragraph", text: "Every static reference resolved to something in the input." });
  if (missingConns.length) blocks.push({ type: "callout", tone: "note", text: `Connections are defined on the gateway, so ${missingConns.map(code).join(", ")} can't be described from this input. Add a gateway backup to document them.` });
  if (dynamic) blocks.push({ type: "callout", tone: "note", text: `${plural(dynamic, "reference")} ${agree(dynamic, "is", "are")} built at runtime (indirect bindings, parameters or string concatenation) and can't be resolved from configuration.` });
  if (inferred) blocks.push({ type: "callout", tone: "note", text: `${plural(inferred, "reference")} ${agree(inferred, "was", "were")} inferred by reading script text rather than declared in configuration.` });
  return section(ctx, { id: "dependencies", title: "Cross-references and gaps", status: "extracted", blocks, refs: top.map(([id]) => id) });
}

function coverageSection(ctx: Ctx): Section {
  const { ix } = ctx;
  const rows = ix.ev.coverage.map((c) => [c.label, c.found.toLocaleString(), c.read.toLocaleString(), c.note ?? ""]);
  const issues = ix.ev.diagnostics.filter((d) => d.level !== "info");
  const blocks: Block[] = [
    { type: "paragraph", text: "What the toolkit found in the input and what it could read. Anything found but not read is listed here rather than silently left out." },
    { type: "table", columns: ["Resource type", "Found", "Read", "Note"], rows },
  ];
  if (issues.length) {
    blocks.push({ type: "heading", text: "Warnings" });
    blocks.push({ type: "list", items: issues.slice(0, 50).map((d) => d.message) });
  }
  const infos = ix.ev.diagnostics.filter((d) => d.level === "info" && d.code !== "raw-sql");
  if (infos.length) blocks.push({ type: "list", items: [...new Set(infos.map((d) => d.message))].slice(0, 20) });
  blocks.push({
    type: "callout",
    tone: "warning",
    text: "This document is generated from configuration. It doesn't prove the system works as configured, and it doesn't authorise any operating or safety procedure. Review it before sharing, since it can reveal addresses, structure and code.",
  });
  return section(ctx, { id: "coverage", title: "Source coverage and limitations", status: "extracted", blocks });
}

/* ------------------------------ appendices ------------------------------ */

function appendixTags(ctx: Ctx): Section | undefined {
  const tags = ctx.ix.kind("tag");
  if (!tags.length) return undefined;
  const rows = tags.slice(0, APPENDIX_ROWS).map((t) => [code(`[${t.scope}]${t.path}`), list(t.fields.dataType), list(t.fields.valueSource), val(ctx, t, t.fields.opcItemPath ? "opcItemPath" : t.fields.expression ? "expression" : "sourceTagPath"), list(t.fields.engUnit)]);
  return section(ctx, {
    id: "appendix-tags",
    title: "Appendix: Tag inventory",
    status: "extracted",
    appendix: true,
    blocks: [
      { type: "table", columns: ["Tag", "Data type", "Source", "Item path / expression", "Units"], rows },
      ...(tags.length > APPENDIX_ROWS ? [{ type: "callout", tone: "note", text: `Showing ${APPENDIX_ROWS.toLocaleString()} of ${tags.length.toLocaleString()} tags. tags.csv has all of them.` } as Block] : []),
    ],
  });
}

function appendixAlarms(ctx: Ctx): Section | undefined {
  const alarms = sortedAlarms(ctx.ix);
  if (alarms.length <= MAIN_ROWS) return undefined;
  return section(ctx, {
    id: "appendix-alarms",
    title: "Appendix: Alarm inventory",
    status: "extracted",
    appendix: true,
    blocks: [{ type: "table", columns: ["Alarm", "Tag", "Priority", "Condition", "Label"], rows: alarms.slice(0, APPENDIX_ROWS).map((a) => [a.name, code(String(a.fields.tag)), list(a.fields.priority), condition(a), list(a.fields.label)]) }],
  });
}

function appendixViews(ctx: Ctx): Section | undefined {
  const { ix } = ctx;
  const views = ix.kind("view");
  if (!views.length) return undefined;
  const blocks: Block[] = [];
  for (const v of views.slice(0, 400)) {
    blocks.push({ type: "heading", text: `${v.scope} / ${v.path}` });
    const facts: [string, string][] = [
      ["Root container", list(v.fields.rootType)],
      ["Parameters", list(v.fields.params)],
      ["Components", `${v.fields.components ?? 0}${Array.isArray(v.fields.componentTypes) && v.fields.componentTypes.length ? ` (${v.fields.componentTypes.join(", ")})` : ""}`],
      ["Bindings", `${v.fields.bindings ?? 0}${Array.isArray(v.fields.bindingTypes) && v.fields.bindingTypes.length ? ` (${v.fields.bindingTypes.join(", ")})` : ""}`],
      ["Scripts", String(v.fields.scripts ?? 0)],
    ];
    if (v.fields.defaultSize) facts.push(["Default size", String(v.fields.defaultSize)]);
    if (v.fields.documentation) facts.push(["Notes", String(v.fields.documentation)]);
    const pages = ix.incoming(v.id, "routes-to").map((r) => ix.byId.get(r.from)?.name ?? r.from);
    if (pages.length) facts.push(["Opened by", pages.join(", ")]);
    blocks.push({ type: "facts", items: facts });
    const out = ix.outgoing(v.id);
    const items = [
      ...uniq(out.filter((r) => r.type === "embeds-view").map((r) => `Embeds view ${code(r.target)}`)),
      ...uniq(out.filter((r) => r.type === "calls-query").map((r) => `Runs query ${code(r.target)}`)),
      ...uniq(out.filter((r) => r.type === "binds-tag" && !r.dynamic).map((r) => `Reads ${code(r.target)}${r.to ? "" : " (not in input)"}`)).slice(0, 25),
    ];
    const dyn = out.filter((r) => r.dynamic).length;
    if (dyn) items.push(`${plural(dyn, "dynamic reference")} resolved at runtime`);
    if (items.length) blocks.push({ type: "list", items, refs: [v.id] });
  }
  return section(ctx, { id: "appendix-views", title: "Appendix: View details", status: "extracted", appendix: true, blocks, refs: views.map((v) => v.id) });
}

function appendixQueries(ctx: Ctx): Section | undefined {
  const qs = ctx.ix.kind("named-query");
  if (!qs.length) return undefined;
  const blocks: Block[] = [];
  for (const q of qs) {
    blocks.push({ type: "heading", text: `${q.scope} / ${q.path}` });
    blocks.push({ type: "facts", items: [["Type", list(q.fields.type)], ["Database", list(q.fields.database)], ["Parameters", list(q.fields.parameters)], ["Cache", q.fields.cache ? String(q.fields.cache) : "Off"]] });
    if (q.fields.sql) blocks.push(ctx.cfg.redact.code ? { type: "paragraph", text: "SQL text excluded by the export settings." } : { type: "code", language: "sql", text: String(q.fields.sql) });
  }
  return section(ctx, { id: "appendix-queries", title: "Appendix: Named query details", status: "extracted", appendix: true, blocks, refs: qs.map((q) => q.id) });
}

function appendixScripts(ctx: Ctx): Section | undefined {
  const mods = ctx.ix.kind("script");
  if (!mods.length) return undefined;
  const blocks: Block[] = [];
  for (const m of mods) {
    blocks.push({ type: "heading", text: `${m.scope} / ${m.name}` });
    const fns = Array.isArray(m.fields.functions) ? m.fields.functions : [];
    blocks.push(fns.length ? { type: "list", items: fns.map((f) => code(f.split(" — ")[0]!) + (f.includes(" — ") ? ` — ${f.split(" — ")[1]}` : "")) } : { type: "paragraph", text: "No top-level functions." });
  }
  return section(ctx, { id: "appendix-scripts", title: "Appendix: Script functions", status: "extracted", appendix: true, blocks, refs: mods.map((m) => m.id) });
}

function appendixGateway(ctx: Ctx): Section | undefined {
  const res = ctx.ix.kind("resource").filter((r) => r.id.startsWith("resource:gateway/"));
  const listed = ctx.ix.kind("resource").filter((r) => !r.id.startsWith("resource:gateway/"));
  if (!res.length && !listed.length) return undefined;
  const blocks: Block[] = [];
  if (res.length) {
    blocks.push({ type: "heading", text: "Gateway settings" });
    blocks.push({
      type: "table",
      columns: ["Area", "Name", "Settings"],
      rows: res.map((r) => [
        String(r.fields.resourceType ?? ""),
        r.name,
        Object.keys(r.fields)
          .filter((k) => k !== "resourceType")
          .slice(0, 4)
          .map((k) => `${k}: ${val(ctx, r, k)}`)
          .join("; ") || "—",
      ]),
    });
  }
  if (listed.length) {
    blocks.push({ type: "heading", text: "Resources listed but not interpreted" });
    blocks.push({ type: "table", columns: ["Type", "Project", "Name"], rows: listed.slice(0, APPENDIX_ROWS).map((r) => [String(r.fields.resourceType ?? ""), r.scope ?? "—", r.path ?? r.name]) });
  }
  return section(ctx, { id: "appendix-gateway", title: "Appendix: Other resources", status: "extracted", appendix: true, blocks });
}

const uniq = (xs: string[]) => [...new Set(xs)];

/* ------------------------------ frameworks ------------------------------ */

function opIntro(ctx: Ctx): Section {
  return section(ctx, {
    id: "op-intro",
    title: "Using this operator manual",
    status: "extracted",
    blocks: [
      { type: "paragraph", text: "This manual is a framework. Screens, navigation and alarms come from the system's configuration. Operating procedures, alarm responses and safety information must be written or approved by the site; until then they are marked Unresolved." },
      { type: "callout", tone: "warning", text: "Don't use any procedure in this document that isn't marked Confirmed." },
    ],
  });
}

function opScreens(ctx: Ctx): Section | undefined {
  const { ix } = ctx;
  const pages = ix.kind("page");
  if (!pages.length) return undefined;
  const blocks: Block[] = [{ type: "paragraph", text: "Screens available to operators, by the address used to open them." }];
  for (const p of pages.slice(0, 60)) {
    const v = p.fields.view ? ix.byId.get(ix.outgoing(p.id, "routes-to")[0]?.to ?? "") : undefined;
    blocks.push({ type: "heading", text: `${p.name}` });
    const items: [string, string][] = [["View", p.fields.view ? code(String(p.fields.view)) : "—"]];
    if (v) {
      const embeds = uniq(ix.outgoing(v.id, "embeds-view").map((r) => r.target));
      if (embeds.length) items.push(["Includes", embeds.slice(0, 8).map(code).join(", ")]);
      const alarmsNear = ix.outgoing(v.id, "binds-tag").filter((r) => r.to && ix.outgoing(r.to, "has-alarm").length).length;
      if (alarmsNear) items.push(["Alarmed values shown", String(alarmsNear)]);
    }
    blocks.push({ type: "facts", items });
    blocks.push(...shots(ctx, p.id));
  }
  const missing = pages.filter((p) => !ctx.cfg.screenshots.some((s) => s.page === p.id)).length;
  if (missing) blocks.push(gap(`${missing === pages.length ? "Add a screenshot" : `${plural(missing, "screen")} still ${agree(missing, "needs", "need")} a screenshot`} and a short description of each screen. Screenshots come from the running system; the toolkit can't render them from configuration.`));
  return section(ctx, { id: "op-screens", title: "Screens and navigation", status: "extracted", blocks, refs: pages.map((p) => p.id) });
}

function opAlarmResponse(ctx: Ctx): Section | undefined {
  const alarms = sortedAlarms(ctx.ix);
  if (!alarms.length) return undefined;
  const top = alarms.filter((a) => priorityRank(a.fields.priority) <= 1);
  const rows = (top.length ? top : alarms).slice(0, 60).map((a) => [a.name, code(String(a.fields.tag)), list(a.fields.priority), condition(a), ""]);
  return section(ctx, {
    id: "op-alarm-response",
    title: "Alarm responses",
    status: "unresolved",
    blocks: [
      { type: "paragraph", text: top.length ? "Critical and high-priority alarms. Record the approved operator response for each." : "Configured alarms. Record the approved operator response for each." },
      { type: "table", columns: ["Alarm", "Tag", "Priority", "Condition", "Approved response"], rows },
      gap("Responses must come from the site's approved procedures. The toolkit and AI assistants may suggest questions, not responses."),
    ],
    refs: alarms.map((a) => a.id),
  });
}

function procedures(ctx: Ctx, id: string, title: string, prompts: string[]): Section {
  const text = ctx.cfg.context.procedures.trim();
  if (text && id === "op-procedures") {
    return section(ctx, { id, title, status: "confirmed", origin: "user", blocks: text.split(/\n{2,}/).map((p) => ({ type: "paragraph", text: p.trim() }) as Block) });
  }
  return section(ctx, { id, title, status: "unresolved", blocks: [gap("To be supplied by the site."), { type: "list", items: prompts }] });
}

function mgEquipment(ctx: Ctx): Section {
  const { ix } = ctx;
  const inst = ix.kind("udt-instance");
  if (!inst.length) {
    return section(ctx, { id: "mg-equipment", title: "Equipment", status: "unresolved", blocks: [gap("No UDT instances were found, so there's no equipment list to draw from. Add a tag export that includes the equipment UDTs, or list the equipment here.")] });
  }
  const rows = [...inst].sort((a, b) => String(a.fields.typeId).localeCompare(String(b.fields.typeId)) || a.id.localeCompare(b.id)).slice(0, 500).map((i) => [code(`[${i.scope}]${i.path}`), list(i.fields.typeId), list(i.fields.parameters), String(ix.kind("alarm").filter((a) => String(a.fields.tag).startsWith(`[${i.scope}]${i.path}/`)).length)]);
  return section(ctx, {
    id: "mg-equipment",
    title: "Equipment",
    status: "extracted",
    blocks: [{ type: "paragraph", text: "Equipment modelled as UDT instances, grouped by type." }, { type: "table", columns: ["Equipment", "Type", "Parameters", "Alarms"], rows }],
    refs: inst.map((i) => i.id),
  });
}

function mgTroubleshooting(ctx: Ctx): Section | undefined {
  const alarms = sortedAlarms(ctx.ix);
  if (!alarms.length) return undefined;
  const names = uniq(alarms.map((a) => a.name)).slice(0, 40);
  return section(ctx, {
    id: "mg-troubleshooting",
    title: "Troubleshooting",
    status: "unresolved",
    blocks: [
      { type: "paragraph", text: "Alarm types found in the configuration. Record likely causes and the checks a technician should make." },
      { type: "table", columns: ["Alarm", "Likely causes", "Checks"], rows: names.map((n) => [n, "", ""]) },
      gap("Causes and checks come from site experience and equipment manuals. The agent extension can propose questions to ask, marked AI draft."),
    ],
    refs: alarms.map((a) => a.id),
  });
}

function mgRecovery(ctx: Ctx): Section {
  const gw = ctx.ix.kind("gateway")[0];
  const blocks: Block[] = [];
  if (gw) blocks.push({ type: "facts", items: [["Gateway version", list(gw.fields.version)], ["Backup taken", list(gw.fields.backupTimestamp)], ["Configuration format", list(gw.fields.configFormat)]] });
  blocks.push(gap("Record where gateway backups are kept, how often they're taken, who can restore them and how a restore is verified."));
  return section(ctx, { id: "mg-recovery", title: "Backup and recovery", status: "unresolved", blocks, refs: gw ? [gw.id] : [] });
}

/* ------------------------------ packs ------------------------------ */

type Builder = (ctx: Ctx) => Section | undefined;

const REFERENCE: Builder[] = [about, overview, systemMap, projectsSection, navigation, screenshotsSection, viewsSection, tagsSection, alarmsSection, connections, queries, scripts, dependencies];
const APPENDICES: Builder[] = [appendixTags, appendixAlarms, appendixViews, appendixQueries, appendixScripts, appendixGateway];
const OPERATOR: Builder[] = [
  opIntro,
  about,
  opScreens,
  screenshotsSection,
  alarmsSection,
  opAlarmResponse,
  (c) => procedures(c, "op-procedures", "Operating procedures", ["Start-up", "Normal operation and routine checks", "Shutdown", "Abnormal and emergency situations", "Handover between shifts"]),
  (c) => procedures(c, "op-safety", "Safety information", ["Hazards and required PPE", "Interlocks and permissives operators should know", "Emergency stops and who to call"]),
];
const MAINTENANCE: Builder[] = [
  (c) => section(c, { id: "mg-intro", title: "Using this maintenance guide", status: "extracted", blocks: [{ type: "paragraph", text: "Equipment, connections, alarms and scripts come from the configuration. Troubleshooting steps and recovery procedures must be supplied by the site and are marked Unresolved until then." }] }),
  about,
  mgEquipment,
  connections,
  alarmsSection,
  mgTroubleshooting,
  scripts,
  mgRecovery,
];

const PACK_BUILDERS: Record<PackId, Builder[]> = {
  "engineering-reference": [...REFERENCE, coverageSection, ...APPENDICES],
  "operator-manual": [...OPERATOR, coverageSection, appendixAlarms],
  "maintenance-guide": [...MAINTENANCE, coverageSection, appendixTags, appendixAlarms, appendixScripts],
  "complete-handoff": [...REFERENCE, ...OPERATOR, ...MAINTENANCE, coverageSection, ...APPENDICES],
};

/** Every section a pack can contain, before exclusions: used for the section checklist. */
export function packSections(ev: Evidence, cfg: ToolkitConfig, pack: PackId = cfg.pack): Section[] {
  const ctx: Ctx = { ix: new Index(ev), cfg };
  const seen = new Set<string>();
  const out: Section[] = [];
  for (const b of PACK_BUILDERS[pack]) {
    const s = b(ctx);
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

export function buildDocument(ev: Evidence, cfg: ToolkitConfig): DocumentModel {
  const all = packSections(ev, cfg);
  const pack = PACKS.find((p) => p.id === cfg.pack)!;
  return {
    schema: DOCUMENT_SCHEMA,
    pack: cfg.pack,
    title: cfg.identity.project || ev.entities.find((e) => e.kind === "project")?.name || ev.entities.find((e) => e.kind === "gateway")?.name || pack.label,
    sections: all.filter((s) => s.id === "coverage" || !cfg.exclude.includes(s.id)),
  };
}
