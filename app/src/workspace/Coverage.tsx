import { unresolved } from "../../../lib/resolve.ts";
import type { Evidence } from "../../../lib/types.ts";
import { Icon } from "../ui/icons.tsx";

/** Everything found, what was read, and what wasn't. Nothing is dropped silently. */
export function Coverage({ evidence }: { evidence: Evidence }) {
  const gaps = unresolved(evidence);
  const partial = evidence.coverage.filter((c) => c.read < c.found);
  const full = evidence.coverage.length - partial.length;
  const warnings = evidence.diagnostics.filter((d) => d.level !== "info");

  return (
    <div className="stage-scroll">
      <div className="cov">
        <div className="cov-summary">
          <div className="cov-stat good">
            <Icon name="check" size={16} />
            <b>{full}</b>
            <span>resource type{full === 1 ? "" : "s"} fully read</span>
          </div>
          <div className={`cov-stat${partial.length ? " warn" : ""}`}>
            <Icon name="alert" size={16} />
            <b>{partial.length}</b>
            <span>partly read or listed by name</span>
          </div>
          <div className={`cov-stat${gaps.length ? " warn" : ""}`}>
            <Icon name="restart" size={16} />
            <b>{gaps.length}</b>
            <span>unresolved reference{gaps.length === 1 ? "" : "s"}</span>
          </div>
        </div>

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
                  <td className="num">
                    <span className={`cov-read${c.read < c.found ? " part" : ""}`}>{c.read.toLocaleString()}</span>
                  </td>
                  <td className="muted">{c.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 className="block-title">Unresolved references</h2>
        {gaps.length ? (
          <ul className="diag">
            {gaps.slice(0, 200).map((r, i) => (
              <li key={i}>
                <code>{r.target}</code> <span className="muted">{r.type.replace(/-/g, " ")} from</span> <code>{r.from}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Every static reference resolved.</p>
        )}

        {evidence.diagnostics.length > 0 && (
          <details className="diag-details" open={warnings.length > 0 && warnings.length <= 12}>
            <summary>
              Diagnostics <span className="muted">({evidence.diagnostics.length})</span>
            </summary>
            <ul className="diag">
              {evidence.diagnostics.slice(0, 200).map((d, i) => (
                <li key={i} className={d.level}>
                  <b>{d.level}</b> {d.message}
                  {d.source?.path && <code>{d.source.path}</code>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
