import { useState } from "react";
import { PACKS } from "../../../lib/document/model.ts";
import { CONFIG } from "../config.ts";
import type { PageId } from "../shell/tools.ts";
import { Art } from "../ui/Art.tsx";
import { Icon } from "../ui/icons.tsx";
import type { WorkspaceApi } from "../workspace/useWorkspace.ts";
import { HeroScene, Vignette } from "./Isometric.tsx";

const REPO = `https://github.com/${CONFIG.repo}`;

const STEPS = [
  ["archive", "step-open", "Open", "A gateway backup, project export or tag export, read right here in the browser."],
  ["extract", "step-review", "Review", "Every view, tag, script and connection becomes evidence you can check against its file."],
  ["documents", "step-handover", "Hand over", "Linked HTML, editable Word, PDF and CSV, or a workspace for your AI assistant."],
] as const;

const PROMISES = [
  ["shield", "Stays on your device"],
  ["check", "Every fact traced to its file"],
  ["file", "Free and open source"],
] as const;

/**
 * The front door: what the toolkit does, at a glance, and a way in. Opening
 * files happens in the workspace, though a drop here still works.
 */
export function Overview({ ws, navigate }: { ws: WorkspaceApi; navigate: (id: PageId) => void }) {
  const current = ws.document?.title;
  const [over, setOver] = useState(false);
  const toWorkspace = () => navigate("docs.workspace");
  const sample = () => (ws.openSample(), toWorkspace());

  return (
    <div
      className={`home${over ? " over" : ""}`}
      onDragOver={(e) => [...e.dataTransfer.types].includes("Files") && (e.preventDefault(), setOver(true))}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!e.dataTransfer.files.length) return;
        ws.addFiles(e.dataTransfer.files);
        toWorkspace();
      }}
    >
      <section className="home-hero">
        <div className="home-copy">
          <p className="eyebrow">For Ignition integrators</p>
          <h1>Turn an Ignition backup into documentation you can hand&nbsp;over.</h1>
          <p className="lede">An engineering reference and editable manuals, built from the configuration itself. Nothing leaves your browser.</p>
          <div className="home-cta">
            {current ? (
              <button className="button primary big" onClick={toWorkspace}>
                Continue with {current} <Icon name="arrow" />
              </button>
            ) : (
              <button className="button primary big" onClick={toWorkspace}>
                Open the workspace <Icon name="arrow" />
              </button>
            )}
            <button className="button big" onClick={sample}>
              <Icon name="sample" /> Try the sample
            </button>
          </div>
          <ul className="promises">
            {PROMISES.map(([icon, text]) => (
              <li key={text}>
                <Icon name={icon} size={14} /> {text}
              </li>
            ))}
          </ul>
        </div>
        <div className="home-art">
          <Art name="hero" eager fallback={<HeroScene />} />
        </div>
      </section>

      <section className="home-band">
        <ol className="steps">
          {STEPS.map(([scene, art, title, text], i) => (
            <li key={title}>
              <div className="step-art">
                <Art name={art} fallback={<Vignette kind={scene} />} />
              </div>
              <span className="step-n">{String(i + 1).padStart(2, "0")}</span>
              <strong>{title}</strong>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="home-band">
        <div className="band-head">
          <h2 className="band-title">Four packs from one backup</h2>
          <p className="band-note">
            What only the site knows, like operating steps and alarm responses, stays marked <b>Unresolved</b> for a person to supply. Nothing is invented.
          </p>
        </div>
        <div className="pack-grid">
          {PACKS.map((p) => (
            <div key={p.id} className="pack-card">
              <Art name={`pack-${p.id}`} className="pack-art" />
              <strong>{p.label}</strong>
              <p>{p.summary}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="home-close">
        <h2>Start with a backup you already have.</h2>
        <button className="button primary big" onClick={toWorkspace}>
          Open the workspace <Icon name="arrow" />
        </button>
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

      {over && (
        <div className="home-drop" aria-hidden="true">
          <Icon name="upload" size={22} /> Drop to open in the workspace
        </div>
      )}
    </div>
  );
}
