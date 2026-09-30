import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../lib/config.ts";
import { buildDocument } from "../lib/document/packs.ts";
import { workspaceFiles } from "../lib/workspace.ts";
import { sampleEvidence } from "../test/helpers.ts";
import { writeFiles } from "./fs.ts";
import { createMcpHandler } from "./mcp.ts";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

async function workspaceDir() {
  const dir = mkdtempSync(join(tmpdir(), "oic-docs-"));
  dirs.push(dir);
  const evidence = await sampleEvidence();
  const config = defaultConfig();
  writeFiles(dir, workspaceFiles({ config, evidence, document: buildDocument(evidence, config), assets: new Map() }));
  return dir;
}

let n = 0;
const call = async (handle: ReturnType<typeof createMcpHandler>, name: string, args: Record<string, unknown> = {}) => {
  const res = (await handle({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } })) as { result: { content: { text: string }[]; isError?: boolean } };
  return { text: res.result.content[0]!.text, isError: !!res.result.isError };
};

describe("MCP server", () => {
  it("speaks the handshake and lists tools", async () => {
    const handle = createMcpHandler(await workspaceDir());
    const init = (await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })) as { result: { protocolVersion: string; capabilities: object } };
    expect(init.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} } });
    expect(await handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined();
    const list = (await handle({ jsonrpc: "2.0", id: 2, method: "tools/list" })) as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map((t) => t.name)).toEqual(["overview", "search_evidence", "get_entity", "trace_relationships", "check_coverage", "read_section", "write_section", "validate", "build_pack"]);
  });

  it("finds and traces evidence", async () => {
    const handle = createMcpHandler(await workspaceDir());
    const found = JSON.parse((await call(handle, "search_evidence", { query: "PumpStation", kind: "view" })).text);
    expect(found.results[0].id).toBe("view:Riverbend/Pumps/PumpStation");
    const trace = JSON.parse((await call(handle, "trace_relationships", { id: "page:Riverbend/pumps", depth: 2 })).text);
    expect(trace.edges.some((e: { to: string }) => e.to === "view:Riverbend/Components/PumpTile")).toBe(true);
  });

  it("writes only honest drafts, only inside the workspace", async () => {
    const dir = await workspaceDir();
    const handle = createMcpHandler(dir);
    const confirmed = await call(handle, "write_section", { id: "scripts", markdown: "---\nid: scripts\ntitle: Scripts\nstatus: confirmed\norigin: agent\n---\n\nHi\n" });
    expect(confirmed.isError).toBe(true);
    const bad = await call(handle, "write_section", { id: "../../etc", markdown: "x" });
    expect(bad.isError).toBe(true);
    const ok = await call(handle, "write_section", {
      id: "scripts",
      markdown: "---\nid: scripts\ntitle: Scripts\nstatus: ai-draft\norigin: agent\n---\n\nThe pumps module starts and stops pumps.\n<!-- refs: script:Riverbend/riverbend.pumps -->\n",
    });
    expect(ok.isError).toBe(false);
    const written = JSON.parse(ok.text);
    expect(written.issues).toEqual([]);
    expect(readFileSync(join(dir, written.written), "utf8")).toContain("starts and stops pumps");
    const section = await call(handle, "read_section", { id: "scripts" });
    expect(section.text).toContain("status: ai-draft");
  });

  it("builds exports", async () => {
    const dir = await workspaceDir();
    const res = JSON.parse((await call(createMcpHandler(dir), "build_pack")).text);
    expect(res.written).toEqual(expect.arrayContaining(["exports/reference.html", "exports/reference.docx", "exports/tags.csv"]));
    expect(readFileSync(join(dir, "exports/reference.html"), "utf8")).toContain("<!doctype html>");
  });

  it("reports unknown tools and methods", async () => {
    const handle = createMcpHandler(await workspaceDir());
    expect(await handle({ jsonrpc: "2.0", id: 9, method: "nope" })).toMatchObject({ error: { code: -32601 } });
    expect(await handle({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "nope" } })).toMatchObject({ error: { code: -32602 } });
  });
});
