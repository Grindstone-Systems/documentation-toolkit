import { useEffect, useMemo, useRef, useState } from "react";
import { THEMES, type Screenshot, type ToolkitConfig } from "../../../lib/config.ts";
import { PACKS, STATUS_LABEL, type PackId } from "../../../lib/document/model.ts";
import { packSections } from "../../../lib/document/packs.ts";
import { reencode } from "./images.ts";
import { Section, Segmented } from "../ui/controls.tsx";
import { Icon } from "../ui/icons.tsx";
import type { SessionApi } from "./session.ts";


/** A deliberately small editor: identity, a few appearance choices, sections and short context. */
export function PersonalizePanel({ api, notify }: { api: SessionApi; notify: (m: string) => void }) {
  const { session, setConfig, setSession } = api;
  const cfg = session.config;
  const logoInput = useRef<HTMLInputElement>(null);
  const shotInput = useRef<HTMLInputElement>(null);
  const all = useMemo(() => (session.evidence ? packSections(session.evidence, cfg) : []), [session.evidence, cfg]);
  const pack = PACKS.find((p) => p.id === cfg.pack)!;

  const id = <K extends keyof ToolkitConfig["identity"]>(k: K) => ({
    value: cfg.identity[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setConfig((c) => ({ ...c, identity: { ...c.identity, [k]: e.target.value } })),
  });

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

  return (
    <>
      <Section step="3" title="Personalize">
        <label className="field">
          <span>Pack</span>
          <select value={cfg.pack} onChange={(e) => setConfig((c) => ({ ...c, pack: e.target.value as PackId }))}>
            {PACKS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">{pack.summary}</p>

        <div className="grid2 fields2">
          <label className="field span2">
            <span>Document title</span>
            <input type="text" placeholder={all.length ? "From the project name" : ""} {...id("project")} />
          </label>
          <label className="field span2">
            <span>Customer</span>
            <input type="text" {...id("customer")} />
          </label>
          <label className="field">
            <span>Revision</span>
            <input type="text" {...id("revision")} />
          </label>
          <label className="field">
            <span>Date</span>
            <input type="date" {...id("date")} />
          </label>
          <label className="field span2">
            <span>Prepared by</span>
            <input type="text" {...id("author")} />
          </label>
          <label className="field span2">
            <span>Confidentiality label</span>
            <input type="text" {...id("confidentiality")} />
          </label>
        </div>

        <div className="logo-row">
          <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => (void setLogo(e.target.files?.[0]), (e.target.value = ""))} />
          <button onClick={() => logoInput.current?.click()}>
            <Icon name="image" size={14} /> {cfg.logo ? "Replace logo" : "Add customer logo"}
          </button>
          {cfg.logo && (
            <button onClick={() => setSession((s) => ({ ...s, assets: new Map([...s.assets].filter(([p]) => p !== s.config.logo)), config: { ...s.config, logo: undefined } }))} aria-label="Remove logo">
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      </Section>

      <Section step="" title="Appearance">
        <Segmented value={cfg.appearance.theme} onChange={(theme) => setConfig((c) => ({ ...c, appearance: { ...c.appearance, theme } }))} options={THEMES.map((t) => ({ value: t.id, label: t.label }))} />
        <div className="grid2">
          <Segmented
            value={cfg.appearance.paper}
            onChange={(paper) => setConfig((c) => ({ ...c, appearance: { ...c.appearance, paper } }))}
            options={[
              { value: "letter", label: "Letter" },
              { value: "a4", label: "A4" },
            ]}
          />
          <Segmented
            value={cfg.appearance.density}
            onChange={(density) => setConfig((c) => ({ ...c, appearance: { ...c.appearance, density } }))}
            options={[
              { value: "standard", label: "Standard" },
              { value: "compact", label: "Compact" },
            ]}
          />
        </div>
        <label className="field toggle">
          <span>Accent colour</span>
          <input type="color" value={cfg.appearance.accent} disabled={cfg.appearance.theme === "mono"} onChange={(e) => setConfig((c) => ({ ...c, appearance: { ...c.appearance, accent: e.target.value } }))} />
        </label>
        <label className="field toggle">
          <span>“Generated with” credit in the footer</span>
          <input type="checkbox" role="switch" checked={cfg.credit} onChange={(e) => setConfig((c) => ({ ...c, credit: e.target.checked }))} />
        </label>
      </Section>

      <Section step="" title="Sections" aside={`${all.filter((s) => s.id === "coverage" || !cfg.exclude.includes(s.id)).length} of ${all.length}`}>
        <ul className="section-list">
          {all.map((s) => {
            const locked = s.id === "coverage";
            const on = locked || !cfg.exclude.includes(s.id);
            return (
              <li key={s.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={locked}
                    title={locked ? "Coverage is always included" : undefined}
                    onChange={() => setConfig((c) => ({ ...c, exclude: on ? [...c.exclude, s.id] : c.exclude.filter((x) => x !== s.id) }))}
                  />
                  <span>{s.title}</span>
                </label>
                {s.status !== "extracted" && <span className={`chip-status st-${s.status}`}>{STATUS_LABEL[s.status]}</span>}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section step="" title="Screenshots" aside={cfg.screenshots.length ? String(cfg.screenshots.length) : undefined}>
        <input ref={shotInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => (e.target.files && void addShots(e.target.files), (e.target.value = ""))} />
        <ul className="shots">
          {cfg.screenshots.map((sh) => (
            <li key={sh.asset}>
              <Thumb bytes={session.assets.get(sh.asset)} />
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
              <button aria-label="Remove screenshot" onClick={() => updateShot(sh.asset, null)}>
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
        <button onClick={() => shotInput.current?.click()}>
          <Icon name="image" size={14} /> Add screenshots
        </button>
        <p className="hint">Captured from the running system. Metadata is removed on this device.</p>
      </Section>

      <Section step="" title="Context">
        <label className="field">
          <span>What this system does</span>
          <textarea
            rows={3}
            placeholder="Purpose, site and who uses it. Shown as confirmed text."
            value={cfg.context.systemDescription}
            onChange={(e) => setConfig((c) => ({ ...c, context: { ...c.context, systemDescription: e.target.value } }))}
          />
        </label>
        {(cfg.pack === "operator-manual" || cfg.pack === "complete-handoff") && (
          <label className="field">
            <span>Approved operating procedures</span>
            <textarea
              rows={4}
              placeholder="Paste approved procedures. They're used word for word."
              value={cfg.context.procedures}
              onChange={(e) => setConfig((c) => ({ ...c, context: { ...c.context, procedures: e.target.value } }))}
            />
          </label>
        )}
      </Section>
    </>
  );
}

/** Preview for an in-memory image; the object URL is released when it changes. */
function Thumb({ bytes }: { bytes?: Uint8Array }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!bytes) return;
    const u = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>]));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [bytes]);
  return url ? <img className="shot-thumb" src={url} alt="" /> : <span className="shot-thumb" />;
}
