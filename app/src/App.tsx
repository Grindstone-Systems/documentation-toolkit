import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentsPage } from "./pages/AgentsPage.tsx";
import { Overview } from "./pages/Overview.tsx";
import { ToolStatusPage } from "./pages/ToolStatusPage.tsx";
import { Shell, type Command } from "./shell/Shell.tsx";
import { ALL_PAGES, groupOf, hrefOf, pageById, parseHash, type PageId, type Route } from "./shell/tools.ts";
import { warmUp } from "./workspace/offline.ts";
import { useWorkspace } from "./workspace/useWorkspace.ts";
import { WorkspacePage } from "./workspace/WorkspacePage.tsx";

type Scheme = "light" | "dark";

/**
 * Light by default, like the other Grindstone toolkits; dark only when the
 * viewer picks it. Only an explicit choice is stored (a per-viewer convenience;
 * storage may be unavailable).
 */
const SCHEME_KEY = "dt.theme";
function initialScheme(): Scheme {
  try {
    if (localStorage.getItem(SCHEME_KEY) === "dark") return "dark";
  } catch {
    /* private window */
  }
  return "light";
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseHash());
  const [scheme, setScheme] = useState<Scheme>(initialScheme);
  const [toast, setToast] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout((notify as unknown as { t?: number }).t);
    (notify as unknown as { t?: number }).t = window.setTimeout(() => setToast(null), 3600);
  }, []);
  const ws = useWorkspace(notify);

  // Fetch lazily loaded code early so the app keeps working if the network drops.
  useEffect(() => {
    const t = window.setTimeout(warmUp, 800);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = scheme;
  }, [scheme]);

  // Work in progress lives only in memory, so warn before it's lost.
  useEffect(() => {
    if (!ws.session.evidence) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [ws.session.evidence]);

  const navigate = useCallback((page: PageId) => {
    setRoute({ page });
    document.querySelector(".content")?.scrollTo(0, 0);
    history.pushState(null, "", hrefOf(page));
  }, []);

  const startSample = ws.openSample;
  const openSample = useCallback(() => {
    startSample();
    navigate("docs.workspace");
  }, [startSample, navigate]);

  const toggleTheme = useCallback(() => {
    const next = scheme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(SCHEME_KEY, next);
    } catch {
      /* private window */
    }
    setScheme(next);
  }, [scheme]);
  const page = pageById(route.page);

  useEffect(() => {
    document.title = route.page === "overview" ? "Documentation Toolkit" : `${page.label} · Documentation Toolkit`;
  }, [route.page, page.label]);

  const hasDoc = !!ws.document;
  const commands = useMemo<Command[]>(
    () => [
      ...ALL_PAGES.map((p) => ({ id: `page:${p.id}`, label: p.label, hint: groupOf(p.id)?.label ?? "Go to", icon: p.icon, run: () => navigate(p.id) })),
      ...(hasDoc
        ? [{ id: "export", label: "Export documents…", hint: "Workspace", icon: "download" as const, run: () => (navigate("docs.workspace"), setExportOpen(true)) }]
        : [{ id: "sample", label: "Try the sample project", hint: "Workspace", icon: "sample" as const, run: openSample }]),
      { id: "theme", label: "Toggle light / dark theme", hint: "Appearance", icon: "sun", run: toggleTheme },
    ],
    [navigate, openSample, toggleTheme, hasDoc],
  );

  let content;
  switch (route.page) {
    case "overview":
      content = <Overview ws={ws} navigate={navigate} />;
      break;
    case "docs.workspace":
      content = <WorkspacePage ws={ws} notify={notify} openSample={!!route.sample} exportOpen={exportOpen} setExportOpen={setExportOpen} />;
      break;
    case "extend.agents":
      content = <AgentsPage />;
      break;
    default:
      content = <ToolStatusPage tool={page} group={groupOf(page.id)?.label} />;
  }

  return (
    <Shell
      page={route.page}
      scheme={scheme}
      onToggleTheme={toggleTheme}
      navigate={navigate}
      commands={commands}
    >
      {content}
      <div className={`toast${toast ? " show" : ""}`} role="status" aria-live="polite">
        {toast}
      </div>
    </Shell>
  );
}
