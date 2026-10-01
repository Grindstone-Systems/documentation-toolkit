import type { ReactNode } from "react";
import { CONFIG } from "../config.ts";
import type { ToolPage } from "../shell/tools.ts";
import { PageHeader, StatusPill } from "../ui/controls.tsx";
import { Art, type ArtName } from "../ui/Art.tsx";
import { Icon } from "../ui/icons.tsx";

/** Landing page for a tool that is planned or in preview: what it will do and where it stands. */
export function ToolStatusPage({ tool, group, action }: { tool: ToolPage; group?: string; action?: ReactNode }) {
  return (
    <div className="page">
      <PageHeader eyebrow={group} title={tool.label} actions={<StatusPill status={tool.status} />} art={<Art name={tool.path as ArtName} />}>
        {tool.summary}
      </PageHeader>
      <div className="status-grid">
        <section className="panel-card">
          <h2 className="block-title">{tool.status === "planned" ? "What it will do" : "What it does"}</h2>
          <ul className="checklist">
            {tool.details?.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
          {action && <div className="hero-actions">{action}</div>}
        </section>
        <section className="panel-card muted">
          <h2 className="block-title">Where it stands</h2>
          <p>{tool.progress}</p>
          <a className="text-link" href={`https://github.com/${CONFIG.repo}/blob/main/docs/ROADMAP.md`} target="_blank" rel="noopener noreferrer">
            Read the roadmap <Icon name="external" size={12} />
          </a>
        </section>
      </div>
    </div>
  );
}
