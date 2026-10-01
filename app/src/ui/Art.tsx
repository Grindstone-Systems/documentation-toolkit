import type { ReactNode } from "react";

/**
 * Generated illustrations (docs/ART.md). Each lives in app/src/art/<name>.webp
 * and is bundled with the app, so it loads from our own origin and works
 * offline. Until a file exists, the slot shows its fallback, or nothing.
 */
const FILES = import.meta.glob<string>("../art/*.webp", { eager: true, import: "default" });
const URLS = new Map(Object.entries(FILES).map(([path, url]) => [path.slice("../art/".length, -".webp".length), url]));

export type ArtName =
  | "hero"
  | "step-open"
  | "step-review"
  | "step-handover"
  | "pack-engineering-reference"
  | "pack-operator-manual"
  | "pack-maintenance-guide"
  | "pack-complete-handoff"
  | "workspace-empty"
  | "agents"
  | "platforms";

export const hasArt = (name: ArtName) => URLS.has(name);

/** Decorative: the surrounding HTML carries the meaning, so alt is empty. */
export function Art({ name, className, eager, fallback = null }: { name: ArtName; className?: string; eager?: boolean; fallback?: ReactNode }) {
  const src = URLS.get(name);
  if (!src) return <>{fallback}</>;
  return <img className={`art${className ? ` ${className}` : ""}`} src={src} alt="" loading={eager ? "eager" : "lazy"} decoding="async" draggable={false} />;
}
