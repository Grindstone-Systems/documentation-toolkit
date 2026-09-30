import type { ReactNode } from "react";

export function Section({ step, title, aside, children }: { step: string; title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="section">
      <h2>
        {step && <b>{step}</b>} {title}
        {aside && <span className="aside">{aside}</span>}
      </h2>
      {children}
    </section>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} className={o.value === value ? "on" : ""} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Title block shared by the content pages (everything except the builder). */
export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {children && <div className="lede">{children}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function StatusPill({ status }: { status: "ready" | "preview" | "planned" }) {
  if (status === "ready") return null;
  return <span className={`pill pill--${status}`}>{status === "planned" ? "Soon" : "Preview"}</span>;
}
