/** Stroke icons on a 16px grid; they inherit currentColor. */

const PATHS = {
  home: "M2.5 7 8 2.5 13.5 7v6a.5.5 0 0 1-.5.5H10V10H6v3.5H3a.5.5 0 0 1-.5-.5Z",
  workspace: "M3 2.5h7.5l2.5 2.5v8.5H3ZM10.5 2.5V5H13M5.5 8h5M5.5 10.5h3",
  docs: "M3 2.5h7.5l2.5 2.5v8.5H3ZM10.5 2.5V5H13M5.5 8h5M5.5 10.5h5",
  agent: "M4 5.5h8a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 12 12.5H4A1.5 1.5 0 0 1 2.5 11V7A1.5 1.5 0 0 1 4 5.5ZM8 5.5V3M6 9h.01M10 9h.01M8 2.5h.01",
  word: "M3 2.5h7.5l2.5 2.5v8.5H3ZM5 7l1 4 1-3 1 3 1-4",
  image: "M2.5 3h11v10h-11ZM2.5 11l3.5-3.5 3 3 2-2 2.5 2.5M10.5 6h.01",
  platforms: "M8 1.8 13.5 5v6L8 14.2 2.5 11V5ZM2.5 5 8 8.2 13.5 5M8 8.2v6",
  upload: "M8 10.5v-8M4.5 6 8 2.5 11.5 6M3 13.5h10",
  folder: "M2.5 4h4l1.5 1.5h5.5v7.5h-11Z",
  table: "M2.5 3h11v10h-11ZM2.5 6.5h11M2.5 10h11M6.5 3v10",
  shield: "M8 2 13 4v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4ZM6 8l1.5 1.5L10.5 6.5",
  layers: "M8 2.5 13.5 5.5 8 8.5 2.5 5.5ZM2.5 8.5 8 11.5l5.5-3M2.5 11 8 14l5.5-3",
  check: "M3.5 8.5 6.5 11.5 12.5 4.5",
  close: "M4 4l8 8M12 4l-8 8",
  print: "M4.5 6V2.5h7V6M4.5 11.5h-2v-5h11v5h-2M4.5 9.5h7v4h-7Z",
  eye: "M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8ZM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  sample: "M6 2.5h4M6.5 2.5v4L3 12.5a.7.7 0 0 0 .6 1h8.8a.7.7 0 0 0 .6-1L9.5 6.5v-4M4.5 10h7",
  roadmap: "M2.5 3.5h4l1 1.5h6v8H2.5ZM2.5 3.5v10",
  search: "M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM10.5 10.5 13.5 13.5",
  sun: "M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1",
  moon: "M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z",
  sidebar: "M2.5 3h11v10h-11ZM6 3v10",
  chevron: "M6 4l4 4-4 4",
  external: "M9.5 2.5h4v4M13.5 2.5 8 8M11.5 9.5v4h-9v-9h4",
  download: "M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10",
  arrow: "M3 8h10M9 4l4 4-4 4",
  github:
    "M8 1.5a6.5 6.5 0 0 0-2.05 12.67c.33.06.45-.14.45-.31v-1.1c-1.8.39-2.18-.87-2.18-.87-.3-.75-.72-.95-.72-.95-.59-.4.04-.4.04-.4.65.05 1 .67 1 .67.58 1 1.52.71 1.89.54.06-.42.23-.71.41-.87-1.44-.16-2.96-.72-2.96-3.2 0-.71.25-1.29.67-1.74-.07-.17-.29-.83.06-1.72 0 0 .55-.18 1.79.66a6.2 6.2 0 0 1 3.26 0c1.24-.84 1.79-.66 1.79-.66.35.89.13 1.55.06 1.72.42.45.67 1.03.67 1.74 0 2.49-1.52 3.04-2.97 3.2.24.2.44.6.44 1.2v1.78c0 .17.12.37.45.31A6.5 6.5 0 0 0 8 1.5Z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Documentation Toolkit mark: a page with connected resource nodes. */
export const Mark = () => (
  <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="8" />
    <path d="M9 7.5h9.5l4.5 4.5v12.5H9Z" fill="none" strokeWidth="2.2" strokeLinejoin="round" />
    <path d="M13 15.5h6M13 19.5h3.5" fill="none" strokeWidth="2.2" strokeLinecap="round" />
    <circle className="dot" cx="23" cy="23" r="3.2" />
  </svg>
);
