import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ADAPTERS } from "../../../lib/extract.ts";
import { slug } from "../../../lib/render/escape.ts";
import { renderHtml } from "../../../lib/render/html.ts";
import { unresolved } from "../../../lib/resolve.ts";
import { dataUris } from "../../../lib/workspace.ts";
import { Art } from "../ui/Art.tsx";
import { Popover, Segmented } from "../ui/controls.tsx";
import { Icon } from "../ui/icons.tsx";
import { Coverage } from "./Coverage.tsx";
import { CustomizePanel } from "./CustomizePanel.tsx";
import { EvidenceExplorer } from "./EvidenceExplorer.tsx";
import { ExportDialog } from "./ExportDialog.tsx";
import { OpenPanel } from "./OpenPanel.tsx";
import { Outline } from "./Outline.tsx";
import { ACCEPT, type WorkspaceApi } from "./useWorkspace.ts";

type Tab = "document" | "evidence" | "coverage";

const fmtBytes = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtMs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const wide = (px: number) => typeof matchMedia === "function" && matchMedia(`(min-width: ${px}px)`).matches;

/** Re-render when the viewport crosses a breakpoint; the side panels float below it. */
function useWide(px: number) {
  const [v, setV] = useState(() => wide(px));
  useEffect(() => {
    const m = matchMedia(`(min-width: ${px}px)`);
    const on = () => setV(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [px]);
  return v;
}

/**
 * The in-app preview hides the document's own contents list (the outline
 * replaces it) and keeps the text at a readable width. Print is unaffected:
 * the exported file and the printed PDF are unchanged.
 */
const PREVIEW_CSS = "<style>@media screen{.layout>.toc{display:none}.layout{display:block;max-width:none}main{max-width:900px;margin:0 auto}}</style>";

const COUNTS: [string, string, string[]][] = [
  ["project", "projects", ["project"]],
  ["view", "views", ["view"]],
  ["page", "pages", ["page"]],
  ["tag", "tags", ["tag"]],
  ["UDT", "UDTs", ["udt-type"]],
  ["alarm", "alarms", ["alarm"]],
  ["query", "queries", ["named-query"]],
  ["script", "scripts", ["script", "event-script"]],
  ["connection", "connections", ["opc-connection", "database-connection", "device"]],
];

export function WorkspacePage({
  ws,
  notify,
  openSample,
  exportOpen,
  setExportOpen,
}: {
  ws: WorkspaceApi;
  notify: (m: string) => void;
  openSample: boolean;
  exportOpen: boolean;
  setExportOpen: (open: boolean) => void;
}) {
  const { session, document: doc, extractor } = ws;
  const [tab, setTab] = useState<Tab>("document");
  const [showOutline, setShowOutline] = useState(() => wide(820));
  const [showCustomize, setShowCustomize] = useState(() => wide(1180));
  const roomForOutline = useWide(820);
  const roomForCustomize = useWide(1180);
  const [dragging, setDragging] = useState(false);
  const [active, setActive] = useState<string>();
  const [focus, setFocus] = useState<string | undefined>();
  const pick = useRef<HTMLInputElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  // #/workspace/sample opens the sample once.
  const sampled = useRef(false);
  useEffect(() => {
    if (openSample && !sampled.current && !session.evidence) {
      sampled.current = true;
      ws.openSample();
    }
  }, [openSample, ws, session.evidence]);

  const assets = useMemo(() => dataUris(session.assets), [session.assets]);
  const deferredDoc = useDeferredValue(doc);
  const deferredConfig = useDeferredValue(session.config);
  const html = useMemo(
    () => (deferredDoc ? renderHtml(deferredDoc, deferredConfig, { assets, search: false }).replace("</head>", `${PREVIEW_CSS}</head>`) : ""),
    [deferredDoc, deferredConfig, assets],
  );

  // Section anchors in the preview, mapped back to section ids for the outline.
  const bySid = useRef(new Map<string, string>());
  bySid.current = new Map((doc?.sections ?? []).map((s) => [`s-${slug(s.id)}`, s.id]));

  // The preview reloads whenever the document changes; keep the reader's place.
  const scrollY = useRef(0);
  const jumpTo = useRef<string | undefined>(undefined);
  const jump = (id: string) => {
    const w = frame.current?.contentWindow;
    const el = frame.current?.contentDocument?.getElementById(`s-${slug(id)}`);
    if (!w || !el) return false;
    // Scroll only the preview, never the app around it.
    w.scrollTo({ top: el.getBoundingClientRect().top + w.scrollY - 12, behavior: "instant" });
    el.animate?.([{ background: "color-mix(in srgb, #4a9fd0 16%, transparent)" }, { background: "transparent" }], { duration: 1400 });
    setActive(id);
    return true;
  };
  const onFrameLoad = () => {
    const w = frame.current?.contentWindow;
    const d = frame.current?.contentDocument;
    if (!w || !d) return;
    if (jumpTo.current && jump(jumpTo.current)) jumpTo.current = undefined;
    else w.scrollTo(0, scrollY.current);
    const sections = [...d.querySelectorAll<HTMLElement>("section.sec[id]")];
    let raf = 0;
    const spy = () => {
      raf = 0;
      let current: string | undefined;
      for (const s of sections) {
        if (s.getBoundingClientRect().top > 140) break;
        current = s.id;
      }
      setActive(current ? bySid.current.get(current) : undefined);
    };
    w.addEventListener(
      "scroll",
      () => {
        scrollY.current = w.scrollY;
        if (!raf) raf = w.requestAnimationFrame(spy);
      },
      { passive: true },
    );
    spy();
  };
  // Jump after the preview is visible again; if it's still loading, onFrameLoad finishes the job.
  const [jumpTick, setJumpTick] = useState(0);
  const showSection = useCallback((id: string) => {
    jumpTo.current = id;
    setTab("document");
    setJumpTick((n) => n + 1);
    if (!wide(820)) setShowOutline(false);
  }, []);
  // Panels that would float over the preview close when the window narrows.
  useEffect(() => void (!roomForOutline && setShowOutline(false)), [roomForOutline]);
  useEffect(() => void (!roomForCustomize && setShowCustomize(false)), [roomForCustomize]);
  useEffect(() => {
    if (tab === "document" && jumpTo.current && jump(jumpTo.current)) jumpTo.current = undefined;
  }, [tab, jumpTick]);

  const working = extractor.state.phase === "working";
  const ev = session.evidence;

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) ws.addFiles(e.dataTransfer.files);
  };
  const hasFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes("Files");

  /* ---------- nothing open yet ---------- */
  if (!ev && !working) {
    return (
      <div className="ws-empty" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <div className="ws-empty-inner">
          <Art name="workspace-empty" className="ws-empty-art" eager />
          <h1>Open a backup or project</h1>
          <p className="lede">Your files are read in this tab and never uploaded. Nothing is kept after you close it.</p>
          <OpenPanel ws={ws} />
        </div>
      </div>
    );
  }

  /* ---------- first read in progress ---------- */
  if (!ev || !doc) {
    const log = extractor.state.phase === "working" ? extractor.state.log : [];
    return (
      <div className="ws-empty">
        <div className="reading" role="status" aria-live="polite">
          <span className="spinner lg" aria-hidden="true" />
          <h1>Reading your files</h1>
          <ul className="progress">
            {log.slice(-4).map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
          <button className="button" onClick={ws.reset}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  /* ---------- the workspace ---------- */
  const gaps = unresolved(ev).length;
  const notRead = ev.coverage.filter((c) => c.read < c.found);
  const issues = gaps + notRead.length;
  const counts = COUNTS.map(([one, many, kinds]) => {
    const n = ev.entities.filter((e) => kinds.includes(e.kind)).length;
    return { n, label: n === 1 ? one : many };
  }).filter((c) => c.n);
  const docTab = tab === "document";
  const overlayOpen = docTab && ((showOutline && !roomForOutline) || (showCustomize && !roomForCustomize));

  return (
    <div
      className={`ws${docTab && showOutline ? " with-outline" : ""}${docTab && showCustomize ? " with-customize" : ""}`}
      data-summary={counts.map((c) => `${c.n} ${c.label}`).join(", ")}
      onDragEnter={(e) => hasFiles(e) && setDragging(true)}
    >
      <input ref={pick} type="file" accept={ACCEPT} multiple hidden onChange={(e) => (e.target.files && ws.addFiles(e.target.files), (e.target.value = ""))} />

      <div className="ws-bar">
        <div className="ws-bar-start">
          {docTab && (
            <button
              className={`icon-btn${showOutline ? " pressed" : ""}`}
              onClick={() => setShowOutline((v) => !v)}
              aria-pressed={showOutline}
              aria-label="Show sections"
              title={showOutline ? "Hide sections" : "Show sections"}
            >
              <Icon name="sidebar" />
            </button>
          )}
          <Popover
            className="source"
            label="Source files"
            trigger={
              <>
                <span className="src-icon">{working ? <span className="spinner" aria-hidden="true" /> : <Icon name="file" size={15} />}</span>
                <span className="src-text">
                  <b>{doc.title}</b>
                  <small>{working ? "Reading…" : `${ev.inputs.length} file${ev.inputs.length === 1 ? "" : "s"}${session.sample ? " · sample" : ""}`}</small>
                </span>
                <Icon name="caret" size={14} />
              </>
            }
          >
            {(close) => (
              <div className="source-menu">
                <p className="menu-title">Source files</p>
                <ul className="inputs">
                  {ev.inputs.map((i) => (
                    <li key={i.name}>
                      <Icon name={i.format === "unknown" ? "close" : "check"} size={14} className={i.format === "unknown" ? "bad" : "good"} />
                      <span className="input-name" title={i.name}>
                        {i.name}
                      </span>
                      <span className="input-meta">
                        {ADAPTERS[i.format].label}
                        {i.platformVersion ? ` · ${i.platformVersion}` : ""}
                        {i.size ? ` · ${fmtBytes(i.size)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                <dl className="counts">
                  {counts.map((c) => (
                    <div key={c.label}>
                      <dt>{c.n.toLocaleString()}</dt>
                      <dd>{c.label}</dd>
                    </div>
                  ))}
                </dl>
                {extractor.state.phase === "done" && extractor.state.ms > 0 && (
                  <p className="hint">
                    <Icon name="shield" size={12} /> Read on this device in {fmtMs(extractor.state.ms)}.
                  </p>
                )}
                {issues > 0 && (
                  <button className="menu-link warn" onClick={() => (setTab("coverage"), close())}>
                    <Icon name="alert" size={14} />
                    <span>
                      {[notRead.length && `${notRead.length} resource type${notRead.length > 1 ? "s" : ""} not fully read`, gaps && `${gaps} unresolved reference${gaps > 1 ? "s" : ""}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <Icon name="chevron" size={12} />
                  </button>
                )}
                <div className="menu-actions">
                  <button className="button" onClick={() => (pick.current?.click(), close())}>
                    <Icon name="plus" size={14} /> Add files
                  </button>
                  <button
                    className="button"
                    onClick={() => {
                      if (confirm("Start over? Anything you've changed here is lost unless you saved a workspace.")) {
                        close();
                        ws.reset();
                      }
                    }}
                  >
                    <Icon name="restart" size={14} /> Start over
                  </button>
                </div>
              </div>
            )}
          </Popover>
        </div>

        <Segmented<Tab>
          label="View"
          value={tab}
          onChange={setTab}
          options={[
            { value: "document", label: "Document" },
            { value: "evidence", label: "Evidence" },
            { value: "coverage", label: "Coverage", badge: issues || undefined, title: issues ? `${issues} to look at` : undefined },
          ]}
        />

        <div className="ws-bar-end">
          {docTab && (
            <button className={`button${showCustomize ? " pressed" : ""}`} onClick={() => setShowCustomize((v) => !v)} aria-pressed={showCustomize}>
              <Icon name="sliders" size={15} />
              <span className="lbl">Customize</span>
            </button>
          )}
          <button className="button primary" onClick={() => setExportOpen(true)}>
            <Icon name="download" size={15} />
            <span className="lbl">Export</span>
          </button>
        </div>
      </div>

      <div className="ws-body">
        {docTab && showOutline && (
          <aside className="ws-outline" aria-label="Pack and sections">
            <Outline api={ws} document={doc} active={active} onJump={showSection} />
          </aside>
        )}
        <main className="ws-stage">
          <iframe ref={frame} className="preview" hidden={!docTab} title="Document preview" sandbox="allow-same-origin allow-modals" srcDoc={html} onLoad={onFrameLoad} />
          {tab === "evidence" && <EvidenceExplorer evidence={ev} document={doc} focus={focus} setFocus={setFocus} showSection={showSection} />}
          {tab === "coverage" && <Coverage evidence={ev} />}
        </main>
        {docTab && showCustomize && (
          <aside className="ws-customize" aria-label="Customize">
            <CustomizePanel api={ws} notify={notify} onClose={() => setShowCustomize(false)} />
          </aside>
        )}
        {overlayOpen && <div className="ws-backdrop" onClick={() => (setShowOutline(false), setShowCustomize(false))} />}
      </div>

      {dragging && (
        <div className="ws-drop" onDragOver={(e) => e.preventDefault()} onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)} onDrop={onDrop}>
          <div>
            <Icon name="upload" size={22} />
            <b>Drop to add to this workspace</b>
            <span>Backups, project exports and tag exports</span>
          </div>
        </div>
      )}

      <ExportDialog api={ws} document={doc} frame={frame} notify={notify} open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  );
}
