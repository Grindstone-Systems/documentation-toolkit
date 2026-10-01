import type { IconName } from "../ui/icons.tsx";

/**
 * The tool registry: every page the app knows about, grouped the way the
 * command palette groups them. Adding a tool is one entry here plus a page in App.tsx.
 * Statuses mirror docs/ROADMAP.md — don't mark something ready that isn't.
 */

export type PageId = "overview" | "docs.workspace" | "extend.agents" | "extend.platforms";

export type ToolStatus = "ready" | "preview" | "planned";

export interface ToolPage {
  id: PageId;
  label: string;
  /** Hash path without the leading "#/". */
  path: string;
  icon: IconName;
  status: ToolStatus;
  summary: string;
  details?: string[];
  progress?: string;
}

export interface ToolGroup {
  id: string;
  label: string;
  icon: IconName;
  pages: ToolPage[];
}

export const OVERVIEW: ToolPage = {
  id: "overview",
  label: "Overview",
  path: "",
  icon: "home",
  status: "ready",
  summary: "What Documentation Toolkit does and how to start.",
};

export const GROUPS: ToolGroup[] = [
  {
    id: "docs",
    label: "Documentation",
    icon: "docs",
    pages: [
      {
        id: "docs.workspace",
        label: "Workspace",
        path: "workspace",
        icon: "workspace",
        status: "preview",
        summary: "Open an Ignition backup or project, inspect what was found, add branding and screenshots, and export HTML, Word, PDF or CSV. Runs on this device.",
      },
    ],
  },
  {
    id: "extend",
    label: "Extend",
    icon: "layers",
    pages: [
      {
        id: "extend.agents",
        label: "AI agent extension",
        path: "agents",
        icon: "agent",
        status: "preview",
        summary: "Let Claude Code, Codex or another MCP client explain and complete the pack from its evidence, on your machine.",
      },
      {
        id: "extend.platforms",
        label: "More platforms",
        path: "platforms",
        icon: "platforms",
        status: "planned",
        summary: "Adapters beyond Ignition, such as Rockwell L5X, feeding the same evidence model and packs.",
        details: [
          "Each adapter declares versions, resource types and what it can't read.",
          "Evidence stays platform-neutral, so packs and exports work unchanged.",
          "Within Ignition, Vision windows and reports are the first candidates.",
        ],
        progress: "Not started. The evidence schema is versioned and platform-neutral to allow it.",
      },
    ],
  },
];

export const ALL_PAGES: ToolPage[] = [OVERVIEW, ...GROUPS.flatMap((g) => g.pages)];

/** The top bar's links. Planned tools are reachable from the home page and ⌘K. */
export const NAV: { id: PageId; label: string }[] = [
  { id: "overview", label: "Home" },
  { id: "docs.workspace", label: "Workspace" },
  { id: "extend.agents", label: "AI agents" },
];

export const pageById = (id: PageId) => ALL_PAGES.find((p) => p.id === id)!;
export const groupOf = (id: PageId) => GROUPS.find((g) => g.pages.some((p) => p.id === id));

export interface Route {
  page: PageId;
  /** #/workspace/sample opens the bundled sample. */
  sample?: boolean;
}

export function parseHash(hash = location.hash): Route {
  const h = hash.replace(/^#\/?/, "").replace(/\/$/, "");
  if (h === "workspace/sample" || h === "sample") return { page: "docs.workspace", sample: true };
  return { page: ALL_PAGES.find((p) => p.path === h)?.id ?? "overview" };
}

export const hrefOf = (id: PageId) => `#/${pageById(id).path}`;
