import { useMemo, useState } from "react";
import type { DocumentModel } from "../../../lib/document/model.ts";
import type { Entity, EntityKind, Evidence } from "../../../lib/types.ts";
import { Icon } from "../ui/icons.tsx";

const KIND_LABEL: Partial<Record<EntityKind, string>> = {
  page: "Pages",
  view: "Views",
  tag: "Tags",
  "udt-type": "UDTs",
  "udt-instance": "UDT instances",
  alarm: "Alarms",
  "named-query": "Queries",
  script: "Scripts",
  "event-script": "Event scripts",
  "opc-connection": "OPC",
  "database-connection": "Databases",
  device: "Devices",
  resource: "Other",
};

const LIMIT = 300;

/** Group headings in the "All" list. */
const KIND_GROUP: Partial<Record<EntityKind, string>> = { ...KIND_LABEL, "named-query": "Named queries", "opc-connection": "OPC connections", "database-connection": "Database connections", resource: "Other resources" };

/** Field keys as people read them: opcItemPath → OPC item path. */
const ACRONYMS: Record<string, string> = { opc: "OPC", udt: "UDT", sql: "SQL", url: "URL", id: "ID", ip: "IP", jdbc: "JDBC", ua: "UA", eng: "Eng." };
const human = (k: string) =>
  k
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.]+/g, " ")
    .toLowerCase()
    .split(" ")
    .map((w, i) => ACRONYMS[w] ?? (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");

/** The item's own name in ink, the path that leads to it muted. */
function Name({ text }: { text: string }) {
  const cut = Math.max(text.lastIndexOf("/"), text.lastIndexOf("#")) + 1;
  return (
    <span className="ename">
      {cut > 0 && <span className="epath">{text.slice(0, cut)}</span>}
      {text.slice(cut)}
    </span>
  );
}

/** Inspect any extracted item: its fields, source, links, and where it appears in the document. */
export function EvidenceExplorer({
  evidence,
  document: doc,
  focus,
  setFocus,
  showSection,
}: {
  evidence: Evidence;
  document: DocumentModel;
  focus?: string;
  setFocus: (id: string) => void;
  showSection: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<EntityKind | "all">("all");
  const byId = useMemo(() => new Map(evidence.entities.map((e) => [e.id, e])), [evidence]);
  const kinds = useMemo(() => {
    const m = new Map<EntityKind, number>();
    for (const e of evidence.entities) m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
    return [...m].filter(([k]) => KIND_LABEL[k]);
  }, [evidence]);

  const results = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return evidence.entities.filter((e) => (kind === "all" || e.kind === kind) && terms.every((t) => `${e.id} ${e.name}`.toLowerCase().includes(t)));
  }, [evidence, q, kind]);

  const selected = focus ? byId.get(focus) : undefined;

  return (
    <div className="explorer">
      <div className="explorer-list">
        <label className="search-field">
          <Icon name="search" size={14} />
          <input placeholder="Search tags, views, alarms…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="kind-chips">
          <button className={kind === "all" ? "on" : ""} onClick={() => setKind("all")}>
            All <span>{evidence.entities.length.toLocaleString()}</span>
          </button>
          {kinds.map(([k, n]) => (
            <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
              {KIND_LABEL[k]} <span>{n.toLocaleString()}</span>
            </button>
          ))}
        </div>
        <ul className="entity-list" role="listbox" aria-label="Evidence">
          {results.slice(0, LIMIT).map((e, i, shown) => [
            kind === "all" && e.kind !== shown[i - 1]?.kind && (
              <li key={`g-${e.kind}`} className="egroup" role="presentation">
                {KIND_GROUP[e.kind] ?? e.kind.replace(/-/g, " ")}
              </li>
            ),
            <li key={e.id} role="option" aria-selected={e.id === focus} className={e.id === focus ? "on" : ""} onClick={() => setFocus(e.id)}>
              <Name text={label(e)} />
              {!e.interpreted && <span className="pill">listed</span>}
            </li>,
          ])}
          {results.length > LIMIT && <li className="more">{(results.length - LIMIT).toLocaleString()} more. Refine the search.</li>}
          {!results.length && <li className="more">Nothing matches.</li>}
        </ul>
      </div>
      <div className="explorer-detail">
        {selected ? (
          <Detail e={selected} evidence={evidence} doc={doc} byId={byId} setFocus={setFocus} showSection={showSection} />
        ) : (
          <div className="detail-empty">
            <b>Nothing selected</b>
            <p>Pick an item to see its configuration, the file it came from and where it appears in the document.</p>
          </div>
        )}
      </div>
    </div>
  );
}

const label = (e: Entity) => (e.kind === "tag" || e.kind === "udt-instance" || e.kind === "udt-type" ? `[${e.scope}]${e.path}` : e.scope && e.kind !== "project" ? `${e.scope} / ${e.path ?? e.name}` : (e.path ?? e.name));

function Detail({
  e,
  evidence,
  doc,
  byId,
  setFocus,
  showSection,
}: {
  e: Entity;
  evidence: Evidence;
  doc: DocumentModel;
  byId: Map<string, Entity>;
  setFocus: (id: string) => void;
  showSection: (id: string) => void;
}) {
  // Without a gateway backup, connections are a known limit of the input rather than a gap.
  const gateway = evidence.entities.some((x) => x.kind === "gateway");
  const out = evidence.relationships.filter((r) => r.from === e.id);
  const inc = evidence.relationships.filter((r) => r.to === e.id);
  const sections = doc.sections.filter((s) => s.refs.includes(e.id) || s.blocks.some((b) => "refs" in b && b.refs?.includes(e.id)));
  const fields = Object.entries(e.fields).filter(([k]) => k !== "code" && k !== "sql");
  const code = (e.fields.code ?? e.fields.sql) as string | undefined;

  return (
    <div className="detail">
      <p className="eyebrow">{e.kind.replace(/-/g, " ")}</p>
      <h2>{label(e)}</h2>
      <p className="source">
        <Icon name="docs" size={12} /> <code>{e.source.input}</code>
        {e.source.path !== e.source.input && (
          <>
            {" "}
            › <code>{e.source.path}</code>
          </>
        )}
        {e.source.at && <code>{e.source.at}</code>}
      </p>
      {!e.interpreted && <p className="note">Listed by name only. This resource type isn't interpreted yet.</p>}

      <h3>Appears in</h3>
      {sections.length ? (
        <div className="appears">
          {sections.map((s) => (
            <button key={s.id} onClick={() => showSection(s.id)}>
              {s.title} <Icon name="arrow" size={12} />
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">Not cited by a section directly. It's still in the inventories and CSV exports.</p>
      )}

      {fields.length > 0 && (
        <>
          <h3>Configuration</h3>
          <dl className="fields">
            {fields.map(([k, v]) => (
              <div key={k}>
                <dt title={k}>
                  {human(k)}
                  {e.sensitive?.[k] && <span className="sens">{e.sensitive[k]}</span>}
                </dt>
                <dd>{Array.isArray(v) ? v.join(", ") || "—" : String(v)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {code && (
        <details className="code">
          <summary>Source text ({code.split("\n").length} lines)</summary>
          <pre>{code}</pre>
        </details>
      )}

      {[
        ["Uses", out, (r: (typeof out)[number]) => r.to, (r: (typeof out)[number]) => r.target] as const,
        ["Used by", inc, (r: (typeof inc)[number]) => r.from, (r: (typeof inc)[number]) => byId.get(r.from)?.name ?? r.from] as const,
      ].map(([title, rels, idOf, text]) =>
        rels.length ? (
          <div key={title}>
            <h3>
              {title} <span className="muted">({rels.length})</span>
            </h3>
            <ul className="rels">
              {rels.slice(0, 80).map((r, i) => {
                const target = idOf(r);
                return (
                  <li key={i}>
                    <span className="rtype">{r.type.replace(/-/g, " ")}</span>
                    {target && byId.has(target) ? (
                      <button className="rlink" onClick={() => setFocus(target)}>
                        {text(r)}
                      </button>
                    ) : (
                      <code>{text(r)}</code>
                    )}
                    {r.dynamic && <span className="pill">dynamic</span>}
                    {!r.explicit && <span className="pill">inferred</span>}
                    {!r.to && !r.dynamic && title === "Uses" && (gateway || r.type !== "uses-connection") && <span className="pill pill--gap">not in input</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}
