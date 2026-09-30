import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CONFIG } from "../config.ts";
import { Icon, Mark, type IconName } from "../ui/icons.tsx";
import { StatusPill } from "../ui/controls.tsx";
import { GROUPS, OVERVIEW, groupOf, hrefOf, pageById, type PageId, type ToolPage } from "./tools.ts";

const REPO = `https://github.com/${CONFIG.repo}`;
const MOBILE = "(max-width: 860px)";

/** Per-viewer UI conveniences; storage can be missing or blocked, so never rely on it. */
function useStored<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      return s ? (JSON.parse(s) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* private window */
    }
  }, [key, v]);
  return [v, setV] as const;
}

export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: IconName;
  run: () => void;
}

export function Shell({
  page,
  crumb,
  counts,
  scheme,
  onToggleTheme,
  navigate,
  commands,
  children,
}: {
  page: PageId;
  /** Extra breadcrumb after the page, e.g. the generator being edited. */
  crumb?: string;
  counts: Partial<Record<PageId, number>>;
  scheme: "light" | "dark";
  onToggleTheme: () => void;
  navigate: (id: PageId) => void;
  commands: Command[];
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useStored("dt.nav.collapsed", false);
  const [closedGroups, setClosedGroups] = useStored<string[]>("dt.nav.closed", []);
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const current = pageById(page);
  const group = groupOf(page);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (id: PageId) => {
    setDrawer(false);
    navigate(id);
  };
  const toggleNav = () => (window.matchMedia(MOBILE).matches ? setDrawer((d) => !d) : setCollapsed((c) => !c));
  const toggleGroup = (id: string) => setClosedGroups((c) => (c.includes(id) ? c.filter((g) => g !== id) : [...c, id]));

  return (
    <div className={`shell${collapsed ? " nav-collapsed" : ""}${drawer ? " nav-open" : ""}`}>
      <header className="appbar">
        <button className="icon-btn" onClick={toggleNav} aria-label="Toggle navigation" title="Toggle navigation">
          <Icon name="sidebar" />
        </button>
        <a className="brand" href={hrefOf("overview")} onClick={(e) => (e.preventDefault(), go("overview"))}>
          <Mark />
          <span className="brand-name">Documentation Toolkit</span>
          <span className="pill pill--experimental" title="Experimental: in its testing phase. Check generated documents against the source before relying on them.">
            Experimental
          </span>
        </a>
        <nav className="crumbs" aria-label="Breadcrumb">
          {group && <span>{group.label}</span>}
          <span aria-current="page">{current.label}</span>
          {crumb && <span className="crumb-extra">{crumb}</span>}
        </nav>
        <div className="appbar-end">
          <button className="search-btn" onClick={() => setPalette(true)}>
            <Icon name="search" />
            <span>Search tools…</span>
            <kbd>{navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl"} K</kbd>
          </button>
          <button className="icon-btn" onClick={onToggleTheme} aria-label={`Switch to ${scheme === "dark" ? "light" : "dark"} theme`} title="Light / dark">
            <Icon name={scheme === "dark" ? "sun" : "moon"} />
          </button>
          <a className="icon-btn" href={REPO} target="_blank" rel="noopener" aria-label="Source on GitHub" title="Source on GitHub">
            <Icon name="github" />
          </a>
        </div>
      </header>

      <aside className="sidenav" aria-label="Tools">
        <nav className="nav-scroll">
          <NavLink page={OVERVIEW} active={page === "overview"} onGo={go} />
          {GROUPS.map((g) => {
            const open = !closedGroups.includes(g.id);
            const inGroup = g.pages.some((p) => p.id === page);
            return (
              <div key={g.id} className={`nav-group${inGroup ? " has-active" : ""}`}>
                <button
                  className="nav-group-head"
                  aria-expanded={open}
                  onClick={() => (collapsed ? go(g.pages[0]!.id) : toggleGroup(g.id))}
                  title={collapsed ? g.label : undefined}
                >
                  <Icon name={g.icon} />
                  <span className="nav-label">{g.label}</span>
                  <Icon name="chevron" size={12} className="nav-chevron" />
                </button>
                {open && (
                  <div className="nav-children">
                    {g.pages.map((p) => (
                      <NavLink key={p.id} page={p} active={page === p.id} onGo={go} count={counts[p.id]} nested />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="nav-foot">
          <p className="nav-section">Resources</p>
          <a className="nav-link" href={`${REPO}#readme`} target="_blank" rel="noopener" title="Documentation">
            <Icon name="docs" />
            <span className="nav-label">Documentation</span>
            <Icon name="external" size={12} className="nav-ext" />
          </a>
          <a className="nav-link" href={`${REPO}/blob/main/docs/ROADMAP.md`} target="_blank" rel="noopener" title="Roadmap">
            <Icon name="roadmap" />
            <span className="nav-label">Roadmap</span>
            <Icon name="external" size={12} className="nav-ext" />
          </a>
          <p className="byline">by Grindstone Systems · OIC</p>
        </div>
      </aside>
      <div className="nav-backdrop" onClick={() => setDrawer(false)} />

      <main className="content">{children}</main>

      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
    </div>
  );
}

function NavLink({ page, active, onGo, count, nested }: { page: ToolPage; active: boolean; onGo: (id: PageId) => void; count?: number; nested?: boolean }) {
  return (
    <a
      className={`nav-link${active ? " on" : ""}${nested ? " nested" : ""}`}
      href={hrefOf(page.id)}
      aria-current={active ? "page" : undefined}
      title={page.label}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        onGo(page.id);
      }}
    >
      {!nested && <Icon name={page.icon} />}
      <span className="nav-label">{page.label}</span>
      {count !== undefined && <span className="nav-count">{count}</span>}
      <StatusPill status={page.status} />
    </a>
  );
}

/* ------------------------------ ⌘K ------------------------------ */

function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const results = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((c) => terms.every((t) => `${c.label} ${c.hint ?? ""}`.toLowerCase().includes(t)));
  }, [q, commands]);
  const pick = (c?: Command) => {
    if (!c) return;
    onClose();
    c.run();
  };

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search tools" onMouseDown={(e) => e.stopPropagation()}>
        <label className="palette-input">
          <Icon name="search" />
          <input
            autoFocus
            placeholder="Jump to a tool or action…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(s + 1, results.length - 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
              else if (e.key === "Enter") pick(results[sel]);
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
          />
          <kbd>Esc</kbd>
        </label>
        <ul className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {results.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => pick(c)}>
              <Icon name={c.icon} />
              <span>{c.label}</span>
              {c.hint && <span className="palette-hint">{c.hint}</span>}
            </li>
          ))}
          {results.length === 0 && <li className="palette-empty">Nothing matches “{q}”.</li>}
        </ul>
      </div>
    </div>
  );
}
