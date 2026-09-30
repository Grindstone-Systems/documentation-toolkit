import workerUrl from "./extract.worker.ts?worker&url";

/**
 * Once the app has loaded it must keep working without a network: the plan's
 * acceptance test processes files with the connection off. Lazily loaded
 * code is fetched up front, and the (self-contained) worker is held as a
 * blob URL so a new worker can start offline.
 */

let source: Promise<string> | undefined;

export function warmUp() {
  if (source) return;
  source = import.meta.env.PROD
    ? fetch(workerUrl)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then((b) => URL.createObjectURL(new Blob([b], { type: "text/javascript" })))
        .catch(() => workerUrl)
    : Promise.resolve(workerUrl);
  void import("./sample-data.ts").catch(() => {});
  void import("../../../lib/exports.ts").catch(() => {});
}

export async function newExtractWorker(): Promise<Worker> {
  warmUp();
  return new Worker(await source!, { type: "module" });
}
