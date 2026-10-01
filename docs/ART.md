# Illustrations

Documentation Toolkit uses the Open Industrial Collective's dimensional visual grammar, drawn about documents and data rather than plant equipment. Generated art is decorative: every image has empty alt text, and the page's HTML carries the meaning. Images never show the product's real screens, and they never contain words, logos, brands, badges or certification marks.

## Visual grammar

- Three-quarter isometric camera, the same angle throughout, lit from the upper left.
- Ivory bases with rounded edges, small screw holes and a fine speckled texture.
- Graphite cases and panels, brushed steel details.
- Rust-orange (about `#e8642a`) for connections, rails, status lights and one accent per object.
- Paper in warm white, with grey ruled lines and simple bar or table marks in place of text.
- Soft contact shadows, gentle depth, tactile matte materials. No people, faces or robots.
- Transparent background, with the object centred and a little margin on every side.

## How to add one

1. Generate the image with the prompt below. Attach `docs/sources/art/style-oic-workbench.png` as the style reference. For the hero and the three steps, also attach the matching `layout-*.png` so the composition matches the page. (`docs/sources/` stays local.)
2. Export as PNG with a transparent background, at least the source size listed.
3. Convert it into the app (trim, resize, WebP with alpha):

   ```sh
   magick in.png -trim +repage -resize 1600x\> png:- | cwebp -q 82 -alpha_q 90 -exact -o app/src/art/hero.webp -- -
   ```

The app picks up any `app/src/art/<name>.webp` automatically (see `app/src/ui/Art.tsx`). Until the file exists, the hero and steps show the code-drawn scene from `app/src/pages/Isometric.tsx` and the other slots show nothing. Keep each file under about 150 KB.

## Assets

In the app so far: `hero`, `step-open`, `step-review` and `step-handover`.

| File | Where it appears | Shape | Source size | Web width |
| --- | --- | --- | --- | --- |
| `hero.webp` | Home hero | 2:1 | 2400×1200 | 1600 |
| `step-open.webp` | Home, step 1 | 4:3 | 1200×900 | 640 |
| `step-review.webp` | Home, step 2 | 4:3 | 1200×900 | 640 |
| `step-handover.webp` | Home, step 3 | 4:3 | 1200×900 | 640 |
| `pack-engineering-reference.webp` | Home, pack card | 1:1 | 1024×1024 | 256 |
| `pack-operator-manual.webp` | Home, pack card | 1:1 | 1024×1024 | 256 |
| `pack-maintenance-guide.webp` | Home, pack card | 1:1 | 1024×1024 | 256 |
| `pack-complete-handoff.webp` | Home, pack card | 1:1 | 1024×1024 | 256 |
| `workspace-empty.webp` | Workspace, before files are opened | 4:3 | 1200×900 | 480 |
| `agents.webp` | AI agents page header | 4:3 | 1200×900 | 640 |
| `platforms.webp` | More platforms page header | 4:3 | 1200×900 | 640 |

## Prompts

Start every prompt with the shared style, then add the subject.

**Shared style**

> Crisp 3D isometric product illustration, three-quarter view from the upper left, on a fully transparent background. Modular tabletop pieces on ivory bases with rounded edges, small screw holes and a fine speckled matte texture. Graphite cases, brushed steel details, warm white paper with grey ruled lines. Rust-orange is the only accent colour, used for connecting rails, cable clips, status lights and one highlight per object. Soft contact shadows, gentle depth, clean studio lighting, tactile matte materials, high detail, sharp edges. No text, letters, numbers, logos, brands, badges, watermarks, people, faces or robots.

**hero**

> Three connected ivory bases joined by rust-orange rails with small orange data cubes travelling along them, left to right. Left base: a closed graphite archive case with a zipper across its lid and a blank paper label on its front, like a backup cartridge. Centre base, nearest the viewer: a graphite scanning gantry over a short conveyor, a sheet of paper passing beneath a soft orange scan light, and beyond it a neat grid of small ivory and graphite blocks of different heights standing for extracted records, two of them orange. Right base: an upright graphite binder and a standing ivory manual behind a fanned stack of crisp documents with ruled lines, a small table and an orange check seal, plus a flat spreadsheet sheet with an orange header row. Wide 2:1 composition matching the attached layout.

**step-open**

> One ivory base holding the graphite archive case with a zipper across its lid and a blank paper label, an orange status light on its side. A short rust-orange rail leaves the base toward the right edge. Matches the attached layout.

**step-review**

> One ivory base holding a graphite scanning gantry over a short conveyor, a sheet of paper under a soft orange scan light, and a grid of small ivory and graphite record blocks of different heights. A magnifying glass with an orange handle leans against the blocks. Matches the attached layout.

**step-handover**

> One ivory base holding an upright graphite binder, a standing ivory manual and a fanned stack of documents with ruled lines, a small table and an orange check seal, plus a flat spreadsheet sheet with an orange header row. Matches the attached layout.

**pack-engineering-reference**

> A single small ivory base holding a graphite binder lying open, its pages showing a simple connected block diagram drawn in grey lines with orange nodes. Compact, centred, square.

**pack-operator-manual**

> A single small ivory base holding a graphite tablet-style operator panel standing upright with simple grey screen shapes and one orange status light, beside a closed ivory manual. Compact, centred, square.

**pack-maintenance-guide**

> A single small ivory base holding a closed ivory guide with an orange bookmark ribbon, a steel wrench lying across it and a small graphite device with an orange indicator. Compact, centred, square.

**pack-complete-handoff**

> A single small ivory base holding a neat bundle of three binders, graphite, ivory and steel, tied with a rust-orange strap, ready to hand over. Compact, centred, square.

**workspace-empty**

> A single ivory base with a shallow graphite intake tray, its open mouth facing the viewer, and a closed graphite archive case hovering just above it about to drop in, with a few small orange data cubes beneath. Calm, inviting, plenty of empty space.

**agents**

> Two ivory bases joined by a rust-orange rail. Left: a fanned stack of documents with ruled lines and an orange check seal. Right: a compact graphite console with a blank dark screen showing simple grey lines and an orange cursor block, and a small ivory speech-bubble shaped tile standing beside it. Small orange data cubes move between them.

**platforms**

> One central ivory base holding a graphite processing module, with three different input cartridges, graphite, steel and ivory, each on its own small base and each joined to the centre by a rust-orange rail. The cartridges differ in shape to suggest different platforms.
