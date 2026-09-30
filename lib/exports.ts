import { renderDocx } from "./render/docx.ts";
import { workspaceFiles, type Workspace, type WorkspaceFile } from "./workspace.ts";

/**
 * A workspace with every rendered export, including Word. Kept apart from
 * workspace.ts so the browser only loads the DOCX library when it's needed.
 */
export async function workspaceWithExports(ws: Workspace): Promise<WorkspaceFile[]> {
  const files = workspaceFiles(ws, { exports: true });
  files.push({ path: "exports/reference.docx", content: await renderDocx(ws.document, ws.config, { assets: ws.assets }) });
  return files;
}

export { renderDocx };
