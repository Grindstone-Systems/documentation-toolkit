# Privacy and security

## What the claim covers

In the browser app, **backup contents, extracted evidence, generated text, images and file names never leave your device.** The app is static files. After they load, processing needs no network, and nothing is sent to Grindstone Systems, OIC, analytics, telemetry or error reporting.

It doesn't cover:

- **The code itself.** You trust the code the site serves, as with any web app. The source is public and the build can be self-hosted (`pnpm build`, then serve `dist/` anywhere).
- **What you do with exports.** A generated pack can reveal addresses, usernames, process structure and code. Review it before sharing.
- **AI assistants you choose to use.** A cloud-based assistant sends what it reads from a workspace to its provider. Local extraction and cloud AI are different privacy boundaries, and the export step says so.

## How it's enforced

| Measure | Where |
| --- | --- |
| Production pages carry a content security policy allowing only same-origin scripts, styles, fonts and workers, `connect-src 'self'`, no forms | `vite.config.ts` |
| Parsing runs in a worker that has no network code | `app/src/workspace/extract.worker.ts` |
| Work stays in memory. Nothing is written to browser storage except the light/dark and sidebar preferences | `app/src/workspace/session.ts` |
| Fonts, icons and templates are bundled; nothing is fetched from a CDN | `app/src/main.tsx`, `lib/render/html.ts` |
| Generated references carry their own CSP (`default-src 'none'`) and embed images as data URIs | `lib/render/html.ts` |
| The in-app preview is a sandboxed iframe that can't run scripts | `app/src/workspace/WorkspacePage.tsx` |
| Tests fail if a generated reference references a remote URL | `lib/document.test.ts` |
| CI serves the production build, switches the network off, processes files (including a synthetic 8.1 backup, so the internal-database reader runs in the real worker), runs every export and opens the exported reference from disk, and fails on any request that leaves the origin | `scripts/privacy-check.ts` (`pnpm privacy:check`) |
| The worker and lazily loaded code (sample, Word library) are fetched as soon as the app loads, so it keeps working offline | `app/src/workspace/offline.ts` |
| Uploaded logos and screenshots are redrawn on a canvas and re-encoded, which drops metadata; SVG is never accepted | `app/src/workspace/images.ts` |

## Untrusted input

Every input is treated as hostile:

- **Archives:** entry-count, per-entry and total-size limits are checked from the central directory before decompressing; only the entries an adapter needs are decompressed; paths with `..`, NUL or absolute roots are rejected. Nothing is extracted to disk. (`lib/archive.ts`)
- **No execution:** scripts, expressions and SQL are read as text, never run. There's no deserialisation beyond `JSON.parse`.
- **Credentials:** keys that look like passwords, secrets, tokens, keys or ciphertext, and Ignition's embedded encrypted values, are dropped during extraction and only counted. Keystores and certificates are never decompressed. (`lib/adapters/collector.ts`)
- **Ignition 8.1 internal database:** read by a read-only SQLite file reader written in TypeScript, bundled in the worker; there's no SQL engine, WASM or network involved, and the content security policy is unchanged. Only named columns are decoded, and asking for a column whose name looks like a credential is refused, so password, key and certificate columns are never read; user, contact and security tables are only counted. Page numbers, sizes and loops are bounds-checked, and a damaged table is reported without losing the rest of the backup. (`lib/sqlite.ts`, `lib/adapters/ignition-internal-db.ts`)
- **Output:** all text is HTML-escaped before rendering; only `inline code` and **bold** marks are applied afterwards. CSV cells that start like formulas are prefixed with `'`. Workspace files are sanitised on reimport, and the CLI and MCP server refuse to write outside the workspace.

Secret detection is best effort. The toolkit never labels a pack as safe to share.

## Still to do

- Run `pnpm privacy:check` in Safari and Firefox as well as Chrome.
