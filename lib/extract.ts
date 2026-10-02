import { strFromU8 } from "fflate";
import { DEFAULT_LIMITS, InputError, isZip, listZip, readZip, sha256, type ArchiveEntry, type ArchiveLimits, type FileTree } from "./archive.ts";
import { Collector } from "./adapters/collector.ts";
import { collectGateway, shortVersion, wantGatewayFile } from "./adapters/ignition-gateway.ts";
import { collectProject, wantProjectFile } from "./adapters/ignition-project.ts";
import { collectTagNodes, newTagStore, tagRoots, type TagStore } from "./adapters/ignition-tags.ts";
import { collectSupplement, isSupplement } from "./adapters/supplement.ts";
import { expandUdts, finalize, resolve } from "./resolve.ts";
import { emptyEvidence, type Evidence, type InputFormat, type InputRecord } from "./types.ts";

/**
 * Selected files → bounded extraction → evidence. Runs unchanged in a browser
 * worker and in Node (the local CLI). Nothing here touches the network.
 */

export const ADAPTERS = {
  "ignition-gateway-backup": { name: "ignition.gateway", version: "0.2.0", label: "Ignition gateway backup" },
  "ignition-project-export": { name: "ignition.project", version: "0.1.0", label: "Ignition project export" },
  "ignition-tag-json": { name: "ignition.tags", version: "0.1.2", label: "Ignition tag export (JSON)" },
  "oic-docs-supplement": { name: "oic.supplement", version: "0.1.0", label: "Supplied evidence" },
  unknown: { name: "none", version: "0", label: "Unsupported file" },
} as const satisfies Record<InputFormat, { name: string; version: string; label: string }>;

export interface InputFile {
  name: string;
  bytes: Uint8Array;
}

/** An input that is already a file tree (the bundled sample, an unzipped folder). */
export interface InputTree {
  name: string;
  tree: FileTree;
}

export interface Progress {
  stage: "hashing" | "listing" | "reading" | "linking" | "done";
  input?: string;
  message: string;
}

export interface ExtractOptions {
  limits?: ArchiveLimits;
  onProgress?: (p: Progress) => void;
  /** Tag provider name to assume for tag exports, which don't record it. */
  defaultProvider?: string;
}

export interface Detection {
  format: InputFormat;
  /** Path prefix of the project inside a project export ("" at the root). */
  prefix?: string;
  reason: string;
}

/** Decide what an archive is from its entry list alone. */
export function detectArchive(name: string, entries: ArchiveEntry[]): Detection {
  const paths = new Set(entries.map((e) => e.path));
  if (paths.has("backupinfo.xml") || paths.has("db_backup_sqlite.idb") || /\.gwbk$/i.test(name)) {
    return { format: "ignition-gateway-backup", reason: "Found gateway backup metadata." };
  }
  if (paths.has("project.json")) return { format: "ignition-project-export", prefix: "", reason: "Found project.json at the archive root." };
  // Exports zipped from a folder have one extra level.
  const nested = entries.map((e) => e.path.match(/^([^/]+)\/project\.json$/)?.[1]).filter(Boolean) as string[];
  if (nested.length === 1) return { format: "ignition-project-export", prefix: `${nested[0]}/`, reason: "Found project.json in a top-level folder." };
  return { format: "unknown", reason: "This archive has no gateway backup metadata or project.json." };
}

export function projectNameFor(fileName: string, prefix: string): string {
  if (prefix) return prefix.replace(/\/$/, "");
  return fileName.replace(/\.(zip|proj)$/i, "").replace(/[_-]\d{4}-?\d{2}-?\d{2}[_-]?\d*$/, "") || "Project";
}

export async function extract(inputs: (InputFile | InputTree)[], opts: ExtractOptions = {}): Promise<Evidence> {
  const limits = opts.limits ?? DEFAULT_LIMITS;
  const say = opts.onProgress ?? (() => {});
  const ev = emptyEvidence();
  const store = newTagStore();
  const post = new Collector("(linking)");

  for (const input of inputs) {
    const c = new Collector(input.name);
    let record: InputRecord;
    try {
      record = "tree" in input ? readTree(c, input, store, say) : await readFile(c, input, store, limits, opts, say);
    } catch (e) {
      const code = e instanceof InputError ? e.code : "input-failed";
      const message = e instanceof InputError ? e.message : `Couldn't read this file: ${(e as Error).message}`;
      c.diag("error", code, message, c.src(""));
      record = { name: input.name, size: "bytes" in input ? input.bytes.length : 0, sha256: "", format: "unknown", adapter: "none", adapterVersion: "0" };
    }
    ev.inputs.push(record);
    ev.entities.push(...c.entities.values());
    ev.relationships.push(...c.relationships);
    ev.diagnostics.push(...c.diagnostics);
    ev.coverage.push(...c.coverageItems());
  }

  say({ stage: "linking", message: "Linking references" });
  expandUdts(post, store);
  ev.entities.push(...post.entities.values());
  ev.relationships.push(...post.relationships);
  ev.diagnostics.push(...post.diagnostics);
  ev.coverage.push(...post.coverageItems());
  const out = finalize(resolve(ev));
  say({ stage: "done", message: `${out.entities.length.toLocaleString()} items documented` });
  return out;
}

async function readFile(c: Collector, input: InputFile, store: TagStore, limits: ArchiveLimits, opts: ExtractOptions, say: (p: Progress) => void): Promise<InputRecord> {
  say({ stage: "hashing", input: input.name, message: `Fingerprinting ${input.name}` });
  const base = { name: input.name, size: input.bytes.length, sha256: await sha256(input.bytes) };

  if (isZip(input.bytes)) {
    say({ stage: "listing", input: input.name, message: "Listing archive contents" });
    const entries = listZip(input.bytes, limits);
    const d = detectArchive(input.name, entries);
    if (d.format === "unknown") throw new InputError("unknown-archive", `${d.reason} Supported: Ignition project exports and 8.x gateway backups.`);
    const legacy = !entries.some((e) => e.path.startsWith("config/resources/"));
    const want = d.format === "ignition-gateway-backup" ? (p: string, s: number) => wantGatewayFile(p, s, legacy) : (p: string, s: number) => p.startsWith(d.prefix ?? "") && wantProjectFile(p, s);
    say({ stage: "reading", input: input.name, message: `Reading ${ADAPTERS[d.format].label.toLowerCase()}` });
    const { tree, skipped } = readZip(input.bytes, want, limits);
    for (const s of skipped) c.diag("warning", "entry-too-large", `Skipped ${s.path} (${Math.round(s.size / 1024 / 1024)} MB is over the per-file limit).`, c.src(s.path));
    let platformVersion: string | undefined;
    if (d.format === "ignition-gateway-backup") platformVersion = shortVersion(collectGateway(c, tree, store).version);
    else collectProject(c, tree, d.prefix ?? "", projectNameFor(input.name, d.prefix ?? ""));
    return { ...base, format: d.format, adapter: ADAPTERS[d.format].name, adapterVersion: ADAPTERS[d.format].version, ...(platformVersion ? { platformVersion } : {}) };
  }

  // Plain JSON: evidence a host supplies, or a tag export.
  if (input.bytes.length > limits.maxEntryBytes) throw new InputError("too-large", "This file is larger than the per-file limit.");
  const text = strFromU8(input.bytes).replace(/^﻿/, "");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new InputError("unknown-file", "This file isn't a ZIP archive or JSON. Supported: Ignition project exports, 8.x gateway backups and tag exports (JSON).");
  }
  // Checked first: a supplement's schema field is decisive, and it must never be read as tags.
  if (isSupplement(json)) {
    say({ stage: "reading", input: input.name, message: "Reading supplied evidence" });
    collectSupplement(c, json as Record<string, unknown>, input.name);
    return { ...base, ...record("oic-docs-supplement") };
  }
  const roots = tagRoots(json);
  if (!roots) throw new InputError("unknown-json", "This JSON file doesn't look like an Ignition tag export.");
  say({ stage: "reading", input: input.name, message: "Reading tag export" });
  collectTagFile(c, json, roots, input.name, store, opts.defaultProvider);
  return { ...base, format: "ignition-tag-json", adapter: ADAPTERS["ignition-tag-json"].name, adapterVersion: ADAPTERS["ignition-tag-json"].version };
}

function collectTagFile(c: Collector, json: unknown, roots: ReturnType<typeof tagRoots> & object, file: string, store: TagStore, defaultProvider = "default") {
  const named = json && typeof json === "object" && !Array.isArray(json) && (json as { tagType?: string }).tagType === "Provider" ? (json as { name?: string }).name : undefined;
  const provider = named || defaultProvider;
  if (!named) c.diag("info", "provider-assumed", `Tag exports don't record their provider, so these tags are documented under [${provider}].`, c.src(file));
  if (!c.entities.has(`tag-provider:${provider}`)) c.add({ id: `tag-provider:${provider}`, kind: "tag-provider", name: provider, file, fields: {} });
  collectTagNodes(c, roots, { provider, folder: "", file, inTypes: false, store });
}

function readTree(c: Collector, input: InputTree, store: TagStore, say: (p: Progress) => void): InputRecord {
  say({ stage: "reading", input: input.name, message: `Reading ${input.name}` });
  const d = detectArchive(input.name, input.tree.entries);
  const base = { name: input.name, size: input.tree.entries.reduce((s, e) => s + e.size, 0), sha256: "" };
  if (d.format === "ignition-gateway-backup") {
    const v = shortVersion(collectGateway(c, input.tree, store).version);
    return { ...base, format: d.format, adapter: ADAPTERS[d.format].name, adapterVersion: ADAPTERS[d.format].version, ...(v ? { platformVersion: v } : {}) };
  }
  if (d.format === "ignition-project-export") {
    collectProject(c, input.tree, d.prefix ?? "", projectNameFor(input.name, d.prefix ?? ""));
    return { ...base, format: d.format, adapter: ADAPTERS[d.format].name, adapterVersion: ADAPTERS[d.format].version };
  }
  // A tree holding tag JSON files, supplements, or both.
  let tags = 0;
  let supplements = 0;
  for (const e of input.tree.entries.filter((x) => x.path.endsWith(".json"))) {
    const json = input.tree.json(e.path);
    if (isSupplement(json)) {
      collectSupplement(c, json as Record<string, unknown>, e.path);
      supplements++;
      continue;
    }
    const roots = tagRoots(json);
    if (roots) {
      collectTagFile(c, json, roots, e.path, store);
      tags++;
    }
  }
  return { ...base, ...record(supplements && !tags ? "oic-docs-supplement" : "ignition-tag-json") };
}

const record = (format: "ignition-tag-json" | "oic-docs-supplement") => ({ format, adapter: ADAPTERS[format].name, adapterVersion: ADAPTERS[format].version });
