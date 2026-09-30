# Documentation Toolkit

**Turn an Ignition backup into an engineering reference.** By Grindstone Systems, for the Open Industrial Collective.

Open a gateway backup, project export or tag export in your browser. You get a searchable engineering reference and an editable manual pack, with every fact traced to the file it came from. Nothing is uploaded. Your own AI assistant (Claude Code, Codex or any MCP client) can then explain and complete the pack through an optional local extension.

> Status: **Experimental (0.1), testing phase.** Check generated documents against the source before relying on them. Reads Ignition 8.x project exports, tag exports and 8.3 gateway backups; 8.1 backups document projects only. Four packs (Engineering Reference, Operator Manual Framework, Maintenance Guide Framework, Complete Handoff), customer branding and screenshots. Exports: offline HTML, Word (.docx), print-to-PDF, CSV inventories and an agent workspace. Works offline once loaded. The `oic-docs` CLI and MCP server work locally but aren't published to npm yet. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Quick start

```bash
pnpm install
pnpm dev          # app at http://127.0.0.1:5173 (try "Explore the sample")
pnpm check        # typecheck + tests + app build + CLI build
pnpm privacy:check   # after a build: no request leaves the origin; works offline (needs Chrome)
```

Requires Node ≥ 22.12 and pnpm 10.

**Demo file:** [`demo/riverbend-demo.gwbk`](demo/) is a synthetic Ignition 8.3 gateway backup of a fictional water plant, made to show everything the toolkit reads (and refuses to read). Drop it into the app. Regenerate with `pnpm demo:backup`.

The local extension, from a checkout:

```bash
pnpm build:cli
node dist-cli/oic-docs.mjs inspect path/to/backup.gwbk
node dist-cli/oic-docs.mjs build path/to/backup.gwbk --out my-workspace
node dist-cli/oic-docs.mjs mcp --workspace my-workspace     # for AI agents
```

## Layout

One repository, one package:

| Path | What it is |
| --- | --- |
| `lib/` | The engine: safe archive reading, adapters, evidence model, document packs, renderers, workspace format |
| `lib/adapters/` | Ignition project, tag and gateway backup adapters |
| `lib/document/` | The document model and the four packs |
| `lib/render/` | Offline HTML, Word, Markdown (both ways), CSV and the system map |
| `app/` | The browser app (React + Vite, fully static; parsing runs in a worker) |
| `cli/` | `oic-docs`: inspect, build, validate and an MCP server over stdio |
| `agent/` | A skill and setup notes for AI assistants |
| `fixtures/sample/` | Riverbend, a synthetic sample project. Never real customer data |
| `scripts/` | Privacy/offline check, OIC listing media and validation |
| `.oic/` | The OIC catalog profile, overview and media ([docs/OIC_LISTING.md](docs/OIC_LISTING.md)) |
| `docs/` | Privacy, evidence, workspace, local extension, feasibility, roadmap, decisions |

## How it works, in one paragraph

An **adapter** reads an input (a backup, a project export, a tag export) and produces **evidence**: entities such as views, tags, alarms and queries, the relationships between them, and a coverage report of what was and wasn't read, each with its source file. A **pack** turns evidence into a **document** of typed sections, each marked Extracted, AI draft, Confirmed or Unresolved. **Renderers** turn the document into HTML, Word, Markdown and CSV. The **workspace** is all of it as plain files, so people and agents can edit sections and rebuild without losing work. See [docs/EVIDENCE.md](docs/EVIDENCE.md) and [docs/WORKSPACE.md](docs/WORKSPACE.md).

## Principles

- **Useful before AI.** The basic pack needs no model, account or install.
- **Private during basic generation.** Backups are read in the browser and never sent anywhere. Credentials are never read. See [docs/PRIVACY.md](docs/PRIVACY.md).
- **Explicit about coverage.** Anything found but not read is counted and shown.
- **Honest states.** Procedures, alarm responses and safety steps are never generated; they stay Unresolved until the site supplies them.
- **Portable after export.** HTML, Markdown, JSON and CSV that any tool can open.
- **$0 to run.** A static site with no backend.

## License

The code is Apache-2.0. Documents you generate are yours.
