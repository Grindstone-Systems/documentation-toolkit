import type { CoverageItem, Diagnostic, Entity, FieldValue, Relationship, Sensitivity, SourceRef } from "../types.ts";

/** Accumulates evidence from one input; adapters only ever append. */
export class Collector {
  readonly entities = new Map<string, Entity>();
  readonly relationships: Relationship[] = [];
  readonly diagnostics: Diagnostic[] = [];
  private readonly coverage = new Map<string, CoverageItem>();

  constructor(readonly input: string) {}

  src(path: string, at?: string): SourceRef {
    return at ? { input: this.input, path, at } : { input: this.input, path };
  }

  add(e: Omit<Entity, "source" | "interpreted"> & { source?: SourceRef; interpreted?: boolean; file?: string }): Entity {
    const { file, ...rest } = e;
    const entity: Entity = { interpreted: true, ...rest, source: e.source ?? this.src(file ?? "") };
    if (this.entities.has(entity.id)) {
      this.diag("info", "duplicate-id", `Two resources resolve to “${entity.id}”; the first one is kept.`, entity.source);
      return this.entities.get(entity.id)!;
    }
    this.entities.set(entity.id, entity);
    return entity;
  }

  rel(r: Relationship) {
    this.relationships.push(r);
  }

  diag(level: Diagnostic["level"], code: string, message: string, source?: SourceRef) {
    this.diagnostics.push(source ? { level, code, message, source } : { level, code, message });
  }

  /** Count one resource of a type as found, and whether we could read it. */
  count(key: string, label: string, read: boolean, note?: string) {
    const c = this.coverage.get(key) ?? { key, label, found: 0, read: 0 };
    c.found++;
    if (read) c.read++;
    if (note && !c.note) c.note = note;
    this.coverage.set(key, c);
  }

  /** Count many at once, e.g. a skipped folder. */
  countMany(key: string, label: string, found: number, read: number, note?: string) {
    const c = this.coverage.get(key) ?? { key, label, found: 0, read: 0 };
    c.found += found;
    c.read += read;
    if (note && !c.note) c.note = note;
    this.coverage.set(key, c);
  }

  coverageItems(): CoverageItem[] {
    return [...this.coverage.values()];
  }
}

/* ------------------------------ secrets ------------------------------ */

const SECRET_KEY = /pass(word|phrase)?|secret|token|api[-_]?key|private|credential|ciphertext|encrypted|keystore|certificate|pfx|salt|hash/i;
const ADDRESS_KEY = /(url|uri|host|hostname|address|endpoint|^ip|^port)$/i;
const USER_KEY = /user(name)?$|login|account/i;

export const isSecretKey = (k: string) => SECRET_KEY.test(k);

/** An Ignition embedded secret looks like { type: "Embedded", data: { ciphertext… } }. */
const looksEncrypted = (v: unknown) =>
  typeof v === "object" && v !== null && ("ciphertext" in v || "encrypted_key" in v || ((v as { type?: unknown }).type === "Embedded" && "data" in v));

/**
 * Flatten configuration into a few scalar fields for documentation. Secret
 * values are dropped entirely (counted in `excluded`), and addresses and
 * usernames are marked so the export can redact them.
 */
export function flattenSettings(
  obj: unknown,
  opts: { maxFields?: number; prefix?: string } = {},
): { fields: Record<string, FieldValue>; sensitive: Record<string, Sensitivity>; excluded: number } {
  const fields: Record<string, FieldValue> = {};
  const sensitive: Record<string, Sensitivity> = {};
  let excluded = 0;
  const max = opts.maxFields ?? 40;
  const walk = (v: unknown, rawKey: string, depth: number) => {
    // Ignition wraps config in profile/settings; the wrapper adds nothing for readers.
    const key = rawKey.replace(/^(settings|profile)\./, "");
    const leaf = key.split(".").pop() ?? key;
    if (key && (isSecretKey(leaf) || looksEncrypted(v))) {
      if (v !== null && v !== "" && v !== undefined) excluded++;
      return;
    }
    // Tuning parameters crowd out what a reader needs; secrets inside are still counted above.
    if (/(^|\.)advanced$/.test(key) || key in fields || Object.keys(fields).length >= max) {
      if (typeof v === "object" && v !== null) countSecrets(v);
      return;
    }
    if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      if (v === "" || v === null) return;
      fields[key] = typeof v === "string" ? clip(v, 240) : v;
      if (ADDRESS_KEY.test(leaf) && typeof v === "string") sensitive[key] = "address";
      else if (USER_KEY.test(leaf) && typeof v === "string") sensitive[key] = "username";
      return;
    }
    if (Array.isArray(v)) {
      if (v.every((x) => typeof x === "string" || typeof x === "number") && v.length) fields[key] = v.slice(0, 12).map(String);
      return;
    }
    if (typeof v === "object" && depth < 4) {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, rawKey ? `${rawKey}.${k}` : k, depth + 1);
    }
  };
  const countSecrets = (v: unknown, depth = 0): void => {
    if (!v || typeof v !== "object" || depth > 6) return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if ((isSecretKey(k) || looksEncrypted(x)) && x !== null && x !== "") excluded++;
      else countSecrets(x, depth + 1);
    }
  };
  walk(obj, opts.prefix ?? "", 0);
  return { fields, sensitive, excluded };
}

export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Stringify an Ignition value that may be a binding object rather than a literal. */
export function asText(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && "binding" in (v as object)) return `{${String((v as { binding: unknown }).binding)}}`;
  return undefined;
}
