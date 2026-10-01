import type { FileTree } from "../archive.ts";
import type { FieldValue } from "../types.ts";
import { clip, type Collector } from "./collector.ts";
import { linkExpression } from "./ignition-tags.ts";

/**
 * Ignition 8.x project resources (file-based since 8.0): a project export ZIP
 * has them at its root; a gateway backup has one folder per project under
 * `projects/`. Each resource is a folder holding `resource.json` plus files.
 */

/** Files worth decompressing inside a project. Binary resources are listed, not read. */
export const wantProjectFile = (path: string, size: number) => size < 8 * 1024 * 1024 && /\.(json|py|sql|txt)$/i.test(path);

interface Resource {
  module: string;
  type: string;
  /** Resource path inside its type, e.g. `Pumps/Station`; "" for singletons. */
  path: string;
  dir: string;
  files: string[];
}

const LABELS: Record<string, string> = {
  "com.inductiveautomation.perspective/views": "Perspective views",
  "com.inductiveautomation.perspective/page-config": "Perspective page configuration",
  "com.inductiveautomation.perspective/session-props": "Perspective session properties",
  "com.inductiveautomation.perspective/session-scripts": "Perspective session events",
  "com.inductiveautomation.perspective/style-classes": "Perspective style classes",
  "com.inductiveautomation.perspective/stylesheet": "Perspective stylesheet",
  "com.inductiveautomation.vision/windows": "Vision windows",
  "com.inductiveautomation.vision/templates": "Vision templates",
  "com.inductiveautomation.vision/client-event-scripts": "Vision client events",
  "com.inductiveautomation.reporting/reports": "Reports",
  "com.inductiveautomation.sqlbridge/transaction-groups": "Transaction groups",
  "com.inductiveautomation.alarm-notification/alarm-pipelines": "Alarm pipelines",
  "com.inductiveautomation.sfc/charts": "SFC charts",
  "com.inductiveautomation.webdev/resources": "WebDev resources",
  "ignition/script-python": "Project scripts",
  "ignition/named-query": "Named queries",
  "ignition/event-scripts": "Gateway events (8.1 format)",
  "ignition/global-props": "Project properties",
  "ignition/designer-properties": "Designer properties",
  "ignition/inheritable-props": "Inheritance properties",
};

/** Resource types we read but that don't need their own entity. */
const QUIET = new Set(["ignition/global-props", "ignition/designer-properties", "ignition/inheritable-props", "com.inductiveautomation.perspective/session-props"]);

const GATEWAY_EVENT_TYPES = /^(startup|shutdown|timer|tag-change|message-handlers?|scheduled)/;

export function findResources(tree: FileTree, prefix: string): Resource[] {
  const byDir = new Map<string, string[]>();
  for (const e of tree.entries) {
    if (prefix && !e.path.startsWith(prefix)) continue;
    const rel = e.path.slice(prefix.length);
    const slash = rel.lastIndexOf("/");
    const dir = slash < 0 ? "" : rel.slice(0, slash);
    const list = byDir.get(dir) ?? [];
    list.push(rel.slice(slash + 1));
    byDir.set(dir, list);
  }
  const out: Resource[] = [];
  for (const [dir, files] of byDir) {
    if (!files.includes("resource.json")) continue;
    const parts = dir.split("/");
    if (parts.length < 2) continue;
    out.push({ module: parts[0]!, type: parts[1]!, path: parts.slice(2).join("/"), dir: prefix + dir, files });
  }
  return out.sort((a, b) => a.dir.localeCompare(b.dir));
}

export function collectProject(c: Collector, tree: FileTree, prefix: string, fallbackName: string) {
  const meta = tree.json<Record<string, unknown>>(`${prefix}project.json`) ?? {};
  const name = fallbackName;
  const projectId = `project:${name}`;
  const resources = findResources(tree, prefix);
  const counts: Record<string, number> = {};
  for (const r of resources) counts[`${r.module}/${r.type}`] = (counts[`${r.module}/${r.type}`] ?? 0) + 1;

  c.add({
    id: projectId,
    kind: "project",
    name,
    file: `${prefix}project.json`,
    fields: {
      title: str(meta.title) ?? null,
      description: str(meta.description) ?? null,
      parent: str(meta.parent) ?? null,
      enabled: meta.enabled !== false,
      inheritable: meta.inheritable === true,
      resources: resources.length,
    },
  });
  c.count("ignition.project", "Projects", true);
  if (meta.parent) {
    c.diag(
      "info",
      "inherited-project",
      `Project “${name}” inherits from “${String(meta.parent)}”. Inherited resources are only documented if that project is also in the input.`,
      c.src(`${prefix}project.json`),
    );
  }

  // Script modules first, so view and script code can link to them.
  const modules = resources.filter((r) => r.module === "ignition" && r.type === "script-python").map((r) => r.path.replace(/\//g, "."));
  const ctx: ProjectCtx = { c, tree, project: name, projectId, modules };

  for (const r of resources) {
    const key = `${r.module}/${r.type}`;
    const label = LABELS[key] ?? `${r.type} (${r.module})`;
    try {
      if (key === "com.inductiveautomation.perspective/views") readView(ctx, r);
      else if (key === "com.inductiveautomation.perspective/page-config") readPages(ctx, r);
      else if (key === "com.inductiveautomation.perspective/style-classes") readSimple(ctx, r, "style-class", label);
      else if (key === "ignition/script-python") readScript(ctx, r);
      else if (key === "ignition/named-query") readNamedQuery(ctx, r);
      else if (r.module === "ignition" && GATEWAY_EVENT_TYPES.test(r.type) && r.files.some((f) => f.endsWith(".py"))) readEventScript(ctx, r);
      else if (QUIET.has(key)) c.count(key, label, true);
      else listOnly(ctx, r, key, label);
    } catch (e) {
      c.count(key, label, false, "Some resources couldn't be parsed; see diagnostics.");
      c.diag("warning", "resource-unreadable", `Couldn't read ${r.dir}: ${(e as Error).message}`, c.src(r.dir));
    }
  }
}

interface ProjectCtx {
  c: Collector;
  tree: FileTree;
  project: string;
  projectId: string;
  modules: string[];
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const resId = (kind: string, ctx: ProjectCtx, path: string) => `${kind}:${ctx.project}/${path}`;
export const viewId = (project: string, path: string) => `view:${project}/${path.replace(/^\/+/, "")}`;

function resourceDoc(ctx: ProjectCtx, r: Resource): Record<string, FieldValue> {
  const res = ctx.tree.json<Record<string, unknown>>(`${r.dir}/resource.json`) ?? {};
  const attrs = (res.attributes ?? {}) as Record<string, unknown>;
  const doc = str(res.documentation) ?? str(attrs.documentation) ?? str(res.description);
  return doc ? { documentation: clip(doc, 600) } : {};
}

function listOnly(ctx: ProjectCtx, r: Resource, key: string, label: string) {
  const readable = r.files.some((f) => f.endsWith(".json") && f !== "resource.json") || r.files.some((f) => f.endsWith(".py"));
  const binary = r.files.filter((f) => f.endsWith(".bin"));
  ctx.c.add({
    id: resId(`resource:${key}`, ctx, r.path || r.type),
    kind: "resource",
    name: r.path.split("/").pop() || r.type,
    path: r.path || r.type,
    scope: ctx.project,
    file: `${r.dir}/resource.json`,
    interpreted: false,
    fields: { resourceType: label, files: r.files.filter((f) => f !== "resource.json"), ...resourceDoc(ctx, r) },
  });
  ctx.c.count(key, label, false, binary.length ? "Stored in a binary format that isn't decoded yet; listed by name only." : readable ? "Listed by name; content isn't interpreted yet." : "Listed by name only.");
}

function readSimple(ctx: ProjectCtx, r: Resource, kind: "style-class", label: string) {
  ctx.c.add({ id: resId(kind, ctx, r.path), kind, name: r.path.split("/").pop() ?? r.path, path: r.path, scope: ctx.project, file: `${r.dir}/resource.json`, fields: resourceDoc(ctx, r) });
  ctx.c.count(`${r.module}/${r.type}`, label, true);
}

/* ------------------------------ Perspective views ------------------------------ */

function readView(ctx: ProjectCtx, r: Resource) {
  const { c, tree } = ctx;
  const file = `${r.dir}/view.json`;
  const view = tree.json<Record<string, unknown>>(file);
  const key = `${r.module}/${r.type}`;
  if (!view) {
    c.count(key, "Perspective views", false, "Some view.json files were missing or invalid.");
    c.diag("warning", "view-unreadable", `Couldn't parse ${file}.`, c.src(file));
    return;
  }
  const id = viewId(ctx.project, r.path);
  const stats = { components: 0, types: new Map<string, number>(), bindings: new Map<string, number>(), scripts: 0 };

  walk(view, "", (node, ptr) => {
    // Components carry a type and a meta block; the view root is one of them.
    if (typeof node.type === "string" && node.meta && typeof node.meta === "object") {
      stats.components++;
      stats.types.set(node.type, (stats.types.get(node.type) ?? 0) + 1);
      const props = (node.props ?? {}) as Record<string, unknown>;
      if (/view|repeater/i.test(node.type) && typeof props.path === "string" && props.path) {
        c.rel({ from: id, type: "embeds-view", target: props.path, to: viewId(ctx.project, props.path), explicit: true, source: c.src(file, ptr) });
      }
    }
    const binding = node.binding as Record<string, unknown> | undefined;
    if (binding && typeof binding === "object" && typeof binding.type === "string") {
      stats.bindings.set(binding.type, (stats.bindings.get(binding.type) ?? 0) + 1);
      readBinding(ctx, id, binding, file, `${ptr}/binding`);
    }
    // Navigation and popup actions.
    if ((node.type === "nav" || node.type === "popup") && node.config && typeof node.config === "object") {
      const cfg = node.config as Record<string, unknown>;
      const target = str(cfg.view) ?? str(cfg.viewPath);
      if (target) c.rel({ from: id, type: "embeds-view", target, to: viewId(ctx.project, target), explicit: true, source: c.src(file, ptr) });
    }
    if (typeof node.viewPath === "string" && node.viewPath) {
      c.rel({ from: id, type: "embeds-view", target: node.viewPath, to: viewId(ctx.project, node.viewPath), explicit: true, source: c.src(file, ptr) });
    }
    for (const k of ["script", "code"] as const) {
      if (typeof node[k] === "string" && node[k]) {
        stats.scripts++;
        linkScript(ctx, id, node[k] as string, file, ptr);
      }
    }
  });

  const params = viewParams(view);
  const size = (view.props as { defaultSize?: { width?: number; height?: number } } | undefined)?.defaultSize;
  const root = view.root as { type?: string } | undefined;
  c.add({
    id,
    kind: "view",
    name: r.path.split("/").pop() ?? r.path,
    path: r.path,
    scope: ctx.project,
    file,
    fields: {
      rootType: root?.type ?? null,
      components: stats.components,
      componentTypes: [...stats.types].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([t, n]) => `${t.replace(/^ia\./, "")} ×${n}`),
      bindings: [...stats.bindings.values()].reduce((a, b) => a + b, 0),
      bindingTypes: [...stats.bindings].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ×${n}`),
      scripts: stats.scripts,
      params,
      ...(size?.width && size?.height ? { defaultSize: `${size.width} × ${size.height}` } : {}),
      ...resourceDoc(ctx, r),
    },
  });
  c.count(key, "Perspective views", true);
}

function viewParams(view: Record<string, unknown>): string[] {
  const names = Object.keys((view.params ?? {}) as object);
  const cfg = (view.propConfig ?? {}) as Record<string, { paramDirection?: string }>;
  return names.map((n) => {
    const dir = cfg[`params.${n}`]?.paramDirection;
    return dir && dir !== "input" ? `${n} (${dir})` : n;
  });
}

function readBinding(ctx: ProjectCtx, from: string, b: Record<string, unknown>, file: string, ptr: string) {
  const { c } = ctx;
  const cfg = (b.config ?? {}) as Record<string, unknown>;
  switch (b.type) {
    case "tag": {
      const path = str(cfg.tagPath);
      if (path) {
        const dynamic = cfg.mode === "indirect" || cfg.mode === "expression" || /\{|\[[.~]\]/.test(path);
        c.rel({ from, type: "binds-tag", target: path, explicit: true, dynamic: dynamic || undefined, source: c.src(file, ptr) });
      }
      break;
    }
    case "expr":
      if (typeof cfg.expression === "string") linkExpression(c, from, cfg.expression, file);
      break;
    case "expr-struct":
      for (const v of Object.values((cfg.struct ?? {}) as Record<string, unknown>)) if (typeof v === "string") linkExpression(c, from, v, file);
      break;
    case "query": {
      const q = str(cfg.queryPath);
      if (q) c.rel({ from, type: "calls-query", target: q, to: resId("named-query", ctx, q), explicit: true, source: c.src(file, ptr) });
      break;
    }
    case "tag-history": {
      for (const t of (cfg.tags ?? []) as { path?: unknown }[]) {
        const p = str(t?.path);
        if (p) c.rel({ from, type: "binds-tag", target: p, explicit: true, dynamic: /\{/.test(p) || undefined, source: c.src(file, ptr) });
      }
      break;
    }
  }
  for (const t of (b.transforms ?? []) as { type?: string; expression?: unknown }[]) {
    if (t?.type === "expression" && typeof t.expression === "string") linkExpression(c, from, t.expression, file);
  }
}

/** Depth-first walk over plain JSON, with a JSON pointer for each object. */
function walk(v: unknown, ptr: string, visit: (node: Record<string, unknown>, ptr: string) => void, depth = 0) {
  if (depth > 200 || v === null || typeof v !== "object") return;
  if (Array.isArray(v)) {
    v.forEach((x, i) => walk(x, `${ptr}/${i}`, visit, depth + 1));
    return;
  }
  const o = v as Record<string, unknown>;
  visit(o, ptr || "/");
  for (const [k, x] of Object.entries(o)) walk(x, `${ptr}/${k.replace(/~/g, "~0").replace(/\//g, "~1")}`, visit, depth + 1);
}

/* ------------------------------ pages ------------------------------ */

function readPages(ctx: ProjectCtx, r: Resource) {
  const { c, tree } = ctx;
  const file = `${r.dir}/config.json`;
  const cfg = tree.json<{ pages?: Record<string, { viewPath?: string; title?: string }>; sharedDocks?: unknown }>(file);
  if (!cfg) {
    c.count("com.inductiveautomation.perspective/page-config", "Perspective page configuration", false);
    return;
  }
  for (const [url, page] of Object.entries(cfg.pages ?? {})) {
    const id = `page:${ctx.project}${url.startsWith("/") ? "" : "/"}${url}`;
    c.add({ id, kind: "page", name: url, path: url, scope: ctx.project, file, fields: { view: page.viewPath ?? null, ...(page.title ? { title: page.title } : {}) } });
    if (page.viewPath) c.rel({ from: id, type: "routes-to", target: page.viewPath, to: viewId(ctx.project, page.viewPath), explicit: true, source: c.src(file, `/pages/${url}`) });
    c.count("perspective.page", "Perspective pages", true);
  }
  // Shared docks: whatever the layout, every dock names its view with viewPath.
  walk(cfg.sharedDocks ?? {}, "/sharedDocks", (node, ptr) => {
    if (typeof node.viewPath === "string" && node.viewPath) {
      c.rel({ from: ctx.projectId, type: "embeds-view", target: node.viewPath, to: viewId(ctx.project, node.viewPath), explicit: true, source: c.src(file, ptr) });
    }
  });
  c.count("com.inductiveautomation.perspective/page-config", "Perspective page configuration", true);
}

/* ------------------------------ scripts ------------------------------ */

const DEF = /^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:/;

export function scriptFunctions(code: string): string[] {
  const lines = code.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(DEF);
    if (!m) continue;
    let doc = "";
    const next = lines.slice(i + 1, i + 4).join("\n").trim();
    const d = next.match(/^(?:"""|''')\s*([^\n"']+)/);
    if (d) doc = d[1]!.trim();
    const sig = `${m[1]}(${m[2]!.replace(/\s+/g, " ").trim()})`;
    out.push(doc ? `${sig} — ${clip(doc, 120)}` : sig);
  }
  return out;
}

function readScript(ctx: ProjectCtx, r: Resource) {
  const { c, tree } = ctx;
  const file = `${r.dir}/code.py`;
  const code = tree.text(file);
  const module = r.path.replace(/\//g, ".");
  if (code === undefined) {
    c.count("ignition/script-python", "Project scripts", false, "Some script files were missing.");
    return;
  }
  const id = resId("script", ctx, module);
  c.add({
    id,
    kind: "script",
    name: module,
    path: module,
    scope: ctx.project,
    file,
    fields: { functions: scriptFunctions(code).slice(0, 80), lines: code.split(/\r?\n/).length, code: clip(code, 6000), ...resourceDoc(ctx, r) },
    sensitive: { code: "code" },
  });
  c.count("ignition/script-python", "Project scripts", true);
  linkScript(ctx, id, code, file);
}

function readEventScript(ctx: ProjectCtx, r: Resource) {
  const { c, tree } = ctx;
  for (const f of r.files.filter((x) => x.endsWith(".py"))) {
    const file = `${r.dir}/${f}`;
    const code = tree.text(file) ?? "";
    const name = r.path ? `${r.type}/${r.path}` : r.type;
    const id = resId("event-script", ctx, `${name}/${f.replace(/\.py$/, "")}`);
    const res = tree.json<{ attributes?: Record<string, unknown> }>(`${r.dir}/resource.json`);
    c.add({
      id,
      kind: "event-script",
      name: `${name} · ${f.replace(/\.py$/, "")}`,
      path: name,
      scope: ctx.project,
      file,
      fields: { event: r.type, lines: code.split(/\r?\n/).length, enabled: res?.attributes?.enabled !== false, code: clip(code, 4000) },
      sensitive: { code: "code" },
    });
    linkScript(ctx, id, code, file);
  }
  c.count("ignition.gateway-events", "Gateway event scripts", true);
}

/* Inferred links from code: tag path literals, named query calls, project library calls. */
const TAG_LITERAL = /["'](\[[^\]"'\n]*\][^"'\n]+)["']/g;
const NAMED_QUERY = /system\.db\.runNamedQuery\(\s*(?:\w+\s*=\s*)?["']([^"']+)["']\s*(?:,\s*["']([^"']+)["'])?/g;
const RAW_SQL = /system\.db\.run(?:Prep)?(?:Query|Update)\(/g;

function linkScript(ctx: ProjectCtx, from: string, code: string, file: string, at?: string) {
  const { c } = ctx;
  const src = c.src(file, at);
  for (const m of code.matchAll(TAG_LITERAL)) {
    c.rel({ from, type: "binds-tag", target: m[1]!, explicit: false, dynamic: /%s|\{/.test(m[1]!) || undefined, source: src });
  }
  for (const m of code.matchAll(NAMED_QUERY)) {
    const path = m[2] ?? m[1]!;
    c.rel({ from, type: "calls-query", target: path, to: resId("named-query", ctx, path), explicit: false, source: src });
  }
  const raw = [...code.matchAll(RAW_SQL)].length;
  if (raw) c.diag("info", "raw-sql", `${raw} direct SQL call${raw > 1 ? "s" : ""} in script code; their tables aren't traced.`, src);
  const seen = new Set<string>();
  for (const mod of ctx.modules) {
    const re = new RegExp(`\\b${mod.replace(/\./g, "\\.")}\\.(\\w+)\\s*\\(`, "g");
    for (const m of code.matchAll(re)) {
      const target = `${mod}.${m[1]}`;
      if (seen.has(target) || from === resId("script", ctx, mod)) continue;
      seen.add(target);
      c.rel({ from, type: "calls-script", target, to: resId("script", ctx, mod), explicit: false, source: src });
    }
  }
}

/* ------------------------------ named queries ------------------------------ */

const TABLES = /\b(?:from|join|into|update)\s+((?:\[[^\]]+\]|"[^"]+"|`[^`]+`|[A-Za-z_][\w$]*)(?:\.(?:\[[^\]]+\]|"[^"]+"|`[^`]+`|[A-Za-z_][\w$]*))*)/gi;

export function sqlTables(sql: string): string[] {
  const noComments = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const set = new Set<string>();
  for (const m of noComments.matchAll(TABLES)) {
    const t = m[1]!;
    if (/^(select|values|set|where|\(|:)/i.test(t)) continue;
    set.add(t);
  }
  return [...set].sort();
}

function readNamedQuery(ctx: ProjectCtx, r: Resource) {
  const { c, tree } = ctx;
  const res = tree.json<{ attributes?: Record<string, unknown> }>(`${r.dir}/resource.json`) ?? {};
  const a = res.attributes ?? {};
  const sql = tree.text(`${r.dir}/query.sql`);
  const params = ((a.parameters ?? []) as { identifier?: string; type?: string }[]).map((p) => (p.type === "QueryString" ? `${p.identifier} (query string)` : String(p.identifier)));
  const id = resId("named-query", ctx, r.path);
  c.add({
    id,
    kind: "named-query",
    name: r.path.split("/").pop() ?? r.path,
    path: r.path,
    scope: ctx.project,
    file: `${r.dir}/${sql !== undefined ? "query.sql" : "resource.json"}`,
    interpreted: sql !== undefined,
    fields: {
      type: str(a.type) ?? null,
      database: str(a.database) ?? "(project default)",
      parameters: params,
      cache: a.cacheEnabled === true ? `${a.cacheAmount ?? ""} ${a.cacheUnit ?? ""}`.trim() || "on" : false,
      enabled: a.enabled !== false,
      tables: sql ? sqlTables(sql) : [],
      ...(sql ? { sql: clip(sql.trim(), 4000) } : {}),
      ...resourceDoc(ctx, r),
    },
    sensitive: sql ? { sql: "code" } : undefined,
  });
  if (str(a.database)) c.rel({ from: id, type: "uses-connection", target: String(a.database), to: `database-connection:${a.database}`, explicit: true, source: c.src(`${r.dir}/resource.json`) });
  c.count("ignition/named-query", "Named queries", sql !== undefined, sql === undefined ? "Some queries had no query.sql." : undefined);
}
