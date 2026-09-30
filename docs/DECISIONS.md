# Decisions

| Date | Decision | Status |
| --- | --- | --- |
| 2026-09-29 | Public name **Documentation Toolkit**, an OIC utility built by Grindstone Systems, alongside Visual Toolkit | Adopted |
| 2026-09-29 | Same shape as Visual Toolkit: one repo, one package (`lib/` + `app/` + `cli/`), static hosting on GitHub Pages at $0 | Adopted |
| 2026-09-29 | Browser-local processing is the product. No uploads, no server fallback, no telemetry | Adopted |
| 2026-09-29 | One TypeScript engine shared by the browser (worker) and the CLI. No parallel Python parser | Adopted |
| 2026-09-29 | Deterministic generation; AI only through the user's own assistant, via the workspace and MCP | Adopted |
| 2026-09-29 | Evidence schema `oic.docs.evidence/v0`, document `oic.docs.document/v0`, workspace `oic.docs.workspace/v0`; platform-neutral and versioned | Adopted |
| 2026-09-29 | Section states Extracted / AI draft / Confirmed / Unresolved. Editing extracted text makes it an AI draft; only people confirm | Adopted |
| 2026-09-29 | Credentials are never read into evidence. Addresses, usernames and code are marked and can be redacted everywhere | Adopted |
| 2026-09-29 | Only raster images (PNG, JPEG, WebP) are accepted as assets; SVG waits for a sanitiser | Adopted |
| 2026-09-29 | Word export with the `docx` library (MIT, 9.x), loaded only when used; core-property dates pinned to the document date so output is reproducible | Adopted |
| 2026-09-29 | Screenshots are user-supplied and re-encoded in the browser; the toolkit never renders or restores a gateway to capture them | Adopted |
| 2026-09-29 | Hand-rolled MCP over stdio (initialize, tools/list, tools/call) instead of an SDK dependency, while the tool surface is small | Proposed |
| 2026-09-29 | CLI name `oic-docs` and package identifiers are provisional until repository, npm and trademark checks | Proposed |
| 2026-09-29 | Code Apache-2.0 | Proposed |
