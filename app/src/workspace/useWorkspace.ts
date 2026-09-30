import { useCallback } from "react";
import { loadSample } from "./sample.ts";
import { useSession } from "./session.ts";
import { useExtractor } from "./useExtractor.ts";

/** Files the open screens accept. */
export const ACCEPT = ".gwbk,.zip,.json";

const isWorkspaceZip = (f: File) => /workspace.*\.zip$|\.oicdocs\.zip$/i.test(f.name);

/**
 * The session plus the extractor that fills it. Lives at the app root so the
 * home screen can start a run and the workspace can pick it up.
 */
export function useWorkspace(notify: (m: string) => void) {
  const api = useSession();
  const { session, setSession, openWorkspace, reset: resetSession } = api;

  const extractor = useExtractor(
    (evidence) => setSession((s) => ({ ...s, evidence })),
    (ws) => {
      openWorkspace(ws);
      notify("Workspace reopened. Your edits are kept.");
    },
  );

  const runFiles = useCallback(
    async (files: File[], sample: boolean) => {
      const texts = sample ? await loadSample() : undefined;
      setSession((s) => ({ ...s, files, sample }));
      extractor.run({
        type: "extract",
        files,
        texts: texts
          ? [
              { name: "Riverbend", files: texts.project },
              { name: "riverbend-tags.json", files: texts.tags },
            ]
          : undefined,
      });
    },
    [extractor, setSession],
  );

  /** Add inputs to the current set; a lone saved workspace reopens instead. */
  const addFiles = useCallback(
    (list: FileList | File[]) => {
      const incoming = [...list];
      if (!incoming.length) return;
      if (incoming.length === 1 && isWorkspaceZip(incoming[0]!)) {
        extractor.run({ type: "open-workspace", file: incoming[0]! });
        return;
      }
      const names = new Set(incoming.map((f) => f.name));
      void runFiles([...session.files.filter((f) => !names.has(f.name)), ...incoming], session.sample);
    },
    [extractor, runFiles, session.files, session.sample],
  );

  const reopen = useCallback((file: File) => extractor.run({ type: "open-workspace", file }), [extractor]);
  const openSample = useCallback(() => void runFiles([], true), [runFiles]);
  const reset = useCallback(() => {
    extractor.cancel();
    resetSession();
  }, [extractor, resetSession]);

  return { ...api, extractor, addFiles, reopen, openSample, reset };
}

export type WorkspaceApi = ReturnType<typeof useWorkspace>;
