import { strFromU8, unzipSync, type UnzipFileInfo } from "fflate";

/**
 * Bounded archive reading. Inputs are untrusted: entry counts, sizes and
 * paths are checked before anything is decompressed, and nothing is ever
 * written to disk or executed. See docs/PRIVACY.md.
 */

export interface ArchiveLimits {
  /** Entries listed in the central directory. */
  maxEntries: number;
  /** Largest single entry we will decompress, in bytes. */
  maxEntryBytes: number;
  /** Total decompressed bytes across the entries we read. */
  maxTotalBytes: number;
}

export const DEFAULT_LIMITS: ArchiveLimits = {
  maxEntries: 250_000,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 768 * 1024 * 1024,
};

export class InputError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ArchiveEntry {
  path: string;
  /** Declared uncompressed size. */
  size: number;
}

/** A read-only view over files, from a ZIP or an already expanded folder. */
export interface FileTree {
  /** Every file path, including ones we chose not to read. */
  entries: ArchiveEntry[];
  has(path: string): boolean;
  bytes(path: string): Uint8Array | undefined;
  text(path: string): string | undefined;
  json<T = unknown>(path: string): T | undefined;
}

/** Normalise an entry name; returns undefined for anything unsafe or a directory. */
export function normalizePath(name: string): string | undefined {
  if (name.includes("\0")) return undefined;
  const parts = name.replace(/\\/g, "/").split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") return undefined;
    out.push(p);
  }
  if (!out.length || name.endsWith("/")) return undefined;
  return out.join("/");
}

export const isZip = (b: Uint8Array) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) && (b[3] === 4 || b[3] === 6);

/** List entries without decompressing anything. */
export function listZip(data: Uint8Array, limits: ArchiveLimits = DEFAULT_LIMITS): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  try {
    unzipSync(data, {
      filter: (f: UnzipFileInfo) => {
        if (entries.length >= limits.maxEntries) throw new InputError("too-many-entries", `This archive has more than ${limits.maxEntries.toLocaleString()} entries.`);
        const path = normalizePath(f.name);
        if (path) entries.push({ path, size: f.originalSize });
        return false;
      },
    });
  } catch (e) {
    if (e instanceof InputError) throw e;
    throw new InputError("bad-archive", "This file isn't a readable ZIP archive. It may be truncated or damaged.");
  }
  return entries;
}

/**
 * Decompress only the entries `want` selects, within the limits. Entries
 * over the per-entry limit are skipped and reported through `skipped`.
 */
export function readZip(
  data: Uint8Array,
  want: (path: string, size: number) => boolean,
  limits: ArchiveLimits = DEFAULT_LIMITS,
): { tree: FileTree; skipped: ArchiveEntry[] } {
  const entries = listZip(data, limits);
  const skipped: ArchiveEntry[] = [];
  let total = 0;
  const pathOf = new Map<string, string>();
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter: (f) => {
        const path = normalizePath(f.name);
        if (!path || !want(path, f.originalSize)) return false;
        if (f.originalSize > limits.maxEntryBytes) {
          skipped.push({ path, size: f.originalSize });
          return false;
        }
        total += f.originalSize;
        if (total > limits.maxTotalBytes)
          throw new InputError("too-large", `The selected resources expand to more than ${Math.round(limits.maxTotalBytes / 1024 / 1024)} MB.`);
        pathOf.set(f.name, path);
        return true;
      },
    });
  } catch (e) {
    if (e instanceof InputError) throw e;
    throw new InputError("bad-archive", "Part of this archive couldn't be decompressed. It may be truncated or damaged.");
  }
  const map = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(files)) {
    const path = pathOf.get(name);
    // Declared sizes can lie; check what actually came out.
    if (!path || bytes.length > limits.maxEntryBytes) continue;
    map.set(path, bytes);
  }
  return { tree: treeFromMap(map, entries), skipped };
}

export function treeFromMap(map: Map<string, Uint8Array>, entries?: ArchiveEntry[]): FileTree {
  const list = entries ?? [...map].map(([path, b]) => ({ path, size: b.length }));
  const known = new Set(list.map((e) => e.path));
  const text = (p: string) => {
    const b = map.get(p);
    return b ? strFromU8(b).replace(/^﻿/, "") : undefined;
  };
  return {
    entries: list,
    has: (p) => known.has(p),
    bytes: (p) => map.get(p),
    text,
    json: <T>(p: string) => {
      const t = text(p);
      if (t === undefined) return undefined;
      try {
        return JSON.parse(t) as T;
      } catch {
        return undefined;
      }
    },
  };
}

/** Build a tree from plain text files, e.g. the bundled sample or tests. */
export function treeFromTexts(files: Record<string, string>): FileTree {
  const enc = new TextEncoder();
  const map = new Map<string, Uint8Array>();
  for (const [p, t] of Object.entries(files)) {
    const path = normalizePath(p);
    if (path) map.set(path, enc.encode(t));
  }
  return treeFromMap(map);
}

export async function sha256(data: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Small, synchronous fingerprint for change detection (not security). */
export function fingerprint(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}
