import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ADAPTERS } from "../../../lib/extract.ts";
import { renderHtml } from "../../../lib/render/html.ts";
import { unresolved } from "../../../lib/resolve.ts";
import { dataUris } from "../../../lib/workspace.ts";
import { Segmented } from "../ui/controls.tsx";
import { Icon } from "../ui/icons.tsx";
import { EvidenceExplorer } from "./EvidenceExplorer.tsx";
import { ExportPanel } from "./ExportPanel.tsx";
import { PersonalizePanel } from "./PersonalizePanel.tsx";
import { loadSample } from "./sample.ts";
import type { SessionApi } from "./session.ts";
import { useExtractor } from "./useExtractor.ts";

type Tab = "document" | "evidence" | "coverage";

const ACCEPT = ".gwbk,.zip,.json";
const fmtBytes = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function WorkspacePage({ api, notify, openSample }: { api: SessionApi; notify: (m: string) => void; openSample: boolean }) {
  const { session, setSession, document: doc, openWorkspace } = api;
  const [tab, setTab] = useState<Tab>("document");
  const [dragging, setDragging] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const pickWorkspace = useRef<HTMLInputElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [focus, setFocus] = useState<string | undefined>();

  const extractor = useExtractor(
    (evidence) => setSession((s) => ({ ...s, evidence })),
    (ws) => {
      openWorkspace(ws);
      notify("Workspace reopened. Your edits are kept.");
    },
  );

  const runFiles = useCallback(
    async (files: File[], sample: boolean) => {
      const texts = sample ? await loadSample() : undefined;
      setSession((s) => ({ ...s, files, sample }));
      extractor.run({
        type: "extract",
        files,
        texts: texts
          ? [
              { name: "Riverbend", files: texts.project },
              { name: "riverbend-tags.json", files: texts.tags },
            ]
          : undefined,
      });
    },
    [extractor, setSession],
  );

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      const incoming = [...list];
      const ws = incoming.find((f) => /workspace.*\.zip$|\.oicdocs\.zip$/i.test(f.name));
      if (ws && incoming.length === 1) {
        extractor.run({ type: "open-workspace", file: ws });
        return;
      }
      const names = new Set(incoming.map((f) => f.name));
      void runFiles([...session.files.filter((f) => !names.has(f.name)), ...incoming], session.sample);
    },
    [extractor, runFiles, session.files, session.sample],
  );

  // #/workspace/sample opens the sample once.
  const sampled = useRef(false);
  useEffect(() => {
    if (openSample && !sampled.current && !session.evidence) {
      sampled.current = true;
      void runFiles([], true);
    }
  }, [openSample, runFiles, session.evidence]);

  const assets = useMemo(() => dataUris(session.assets), [session.assets]);
  const deferredDoc = useDeferredValue(doc);
  const deferredConfig = useDeferredValue(session.config);
  const html = useMemo(() => (deferredDoc ? renderHtml(deferredDoc, deferredConfig, { assets, search: false }) : ""), [deferredDoc, deferredConfig, assets]);

  // The preview reloads whenever the document changes; keep the reader's place.
  const scrollY = useRef(0);
  const jumpTo = useRef<string | undefined>(undefined);
  const jump = (id: string) => {
    const w = frame.current?.contentWindow;
    const el = frame.current?.contentDocument?.getElementById(`s-${id}`);
    if (!w || !el) return false;
    // Scroll only the preview, never the app around it.
    w.scrollTo({ top: el.getBoundingClientRect().top + w.scrollY - 8, behavior: "instant" });
    el.animate?.([{ background: "color-mix(in srgb, #4a9fd0 18%, transparent)" }, { background: "transparent" }], { duration: 1400 });
    return true;
  };
  const onFrameLoad = () => {
    const w = frame.current?.contentWindow;
    if (!w) return;
    if (jumpTo.current && jump(jumpTo.current)) jumpTo.current = undefined;
    else w.scrollTo(0, scrollY.current);
    w.addEventListener("scroll", () => (scrollY.current = w.scrollY), { passive: true });
  };
  // Jump after the preview is visible again; if it's still loading, onFrameLoad finishes the job.
  const [jumpTick, setJumpTick] = useState(0);
  const showSection = useCallback((id: string) => {
    jumpTo.current = id;
    setTab("document");
    setJumpTick((n) => n + 1);
  }, []);
  useEffect(() => {
    if (tab === "document" && jumpTo.current && jump(jumpTo.current)) jumpTo.current = undefined;
  }, [tab, jumpTick]);

  const empty = !session.evidence && extractor.state.phase !== "working";
  const ev = session.evidence;

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  const hidden = (
    <>
      <input ref={pick} type="file" accept={ACCEPT} multiple hidden onChange={(e) => (e.target.files && addFiles(e.target.files), (e.target.value = ""))} />
      <input ref={pickWorkspace} type="file" accept=".zip" hidden onChange={(e) => (e.target.files?.[0] && extractor.run({ type: "open-workspace", file: e.target.files[0] }), (e.target.value = ""))} />
    </>
  );

  if (empty) {
    return (
      <div className={`page open-page${dragging ? " dragging" : ""}`} onDragOver={(e) => (e.preventDefault(), setDragging(true))} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
        {hidden}
        <div className="dropzone">
          <span className="drop-icon">
            <Icon name="upload" size={22} />
          </span>
          <h1>Open a backup or project</h1>
          <p className="lede">Drop an Ignition gateway backup (.gwbk), a project export (.zip) or a tag export (.json). You can add several.</p>
          <div className="hero-actions center">
            <button className="primary" onClick={() => pick.current?.click()}>
              <Icon name="folder" /> Choose files
            </button>
            <button className="secondary" onClick={() => void runFiles([], true)}>
              <Icon name="sample" /> Explore the sample
            </button>
            <button className="secondary" onClick={() => pickWorkspace.current?.click()}>
              Reopen a workspace
            </button>
          </div>
          <p className="privacy">
            <Icon name="shield" size={14} /> Files are processed on this device. Nothing is uploaded, and nothing is kept after you close the tab.
          </p>
          <p className="hint">Experimental: check generated documents against the source before relying on them.</p>
          {extractor.state.phase === "error" && <p className="error-note">{extractor.state.message}</p>}
        </div>
        <SupportTable />
      </div>
    );
  }

  const gaps = ev ? unresolved(ev).length : 0;
  const notRead = ev ? ev.coverage.filter((c) => c.read < c.found) : [];

  return (
    <div className="workspace" onDragOver={(e) => (e.preventDefault(), setDragging(true))} onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)} onDrop={onDrop}>
      {hidden}
      <aside className="panel left">
        <section className="section">
          <h2>
            <b>1</b> Inputs
          </h2>
          <ul className="inputs">
            {ev?.inputs.map((i) => (
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
            {!ev && session.previous && <li className="muted">Reopened workspace</li>}
          </ul>
          <div className="grid2">
            <button onClick={() => pick.current?.click()}>
              <Icon name="upload" size={14} /> Add files
            </button>
            <button onClick={() => (api.reset(), extractor.cancel())}>Start over</button>
          </div>
          <p className="hint">
            <Icon name="shield" size={12} /> Processed on this device.
          </p>
        </section>

        <section className="section">
          <h2>
            <b>2</b> Inspect
            {extractor.state.phase === "done" && extractor.state.ms > 0 && <span className="aside">{extractor.state.ms < 1000 ? `${extractor.state.ms} ms` : `${(extractor.state.ms / 1000).toFixed(1)} s`}</span>}
          </h2>
          {extractor.state.phase === "working" && (
            <ul className="progress">
              {extractor.state.log.map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
              <li className="spin">Working…</li>
            </ul>
          )}
          {extractor.state.phase === "error" && <p className="error-note">{extractor.state.message}</p>}
          {ev && (
            <>
              <dl className="counts">
                {COUNTS.map(([one, many, kinds]) => {
                  const n = ev.entities.filter((e) => kinds.includes(e.kind)).length;
                  return n ? (
                    <div key={many}>
                      <dt>{n.toLocaleString()}</dt>
                      <dd>{n === 1 ? one : many}</dd>
                    </div>
                  ) : null;
                })}
              </dl>
              {(notRead.length > 0 || gaps > 0) && (
                <button className="link-row" onClick={() => setTab("coverage")}>
                  {notRead.length > 0 && <span>{notRead.length} resource type{notRead.length > 1 ? "s" : ""} not fully read</span>}
                  {gaps > 0 && <span>{gaps} unresolved reference{gaps > 1 ? "s" : ""}</span>}
                  <Icon name="chevron" size={12} />
                </button>
              )}
              {ev.diagnostics
                .filter((d) => d.level === "error")
                .map((d, i) => (
                  <p key={i} className="error-note">
                    {d.message}
                  </p>
                ))}
            </>
          )}
        </section>
      </aside>

      <main className={`stage${dragging ? " dragging" : ""}`}>
        <div className="stage-tools">
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "document", label: "Document" },
              { value: "evidence", label: "Evidence" },
              { value: "coverage", label: "Coverage" },
            ]}
          />
          {doc && (
            <span className="doc-status">
              {(["extracted", "ai-draft", "confirmed", "unresolved"] as const).map((st) => {
                const n = doc.sections.filter((s) => s.status === st).length;
                return n ? (
                  <span key={st} className={`chip-status st-${st}`}>
                    {n} {st === "ai-draft" ? "AI draft" : st}
                  </span>
                ) : null;
              })}
            </span>
          )}
        </div>
        {html ? (
          <iframe ref={frame} className="preview" hidden={tab !== "document"} title="Document preview" sandbox="allow-same-origin allow-modals" srcDoc={html} onLoad={onFrameLoad} />
        ) : (
          tab === "document" && <div className="stage-empty">Reading…</div>
        )}
        {tab === "evidence" && ev && doc && <EvidenceExplorer evidence={ev} document={doc} focus={focus} setFocus={setFocus} showSection={showSection} />}
        {tab === "coverage" && ev && <Coverage evidence={ev} />}
        {dragging && <div className="drop-hint">Drop to add files</div>}
      </main>

      <aside className="panel right">
        {ev && doc && (
          <>
            <PersonalizePanel api={api} notify={notify} />
            <ExportPanel api={api} document={doc} frame={frame} notify={notify} />
          </>
        )}
      </aside>
    </div>
  );
}

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

function Coverage({ evidence }: { evidence: NonNullable<SessionApi["session"]["evidence"]> }) {
  const gaps = unresolved(evidence);
  return (
    <div className="stage-scroll">
      <h2 className="block-title">Found and read</h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Resource type</th>
              <th className="num">Found</th>
              <th className="num">Read</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {evidence.coverage.map((c) => (
              <tr key={c.key} className={c.read < c.found ? "partial" : ""}>
                <td>{c.label}</td>
                <td className="num">{c.found.toLocaleString()}</td>
                <td className="num">{c.read.toLocaleString()}</td>
                <td className="muted">{c.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {evidence.diagnostics.length > 0 && (
        <>
          <h2 className="block-title">Diagnostics</h2>
          <ul className="diag">
            {evidence.diagnostics.slice(0, 200).map((d, i) => (
              <li key={i} className={d.level}>
                <b>{d.level}</b> {d.message}
                {d.source?.path && <code>{d.source.path}</code>}
              </li>
            ))}
          </ul>
        </>
      )}
      <h2 className="block-title">Unresolved references ({gaps.length})</h2>
      {gaps.length ? (
        <ul className="diag">
          {gaps.slice(0, 200).map((r, i) => (
            <li key={i}>
              <code>{r.target}</code> {r.type.replace(/-/g, " ")} from <code>{r.from}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Every static reference resolved.</p>
      )}
    </div>
  );
}

function SupportTable() {
  return (
    <section className="block support">
      <h2 className="block-title">What it reads today</h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Input</th>
              <th>What gets documented</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Project export (.zip), Ignition 8.x</td>
              <td>Perspective pages, views and bindings, project scripts, named queries, gateway event scripts. Vision, reports and other modules are listed by name.</td>
              <td>
                <span className="pill pill--preview">Preview</span>
              </td>
            </tr>
            <tr>
              <td>Tag export (.json)</td>
              <td>Folders, tags, UDT definitions and instances, alarms. UDT members are expanded with parameters substituted.</td>
              <td>
                <span className="pill pill--preview">Preview</span>
              </td>
            </tr>
            <tr>
              <td>Gateway backup (.gwbk), Ignition 8.3</td>
              <td>All projects, plus tags, tag providers, OPC and database connections, user sources and other gateway settings. Credentials are never read.</td>
              <td>
                <span className="pill pill--preview">Preview</span>
              </td>
            </tr>
            <tr>
              <td>Gateway backup (.gwbk), Ignition 8.1</td>
              <td>All projects. Gateway configuration lives in an internal database that isn't decoded yet, so add a tag export.</td>
              <td>
                <span className="pill">Projects only</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="hint">Tested against synthetic fixtures and a small number of real 8.1 and 8.3 backups. Unsupported content is counted and shown, never silently dropped.</p>
    </section>
  );
}
