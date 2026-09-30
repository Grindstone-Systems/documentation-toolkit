# Local extension: `oic-docs`

The browser is the complete basic product. The local extension is for AI agents, repeatable builds and scripting. It's the same engine as the app, built as one Node file.

> Not on npm yet, and the command name is provisional. Build it from a checkout: `pnpm install && pnpm build:cli`, then run `node dist-cli/oic-docs.mjs`.

| Command | What it does |
| --- | --- |
| `oic-docs inspect <input…> [--json]` | Report what was found and read |
| `oic-docs build <input…> --out <dir> [--pack <id>] [--config <file>] [--zip]` | Create a workspace with exports (HTML, Word, CSV). Running it again over the same folder keeps edited sections |
| `oic-docs build --workspace <dir>` | Re-render `exports/` (HTML, Word, CSV) from an edited workspace |
| `oic-docs validate <dir>` | Check refs, statuses and assets; exits 1 on errors |
| `oic-docs mcp --workspace <dir>` | Serve the workspace to an agent over stdio (MCP) |

Inputs can be `.gwbk`, project `.zip`, an unzipped project folder, or tag `.json`.

## MCP tools

`overview`, `search_evidence`, `get_entity`, `trace_relationships`, `check_coverage`, `read_section`, `write_section`, `validate`, `build_pack`.

- Reads only the workspace folder. Writes only `content/sections/*.md` and `exports/`.
- `write_section` refuses `status: confirmed` and requires `origin: agent`.
- stdio only; no network port is opened.

## Client setup (unverified)

These follow each client's documented MCP configuration but haven't been tested end to end yet.

**Claude Code**, from inside the unzipped workspace:

```bash
claude mcp add oic-docs -- node /path/to/documentation-toolkit/dist-cli/oic-docs.mjs mcp --workspace .
```

**Codex**, in `~/.codex/config.toml`:

```toml
[mcp_servers.oic-docs]
command = "node"
args = ["/path/to/documentation-toolkit/dist-cli/oic-docs.mjs", "mcp", "--workspace", "/path/to/workspace"]
```

Without MCP, both assistants still work from the workspace alone: they read `AGENTS.md` (Claude Code via `CLAUDE.md`) and edit the Markdown files directly. The skill in `agent/skills/documentation-toolkit/` carries the same rules for assistants that load skills.
