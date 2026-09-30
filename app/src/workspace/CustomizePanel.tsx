import { useEffect, useMemo, useRef, useState } from "react";
import { THEMES, type Screenshot, type ToolkitConfig } from "../../../lib/config.ts";
import { THEME_TOKENS } from "../../../lib/render/html.ts";
import { Segmented } from "../ui/controls.tsx";
import { Icon } from "../ui/icons.tsx";
import { reencode } from "./images.ts";
import type { SessionApi } from "./session.ts";

type Tab = "details" | "style" | "content";

const ACCENTS = ["#2d6a8e", "#1f7a5a", "#b4541a", "#8a3ffc", "#b42343", "#3a4a5c"];

/** Identity, appearance and site context: the things a person adds to the generated pack. */
export function CustomizePanel({ api, notify, onClose }: { api: SessionApi; notify: (m: string) => void; onClose: () => void }) {
  const { session, setConfig, setSession, document: doc } = api;
  const cfg = session.config;
  const [tab, setTab] = useState<Tab>("details");
  const logoInput = useRef<HTMLInputElement>(null);
  const shotInput = useRef<HTMLInputElement>(null);

  const id = <K extends keyof ToolkitConfig["identity"]>(k: K) => ({
    value: cfg.identity[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setConfig((c) => ({ ...c, identity: { ...c.identity, [k]: e.target.value } })),
  });
  const appearance = (patch: Partial<ToolkitConfig["appearance"]>) => setConfig((c) => ({ ...c, appearance: { ...c.appearance, ...patch } }));

  const setLogo = async (file?: File) => {
    if (!file) return;
    try {
      const bytes = await reencode(file, { maxWidth: 800, type: "image/png" });
      setSession((s) => {
        const assets = new Map([...s.assets].filter(([p]) => !p.startsWith("assets/logo.")));
        assets.set("assets/logo.png", bytes);
        return { ...s, assets, config: { ...s.config, logo: "assets/logo.png" } };
      });
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const removeLogo = () => setSession((s) => ({ ...s, assets: new Map([...s.assets].filter(([p]) => p !== s.config.logo)), config: { ...s.config, logo: undefined } }));

  const pages = useMemo(() => (session.evidence?.entities ?? []).filter((e) => e.kind === "page"), [session.evidence]);
  const addShots = async (files: FileList) => {
    const added: { path: string; bytes: Uint8Array; caption: string }[] = [];
    let n = Math.max(0, ...[...session.assets.keys()].map((p) => Number(p.match(/^assets\/screen-(\d+)\.jpg$/)?.[1] ?? 0)));
    for (const f of [...files]) {
      try {
        added.push({ path: `assets/screen-${++n}.jpg`, bytes: await reencode(f, { maxWidth: 2000, type: "image/jpeg" }), caption: f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ") });
      } catch (e) {
        notify((e as Error).message);
      }
    }
    if (!added.length) return;
    setSession((s) => {
      const assets = new Map(s.assets);
      for (const a of added) assets.set(a.path, a.bytes);
      return { ...s, assets, config: { ...s.config, screenshots: [...s.config.screenshots, ...added.map((a) => ({ asset: a.path, caption: a.caption }))] } };
    });
  };
  const updateShot = (asset: string, patch: Partial<Screenshot> | null) =>
    setSession((s) => ({
      ...s,
      assets: patch ? s.assets : new Map([...s.assets].filter(([p]) => p !== asset)),
      config: { ...s.config, screenshots: patch ? s.config.screenshots.map((x) => (x.asset === asset ? { ...x, ...patch } : x)) : s.config.screenshots.filter((x) => x.asset !== asset) },
    }));

  const procedures = cfg.pack === "operator-manual" || cfg.pack === "complete-handoff";

  return (
    <div className="customize">
      <header className="cz-head">
        <h2>Customize</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close customize panel" title="Close">
          <Icon name="close" />
        </button>
      </header>
      <div className="cz-tabs">
        <Segmented<Tab>
          label="Customize"
          value={tab}
          onChange={setTab}
          options={[
            { value: "details", label: "Details" },
            { value: "style", label: "Style" },
            { value: "content", label: "Content", badge: cfg.screenshots.length || undefined },
          ]}
        />
      </div>

      <div className="cz-body">
        {tab === "details" && (
          <>
            <label className="field">
              <span>Document title</span>
              <input type="text" placeholder={doc?.title || "From the project name"} {...id("project")} />
            </label>
            <label className="field">
              <span>Customer</span>
              <input type="text" placeholder="Who the document is for" {...id("customer")} />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Revision</span>
                <input type="text" {...id("revision")} />
              </label>
              <label className="field">
                <span>Date</span>
                <input type="date" {...id("date")} />
              </label>
            </div>
            <label className="field">
              <span>Prepared by</span>
              <input type="text" placeholder="Your name or company" {...id("author")} />
            </label>
            <label className="field">
              <span>Confidentiality label</span>
              <input type="text" placeholder="Leave empty for none" {...id("confidentiality")} />
            </label>
            <div className="field">
              <span>Customer logo</span>
              <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => (void setLogo(e.target.files?.[0]), (e.target.value = ""))} />
              {cfg.logo ? (
                <div className="logo-tile">
                  <Thumb bytes={session.assets.get(cfg.logo)} className="logo-img" />
                  <button className="btn-quiet" onClick={() => logoInput.current?.click()}>
                    Replace
                  </button>
                  <button className="icon-btn" onClick={removeLogo} aria-label="Remove logo" title="Remove logo">
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ) : (
                <button className="add-tile" onClick={() => logoInput.current?.click()}>
                  <Icon name="image" /> Add a logo <small>PNG, JPEG or WebP</small>
                </button>
              )}
            </div>
          </>
        )}

        {tab === "style" && (
          <>
            <div className="field">
              <span>Theme</span>
              <div className="themes" role="radiogroup" aria-label="Theme">
                {THEMES.map((t) => {
                  const tok = THEME_TOKENS[t.id];
                  const accent = t.id === "mono" ? "#111111" : cfg.appearance.accent;
                  return (
                    <button key={t.id} role="radio" aria-checked={cfg.appearance.theme === t.id} className={cfg.appearance.theme === t.id ? "on" : ""} onClick={() => appearance({ theme: t.id })}>
                      <span className="theme-thumb" style={{ background: tok.paper, borderColor: tok.line }}>
                        <span className="tt-cover" style={{ background: tok.cover, borderBottomColor: accent, boxShadow: t.id === "mono" ? `inset 0 0 0 1px ${tok.line}` : undefined }} />
                        <span className="tt-line" style={{ background: tok.line }} />
                        <span className="tt-line short" style={{ background: tok.line }} />
                      </span>
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="field">
              <span>Accent color</span>
              <div className={`accents${cfg.appearance.theme === "mono" ? " disabled" : ""}`} role="radiogroup" aria-label="Accent color">
                {ACCENTS.map((a) => (
                  <button
                    key={a}
                    role="radio"
                    aria-checked={cfg.appearance.accent === a}
                    aria-label={a}
                    disabled={cfg.appearance.theme === "mono"}
                    className={cfg.appearance.accent === a ? "on" : ""}
                    style={{ background: a }}
                    onClick={() => appearance({ accent: a })}
                  />
                ))}
                <label className={`accent-custom${ACCENTS.includes(cfg.appearance.accent) ? "" : " on"}`} title="Custom color">
                  <input type="color" value={cfg.appearance.accent} disabled={cfg.appearance.theme === "mono"} onChange={(e) => appearance({ accent: e.target.value })} aria-label="Custom accent color" />
                </label>
              </div>
              {cfg.appearance.theme === "mono" && <small className="hint">Monochrome prints in black only.</small>}
            </div>
            <div className="field-row">
              <div className="field">
                <span>Paper</span>
                <Segmented
                  label="Paper"
                  value={cfg.appearance.paper}
                  onChange={(paper) => appearance({ paper })}
                  options={[
                    { value: "letter", label: "Letter" },
                    { value: "a4", label: "A4" },
                  ]}
                />
              </div>
              <div className="field">
                <span>Density</span>
                <Segmented
                  label="Density"
                  value={cfg.appearance.density}
                  onChange={(density) => appearance({ density })}
                  options={[
                    { value: "standard", label: "Standard" },
                    { value: "compact", label: "Compact" },
                  ]}
                />
              </div>
            </div>
            <label className="switch-row">
              <span>
                <b>“Generated with” credit</b>
                <small>A small line in the footer</small>
              </span>
              <input type="checkbox" role="switch" checked={cfg.credit} onChange={(e) => setConfig((c) => ({ ...c, credit: e.target.checked }))} />
            </label>
          </>
        )}

        {tab === "content" && (
          <>
            <label className="field">
              <span>What this system does</span>
              <textarea
                rows={4}
                placeholder="Purpose, site and who uses it. Shown as confirmed text."
                value={cfg.context.systemDescription}
                onChange={(e) => setConfig((c) => ({ ...c, context: { ...c.context, systemDescription: e.target.value } }))}
              />
            </label>
            {procedures && (
              <label className="field">
                <span>Approved operating procedures</span>
                <textarea
                  rows={5}
                  placeholder="Paste approved procedures. They're used word for word."
                  value={cfg.context.procedures}
                  onChange={(e) => setConfig((c) => ({ ...c, context: { ...c.context, procedures: e.target.value } }))}
                />
              </label>
            )}
            <div className="field">
              <span>Screenshots</span>
              <input ref={shotInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => (e.target.files && void addShots(e.target.files), (e.target.value = ""))} />
              <ul className="shots">
                {cfg.screenshots.map((sh) => (
                  <li key={sh.asset}>
                    <Thumb bytes={session.assets.get(sh.asset)} className="shot-thumb" />
                    <div className="shot-fields">
                      <input type="text" aria-label="Caption" value={sh.caption} onChange={(e) => updateShot(sh.asset, { caption: e.target.value })} />
                      <select aria-label="Screen" value={sh.page ?? ""} onChange={(e) => updateShot(sh.asset, { page: e.target.value || undefined })}>
                        <option value="">Not attached to a screen</option>
                        {pages.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.scope} {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button className="icon-btn" aria-label="Remove screenshot" title="Remove" onClick={() => updateShot(sh.asset, null)}>
                      <Icon name="close" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
              <button className="add-tile" onClick={() => shotInput.current?.click()}>
                <Icon name="plus" /> Add screenshots <small>From the running system</small>
              </button>
              <small className="hint">Image metadata is removed on this device.</small>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Preview for an in-memory image; the object URL is released when it changes. */
function Thumb({ bytes, className }: { bytes?: Uint8Array; className: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!bytes) return;
    const u = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>]));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [bytes]);
  return url ? <img className={className} src={url} alt="" /> : <span className={className} />;
}
