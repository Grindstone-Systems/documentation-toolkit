import { useCallback, useEffect, useRef, useState } from "react";
import type { Progress } from "../../../lib/extract.ts";
import type { Evidence } from "../../../lib/types.ts";
import type { Workspace } from "../../../lib/workspace.ts";
import { newExtractWorker } from "./offline.ts";
import type { FromWorker, ToWorker } from "./protocol.ts";

export type ExtractState =
  | { phase: "idle" }
  | { phase: "working"; log: Progress[] }
  | { phase: "done"; ms: number }
  | { phase: "error"; message: string };

/** One worker per run, so a cancelled or failed run can't leak into the next. */
export function useExtractor(onEvidence: (ev: Evidence) => void, onWorkspace: (ws: Workspace) => void) {
  const [state, setState] = useState<ExtractState>({ phase: "idle" });
  const worker = useRef<Worker | null>(null);
  const runs = useRef(0);
  const handlers = useRef({ onEvidence, onWorkspace });
  handlers.current = { onEvidence, onWorkspace };

  const stop = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const run = useCallback(
    async (msg: ToWorker) => {
      stop();
      const run = ++runs.current;
      setState({ phase: "working", log: [] });
      const w = await newExtractWorker();
      // A newer run (or a cancel) started while this worker was being created.
      if (run !== runs.current) return void w.terminate();
      worker.current = w;
      w.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data;
        if (m.type === "progress") setState((s) => (s.phase === "working" ? { phase: "working", log: [...s.log.slice(-6), m.progress] } : s));
        else if (m.type === "evidence") {
          handlers.current.onEvidence(m.evidence);
          setState({ phase: "done", ms: m.ms });
          stop();
        } else if (m.type === "workspace") {
          handlers.current.onWorkspace(m.workspace);
          setState({ phase: "done", ms: 0 });
          stop();
        } else {
          setState({ phase: "error", message: m.message });
          stop();
        }
      };
      w.onerror = (e) => {
        setState({ phase: "error", message: e.message || "The file couldn't be processed." });
        stop();
      };
      w.postMessage(msg);
    },
    [stop],
  );

  const cancel = useCallback(() => {
    runs.current++;
    stop();
    setState({ phase: "idle" });
  }, [stop]);

  return { state, run, cancel };
}
