import type { ReactNode } from "react";

/**
 * Code-native isometric artwork in the OIC visual grammar (ivory bases,
 * graphite parts, rust-orange connections, soft depth), drawn about documents
 * rather than equipment. Decorative only: the page's HTML carries the meaning.
 *
 * World axes: x runs down-right, y down-left, z up. Faces are drawn by
 * mapping a flat 2D drawing onto a plane, so details stay simple.
 */

const C = Math.cos(Math.PI / 6);
const S = 0.5;
const r = (n: number) => Math.round(n * 10) / 10;
const pt = (x: number, y: number, z: number) => `${r((x - y) * C)},${r((x + y) * S - z)}`;
const poly = (pts: [number, number, number][]) => pts.map((q) => pt(...q)).join(" ");

type Tone = "ivory" | "graphite" | "paper" | "rust" | "steel";

/** A solid block; only the three faces a viewer can see are drawn. */
function Box({ x, y, z, w, d, h, tone, className }: { x: number; y: number; z: number; w: number; d: number; h: number; tone: Tone; className?: string }) {
  return (
    <g className={`${tone}${className ? ` ${className}` : ""}`}>
      <polygon className="l" points={poly([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]])} />
      <polygon className="r" points={poly([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]])} />
      <polygon className="t" points={poly([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]])} />
    </g>
  );
}

/** Draw on the horizontal plane at height z, in (x, y) world units. */
const Top = ({ z, children }: { z: number; children: ReactNode }) => <g transform={`matrix(${r4(C)} ${S} ${r4(-C)} ${S} 0 ${-z})`}>{children}</g>;
/** Draw on the front-left face at y = Y, in (x, -z) units. */
const FaceY = ({ y, children }: { y: number; children: ReactNode }) => <g transform={`matrix(${r4(C)} ${S} 0 1 ${r(-y * C)} ${r(y * S)})`}>{children}</g>;
/** Draw on the front-right face at x = X, in (-y, -z) units. */
const FaceX = ({ x, children }: { x: number; children: ReactNode }) => <g transform={`matrix(${r4(C)} ${-S} 0 1 ${r(x * C)} ${r(x * S)})`}>{children}</g>;
function r4(n: number) {
  return Math.round(n * 10000) / 10000;
}

/** Move a whole object to a world position. */
const At = ({ x, y, z = 0, children }: { x: number; y: number; z?: number; children: ReactNode }) => (
  <g transform={`translate(${pt(x, y, z)})`}>{children}</g>
);

const H = 12; // base thickness; objects stand at z = H

/** An ivory base plate with a soft shadow and corner fixings. */
function Plate({ w, d }: { w: number; d: number }) {
  return (
    <g>
      <polygon className="iso-shadow" points={poly([[4, 10, -6], [w + 10, 10, -6], [w + 10, d + 8, -6], [4, d + 8, -6]])} />
      <Box x={0} y={0} z={0} w={w} d={d} h={H} tone="ivory" />
      <Top z={H}>
        <path className="iso-rim" d={`M1 ${d - 1}V1H${w - 1}`} />
        {[
          [8, 8],
          [w - 8, 8],
          [8, d - 8],
          [w - 8, d - 8],
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} className="iso-hole" cx={cx} cy={cy} r={2.6} />
        ))}
      </Top>
    </g>
  );
}

/** The input: a zipped gateway backup. */
export function Archive() {
  return (
    <g>
      <Box x={30} y={36} z={H} w={70} d={56} h={50} tone="graphite" />
      <Box x={28} y={34} z={H + 40} w={74} d={60} h={12} tone="graphite" className="lid" />
      <Top z={H + 52}>
        <rect className="iso-track" x={34} y={62} width={62} height={4} rx={1} />
        {Array.from({ length: 15 }, (_, i) => (
          <rect key={i} className="iso-tooth" x={35 + i * 4} y={i % 2 ? 66 : 60} width={2.6} height={2} />
        ))}
        <rect className="iso-accent" x={84} y={65} width={8} height={12} rx={2} />
      </Top>
      <FaceY y={92}>
        <rect className="iso-label" x={40} y={-46} width={44} height={22} rx={1.5} />
        <text className="iso-label-text" x={44} y={-36}>
          GWBK
        </text>
        <path className="iso-label-line" d="M44 -30H72M44 -27H64" />
      </FaceY>
      <FaceX x={100}>
        <rect className="iso-accent" x={-84} y={-34} width={6} height={3} rx={1} />
        <path className="iso-vent" d="M-74 -32.5H-48M-74 -26.5H-48M-74 -20.5H-48" />
      </FaceX>
    </g>
  );
}

const TILES: [number, number, number, Tone][] = [
  // [col, row, height, tone]: extracted records, laid out as a little data city
  [0, 0, 8, "ivory"],
  [1, 0, 18, "graphite"],
  [2, 0, 11, "ivory"],
  [0, 1, 22, "ivory"],
  [1, 1, 12, "rust"],
  [2, 1, 28, "ivory"],
  [0, 2, 10, "graphite"],
  [1, 2, 26, "ivory"],
  [2, 2, 14, "ivory"],
  [0, 3, 16, "ivory"],
  [1, 3, 9, "ivory"],
  [2, 3, 20, "rust"],
];

/** The engine: a scanner reads the archive into structured records. */
export function Extractor() {
  const tiles = [...TILES].sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  return (
    <g>
      <Box x={36} y={38} z={H} w={12} d={9} h={64} tone="graphite" />
      <Box x={4} y={52} z={H} w={84} d={26} h={7} tone="graphite" className="belt" />
      <Top z={H + 7}>
        <path className="iso-roller" d={Array.from({ length: 8 }, (_, i) => `M${10 + i * 10} 54V76`).join("")} />
      </Top>
      <FaceX x={42}>
        <polygon className="iso-beam" points="-47,-74 -83,-74 -86,-19 -44,-19" />
      </FaceX>
      <Box x={60} y={58} z={H + 7} w={14} d={14} h={4} tone="paper" />
      <Box x={36} y={83} z={H} w={12} d={9} h={64} tone="graphite" />
      <Box x={36} y={44} z={H + 62} w={12} d={42} h={2} tone="rust" className="scan" />
      <Box x={34} y={38} z={H + 64} w={16} d={54} h={10} tone="graphite" />
      {tiles.map(([c, row, h, tone]) => (
        <Box key={`${c}-${row}`} x={100 + c * 18} y={18 + row * 24} z={H} w={14} d={19} h={h} tone={tone} />
      ))}
    </g>
  );
}

/** The output: manuals and documents, ready to hand over. */
export function Documents() {
  const sheets = [0, 1, 2, 3];
  return (
    <g>
      <Box x={22} y={14} z={H} w={50} d={12} h={74} tone="graphite" />
      <FaceY y={26}>
        <rect className="iso-label" x={30} y={-76} width={34} height={16} rx={1.5} />
        <path className="iso-label-line" d="M34 -70H58M34 -66H50" />
        <rect className="iso-accent" x={30} y={-26} width={34} height={4} />
      </FaceY>
      <Box x={78} y={18} z={H} w={40} d={10} h={58} tone="ivory" />
      <FaceY y={28}>
        <path className="iso-text" d="M84 -62H110M84 -56H106M84 -50H110M84 -44H100M84 -38H108M84 -32H104" />
      </FaceY>
      {sheets.map((i) => (
        <Box key={i} x={46 + i * 3} y={48 - i * 2} z={H + i * 3} w={56} d={76} h={3} tone="paper" />
      ))}
      <Top z={H + 12}>
        <rect className="iso-ink" x={62} y={48} width={36} height={6} rx={1} />
        <path className="iso-text" d="M62 62H96M62 67H92M62 72H96M62 77H86" />
        <rect className="iso-grid" x={62} y={83} width={34} height={18} />
        <path className="iso-grid" d="M62 89H96M62 95H96M73.3 83V101M84.6 83V101" />
        <circle className="iso-seal" cx={92} cy={109} r={5.5} />
        <path className="iso-check" d="M89.5 109.2l1.8 1.8 3.4-3.6" />
      </Top>
      <Box x={112} y={70} z={H} w={30} d={46} h={2} tone="paper" />
      <Top z={H + 2}>
        <rect className="iso-accent" x={115} y={73} width={24} height={5} />
        <path className="iso-grid" d="M115 83H139M115 88H139M115 93H139M115 98H139M115 103H139M115 108H139M123 78V111M131 78V111" />
      </Top>
    </g>
  );
}

/** A bridge between two bases, with clips where it crosses each edge. */
function Rail({ axis, from, to, at }: { axis: "x" | "y"; from: number; to: number; at: number }) {
  const lo = Math.min(from, to);
  const len = Math.abs(to - from);
  return axis === "x" ? (
    <g>
      <Box x={lo} y={at - 3} z={H} w={len} d={6} h={1.5} tone="rust" />
    </g>
  ) : (
    <g>
      <Box x={at - 3} y={lo} z={H} w={6} d={len} h={1.5} tone="rust" />
    </g>
  );
}

function Clip({ x, y }: { x: number; y: number }) {
  return <Box x={x - 4} y={y - 6} z={H} w={8} d={12} h={5} tone="rust" className="clip" />;
}
function ClipY({ x, y }: { x: number; y: number }) {
  return <Box x={x - 6} y={y - 4} z={H} w={12} d={8} h={5} tone="rust" className="clip" />;
}

/** A record moving along a rail; dx/dy are the world-space travel. */
function Packet({ x, y, dx, dy, delay }: { x: number; y: number; dx: number; dy: number; delay: number }) {
  const [tx, ty] = [r((dx - dy) * C), r((dx + dy) * S)];
  return (
    <g className="iso-packet" style={{ "--tx": `${tx}px`, "--ty": `${ty}px`, animationDelay: `${delay}s` } as React.CSSProperties}>
      <Box x={x - 3.5} y={y - 3.5} z={H + 1.5} w={7} d={7} h={7} tone="rust" />
    </g>
  );
}

// Where the three bases sit in the world.
const A = { x: 0, y: 0, w: 130, d: 130 };
const B = { x: 155, y: 0, w: 160, d: 130 };
const D = { x: 215, y: -175, w: 150, d: 140 };

/** Backup → records → documents, on three connected bases. */
export function HeroScene() {
  const railBD = B.x + 118; // world x of the rail from the records to the documents
  return (
    <svg className="iso" viewBox="-125 -62 605 300" role="presentation" aria-hidden="true" focusable="false">
      <At x={D.x} y={D.y}>
        <Plate w={D.w} d={D.d} />
        <Documents />
      </At>
      <At x={A.x} y={A.y}>
        <Plate w={A.w} d={A.d} />
        <Archive />
      </At>
      <At x={B.x} y={B.y}>
        <Plate w={B.w} d={B.d} />
      </At>
      <Rail axis="x" from={A.x + 104} to={B.x + 8} at={65} />
      <Clip x={A.x + A.w - 4} y={65} />
      <Clip x={B.x + 4} y={65} />
      <Rail axis="y" from={B.y + 14} to={D.y + D.d - 6} at={railBD} />
      <ClipY x={railBD} y={B.y + 4} />
      <ClipY x={railBD} y={D.y + D.d - 4} />
      <g className="iso-flow">
        {[0, 1, 2].map((i) => (
          <Packet key={`a${i}`} x={A.x + 106} y={65} dx={52} dy={0} delay={i * 1.2} />
        ))}
        {[0, 1, 2].map((i) => (
          <Packet key={`b${i}`} x={railBD} y={B.y + 8} dx={0} dy={-40} delay={0.6 + i * 1.2} />
        ))}
      </g>
      <At x={B.x} y={B.y}>
        <Extractor />
      </At>
    </svg>
  );
}

/** One base and one object, for the small step illustrations. */
export function Vignette({ kind }: { kind: "archive" | "extract" | "documents" }) {
  const box = { archive: "-118 -40 236 178", extract: "-118 -58 262 212", documents: "-126 -75 262 226" }[kind];
  const [w, d] = ({ archive: [130, 130], extract: [160, 130], documents: [150, 140] } as const)[kind];
  return (
    <svg className="iso" viewBox={box} role="presentation" aria-hidden="true" focusable="false">
      <Plate w={w} d={d} />
      {kind === "archive" ? <Archive /> : kind === "extract" ? <Extractor /> : <Documents />}
    </svg>
  );
}
