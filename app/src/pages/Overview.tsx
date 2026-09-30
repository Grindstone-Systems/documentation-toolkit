import { PACKS } from "../../../lib/document/model.ts";
import { CONFIG } from "../config.ts";
import type { PageId } from "../shell/tools.ts";
import { Icon } from "../ui/icons.tsx";
import { OpenPanel } from "../workspace/OpenPanel.tsx";
import type { WorkspaceApi } from "../workspace/useWorkspace.ts";

const REPO = `https://github.com/${CONFIG.repo}`;

const STEPS = [
  ["Open", "Drop a gateway backup, project export or tag export. It's read in this browser tab."],
  ["Review", "Pick a pack, check each section against its source, add the customer's details and screenshots."],
  ["Export", "Offline HTML, editable Word, PDF, CSV inventories, or a workspace for your AI assistant."],
] as const;

export function Overview({ ws, navigate }: { ws: WorkspaceApi; navigate: (id: PageId) => void }) {
  const current = ws.document?.title;
  const toWorkspace = () => navigate("docs.workspace");

  return (
    <div className="home">
      <section className="home-hero">
        <div className="home-copy">
          <h1>Turn an Ignition backup into documentation you can hand over.</h1>
          <p className="lede">
            A linked engineering reference and editable manual pack, built from the configuration itself. Every fact is traced to the file it came from, and nothing
            leaves your device.
          </p>
          {current && (
            <button className="resume" onClick={toWorkspace}>
              <span>
                <small>Continue where you left off</small>
                <b>{current}</b>
              </span>
              <Icon name="arrow" />
            </button>
          )}
        </div>
        <OpenPanel ws={ws} onStart={toWorkspace} />
      </section>

      <section className="home-band">
        <ol className="flow">
          {STEPS.map(([t, d], i) => (
            <li key={t}>
              <span className="flow-n">{i + 1}</span>
              <strong>{t}</strong>
              <p>{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="home-band">
        <h2 className="band-title">Four packs from one backup</h2>
        <div className="pack-grid">
          {PACKS.map((p) => (
            <div key={p.id} className="pack-card">
              <strong>{p.label}</strong>
              <p>{p.summary}</p>
            </div>
          ))}
        </div>
        <p className="band-note">
          Frameworks leave what only the site knows, such as operating steps, alarm responses and safety information, marked <b>Unresolved</b> for a person to supply.
        </p>
      </section>

      <footer className="home-foot">
        <p>
          <span className="beta">Experimental</span> Still being proven on real projects. Check generated documents against the source before you rely on them.
        </p>
        <nav aria-label="Resources">
          <a href="#/agents" onClick={(e) => (e.preventDefault(), navigate("extend.agents"))}>
            AI agents
          </a>
          <a href="#/platforms" onClick={(e) => (e.preventDefault(), navigate("extend.platforms"))}>
            More platforms
          </a>
          <a href={`${REPO}/blob/main/docs/ROADMAP.md`} target="_blank" rel="noopener">
            Roadmap
          </a>
          <a href={`${REPO}/blob/main/docs/PRIVACY.md`} target="_blank" rel="noopener">
            Privacy
          </a>
          <a href={REPO} target="_blank" rel="noopener">
            Source
          </a>
        </nav>
        <p className="byline">Grindstone Systems · Open Industrial Collective. Not affiliated with or endorsed by Inductive Automation.</p>
      </footer>
    </div>
  );
}
