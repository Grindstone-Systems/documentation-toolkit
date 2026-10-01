import { useCallback, useMemo, useState } from "react";
import { defaultConfig, type ToolkitConfig } from "../../../lib/config.ts";
import type { DocumentModel } from "../../../lib/document/model.ts";
import { buildDocument } from "../../../lib/document/packs.ts";
import type { Evidence } from "../../../lib/types.ts";
import { mergeDocument, type Workspace } from "../../../lib/workspace.ts";

/**
 * Everything the user is working on, held in memory only. Nothing is written
 * to browser storage; "Save workspace" is an explicit download.
 */
export interface Session {
  files: File[];
  sample: boolean;
  evidence?: Evidence;
  /** The document from a reopened workspace; edits in it survive regeneration. */
  previous?: DocumentModel;
  config: ToolkitConfig;
  assets: Map<string, Uint8Array>;
}

const today = () => new Date().toISOString().slice(0, 10);

export const newSession = (): Session => ({
  files: [],
  sample: false,
  config: { ...defaultConfig(), identity: { ...defaultConfig().identity, date: today() } },
  assets: new Map(),
});

export function useSession() {
  const [session, setSession] = useState<Session>(newSession);

  const document = useMemo<DocumentModel | undefined>(() => {
    if (!session.evidence) return undefined;
    const doc = buildDocument(session.evidence, session.config);
    return session.previous ? mergeDocument(doc, session.previous) : doc;
  }, [session.evidence, session.config, session.previous]);

  const setConfig = useCallback((f: (c: ToolkitConfig) => ToolkitConfig) => setSession((s) => ({ ...s, config: f(s.config) })), []);

  const openWorkspace = useCallback((ws: Workspace) => {
    setSession({ files: [], sample: false, evidence: ws.evidence, previous: ws.document, config: ws.config, assets: ws.assets });
  }, []);

  const reset = useCallback(() => setSession(newSession()), []);

  return { session, setSession, document, setConfig, openWorkspace, reset };
}

export type SessionApi = ReturnType<typeof useSession>;
