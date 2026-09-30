import { useMemo, useState, type RefObject } from "react";
import type { DocumentModel } from "../../../lib/document/model.ts";
import { inventoryCsvs } from "../../../lib/render/csv.ts";
import { slug } from "../../../lib/render/escape.ts";
import type { Sensitivity } from "../../../lib/types.ts";
import { renderHtml } from "../../../lib/render/html.ts";
import { dataUris, zipFiles } from "../../../lib/workspace.ts";
import { downloadBlob } from "../download.ts";
import { Section } from "../ui/controls.tsx";
import { Icon } from "../ui/icons.tsx";
import type { SessionApi } from "./session.ts";

const SENSITIVE: { key: Sensitivity; flag: "addresses" | "usernames" | "code"; label: string }[] = [
  { key: "address", flag: "addresses", label: "Network addresses" },
  { key: "username", flag: "usernames", label: "Usernames" },
  { key: "code", flag: "code", label: "Script and SQL source" },
];

export function ExportPanel({ api, document: doc, frame, notify }: { api: SessionApi; document: DocumentModel; frame: RefObject<HTMLIFrameElement | null>; notify: (m: string) => void }) {
  const { session, setConfig } = api;
  const [busy, setBusy] = useState(false);
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

  const ws = () => ({ config: cfg, evidence: ev, document: doc, assets: session.assets });

  return (
    <>
      <Section step="4" title="Review what's shared">
        <ul className="exposure">
          {SENSITIVE.map((s) => (
            <li key={s.key}>
              <label className="field toggle">
                <span>
                  {s.label} <em>{exposure[s.key]}</em>
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
          <Icon name="shield" size={12} /> Passwords and keys are never read{secrets ? ` (${secrets.message.match(/^\d+/)?.[0] ?? "some"} excluded)` : ""}. Automatic detection can miss things, so review the pack before you share it.
        </p>
      </Section>

      <Section step="5" title="Export">
        <button className="primary wide" onClick={() => {
            // The preview omits search (it runs no scripts); the saved file gets the full version.
            const full = renderHtml(doc, cfg, { assets: dataUris(session.assets) });
            downloadBlob(new Blob([full], { type: "text/html" }), `${base}-reference.html`);
            notify("Saved. The file opens offline in any browser.");
          }}>
          <Icon name="download" /> Reference (HTML)
        </button>
        <div className="grid2">
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const { renderDocx } = await import("../../../lib/exports.ts");
                const bytes = await renderDocx(doc, cfg, { assets: session.assets });
                downloadBlob(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), `${base}-reference.docx`);
                notify("Saved. Headings, tables and captions are editable in Word.");
              } catch (e) {
                notify(`Couldn't build the Word file: ${(e as Error).message}`);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Icon name="word" size={14} /> Word (.docx)
          </button>
          <button onClick={() => frame.current?.contentWindow?.print()} title="Opens the print dialog; choose Save as PDF">
            <Icon name="print" size={14} /> Print / PDF
          </button>
          <button
            className="span2"
            onClick={() => {
              const files = inventoryCsvs(ev, cfg).map((c) => ({ path: c.path, content: c.content }));
              downloadBlob(new Blob([zipFiles(files, `${base}-inventories/`) as Uint8Array<ArrayBuffer>], { type: "application/zip" }), `${base}-inventories.zip`);
            }}
          >
            <Icon name="table" size={14} /> Inventories (CSV)
          </button>
        </div>
        <div className="agent-box">
          <p>
            <strong>Agent workspace</strong> — evidence, editable Markdown sections and instructions for Claude Code, Codex or any assistant. Reopen it here to rebuild with your edits.
          </p>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const { workspaceWithExports } = await import("../../../lib/exports.ts");
              const files = await workspaceWithExports(ws()).finally(() => setBusy(false));
              downloadBlob(new Blob([zipFiles(files, `${base}-workspace/`) as Uint8Array<ArrayBuffer>], { type: "application/zip" }), `${base}-workspace.zip`);
              notify("Workspace saved. Unzip it and point your assistant at the folder.");
            }}
          >
            <Icon name="agent" size={14} /> Save workspace (.zip)
          </button>
          <p className="hint">If you hand the workspace to a cloud-based assistant, the evidence in it goes to that provider under its terms. Processing here stays on this device.</p>
        </div>
      </Section>
    </>
  );
}
