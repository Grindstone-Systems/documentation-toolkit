import { useMemo, useState, type RefObject } from "react";
import type { DocumentModel } from "../../../lib/document/model.ts";
import { inventoryCsvs } from "../../../lib/render/csv.ts";
import { slug } from "../../../lib/render/escape.ts";
import { renderHtml } from "../../../lib/render/html.ts";
import type { Sensitivity } from "../../../lib/types.ts";
import { dataUris, zipFiles } from "../../../lib/workspace.ts";
import { downloadBlob } from "../download.ts";
import { FileBadge, Modal } from "../ui/controls.tsx";
import { Icon } from "../ui/icons.tsx";
import type { SessionApi } from "./session.ts";

const SENSITIVE: { key: Sensitivity; flag: "addresses" | "usernames" | "code"; label: string; hint: string }[] = [
  { key: "address", flag: "addresses", label: "Network addresses", hint: "IPs and hostnames of devices and servers" },
  { key: "username", flag: "usernames", label: "Usernames", hint: "Accounts named in connections and user sources" },
  { key: "code", flag: "code", label: "Script and SQL source", hint: "Full text of scripts and named queries" },
];

type Format = "html" | "docx" | "pdf" | "csv" | "workspace";

export function ExportDialog({
  api,
  document: doc,
  frame,
  notify,
  open,
  onClose,
}: {
  api: SessionApi;
  document: DocumentModel;
  frame: RefObject<HTMLIFrameElement | null>;
  notify: (m: string) => void;
  open: boolean;
  onClose: () => void;
}) {
  const { session, setConfig } = api;
  const [busy, setBusy] = useState<Format | null>(null);
  const cfg = session.config;
  const ev = session.evidence!;
  const base = slug(cfg.identity.project || doc.title) || "documentation";

  // What the pack could reveal, so redaction is a visible choice rather than a guess.
  const exposure = useMemo(() => {
    const n: Record<Sensitivity, number> = { address: 0, username: 0, code: 0 };
    for (const e of ev.entities) for (const s of Object.values(e.sensitive ?? {})) n[s]++;
    return n;
  }, [ev]);
  const secrets = ev.diagnostics.find((d) => d.code === "secrets-excluded");
  const unresolved = doc.sections.filter((s) => s.status === "unresolved").length;

  const run = async (f: Format, job: () => Promise<void> | void) => {
    setBusy(f);
    try {
      await job();
    } catch (e) {
      notify(`Couldn't export: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const FORMATS: { id: Format; ext: string; title: string; text: string; action: string; aria: string; job: () => Promise<void> | void }[] = [
    {
      id: "html",
      ext: "HTML",
      title: "Reference",
      text: "One self-contained file with search. Opens offline in any browser.",
      action: "Download",
      aria: "Download Reference (HTML)",
      job: () => {
        // The preview omits search (it runs no scripts); the saved file gets the full version.
        const full = renderHtml(doc, cfg, { assets: dataUris(session.assets) });
        downloadBlob(new Blob([full], { type: "text/html" }), `${base}-reference.html`);
        notify("Saved. The file opens offline in any browser.");
      },
    },
    {
      id: "docx",
      ext: "DOCX",
      title: "Word document",
      text: "Editable headings, tables and captions for your own template.",
      action: "Download",
      aria: "Download Word (.docx)",
      job: async () => {
        const { renderDocx } = await import("../../../lib/exports.ts");
        const bytes = await renderDocx(doc, cfg, { assets: session.assets });
        downloadBlob(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), `${base}-reference.docx`);
        notify("Saved. Headings, tables and captions are editable in Word.");
      },
    },
    {
      id: "pdf",
      ext: "PDF",
      title: "Print or PDF",
      text: "Paginated for print. Choose “Save as PDF” in the print dialog.",
      action: "Print",
      aria: "Print / PDF",
      job: () => {
        onClose();
        frame.current?.contentWindow?.print();
      },
    },
    {
      id: "csv",
      ext: "CSV",
      title: "Inventories",
      text: "Tags, alarms, screens and more as spreadsheets, in one ZIP.",
      action: "Download",
      aria: "Download Inventories (CSV)",
      job: () => {
        const files = inventoryCsvs(ev, cfg).map((c) => ({ path: c.path, content: c.content }));
        downloadBlob(new Blob([zipFiles(files, `${base}-inventories/`) as Uint8Array<ArrayBuffer>], { type: "application/zip" }), `${base}-inventories.zip`);
      },
    },
    {
      id: "workspace",
      ext: "ZIP",
      title: "Agent workspace",
      text: "Evidence and editable Markdown for Claude Code, Codex or any assistant. Reopen it here to rebuild with your edits.",
      action: "Save",
      aria: "Save workspace (.zip)",
      job: async () => {
        const { workspaceWithExports } = await import("../../../lib/exports.ts");
        const files = await workspaceWithExports({ config: cfg, evidence: ev, document: doc, assets: session.assets });
        downloadBlob(new Blob([zipFiles(files, `${base}-workspace/`) as Uint8Array<ArrayBuffer>], { type: "application/zip" }), `${base}-workspace.zip`);
        notify("Workspace saved. Unzip it and point your assistant at the folder.");
      },
    },
  ];

  return (
    <Modal open={open} onClose={onClose} title="Export" subtitle={<>Everything is built on this device from what you see in the preview.</>}>
      <div className="export-grid">
        <ul className="formats-list">
          {FORMATS.map((f) => (
            <li key={f.id} className={f.id === "workspace" ? "agent" : ""}>
              <FileBadge ext={f.ext} tone={f.id === "html" ? "brand" : "neutral"} />
              <div className="fl-text">
                <b>
                  {f.title}
                  {f.id === "html" && <span className="rec">Recommended</span>}
                </b>
                <span>{f.text}</span>
              </div>
              <button className={f.id === "html" ? "button primary" : "button"} disabled={busy !== null} aria-label={f.aria} onClick={() => void run(f.id, f.job)}>
                {busy === f.id ? <span className="spinner" aria-hidden="true" /> : <Icon name={f.id === "pdf" ? "print" : "download"} size={14} />}
                {f.action}
              </button>
            </li>
          ))}
        </ul>

        <aside className="share-box">
          <h3>What's included</h3>
          <ul className="share-list">
            {SENSITIVE.map((s) => (
              <li key={s.key}>
                <label className="switch-row">
                  <span>
                    <b>
                      {s.label} <em>{exposure[s.key]}</em>
                    </b>
                    <small>{s.hint}</small>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={!cfg.redact[s.flag]}
                    disabled={!exposure[s.key]}
                    aria-label={`Include ${s.label.toLowerCase()}`}
                    onChange={(e) => setConfig((c) => ({ ...c, redact: { ...c.redact, [s.flag]: !e.target.checked } }))}
                  />
                </label>
              </li>
            ))}
          </ul>
          <p className="hint">
            <Icon name="shield" size={13} /> Passwords and keys are never read{secrets ? ` (${secrets.message.match(/^\d+/)?.[0] ?? "some"} excluded)` : ""}. Detection can miss
            things, so review before you share.
          </p>
          {unresolved > 0 && (
            <p className="hint warn">
              <Icon name="alert" size={13} /> {unresolved} section{unresolved > 1 ? "s" : ""} still need{unresolved > 1 ? "" : "s"} input from the site and will export marked
              Unresolved.
            </p>
          )}
          <p className="hint">A cloud-based assistant sends what it reads to its provider. Processing here stays on this device.</p>
        </aside>
      </div>
    </Modal>
  );
}
