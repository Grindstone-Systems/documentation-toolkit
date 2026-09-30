import { useMemo } from "react";
import { PACKS, STATUS_LABEL, type DocumentModel, type PackId, type SectionStatus } from "../../../lib/document/model.ts";
import { packSections } from "../../../lib/document/packs.ts";
import { Popover } from "../ui/controls.tsx";
import { Icon } from "../ui/icons.tsx";
import type { SessionApi } from "./session.ts";

const LEGEND: SectionStatus[] = ["unresolved", "ai-draft", "confirmed"];
const LEGEND_TEXT: Record<SectionStatus, [string, string]> = {
  extracted: ["from the configuration", "from the configuration"],
  unresolved: ["needs the site", "need the site"],
  "ai-draft": ["AI draft to review", "AI drafts to review"],
  confirmed: ["confirmed by a person", "confirmed by a person"],
};

/** Pack choice and the document's sections: jump to one, or leave it out. */
export function Outline({ api, document: doc, active, onJump }: { api: SessionApi; document: DocumentModel; active?: string; onJump: (id: string) => void }) {
  const { session, setConfig } = api;
  const cfg = session.config;
  const all = useMemo(() => (session.evidence ? packSections(session.evidence, cfg) : []), [session.evidence, cfg]);
  const pack = PACKS.find((p) => p.id === cfg.pack)!;
  const status = useMemo(() => new Map(doc.sections.map((s) => [s.id, s.status])), [doc]);
  const included = all.filter((s) => s.id === "coverage" || !cfg.exclude.includes(s.id)).length;

  // Numbers follow the document: main sections 1…n, appendices A…
  const numbers = useMemo(() => {
    const main = doc.sections.filter((s) => !s.appendix);
    const appx = doc.sections.filter((s) => s.appendix);
    return new Map(doc.sections.map((s) => [s.id, s.appendix ? String.fromCharCode(65 + appx.indexOf(s)) : String(main.indexOf(s) + 1)]));
  }, [doc]);
  const present = LEGEND.map((st) => [st, doc.sections.filter((s) => s.status === st).length] as const).filter(([, n]) => n > 0);

  return (
    <div className="outline">
      <Popover
        className="pack-picker"
        label="Choose a pack"
        trigger={
          <>
            <span className="pp-text">
              <small>Pack</small>
              <b>{pack.label}</b>
            </span>
            <Icon name="caret" />
          </>
        }
      >
        {(close) => (
          <ul className="pack-menu" role="radiogroup" aria-label="Pack">
            {PACKS.map((p) => (
              <li key={p.id}>
                <button
                  role="radio"
                  aria-checked={p.id === cfg.pack}
                  className={p.id === cfg.pack ? "on" : ""}
                  onClick={() => {
                    setConfig((c) => ({ ...c, pack: p.id as PackId }));
                    close();
                  }}
                >
                  <span className="pm-head">
                    <b>{p.label}</b>
                    <span className={`pack-kind${p.framework ? " fw" : ""}`}>{p.framework ? "Framework" : "Reference"}</span>
                  </span>
                  <span className="pm-sum">{p.summary}</span>
                  {p.id === cfg.pack && <Icon name="check" size={14} className="pm-check" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Popover>
      <p className="pack-summary">{pack.summary}</p>

      <div className="outline-head">
        <span>Sections</span>
        <span className="muted">
          {included} of {all.length}
        </span>
      </div>
      <ol className="outline-list">
        {all.map((s) => {
          const locked = s.id === "coverage";
          const on = locked || !cfg.exclude.includes(s.id);
          const st = status.get(s.id) ?? s.status;
          return (
            <li key={s.id} className={`${on ? "" : "off"}${active === s.id && on ? " active" : ""}`}>
              <input
                type="checkbox"
                className="check"
                checked={on}
                disabled={locked}
                aria-label={`${on ? "Leave out" : "Include"} ${s.title}`}
                title={locked ? "Coverage is always included" : on ? "Included, click to leave out" : "Left out, click to include"}
                onChange={() => setConfig((c) => ({ ...c, exclude: on ? [...c.exclude, s.id] : c.exclude.filter((x) => x !== s.id) }))}
              />
              <button className="ol-link" disabled={!on} onClick={() => onJump(s.id)} title={on ? `Go to ${s.title}` : "Left out of this document"}>
                <span className="ol-n">{on ? numbers.get(s.id) : ""}</span>
                <span className="ol-title">{s.title.replace(/^Appendix: /, "")}</span>
                {on && st !== "extracted" && <i className={`sdot st-${st}`} title={STATUS_LABEL[st]} />}
              </button>
            </li>
          );
        })}
      </ol>
      {present.length > 0 && (
        <ul className="legend">
          {present.map(([st, n]) => (
            <li key={st}>
              <i className={`sdot st-${st}`} /> {n} {LEGEND_TEXT[st][n === 1 ? 0 : 1]}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
