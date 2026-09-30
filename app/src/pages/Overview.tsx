import { PACKS } from "../../../lib/document/model.ts";
import { GROUPS, hrefOf, type PageId } from "../shell/tools.ts";
import { StatusPill } from "../ui/controls.tsx";
import { Icon } from "../ui/icons.tsx";

const STEPS = [
  ["Open", "Drop a gateway backup, project export or tag export. It's read on this device."],
  ["Inspect", "See what was found, what was read, and what couldn't be, with every source file."],
  ["Preview", "A linked engineering reference builds as you watch: screens, data, alarms, scripts."],
  ["Personalize", "Pick a pack, add the customer's name, logo and screenshots, choose sections and what to redact."],
  ["Export", "Offline HTML, editable Word, print-ready PDF, CSV inventories, or a workspace for your AI assistant."],
] as const;

export function Overview({ navigate, openSample }: { navigate: (id: PageId) => void; openSample: () => void }) {
  const tools = GROUPS.flatMap((g) => g.pages.map((p) => ({ ...p, group: g.label })));
  return (
    <div className="page overview">
      <section className="hero">
        <p className="eyebrow">Open Industrial Collective · Grindstone Systems</p>
        <p className="experimental-note">
          <b>Experimental · testing phase.</b> It works, it's private, and it's still being proven on real projects. Check generated documents against the source before
          you rely on them, and tell us what it gets wrong.
        </p>
        <h1>Turn an Ignition backup into an engineering reference</h1>
        <p className="lede">
          Get a searchable reference and an editable manual pack, with every fact traced to the file it came from. Processing happens in your browser. Your own AI
          assistant can fill in the rest.
        </p>
        <div className="hero-actions">
          <button className="primary" onClick={() => navigate("docs.workspace")}>
            Open backup or project <Icon name="arrow" />
          </button>
          <button className="secondary" onClick={openSample}>
            <Icon name="sample" /> Explore the sample
          </button>
        </div>
        <dl className="facts">
          <div>
            <dt>0</dt>
            <dd>files uploaded</dd>
          </div>
          <div>
            <dt>{PACKS.length}</dt>
            <dd>document packs</dd>
          </div>
          <div>
            <dt>HTML · Word · PDF</dt>
            <dd>plus CSV and an agent workspace</dd>
          </div>
          <div>
            <dt>$0</dt>
            <dd>no account, no paid AI</dd>
          </div>
        </dl>
      </section>

      <section className="block">
        <h2 className="block-title">How it works</h2>
        <ol className="steps">
          {STEPS.map(([t, d], i) => (
            <li key={t}>
              <b>{i + 1}</b>
              <strong>{t}</strong>
              <span>{d}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="block">
        <h2 className="block-title">Packs</h2>
        <div className="tool-grid">
          {PACKS.map((p) => (
            <div key={p.id} className="tool-card tool-card--ready static">
              <span className="tool-meta">{p.framework ? "Framework" : "Reference"}</span>
              <strong>{p.label}</strong>
              <span className="tool-summary">{p.summary}</span>
            </div>
          ))}
        </div>
        <p className="hint spaced">
          Frameworks mark what only the site can supply (operating steps, alarm responses, safety information) as <b>Unresolved</b>. The toolkit and AI assistants don't invent
          them.
        </p>
      </section>

      <section className="block">
        <h2 className="block-title">Tools</h2>
        <div className="tool-grid">
          {tools.map((t) => (
            <a
              key={t.id}
              className={`tool-card tool-card--${t.status}`}
              href={hrefOf(t.id)}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                e.preventDefault();
                navigate(t.id);
              }}
            >
              <span className="tool-icon">
                <Icon name={t.icon} size={18} />
              </span>
              <span className="tool-meta">
                {t.group}
                <StatusPill status={t.status} />
              </span>
              <strong>{t.label}</strong>
              <span className="tool-summary">{t.summary}</span>
            </a>
          ))}
        </div>
      </section>

      <section className="block principles">
        <h2 className="block-title">Principles</h2>
        <ul className="checklist">
          <li>Useful before AI: the basic pack needs no model, account or install.</li>
          <li>Private by default: backups never leave the device, and credentials are never read.</li>
          <li>Explicit about coverage: anything not read is counted and shown.</li>
          <li>Honest states: Extracted, AI draft, Confirmed and Unresolved are marked on every section.</li>
          <li>Portable after export: HTML, Markdown, JSON and CSV that any tool can open.</li>
        </ul>
      </section>
    </div>
  );
}
