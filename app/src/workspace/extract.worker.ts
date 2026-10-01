/// <reference lib="webworker" />
import { readZip, treeFromTexts } from "../../../lib/archive.ts";
import { extract, type InputFile, type InputTree } from "../../../lib/extract.ts";
import { readWorkspace } from "../../../lib/workspace.ts";
import type { FromWorker, ToWorker } from "./protocol.ts";

/**
 * Parsing runs here, off the UI thread. It reads the files the user picked
 * and posts evidence back; it has no network code and imports nothing that does.
 */

const post = (m: FromWorker) => (self as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    if (msg.type === "extract") {
      const t = performance.now();
      const inputs: (InputFile | InputTree)[] = [];
      for (const f of msg.files) inputs.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
      for (const t of msg.texts ?? []) inputs.push({ name: t.name, tree: treeFromTexts(t.files) });
      const evidence = await extract(inputs, { onProgress: (progress) => post({ type: "progress", progress }) });
      post({ type: "evidence", evidence, ms: Math.round(performance.now() - t) });
    } else if (msg.type === "open-workspace") {
      const { tree } = readZip(new Uint8Array(await msg.file.arrayBuffer()), () => true);
      post({ type: "workspace", workspace: readWorkspace(tree) });
    }
  } catch (err) {
    post({ type: "error", message: (err as Error).message });
  }
};
