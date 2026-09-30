import type { ToolkitConfig } from "../config.ts";
import { REDACTED } from "../document/packs.ts";
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
  out.push({ path: "coverage.csv", content: toCsv(["Resource type", "Found", "Read", "Note"], ev.coverage.map((c) => [c.label, c.found, c.read, c.note])) });
  return out;
}
