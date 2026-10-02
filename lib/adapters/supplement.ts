import type { Diagnostic, EntityKind, FieldValue, RelationshipType, Sensitivity, SourceRef } from "../types.ts";
import { clip, isSecretKey, type Collector } from "./collector.ts";

/**
 * Evidence a host supplies (`oic.docs.supplement/v0`): a PLC program and I/O
 * list it has already parsed, the disagreements it found between them and the
 * HMI, and facts from runtime history. The toolkit can't read those itself,
 * so the host hands them over already cited. A supplement only adds: it may
 * carry the five supplied kinds below and nothing that Ignition's own files
 * describe. Everything in it is untrusted and checked like any other input.
 * See docs/EVIDENCE.md.
 */

export const SUPPLEMENT_SCHEMA = "oic.docs.supplement/v0";

export const SUPPLIED_KINDS = ["controller", "plc-tag", "io-point", "disagreement", "runtime-fact"] as const satisfies readonly EntityKind[];
export const SUPPLIED_RELATIONSHIPS = ["reads-plc-tag", "wired-to", "concerns", "about"] as const satisfies readonly RelationshipType[];

type SuppliedKind = (typeof SUPPLIED_KINDS)[number];
type SuppliedRel = (typeof SUPPLIED_RELATIONSHIPS)[number];

const KIND_LABEL: Record<SuppliedKind, string> = {
  controller: "Controllers (supplied)",
  "plc-tag": "PLC tags (supplied)",
  "io-point": "I/O points (supplied)",
  disagreement: "PLC and HMI disagreements (supplied)",
  "runtime-fact": "Runtime facts (supplied)",
};

/** Which end of each supplied relationship must be which kind. */
const REL_ENDS: Record<SuppliedRel, { from: string; to?: string }> = {
  "reads-plc-tag": { from: "tag:", to: "plc-tag:" },
  "wired-to": { from: "io-point:", to: "plc-tag:" },
  concerns: { from: "disagreement:" },
  about: { from: "runtime-fact:" },
};

/** Kinds Ignition's own adapters produce. A supplement can't add or override them. */
const IGNITION_KINDS = new Set<string>(["gateway", "project", "page", "view", "style-class", "script", "event-script", "named-query", "tag-provider", "tag-folder", "tag", "udt-type", "udt-instance", "alarm", "opc-connection", "database-connection", "device", "user-source", "resource"]);

const IGNITION_REASON = "ignition-kind";
const LIMITS = { entities: 100_000, relationships: 200_000, coverage: 1_000, diagnostics: 1_000, fields: 40, listItems: 50 };
const SENSITIVITIES = new Set<Sensitivity>(["address", "username", "code"]);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? clip(v.replace(/[\u0000-\u001f\u007f]/g, " ").trim(), n) : undefined);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 512 && !/[\u0000-\u001f\u007f]/.test(v);

export function isSupplement(json: unknown): boolean {
  return isObj(json) && json.schema === SUPPLEMENT_SCHEMA;
}

function source(v: unknown): SourceRef | undefined {
  if (!isObj(v)) return undefined;
  const input = str(v.input, 200);
  if (!input) return undefined;
  const path = str(v.path, 400) ?? "";
  const at = str(v.at, 200);
  return at ? { input, path, at } : { input, path };
}

/** Keep only short scalar fields, never a credential. */
function readFields(raw: unknown, tally: { secrets: number; dropped: number }): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (isSecretKey(k)) {
      if (v !== null && v !== "" && v !== undefined) tally.secrets++;
      continue;
    }
    if (!/^[A-Za-z][\w.-]{0,63}$/.test(k) || Object.keys(out).length >= LIMITS.fields) {
      tally.dropped++;
      continue;
    }
    if (v === null || typeof v === "boolean") out[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "string") out[k] = clip(v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim(), 500);
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) out[k] = v.slice(0, LIMITS.listItems).map((x) => clip(x, 200));
    else tally.dropped++;
  }
  return out;
}

/** Read one supplement into the collector. `file` is where the supplement itself sits. */
export function collectSupplement(c: Collector, json: Record<string, unknown>, file: string) {
  const producer = str(json.producer, 80);
  const tally = { secrets: 0, dropped: 0, unsourced: 0 };
  // Refusals are reported once per reason, with how many and one example.
  const refused = new Map<string, { noun: "entity" | "relationship"; why: string; n: number; example: string; kinds: Set<string> }>();
  const refuse = (noun: "entity" | "relationship", why: string, example: string, kind?: string) => {
    const key = `${noun}|${why}`;
    const r = refused.get(key) ?? { noun, why, n: 0, example, kinds: new Set<string>() };
    r.n++;
    if (kind) r.kinds.add(kind);
    refused.set(key, r);
  };
  const fallback = c.src(file);

  /* ---- entities ---- */
  const rawEntities = Array.isArray(json.entities) ? json.entities : [];
  if (rawEntities.length > LIMITS.entities) {
    c.countMany("supplement.over-limit", "Supplied entities over the limit", rawEntities.length - LIMITS.entities, 0, `Only the first ${LIMITS.entities.toLocaleString()} supplied entities are read.`);
    c.diag("warning", "supplement-capped", `This supplement lists ${rawEntities.length.toLocaleString()} entities; only the first ${LIMITS.entities.toLocaleString()} were read.`, fallback);
  }
  const accepted = new Set<string>();
  for (const raw of rawEntities.slice(0, LIMITS.entities)) {
    const kind = isObj(raw) && typeof raw.kind === "string" ? raw.kind : "";
    const id = isObj(raw) ? raw.id : undefined;
    const label = isId(id) ? id : "(no id)";
    if (!(SUPPLIED_KINDS as readonly string[]).includes(kind)) {
      c.count("supplement.refused", "Supplied entities of other kinds", false, "A supplement can only add controllers, PLC tags, I/O points, disagreements and runtime facts.");
      if (IGNITION_KINDS.has(kind)) refuse("entity", IGNITION_REASON, label, kind);
      else refuse("entity", "of a kind a supplement can't carry", label, kind ? clip(kind, 40) : "none");
      continue;
    }
    const k = kind as SuppliedKind;
    const ok = (why: string) => {
      c.count(`supplement.${k}`, KIND_LABEL[k], false, "Some were refused; see the warnings.");
      refuse("entity", why, label);
    };
    if (!isObj(raw) || !isId(id) || !id.startsWith(`${k}:`) || id.length === k.length + 1) {
      ok(`whose id doesn't start with “${k}:”`);
      continue;
    }
    if (c.entities.has(id)) {
      c.add({ id, kind: k, name: id, source: source(raw.source) ?? fallback, fields: {} }); // records the duplicate-id diagnostic
      c.count(`supplement.${k}`, KIND_LABEL[k], false, "Some were refused; see the warnings.");
      continue;
    }
    const src = source(raw.source);
    if (!src) tally.unsourced++;
    const fields = readFields(raw.fields, tally);
    const sensitive: Record<string, Sensitivity> = {};
    if (isObj(raw.sensitive)) for (const [f, s] of Object.entries(raw.sensitive)) if (f in fields && SENSITIVITIES.has(s as Sensitivity)) sensitive[f] = s as Sensitivity;
    // Who made a change is a person's account name, so it is redactable like any username.
    if (k === "runtime-fact" && typeof fields.by === "string" && !sensitive.by) sensitive.by = "username";
    const path = str(raw.path, 400);
    const scope = str(raw.scope, 200);
    c.add({
      id,
      kind: k,
      name: str(raw.name, 200) ?? id.slice(k.length + 1),
      ...(path ? { path } : {}),
      ...(scope ? { scope } : {}),
      source: src ?? fallback,
      fields,
      ...(Object.keys(sensitive).length ? { sensitive } : {}),
      interpreted: raw.interpreted !== false,
    });
    accepted.add(id);
    c.count(`supplement.${k}`, KIND_LABEL[k], true);
  }

  /* ---- relationships ---- */
  const rawRels = Array.isArray(json.relationships) ? json.relationships : [];
  const relLabel = "Supplied relationships";
  if (rawRels.length > LIMITS.relationships) c.countMany("supplement.relationship", relLabel, rawRels.length - LIMITS.relationships, 0, `Only the first ${LIMITS.relationships.toLocaleString()} are read.`);
  let relRead = 0;
  let relRefused = 0;
  for (const raw of rawRels.slice(0, LIMITS.relationships)) {
    const type = isObj(raw) && typeof raw.type === "string" ? raw.type : "";
    const ends = REL_ENDS[type as SuppliedRel];
    const from = isObj(raw) ? raw.from : undefined;
    const to = isObj(raw) && isId(raw.to) ? raw.to : undefined;
    const target = (isObj(raw) && str(raw.target, 400)) || to;
    let why: string | undefined;
    if (!ends) why = `of type “${clip(type || "none", 40)}”, which a supplement can't add`;
    else if (!isId(from) || !from.startsWith(ends.from)) why = `of type “${type}” whose source isn't a ${ends.from.slice(0, -1)} id`;
    else if (ends.from !== "tag:" && !accepted.has(from)) why = `of type “${type}” from an entity this supplement doesn't contain`;
    else if (ends.to && to && !to.startsWith(ends.to)) why = `of type “${type}” whose target isn't a ${ends.to.slice(0, -1)} id`;
    else if (!target) why = `of type “${type}” with no target`;
    if (why || !isObj(raw) || !target || !isId(from)) {
      relRefused++;
      refuse("relationship", why ?? "that isn't well formed", isId(from) ? from : "(no source)");
      continue;
    }
    const src = source(raw.source);
    if (!src) tally.unsourced++;
    c.rel({ from, ...(to ? { to } : {}), type: type as SuppliedRel, target, explicit: raw.explicit !== false, ...(raw.dynamic === true ? { dynamic: true } : {}), source: src ?? fallback });
    relRead++;
  }
  if (relRead || relRefused) c.countMany("supplement.relationship", relLabel, relRead + relRefused, relRead, relRefused ? "Some were refused; see the warnings." : undefined);

  /* ---- coverage and diagnostics the host recorded ---- */
  const rawCoverage = Array.isArray(json.coverage) ? json.coverage : [];
  for (const raw of rawCoverage.slice(0, LIMITS.coverage)) {
    if (!isObj(raw)) continue;
    const key = str(raw.key, 100);
    const label = str(raw.label, 200);
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), 1e9) : undefined);
    const found = n(raw.found);
    if (!key || !label || found === undefined) continue;
    c.countMany(key, label, found, Math.min(n(raw.read) ?? 0, found), str(raw.note, 500));
  }
  const rawDiags = Array.isArray(json.diagnostics) ? json.diagnostics : [];
  for (const raw of rawDiags.slice(0, LIMITS.diagnostics)) {
    if (!isObj(raw)) continue;
    const message = str(raw.message, 500);
    if (!message) continue;
    const level: Diagnostic["level"] = raw.level === "warning" || raw.level === "error" ? raw.level : "info";
    const code = typeof raw.code === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(raw.code) ? raw.code : "supplied";
    c.diag(level, code, message, source(raw.source));
  }

  /* ---- what was refused, said once per reason ---- */
  for (const r of [...refused.values()].sort((a, b) => a.noun.localeCompare(b.noun) || a.why.localeCompare(b.why))) {
    const nouns = r.n === 1 ? r.noun : r.noun === "entity" ? "entities" : "relationships";
    const kinds = r.kinds.size ? ` (${[...r.kinds].sort().join(", ")})` : "";
    const why = r.why === IGNITION_REASON ? `of an Ignition kind${kinds}: a supplement adds evidence and never overrides what Ignition's own files say` : `${r.why}${kinds}`;
    c.diag("warning", r.why === IGNITION_REASON ? "supplement-kind-refused" : "supplement-refused", `Refused ${r.n.toLocaleString()} supplied ${nouns} ${why} (for example “${clip(r.example, 120)}”).`, fallback);
  }
  if (tally.secrets) c.diag("info", "secrets-excluded", `${tally.secrets} credential value${tally.secrets > 1 ? "s were" : " was"} found in supplied evidence and excluded. Credentials are never read into documentation.`);
  if (tally.dropped) c.diag("info", "supplement-fields-dropped", `${tally.dropped} supplied field${tally.dropped > 1 ? "s weren't" : " wasn't"} a short value or list and ${tally.dropped > 1 ? "were" : "was"} left out.`, fallback);
  if (tally.unsourced) c.diag("info", "supplement-unsourced", `${tally.unsourced} supplied item${tally.unsourced > 1 ? "s" : ""} named no source document, so ${tally.unsourced > 1 ? "they cite" : "it cites"} the supplement itself.`, fallback);
  c.diag("info", "supplement-read", `Evidence supplied${producer ? ` by ${producer}` : ""}: ${accepted.size.toLocaleString()} item${accepted.size === 1 ? "" : "s"} and ${relRead.toLocaleString()} relationship${relRead === 1 ? "" : "s"}, each citing the document it came from.`, fallback);
}
