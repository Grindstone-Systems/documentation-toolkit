import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { defaultConfig, sanitizeConfig, type ToolkitConfig } from "../lib/config.ts";
import { PACKS, type PackId } from "../lib/document/model.ts";
import { buildDocument } from "../lib/document/packs.ts";
import { extract, type InputFile, type InputTree } from "../lib/extract.ts";
import { unresolved } from "../lib/resolve.ts";
import { ENGINE_VERSION } from "../lib/types.ts";
import { workspaceWithExports } from "../lib/exports.ts";
import { mergeDocument, readWorkspace, validateWorkspace, zipFiles, type Workspace } from "../lib/workspace.ts";
import { treeFromDir, writeFiles } from "./fs.ts";
import { serveMcp } from "./mcp.ts";

/**
 * oic-docs: the optional local extension. The same engine as the browser,
 * for repeatable builds and for AI agents (via `mcp`). Command names are
 * provisional until the package is published (docs/LOCAL.md).
 */

const HELP = `Documentation Toolkit ${ENGINE_VERSION} — local extension

Usage:
  oic-docs inspect <input…> [--json]
      Read Ignition exports and report what was found and read.
  oic-docs build <input…> --out <dir> [--pack <id>] [--config <file>] [--zip]
      Create (or refresh, keeping edits) a workspace with rendered exports.
  oic-docs build --workspace <dir>
      Re-render exports/ from an edited workspace.
  oic-docs validate <workspace>
      Check refs, statuses and assets. Exits 1 on errors.
  oic-docs mcp --workspace <dir>
      Serve the workspace to an AI agent over stdio (MCP).

Inputs: gateway backups (.gwbk), project exports (.zip or an unzipped folder)
and tag exports (.json). Packs: ${PACKS.map((p) => p.id).join(", ")}.
Nothing is sent anywhere; the original inputs are only read.
`;

function loadInputs(paths: string[]): (InputFile | InputTree)[] {
  return paths.map((p) => {
    const full = resolve(p);
    if (!existsSync(full)) throw new Error(`Not found: ${p}`);
    return statSync(full).isDirectory() ? { name: basename(full), tree: treeFromDir(full) } : { name: basename(full), bytes: new Uint8Array(readFileSync(full)) };
  });
}

const progress = (quiet: boolean) => (p: { message: string }) => {
  if (!quiet) process.stderr.write(`  ${p.message}\n`);
};

async function inspect(paths: string[], json: boolean) {
  const ev = await extract(loadInputs(paths), { onProgress: progress(json) });
  if (json) {
    process.stdout.write(`${JSON.stringify({ inputs: ev.inputs, coverage: ev.coverage, diagnostics: ev.diagnostics, unresolved: unresolved(ev).length }, null, 2)}\n`);
    return;
  }
  const kinds: Record<string, number> = {};
  for (const e of ev.entities) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  const out = [
    ...ev.inputs.map((i) => `${i.name}: ${i.format}${i.platformVersion ? ` (Ignition ${i.platformVersion})` : ""}`),
    "",
    "Found and read:",
    ...ev.coverage.map((c) => `  ${c.label.padEnd(46)} ${String(c.read).padStart(6)} / ${String(c.found).padEnd(6)} ${c.note ?? ""}`),
    "",
    `Entities: ${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(", ")}`,
    `Relationships: ${ev.relationships.length} (${unresolved(ev).length} unresolved, ${ev.relationships.filter((r) => r.dynamic).length} dynamic)`,
    ...ev.diagnostics.filter((d) => d.level !== "info").map((d) => `${d.level}: ${d.message}`),
  ];
  process.stdout.write(`${out.join("\n")}\n`);
}

function readConfig(path?: string): ToolkitConfig | undefined {
  return path ? sanitizeConfig(JSON.parse(readFileSync(resolve(path), "utf8"))) : undefined;
}

async function build(paths: string[], opts: { out?: string; pack?: string; config?: string; zip?: boolean; workspace?: string }) {
  if (opts.workspace) {
    const root = resolve(opts.workspace);
    const ws = readWorkspace(treeFromDir(root));
    const files = (await workspaceWithExports(ws)).filter((f) => f.path.startsWith("exports/"));
    writeFiles(root, files, (p) => p.startsWith("exports/"));
    process.stderr.write(`Rendered ${files.length} files into ${root}/exports\n`);
    report(validateWorkspace(ws));
    return;
  }
  if (!paths.length || !opts.out) throw new Error("build needs inputs and --out <dir> (or --workspace <dir>).");
  const out = resolve(opts.out);
  const previous: Workspace | undefined = existsSync(resolve(out, "manifest.json")) ? readWorkspace(treeFromDir(out)) : undefined;
  const config = { ...(readConfig(opts.config) ?? previous?.config ?? defaultConfig()) };
  if (opts.pack) {
    if (!PACKS.some((p) => p.id === opts.pack)) throw new Error(`Unknown pack ${opts.pack}. Choose one of: ${PACKS.map((p) => p.id).join(", ")}`);
    config.pack = opts.pack as PackId;
  }
  const evidence = await extract(loadInputs(paths), { onProgress: progress(false) });
  let document = buildDocument(evidence, config);
  if (previous) document = mergeDocument(document, previous.document);
  const ws: Workspace = { config, evidence, document, assets: previous?.assets ?? new Map() };
  const files = await workspaceWithExports(ws);
  writeFiles(out, files);
  if (opts.zip) writeFileSync(`${out}.zip`, zipFiles(files, `${basename(out)}/`));
  process.stderr.write(`${previous ? "Refreshed" : "Created"} workspace ${out} (${document.sections.length} sections)${opts.zip ? ` and ${out}.zip` : ""}\n`);
  report(validateWorkspace(ws));
}

function report(issues: ReturnType<typeof validateWorkspace>): boolean {
  for (const i of issues) process.stderr.write(`${i.level.padEnd(7)} ${i.section ? `[${i.section}] ` : ""}${i.message}\n`);
  return !issues.some((i) => i.level === "error");
}

async function main(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: "string" },
      pack: { type: "string" },
      config: { type: "string" },
      workspace: { type: "string" },
      zip: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  const [cmd, ...rest] = positionals;
  if (values.version) return void process.stdout.write(`${ENGINE_VERSION}\n`);
  if (!cmd || values.help) return void process.stdout.write(HELP);
  switch (cmd) {
    case "inspect":
      if (!rest.length) throw new Error("inspect needs at least one input file or folder.");
      return inspect(rest, !!values.json);
    case "build":
      return build(rest, values);
    case "validate": {
      const dir = rest[0] ?? values.workspace ?? ".";
      if (!report(validateWorkspace(readWorkspace(treeFromDir(resolve(dir)))))) process.exitCode = 1;
      else process.stderr.write("Workspace is valid.\n");
      return;
    }
    case "mcp":
      return serveMcp(values.workspace ?? rest[0] ?? ".");
    default:
      throw new Error(`Unknown command ${cmd}.\n\n${HELP}`);
  }
}

main(process.argv.slice(2)).catch((e: Error) => {
  process.stderr.write(`oic-docs: ${e.message}\n`);
  process.exitCode = 1;
});
