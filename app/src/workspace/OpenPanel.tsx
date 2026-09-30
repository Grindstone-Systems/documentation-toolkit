import { useRef, useState } from "react";
import { FileBadge } from "../ui/controls.tsx";
import { Icon } from "../ui/icons.tsx";
import { ACCEPT, type WorkspaceApi } from "./useWorkspace.ts";

type Support = "full" | "partial";

/** What each input yields today. Mirrors docs/ROADMAP.md; details show on hover. */
const FORMATS: { ext: string; label: string; versions: { v: string; s: Support; note: string }[]; detail: string }[] = [
  {
    ext: "GWBK",
    label: "Gateway backup",
    versions: [
      { v: "8.3", s: "full", note: "Projects, tags, providers, connections and gateway settings" },
      { v: "8.1", s: "full", note: "Projects, plus tags, providers, connections and devices from the internal database" },
    ],
    detail: "All projects, plus tags, tag providers, OPC and database connections, user sources and other gateway settings. Credentials are never read.",
  },
  {
    ext: "ZIP",
    label: "Project export",
    versions: [{ v: "8.x", s: "full", note: "Perspective, scripts, named queries, event scripts" }],
    detail: "Perspective pages, views and bindings, project scripts, named queries and gateway event scripts. Vision, reports and other modules are listed by name.",
  },
  {
    ext: "JSON",
    label: "Tag export",
    versions: [{ v: "8.x", s: "full", note: "Folders, tags, UDTs, instances and alarms" }],
    detail: "Folders, tags, UDT definitions and instances, and alarms. UDT members are expanded with parameters substituted.",
  },
];

/**
 * The one way in: a big drop area with a single primary action. The sample
 * and reopening a saved workspace are there, but quieter.
 */
export function OpenPanel({ ws, onStart }: { ws: WorkspaceApi; onStart?: () => void }) {
  const [over, setOver] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const pickWorkspace = useRef<HTMLInputElement>(null);
  const error = ws.extractor.state.phase === "error" ? ws.extractor.state.message : undefined;

  const take = (files: FileList | File[]) => {
    if (!files.length) return;
    ws.addFiles(files);
    onStart?.();
  };

  return (
    <div className="open-panel">
      <input ref={pick} type="file" accept={ACCEPT} multiple hidden onChange={(e) => (e.target.files && take(e.target.files), (e.target.value = ""))} />
      <input
        ref={pickWorkspace}
        type="file"
        accept=".zip"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          ws.reopen(f);
          onStart?.();
        }}
      />
      <div
        className={`drop${over ? " over" : ""}`}
        role="button"
        tabIndex={0}
        aria-label="Choose Ignition files to open"
        onClick={() => pick.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick.current?.click())}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files);
        }}
      >
        <span className="drop-icon">
          <Icon name="upload" size={22} />
        </span>
        <strong className="drop-title">{over ? "Drop to open" : "Drop Ignition files here"}</strong>
        <span className="drop-sub">You can add several at once, such as a project export and its tags.</span>
        <span className="button primary drop-cta">Choose files</span>

        <ul className="formats" aria-label="Accepted files">
          {FORMATS.map((f) => (
            <li key={f.ext} title={f.detail}>
              <FileBadge ext={f.ext} />
              <span className="fmt-text">
                <b>{f.label}</b>
                <span className="fmt-versions">
                  {f.versions.map((v) => (
                    <span key={v.v} className={`ver ver-${v.s}`} title={`Ignition ${v.v}: ${v.note}`}>
                      <i aria-hidden="true" />
                      {v.v}
                      <span className="sr-only">{v.s === "full" ? " fully supported" : " partly supported"}</span>
                    </span>
                  ))}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {error && (
        <p className="error-note" role="alert">
          <Icon name="alert" size={14} /> {error}
        </p>
      )}

      <div className="open-alt">
        <button className="link-btn" onClick={() => (ws.openSample(), onStart?.())}>
          <Icon name="sample" size={14} /> Try the sample project
        </button>
        <span className="dot-sep" aria-hidden="true" />
        <button className="link-btn" onClick={() => pickWorkspace.current?.click()}>
          <Icon name="restart" size={14} /> Reopen a saved workspace
        </button>
      </div>

      <p className="open-legend">
        <span className="ver ver-full">
          <i aria-hidden="true" />
          Fully read
        </span>
        <span className="ver ver-partial">
          <i aria-hidden="true" />
          Partly read
        </span>
        <span className="open-private">
          <Icon name="shield" size={13} /> Read on this device. Nothing is uploaded.
        </span>
      </p>
    </div>
  );
}
