import { PACKS, type PackId } from "./document/model.ts";

/**
 * What the user controls: identity, a small set of appearance choices,
 * section selection, redaction and short context. Stored in the workspace
 * as toolkit.config.json and always sanitised on the way in.
 */

export const CONFIG_SCHEMA = "oic.docs.config/v0";

export type ThemeId = "graphite" | "harbor" | "mono";
export type Paper = "letter" | "a4";
export type Density = "standard" | "compact";

export const THEMES: { id: ThemeId; label: string }[] = [
  { id: "graphite", label: "Graphite" },
  { id: "harbor", label: "Harbor" },
  { id: "mono", label: "Monochrome" },
];

export interface ToolkitConfig {
  schema: typeof CONFIG_SCHEMA;
  pack: PackId;
  identity: {
    project: string;
    customer: string;
    revision: string;
    /** ISO date (YYYY-MM-DD) printed on the cover; never "now", so builds are reproducible. */
    date: string;
    author: string;
    confidentiality: string;
  };
  appearance: { theme: ThemeId; accent: string; paper: Paper; density: Density };
  /** Section ids left out of the pack. Coverage can't be excluded. */
  exclude: string[];
  redact: { addresses: boolean; usernames: boolean; code: boolean };
  context: { systemDescription: string; procedures: string };
  /** Discreet "Generated with" line in the footer. */
  credit: boolean;
  /** Workspace path of the customer logo, e.g. assets/logo.png. */
  logo?: string;
  /** User-supplied screenshots of the running system, optionally attached to a page. */
  screenshots: Screenshot[];
}

export interface Screenshot {
  /** Workspace path, e.g. assets/screen-1.jpg. */
  asset: string;
  caption: string;
  /** Page entity id the screenshot shows, e.g. page:Riverbend/pumps. */
  page?: string;
}

const ASSET = /^assets\/[\w.-]+\.(png|jpe?g|webp)$/i;

export const defaultConfig = (): ToolkitConfig => ({
  schema: CONFIG_SCHEMA,
  pack: "engineering-reference",
  identity: { project: "", customer: "", revision: "A", date: "", author: "", confidentiality: "Confidential" },
  appearance: { theme: "graphite", accent: "#2d6a8e", paper: "letter", density: "standard" },
  exclude: [],
  redact: { addresses: false, usernames: true, code: false },
  context: { systemDescription: "", procedures: "" },
  credit: true,
  screenshots: [],
});

const text = (v: unknown, max: number, fallback = "") => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, max) : fallback);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);

/** Accept anything (a reimported workspace, a share, an agent's edit) and return a valid config. */
export function sanitizeConfig(input: unknown): ToolkitConfig {
  const d = defaultConfig();
  const o = (input && typeof input === "object" ? input : {}) as Record<string, Record<string, unknown> | unknown>;
  const id = (o.identity ?? {}) as Record<string, unknown>;
  const ap = (o.appearance ?? {}) as Record<string, unknown>;
  const rd = (o.redact ?? {}) as Record<string, unknown>;
  const cx = (o.context ?? {}) as Record<string, unknown>;
  const date = text(id.date, 10);
  const logo = text(o.logo, 120);
  return {
    schema: CONFIG_SCHEMA,
    pack: oneOf(o.pack, PACKS.map((p) => p.id), d.pack),
    identity: {
      project: text(id.project, 120),
      customer: text(id.customer, 120),
      revision: text(id.revision, 24, d.identity.revision),
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
      author: text(id.author, 120),
      confidentiality: text(id.confidentiality, 60, d.identity.confidentiality),
    },
    appearance: {
      theme: oneOf(ap.theme, THEMES.map((t) => t.id), d.appearance.theme),
      accent: typeof ap.accent === "string" && /^#[0-9a-f]{6}$/i.test(ap.accent) ? ap.accent.toLowerCase() : d.appearance.accent,
      paper: oneOf(ap.paper, ["letter", "a4"] as const, d.appearance.paper),
      density: oneOf(ap.density, ["standard", "compact"] as const, d.appearance.density),
    },
    exclude: Array.isArray(o.exclude) ? o.exclude.filter((x): x is string => typeof x === "string" && /^[a-z0-9-]{1,40}$/.test(x)).slice(0, 100) : [],
    redact: {
      addresses: typeof rd.addresses === "boolean" ? rd.addresses : d.redact.addresses,
      usernames: typeof rd.usernames === "boolean" ? rd.usernames : d.redact.usernames,
      code: typeof rd.code === "boolean" ? rd.code : d.redact.code,
    },
    context: { systemDescription: text(cx.systemDescription, 4000), procedures: text(cx.procedures, 20000) },
    credit: typeof o.credit === "boolean" ? o.credit : true,
    ...(ASSET.test(logo) ? { logo } : {}),
    screenshots: Array.isArray(o.screenshots)
      ? (o.screenshots as Record<string, unknown>[])
          .filter((x) => x && typeof x === "object" && typeof x.asset === "string" && ASSET.test(x.asset))
          .slice(0, 100)
          .map((x) => {
            const page = text(x.page, 300);
            return { asset: x.asset as string, caption: text(x.caption, 300), ...(page.startsWith("page:") ? { page } : {}) };
          })
      : [],
  };
}
