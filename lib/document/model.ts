/**
 * The canonical document: ordered sections of typed blocks, each with a
 * review status and the evidence it cites. Templates render it; agents and
 * people edit its content, never its layout. See docs/WORKSPACE.md.
 */

export const DOCUMENT_SCHEMA = "oic.docs.document/v0";

/** Review state, per section. */
export type SectionStatus = "extracted" | "ai-draft" | "confirmed" | "unresolved";

export const STATUS_LABEL: Record<SectionStatus, string> = {
  extracted: "Extracted",
  "ai-draft": "AI draft",
  confirmed: "Confirmed",
  unresolved: "Unresolved",
};

export type Block =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string; refs?: string[] }
  | { type: "list"; items: string[]; ordered?: boolean; refs?: string[] }
  | { type: "table"; columns: string[]; rows: string[][]; caption?: string; refs?: string[] }
  | { type: "facts"; items: [string, string][] }
  | { type: "callout"; tone: "note" | "gap" | "warning"; text: string }
  | { type: "figure"; asset: string; caption: string; alt?: string }
  | { type: "code"; text: string; language?: string }
  | { type: "diagram"; diagram: SystemMap };

/** A bounded, system-level relationship picture: columns of nodes and edges between them. */
export interface SystemMap {
  columns: { title: string; nodes: { id: string; label: string; detail?: string }[] }[];
  edges: { from: string; to: string }[];
}

export interface Section {
  /** Stable id; user edits and review state attach to it across regeneration. */
  id: string;
  title: string;
  status: SectionStatus;
  /** Who wrote the current content. */
  origin: "generated" | "user" | "agent";
  blocks: Block[];
  /** Entity ids this section cites. */
  refs: string[];
  appendix?: boolean;
  /** Fingerprint of the cited evidence at generation time. */
  evidence?: string;
  /** Set when regeneration found the evidence behind edited text changed. */
  review?: "evidence-changed" | "evidence-removed";
}

export type PackId = "engineering-reference" | "operator-manual" | "maintenance-guide" | "complete-handoff";

export const PACKS: { id: PackId; label: string; summary: string; framework: boolean }[] = [
  { id: "engineering-reference", label: "Engineering Reference", summary: "What the system contains and how it connects, drawn entirely from the configuration.", framework: false },
  { id: "operator-manual", label: "Operator Manual Framework", summary: "Screens, navigation and alarms, with clearly marked places for procedures only the site can supply.", framework: true },
  { id: "maintenance-guide", label: "Maintenance Guide Framework", summary: "Equipment, connections, alarms and scripts, with gaps marked for troubleshooting and recovery steps.", framework: true },
  { id: "complete-handoff", label: "Complete Handoff", summary: "The reference plus both frameworks, for a full customer handover.", framework: true },
];

export interface DocumentModel {
  schema: typeof DOCUMENT_SCHEMA;
  pack: PackId;
  title: string;
  sections: Section[];
}

/** Plain text of a section, for search indexes and fingerprints. */
export function sectionText(s: Section): string {
  const parts: string[] = [s.title];
  for (const b of s.blocks) {
    switch (b.type) {
      case "heading":
      case "paragraph":
      case "callout":
      case "code":
        parts.push(b.text);
        break;
      case "list":
        parts.push(...b.items);
        break;
      case "table":
        parts.push(b.columns.join(" "), ...b.rows.map((r) => r.join(" ")));
        break;
      case "facts":
        parts.push(...b.items.map(([k, v]) => `${k} ${v}`));
        break;
      case "figure":
        parts.push(b.caption);
        break;
      case "diagram":
        parts.push(...b.diagram.columns.flatMap((c) => c.nodes.map((n) => n.label)));
        break;
    }
  }
  return parts.join("\n");
}
