import type { Progress } from "../../../lib/extract.ts";
import type { Evidence } from "../../../lib/types.ts";
import type { Workspace } from "../../../lib/workspace.ts";

/** Messages between the page and the extraction worker. Files never leave this device. */

export type ToWorker =
  | { type: "extract"; files: File[]; texts?: { name: string; files: Record<string, string> }[] }
  | { type: "open-workspace"; file: File };

export type FromWorker =
  | { type: "progress"; progress: Progress }
  | { type: "evidence"; evidence: Evidence; ms: number }
  | { type: "workspace"; workspace: Workspace }
  | { type: "error"; message: string };
