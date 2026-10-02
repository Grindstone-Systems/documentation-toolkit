# Roadmap

This tracks the internal vision plan (stages 1–5) against what exists.

| Stage | Deliverable | Status |
| --- | --- | --- |
| 1 · Feasibility | Browser parser and basic renderer on real, sanitized fixtures | ✅ 8.x project exports, tag JSON and 8.1 and 8.3 backups parse in a worker; limits enforced; unsupported types counted. 8.1 gateway configuration is read from the internal database. See [FEASIBILITY.md](FEASIBILITY.md). ⏳ benchmark on the agreed reference fixture and test machine |
| 2 · Browser product | Local preview, branding controls, downloadable reference | ✅ Workspace with Inspect / Evidence / Coverage, four packs, branding, screenshots (re-encoded locally), section choice, redaction, offline HTML with search, print CSS, CSV. Privacy and offline check in CI (`pnpm privacy:check`). Deployed to Pages and listed on OIC. Print CSS checked in Chrome: contents page, running footer with page numbers, headings kept with their content. ⏳ Safari and Firefox print |
| 3 · Editable pack | DOCX renderer, portable workspace reimport | 🟡 Word export (headings, tables with repeating headers and fitted column widths, captions, headers/footers, logo, screenshots; deterministic), checked in Word for Mac. Workspace ZIP round-trips; edits survive regeneration with review flags. ⏳ LibreOffice visual check |
| 4 · Agent extension | CLI, skill and MCP adapter | 🟡 `oic-docs` inspect/build/validate/mcp, workspace `AGENTS.md`, skill. MCP setup checked in Claude Code and Codex ([LOCAL.md](LOCAL.md)). ⏳ npm publication |
| 5 · Expansion | More versions and platforms | ✅ 8.1 internal database (tags, UDTs, connections, devices, providers). ✅ Host-supplied evidence (`oic.docs.supplement/v0`): controllers, PLC tags, I/O points, PLC/HMI disagreements and runtime facts from a host such as FATE, with their own sections and CSVs. ⏳ Vision windows, reports, a native L5X adapter |

## Next up

1. Hands-on checks: open the Word export in LibreOffice, and print to PDF in Safari and Firefox.
2. Test the 8.1 internal-database reader on more real 8.1 backups (other drivers, OPC-COM and third-party modules), and document the remaining 8.1 settings tables.
3. Keep the OIC listing current: approve the `profile-update/documentation-toolkit` PR after each change to `.oic/` ([OIC_LISTING.md](OIC_LISTING.md)).
4. Decide on npm publication of `oic-docs` (name, `private: false`, provenance) and record it in [DECISIONS.md](DECISIONS.md).
5. Benchmark on a backup with tens of thousands of tags.
6. A native L5X adapter producing the same `controller` and `plc-tag` evidence a supplement carries, so a PLC program can be documented without a host.
