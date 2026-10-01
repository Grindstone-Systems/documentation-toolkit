import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { treeFromMap, type FileTree } from "../lib/archive.ts";
import type { WorkspaceFile } from "../lib/workspace.ts";

/** Node helpers for the local extension: folders in and out, never following links outside the root. */

export function treeFromDir(dir: string, opts: { maxFiles?: number; maxBytes?: number } = {}): FileTree {
  const root = resolve(dir);
  const maxFiles = opts.maxFiles ?? 50_000;
  const maxBytes = opts.maxBytes ?? 512 * 1024 * 1024;
  const map = new Map<string, Uint8Array>();
  let total = 0;
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      if (name === "node_modules" || name === ".git") continue;
      const full = join(d, name);
      const st = lstatSync(full);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) {
        if (map.size >= maxFiles) throw new Error(`More than ${maxFiles} files under ${dir}.`);
        total += st.size;
        if (total > maxBytes) throw new Error(`Files under ${dir} exceed ${Math.round(maxBytes / 1024 / 1024)} MB.`);
        map.set(relative(root, full).split(sep).join("/"), new Uint8Array(readFileSync(full)));
      }
    }
  };
  walk(root);
  return treeFromMap(map);
}

/** Write files under `dir`, refusing any path that would land outside it. */
export function writeFiles(dir: string, files: WorkspaceFile[], only?: (path: string) => boolean) {
  const root = resolve(dir);
  for (const f of files) {
    if (only && !only(f.path)) continue;
    const target = resolve(root, f.path);
    if (target !== root && !target.startsWith(root + sep)) throw new Error(`Refusing to write outside the workspace: ${f.path}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.content);
  }
}
