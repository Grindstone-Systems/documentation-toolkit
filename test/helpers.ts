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
