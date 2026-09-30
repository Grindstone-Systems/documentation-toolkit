import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CONFIG } from "../config.ts";
import { Icon, Mark, type IconName } from "../ui/icons.tsx";
import { NAV, hrefOf, type PageId } from "./tools.ts";

const REPO = `https://github.com/${CONFIG.repo}`;

export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: IconName;
  run: () => void;
}

/** One slim bar across the top; the active page fills the rest. */
export function Shell({
  page,
  scheme,
  onToggleTheme,
  navigate,
  commands,
  children,
}: {
  page: PageId;
  scheme: "light" | "dark";
  onToggleTheme: () => void;
  navigate: (id: PageId) => void;
  commands: Command[];
  children: ReactNode;
}) {
  const [palette, setPalette] = useState(false);

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

  const mac = navigator.platform.startsWith("Mac");

  return (
    <div className="shell">
      <header className="appbar">
        <a className="brand" href={hrefOf("overview")} onClick={(e) => (e.preventDefault(), navigate("overview"))}>
          <Mark />
          <span className="brand-name">Documentation Toolkit</span>
        </a>
        <span className="beta" title="Experimental: in its testing phase. Check generated documents against the source before relying on them.">
          Experimental
        </span>
        <nav className="topnav" aria-label="Main">
          {NAV.map((n) => (
            <a
              key={n.id}
              href={hrefOf(n.id)}
              className={page === n.id ? "on" : ""}
              aria-current={page === n.id ? "page" : undefined}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                e.preventDefault();
                navigate(n.id);
              }}
            >
              {n.label}
            </a>
          ))}
        </nav>
        <div className="appbar-end">
          <button className="icon-btn search-cmd" onClick={() => setPalette(true)} aria-label="Search commands" title={`Search commands (${mac ? "⌘" : "Ctrl"} K)`}>
            <Icon name="search" />
          </button>
          <button className="icon-btn" onClick={onToggleTheme} aria-label={`Switch to ${scheme === "dark" ? "light" : "dark"} theme`} title="Light / dark">
            <Icon name={scheme === "dark" ? "sun" : "moon"} />
          </button>
          <a className="icon-btn" href={REPO} target="_blank" rel="noopener" aria-label="Source on GitHub" title="Source on GitHub">
            <Icon name="github" />
          </a>
        </div>
      </header>

      <main className="content">{children}</main>

      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
    </div>
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
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search commands" onMouseDown={(e) => e.stopPropagation()}>
        <label className="palette-input">
          <Icon name="search" />
          <input
            autoFocus
            placeholder="Jump to a page or action…"
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
