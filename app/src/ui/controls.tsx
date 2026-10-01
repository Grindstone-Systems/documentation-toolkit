import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons.tsx";

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string; badge?: number }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} className={o.value === value ? "on" : ""} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
          {!!o.badge && <span className="seg-badge">{o.badge}</span>}
        </button>
      ))}
    </div>
  );
}

/** Title block shared by the content pages. */
export function PageHeader({ eyebrow, title, children, actions, art }: { eyebrow?: string; title: string; children?: ReactNode; actions?: ReactNode; art?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {children && <div className="lede">{children}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
      {art && <div className="page-art">{art}</div>}
    </header>
  );
}

export function StatusPill({ status }: { status: "ready" | "preview" | "planned" }) {
  if (status === "ready") return null;
  return <span className={`pill pill--${status}`}>{status === "planned" ? "Soon" : "Preview"}</span>;
}

/** A button that opens a panel under it; closes on outside click or Escape. */
export function Popover({
  trigger,
  label,
  className,
  align = "start",
  children,
}: {
  trigger: ReactNode;
  label: string;
  className?: string;
  align?: "start" | "end";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => root.current?.contains(e.target as Node) || setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className={`popover-root${className ? ` ${className}` : ""}`} ref={root}>
      <button className="popover-trigger" aria-haspopup="dialog" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open && (
        <div className={`popover align-${align}`} role="dialog" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** Modal dialog on the native <dialog> element, so focus and Escape behave. */
export function Modal({ open, onClose, title, subtitle, children, footer }: { open: boolean; onClose: () => void; title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // Start focus on the dialog itself, not its close button, so nothing looks pre-selected.
      body.current?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" onClose={onClose} onMouseDown={(e) => e.target === ref.current && onClose()} aria-label={title}>
      {open && (
        <div className="modal-body" ref={body} tabIndex={-1}>
          <header className="modal-head">
            <div>
              <h2>{title}</h2>
              {subtitle && <p>{subtitle}</p>}
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="close" />
            </button>
          </header>
          <div className="modal-content">{children}</div>
          {footer && <footer className="modal-foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/** A file-type glyph: a page with its extension printed on it. */
export function FileBadge({ ext, tone = "neutral" }: { ext: string; tone?: "neutral" | "brand" }) {
  return (
    <svg className={`file-badge tone-${tone}`} viewBox="0 0 40 48" aria-hidden="true">
      <path className="fb-page" d="M4 3.5h22l10 10v31H4Z" />
      <path className="fb-fold" d="M26 3.5v10h10" />
      <rect className="fb-tag" x="1" y="26" width={Math.max(26, ext.length * 7 + 8)} height="13" rx="3" />
      <text className="fb-ext" x="5" y="35.6">
        {ext}
      </text>
    </svg>
  );
}
