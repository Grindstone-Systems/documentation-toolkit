# Roadmap

This tracks the internal vision plan (stages 1–5) against what exists.

| Stage | Deliverable | Status |
| --- | --- | --- |
| 1 · Feasibility | Browser parser and basic renderer on real, sanitized fixtures | ✅ 8.x project exports, tag JSON and 8.1 and 8.3 backups parse in a worker; limits enforced; unsupported types counted. 8.1 gateway configuration is read from the internal database. See [FEASIBILITY.md](FEASIBILITY.md). ⏳ benchmark on the agreed reference fixture and test machine |
| 2 · Browser product | Local preview, branding controls, downloadable reference | ✅ Workspace with Inspect / Evidence / Coverage, four packs, branding, screenshots (re-encoded locally), section choice, redaction, offline HTML with search, print CSS, CSV. Privacy and offline check in CI (`pnpm privacy:check`). ⏳ first Pages deploy |
| 3 · Editable pack | DOCX renderer, portable workspace reimport | 🟡 Word export (headings, tables with repeating headers, captions, headers/footers, logo, screenshots; deterministic). Workspace ZIP round-trips; edits survive regeneration with review flags. ⏳ Word and LibreOffice visual check |
| 4 · Agent extension | CLI, skill and MCP adapter | 🟡 `oic-docs` inspect/build/validate/mcp, workspace `AGENTS.md`, skill. ⏳ tested setup in Claude Code and Codex, npm publication |
| 5 · Expansion | More versions and platforms | ✅ 8.1 internal database (tags, UDTs, connections, devices, providers). ⏳ Vision windows, reports, L5X |

## Next up

1. Hands-on testing: open real backups in the app, open the Word export in Word and LibreOffice, print to PDF in Chrome, Safari and Firefox.
2. Publish: create the public repo and turn on Pages ([HOSTING.md](HOSTING.md)).
3. OIC listing: the profile, overview and media are ready in `.oic/` and pass `pnpm oic:check`; register after the first deploy ([OIC_LISTING.md](OIC_LISTING.md)).
4. Validate the agent setup in Claude Code and Codex and record the exact commands in [LOCAL.md](LOCAL.md).
5. Test the 8.1 internal-database reader on more real 8.1 backups (other drivers, OPC-COM and third-party modules), and document the remaining 8.1 settings tables.
