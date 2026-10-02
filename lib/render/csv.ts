import type { ToolkitConfig } from "../config.ts";
import { REDACTED, sortedDisagreements } from "../document/packs.ts";
import type { Entity, Evidence, FieldValue } from "../types.ts";

/**
 * Inventory tables as CSV. Cells that a spreadsheet would treat as a formula
 * are prefixed with an apostrophe, so opening an export can't run anything.
 */

export function csvCell(v: FieldValue | undefined): string {
  let s = Array.isArray(v) ? v.join("; ") : v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (columns: string[], rows: (FieldValue | undefined)[][]) =>
  `﻿${[columns, ...rows].map((r) => r.map((c) => csvCell(c)).join(",")).join("\r\n")}\r\n`;

function value(cfg: ToolkitConfig, e: Entity, key: string): FieldValue | undefined {
  const s = e.sensitive?.[key];
  if ((s === "address" && cfg.redact.addresses) || (s === "username" && cfg.redact.usernames) || (s === "code" && cfg.redact.code)) return REDACTED;
  return e.fields[key];
}

export interface CsvFile {
  path: string;
  content: string;
}

export function inventoryCsvs(ev: Evidence, cfg: ToolkitConfig): CsvFile[] {
  const of = (k: Entity["kind"]) => ev.entities.filter((e) => e.kind === k);
  const out: CsvFile[] = [];
  const tags = of("tag");
  if (tags.length) {
    out.push({
      path: "tags.csv",
      content: toCsv(
        ["Provider", "Path", "Data type", "Value source", "OPC server", "OPC item path", "Expression", "Units", "UDT member of", "Source file"],
        tags.map((t) => [t.scope, t.path, t.fields.dataType, t.fields.valueSource, t.fields.opcServer, t.fields.opcItemPath, t.fields.expression, t.fields.engUnit, t.fields.definedIn, `${t.source.input}:${t.source.path}`]),
      ),
    });
  }
  const alarms = of("alarm");
  if (alarms.length) {
    out.push({
      path: "alarms.csv",
      content: toCsv(
        ["Tag", "Alarm", "Priority", "Mode", "Setpoint A", "Label", "Display path", "Defined in UDT"],
        alarms.map((a) => [a.fields.tag, a.name, a.fields.priority, a.fields.mode, a.fields.setpointA, a.fields.label, a.fields.displayPath, a.fields.definedIn]),
      ),
    });
  }
  const views = of("view");
  if (views.length) {
    out.push({
      path: "views.csv",
      content: toCsv(
        ["Project", "View", "Parameters", "Components", "Bindings", "Scripts", "Tag references", "Source file"],
        views.map((v) => [v.scope, v.path, v.fields.params, v.fields.components, v.fields.bindings, v.fields.scripts, ev.relationships.filter((r) => r.from === v.id && r.type === "binds-tag").length, v.source.path]),
      ),
    });
  }
  const qs = of("named-query");
  if (qs.length) {
    out.push({
      path: "named-queries.csv",
      content: toCsv(["Project", "Query", "Type", "Database", "Parameters", "Tables", "SQL"], qs.map((q) => [q.scope, q.path, q.fields.type, q.fields.database, q.fields.parameters, q.fields.tables, value(cfg, q, "sql")])),
    });
  }
  // Supplied evidence (oic.docs.supplement/v0): only when a host supplied it.
  const cite = (s: { input: string; path: string; at?: string }) => [s.input, s.path, s.at].filter(Boolean).join(", ");
  const readers = (id: string) => [...new Set(ev.relationships.filter((r) => r.type === "reads-plc-tag" && r.to === id).map((r) => r.from.replace(/^tag:/, "")))].sort();
  const plc = of("plc-tag");
  if (plc.length) {
    out.push({
      path: "plc-tags.csv",
      content: toCsv(
        ["Controller", "Program", "PLC tag", "Data type", "Tag type", "Alias for", "Description", "Read by (Ignition tags)", "Source"],
        plc.map((p) => [value(cfg, p, "controller"), value(cfg, p, "program"), p.name, value(cfg, p, "dataType"), value(cfg, p, "tagType"), value(cfg, p, "aliasFor"), value(cfg, p, "description"), readers(p.id), cite(p.source)]),
      ),
    });
  }
  const io = of("io-point");
  if (io.length) {
    const wired = (id: string) => [...new Set(ev.relationships.filter((r) => r.type === "wired-to" && r.from === id).map((r) => (r.to ? r.to.replace(/^plc-tag:/, "") : r.target)))];
    out.push({
      path: "io-points.csv",
      content: toCsv(
        ["Address", "Type", "Description", "Equipment", "PLC tag", "Source"],
        io.map((p) => [value(cfg, p, "address") ?? p.name, value(cfg, p, "type"), value(cfg, p, "description"), value(cfg, p, "equipment"), wired(p.id).length ? wired(p.id) : value(cfg, p, "tag"), cite(p.source)]),
      ),
    });
  }
  const ds = of("disagreement");
  if (ds.length) {
    const sides = (id: string) => ev.relationships.filter((r) => r.type === "concerns" && r.from === id);
    out.push({
      path: "disagreements.csv",
      content: toCsv(
        ["Kind", "Subject", "Disagreement", "Expected", "Address", "One side", "One side source", "Other side", "Other side source"],
        sortedDisagreements(ds).map((d) => {
          const [a, ...b] = sides(d.id);
          return [value(cfg, d, "kind"), value(cfg, d, "subject"), value(cfg, d, "text"), value(cfg, d, "expected"), value(cfg, d, "address"), a?.target, a ? cite(a.source) : undefined, b.map((r) => r.target), b.map((r) => cite(r.source))];
        }),
      ),
    });
  }
  out.push({ path: "coverage.csv", content: toCsv(["Resource type", "Found", "Read", "Note"], ev.coverage.map((c) => [c.label, c.found, c.read, c.note])) });
  return out;
}
