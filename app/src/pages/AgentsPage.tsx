import { useState } from "react";
import { CONFIG } from "../config.ts";
import { PageHeader, Segmented, StatusPill } from "../ui/controls.tsx";
import { Icon } from "../ui/icons.tsx";

type Client = "claude" | "codex" | "other";

const REPO = `https://github.com/${CONFIG.repo}`;

const SETUP: Record<Client, { title: string; steps: [string, string][] }> = {
  claude: {
    title: "Claude Code",
    steps: [
      ["Open the workspace folder", "cd riverbend-workspace\nclaude"],
      ["Or register the tools (MCP)", "claude mcp add oic-docs -- node /path/to/documentation-toolkit/dist-cli/oic-docs.mjs mcp --workspace ."],
    ],
  },
  codex: {
    title: "Codex",
    steps: [
      ["Open the workspace folder", "cd riverbend-workspace\ncodex"],
      [
        "Or register the tools in ~/.codex/config.toml",
        '[mcp_servers.oic-docs]\ncommand = "node"\nargs = ["/path/to/documentation-toolkit/dist-cli/oic-docs.mjs", "mcp", "--workspace", "/path/to/riverbend-workspace"]',
      ],
    ],
  },
  other: {
    title: "Other MCP clients",
    steps: [["Run the server over stdio", "node /path/to/documentation-toolkit/dist-cli/oic-docs.mjs mcp --workspace /path/to/workspace"]],
  },
};

const TOOLS = [
  ["search_evidence", "Find views, tags, alarms, scripts and queries, with ids to cite."],
  ["get_entity / trace_relationships", "One item's configuration and source, and what it connects to."],
  ["check_coverage", "What wasn't read, unresolved references and sections that need the site."],
  ["read_section / write_section", "Edit a section as Markdown. Writes are drafts, inside the workspace only."],
  ["validate / build_pack", "Check citations and statuses, then render the reference."],
];

export function AgentsPage() {
  const [client, setClient] = useState<Client>("claude");
  return (
    <div className="page">
      <PageHeader eyebrow="Extend" title="AI agent extension" actions={<StatusPill status="preview" />}>
        Hand the pack to the assistant you already use. It explains scripts and screens, adapts wording for operators, and asks you for what configuration can't tell it.
        It uses your own subscription; the toolkit adds no model or account.
      </PageHeader>

      <div className="status-grid">
        <section className="panel-card">
          <h2 className="block-title">1 · Save a workspace</h2>
          <p>
            In the Workspace, choose <b>Save workspace</b> and unzip it. The folder holds the evidence, one Markdown file per section, and an <code>AGENTS.md</code> with the rules
            the assistant follows. Assistants that read <code>AGENTS.md</code> or <code>CLAUDE.md</code> need nothing else.
          </p>
          <h2 className="block-title">2 · Optional: add the local tools</h2>
          <p>
            The <code>oic-docs</code> command gives the assistant precise evidence search, validation and rebuilds over MCP (stdio, no network port). It isn't on npm yet, so
            build it from the repository:
          </p>
          <pre className="snippet">{`git clone ${REPO}\ncd documentation-toolkit\npnpm install && pnpm build:cli`}</pre>
          <Segmented<Client>
            value={client}
            onChange={setClient}
            options={[
              { value: "claude", label: "Claude Code" },
              { value: "codex", label: "Codex" },
              { value: "other", label: "Other" },
            ]}
          />
          {SETUP[client].steps.map(([t, code]) => (
            <div key={t} className="snippet-block">
              <p className="snippet-title">{t}</p>
              <pre className="snippet">{code}</pre>
            </div>
          ))}
          <p className="hint">
            These setup steps haven't been tested in every client yet. Check your client's MCP documentation if a command differs.
          </p>
          <h2 className="block-title">3 · Rebuild</h2>
          <p>
            Reopen the edited workspace here, or run <code>oic-docs build --workspace .</code>. Edited sections are kept and marked <b>AI draft</b> until a person confirms them.
          </p>
        </section>

        <section className="panel-card muted">
          <h2 className="block-title">Tools the assistant gets</h2>
          <dl className="tool-defs">
            {TOOLS.map(([n, d]) => (
              <div key={n}>
                <dt>
                  <code>{n}</code>
                </dt>
                <dd>{d}</dd>
              </div>
            ))}
          </dl>
          <h2 className="block-title">Boundaries</h2>
          <ul className="checklist">
            <li>Reads only the workspace folder; writes only section files and exports.</li>
            <li>Never touches the original backup or a gateway.</li>
            <li>Treats scripts, comments and SQL as data, not instructions.</li>
            <li>Can't mark a section Confirmed. Only people do that.</li>
            <li>Leaves procedures and safety steps Unresolved and asks you instead.</li>
          </ul>
          <p>
            Local extraction and cloud AI are different privacy boundaries. A cloud-based assistant sends what it reads to its provider.
          </p>
          <a className="text-link" href={`${REPO}/blob/main/docs/LOCAL.md`} target="_blank" rel="noopener noreferrer">
            Local extension docs <Icon name="external" size={12} />
          </a>
        </section>
      </div>
    </div>
  );
}
