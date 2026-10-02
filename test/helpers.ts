import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { treeFromDir } from "../cli/fs.ts";
import { extract, type InputFile, type InputTree } from "../lib/extract.ts";

/** Shared test inputs. Everything here is synthetic; see fixtures/sample/README.md. */

export const FIXTURES = fileURLToPath(new URL("../fixtures/sample/", import.meta.url));

export function sampleInputs(): (InputFile | InputTree)[] {
  return [
    { name: "Riverbend", tree: treeFromDir(`${FIXTURES}riverbend-project`) },
    { name: "riverbend-tags.json", bytes: new Uint8Array(readFileSync(`${FIXTURES}riverbend-tags.json`)) },
  ];
}

export const sampleEvidence = () => extract(sampleInputs());

const enc = new TextEncoder();
export function zipOf(files: Record<string, string | Uint8Array>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? enc.encode(v) : v])));
}

/** The sample project zipped the way the Designer exports it. */
export function sampleProjectZip(): Uint8Array {
  const tree = treeFromDir(`${FIXTURES}riverbend-project`);
  return zipOf(Object.fromEntries(tree.entries.map((e) => [e.path, tree.bytes(e.path)!])));
}

/* ---------------- a host's supplement (oic.docs.supplement/v0) ---------------- */

const WINDOW = { windowFrom: "2026-09-01T00:00:00Z", windowTo: "2026-10-01T00:00:00Z" };
const L5X = (path: string, at?: string) => ({ input: "line1-controller.L5X", path, ...(at ? { at } : {}) });
const IO = (row: number) => ({ input: "line1-io-list.xlsx", path: "I/O", at: `row ${row}` });
const TAGS = (path: string) => ({ input: "riverbend-tags.json", path });

/**
 * A synthetic supplement for the Riverbend sample, as a host such as FATE
 * would write it: a fictional PLC_Pumps program and I/O list, one
 * disagreement of each kind, and runtime facts about real sample entities.
 * It also plants things a supplement must not get through: a credential, an
 * entity of an Ignition kind, a bad id and a relationship type it can't add.
 */
export function sampleSupplementJson(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "oic.docs.supplement/v0",
    producer: "FATE",
    entities: [
      {
        id: "controller:PLC_Pumps",
        kind: "controller",
        name: "PLC_Pumps",
        source: L5X("Controller[@Name='PLC_Pumps']", "line 12"),
        fields: { processorType: "1756-L83E", softwareRevision: "35.11", tags: 3, password: "SUPPLEMENT-NOT-A-REAL-SECRET", apiKey: "supplement-key-never-shown", nested: { deep: true } },
      },
      { id: "plc-tag:PLC_Pumps/Pump", kind: "plc-tag", name: "Pump", source: L5X("Controller/Tags/Tag[@Name='Pump']", "line 40"), fields: { controller: "PLC_Pumps", dataType: "Pump_UDT[3]", tagType: "Base", description: "Pump station drives" } },
      { id: "plc-tag:PLC_Pumps/Clearwell", kind: "plc-tag", name: "Clearwell", source: L5X("Controller/Tags/Tag[@Name='Clearwell']", "line 61"), fields: { controller: "PLC_Pumps", dataType: "Tank_UDT", tagType: "Base", description: "Clearwell level and alarms" } },
      { id: "plc-tag:PLC_Pumps/Program:MainProgram.P101_SpeedRef", kind: "plc-tag", name: "Program:MainProgram.P101_SpeedRef", source: L5X("Programs/Program[@Name='MainProgram']/Tags", "line 210"), fields: { controller: "PLC_Pumps", program: "MainProgram", dataType: "REAL", tagType: "Base" } },
      { id: "io-point:Local:1:I.Data.0", kind: "io-point", name: "Local:1:I.Data.0", source: IO(4), fields: { address: "Local:1:I.Data.0", tag: "Pump[0].Running", type: "DI", description: "P101 running feedback", equipment: "P101" } },
      { id: "io-point:Local:2:I.Ch0Data", kind: "io-point", name: "Local:2:I.Ch0Data", source: IO(7), fields: { address: "Local:2:I.Ch0Data", tag: "Clearwell.Level", type: "AI", description: "Clearwell level transmitter", equipment: "Clearwell" } },
      { id: "io-point:Local:3:O.Data.4", kind: "io-point", name: "Local:3:O.Data.4", source: IO(9), fields: { address: "Local:3:O.Data.4", tag: "Pump[3].CmdStart", type: "DO", description: "P104 start command", equipment: "P104" } },
      { id: "disagreement:renamed:Pump[1].SpeedPct", kind: "disagreement", name: "Pump[1].SpeedPct", source: L5X("DataType[@Name='Pump_UDT']", "line 88"), fields: { kind: "renamed", text: "The HMI reads Pump[1].SpeedPct but the PLC program names the member SpeedPercent.", subject: "Pump[1].SpeedPct", expected: "Pump[1].SpeedPercent" } },
      { id: "disagreement:io-without-plc:Local:3:O.Data.4", kind: "disagreement", name: "Local:3:O.Data.4", source: IO(9), fields: { kind: "io-without-plc", text: "The I/O list wires Local:3:O.Data.4 to Pump[3].CmdStart, which the PLC program doesn't define.", subject: "Local:3:O.Data.4", address: "Local:3:O.Data.4" } },
      { id: "disagreement:ignition-without-plc:[default]Riverbend/Intake/RawFlow", kind: "disagreement", name: "RawFlow", source: TAGS("Riverbend/Intake/RawFlow"), fields: { kind: "ignition-without-plc", text: "The Ignition tag RawFlow reads [PLC_Intake]RawWater.Flow, but no program for PLC_Intake was supplied.", subject: "[default]Riverbend/Intake/RawFlow" } },
      { id: "disagreement:alarm-missing:Clearwell.LowLow", kind: "disagreement", name: "Clearwell.LowLow", source: L5X("Controller/Tags/Tag[@Name='Clearwell']", "line 66"), fields: { kind: "alarm-missing", text: "The PLC program raises Clearwell.LowLow, but no Ignition alarm watches it.", subject: "Clearwell.LowLow" } },
      { id: "runtime-fact:alarm-activations:alarm:[default]Riverbend/Pumps/P101/Fault#Pump Fault", kind: "runtime-fact", name: "Pump Fault activations", source: { input: "alarm journal", path: "alarm_events", at: "2026-09" }, fields: { metric: "alarm-activations", ...WINDOW, activations: 12, perDay: 0.4, complete: true } },
      { id: "runtime-fact:alarm-activations:alarm:[default]Riverbend/Clearwell/Level#Low Level", kind: "runtime-fact", name: "Low Level activations", source: { input: "alarm journal", path: "alarm_events", at: "2026-09" }, fields: { metric: "alarm-activations", ...WINDOW, activations: 12, perDay: 0.4, complete: true } },
      { id: "runtime-fact:alarm-activations:alarm:[default]Riverbend/Filters/Filter1/Turbidity#High Turbidity", kind: "runtime-fact", name: "High Turbidity activations", source: { input: "alarm journal", path: "alarm_events", at: "2026-09" }, fields: { metric: "alarm-activations", ...WINDOW, activations: 31, perDay: 1.03, complete: false } },
      { id: "runtime-fact:normal-range:tag:[default]Riverbend/Clearwell/Level", kind: "runtime-fact", name: "Clearwell level range", source: { input: "tag history", path: "Riverbend/Clearwell/Level" }, fields: { metric: "normal-range", ...WINDOW, min: 2.1, p05: 2.4, median: 3.6, p95: 4.4, max: 4.7, samples: 43200, unit: "m" } },
      { id: "runtime-fact:last-change:view:Riverbend/Pumps/PumpStation", kind: "runtime-fact", name: "PumpStation last change", source: { input: "audit log", path: "audit_events", at: "id 5512" }, fields: { metric: "last-change", ...WINDOW, at: "2026-09-21T14:02:00Z", by: "jdoe", action: "Saved view" } },
      // Things a supplement may not carry.
      { id: "tag:[default]Riverbend/Plant/Mode", kind: "tag", name: "Mode", source: TAGS("x"), fields: { dataType: "String", documentation: "OVERRIDDEN BY SUPPLEMENT" } },
      { id: "alarm:[default]Riverbend/Clearwell/Level#Low Low Level", kind: "alarm", name: "Low Low Level", source: TAGS("x"), fields: {} },
      { id: "plc:PLC_Filters", kind: "controller", name: "PLC_Filters", source: L5X("x"), fields: {} },
    ],
    relationships: [
      { from: "tag:[default]Riverbend/Pumps/P101/Running", to: "plc-tag:PLC_Pumps/Pump", type: "reads-plc-tag", target: "Pump[0].Running", explicit: true, source: TAGS("Riverbend/Pumps/P101/Running") },
      { from: "tag:[default]Riverbend/Pumps/P102/Running", to: "plc-tag:PLC_Pumps/Pump", type: "reads-plc-tag", target: "Pump[1].Running", explicit: true, source: TAGS("Riverbend/Pumps/P102/Running") },
      { from: "tag:[default]Riverbend/Clearwell/Level", to: "plc-tag:PLC_Pumps/Clearwell", type: "reads-plc-tag", target: "Clearwell.Level", explicit: true, source: TAGS("Riverbend/Clearwell/Level") },
      { from: "io-point:Local:1:I.Data.0", to: "plc-tag:PLC_Pumps/Pump", type: "wired-to", target: "Pump[0].Running", explicit: true, source: IO(4) },
      { from: "io-point:Local:2:I.Ch0Data", to: "plc-tag:PLC_Pumps/Clearwell", type: "wired-to", target: "Clearwell.Level", explicit: true, source: IO(7) },
      { from: "io-point:Local:3:O.Data.4", type: "wired-to", target: "Pump[3].CmdStart", explicit: true, source: IO(9) },
      { from: "disagreement:renamed:Pump[1].SpeedPct", to: "tag:[default]Riverbend/Pumps/P102/Speed", type: "concerns", target: "[default]Riverbend/Pumps/P102/Speed", explicit: true, source: TAGS("Riverbend/Pumps/P102/Speed") },
      { from: "disagreement:renamed:Pump[1].SpeedPct", to: "plc-tag:PLC_Pumps/Pump", type: "concerns", target: "PLC_Pumps/Pump", explicit: true, source: L5X("DataType[@Name='Pump_UDT']", "line 88") },
      { from: "disagreement:io-without-plc:Local:3:O.Data.4", to: "io-point:Local:3:O.Data.4", type: "concerns", target: "Local:3:O.Data.4", explicit: true, source: IO(9) },
      { from: "disagreement:io-without-plc:Local:3:O.Data.4", type: "concerns", target: "Pump[3].CmdStart", explicit: true, source: L5X("Controller/Tags", "line 38") },
      { from: "disagreement:ignition-without-plc:[default]Riverbend/Intake/RawFlow", to: "tag:[default]Riverbend/Intake/RawFlow", type: "concerns", target: "[default]Riverbend/Intake/RawFlow", explicit: true, source: TAGS("Riverbend/Intake/RawFlow") },
      { from: "disagreement:ignition-without-plc:[default]Riverbend/Intake/RawFlow", type: "concerns", target: "[PLC_Intake]RawWater.Flow", explicit: true, source: { input: "line1-controller.L5X", path: "Controller[@Name='PLC_Pumps']" } },
      { from: "disagreement:alarm-missing:Clearwell.LowLow", to: "plc-tag:PLC_Pumps/Clearwell", type: "concerns", target: "PLC_Pumps/Clearwell", explicit: true, source: L5X("Controller/Tags/Tag[@Name='Clearwell']", "line 66") },
      { from: "disagreement:alarm-missing:Clearwell.LowLow", to: "alarm:[default]Riverbend/Clearwell/Level#Low Low Level", type: "concerns", target: "[default]Riverbend/Clearwell/Level#Low Low Level", explicit: true, source: TAGS("Riverbend/Clearwell/Level") },
      { from: "runtime-fact:alarm-activations:alarm:[default]Riverbend/Pumps/P101/Fault#Pump Fault", to: "alarm:[default]Riverbend/Pumps/P101/Fault#Pump Fault", type: "about", target: "[default]Riverbend/Pumps/P101/Fault#Pump Fault", explicit: true, source: { input: "alarm journal", path: "alarm_events" } },
      { from: "runtime-fact:alarm-activations:alarm:[default]Riverbend/Clearwell/Level#Low Level", to: "alarm:[default]Riverbend/Clearwell/Level#Low Level", type: "about", target: "[default]Riverbend/Clearwell/Level#Low Level", explicit: true, source: { input: "alarm journal", path: "alarm_events" } },
      { from: "runtime-fact:alarm-activations:alarm:[default]Riverbend/Filters/Filter1/Turbidity#High Turbidity", to: "alarm:[default]Riverbend/Filters/Filter1/Turbidity#High Turbidity", type: "about", target: "[default]Riverbend/Filters/Filter1/Turbidity#High Turbidity", explicit: true, source: { input: "alarm journal", path: "alarm_events" } },
      { from: "runtime-fact:normal-range:tag:[default]Riverbend/Clearwell/Level", to: "tag:[default]Riverbend/Clearwell/Level", type: "about", target: "[default]Riverbend/Clearwell/Level", explicit: true, source: { input: "tag history", path: "Riverbend/Clearwell/Level" } },
      { from: "runtime-fact:last-change:view:Riverbend/Pumps/PumpStation", to: "view:Riverbend/Pumps/PumpStation", type: "about", target: "Riverbend/Pumps/PumpStation", explicit: true, source: { input: "audit log", path: "audit_events" } },
      // A type a supplement can't add.
      { from: "view:Riverbend/Overview", to: "tag:[default]Riverbend/Plant/Mode", type: "binds-tag", target: "[default]Riverbend/Plant/Mode", explicit: true, source: TAGS("x") },
    ],
    coverage: [{ key: "fate.l5x", label: "L5X programs (FATE)", found: 1, read: 1 }],
    diagnostics: [{ level: "info", code: "fate-note", message: "Compared by FATE against the line 1 program." }],
    ...over,
  };
}

export const supplementFile = (json: unknown = sampleSupplementJson(), name = "supplement.json"): InputFile => ({ name, bytes: enc.encode(JSON.stringify(json)) });

export const sampleWithSupplement = (json?: unknown) => extract([...sampleInputs(), supplementFile(json)]);
