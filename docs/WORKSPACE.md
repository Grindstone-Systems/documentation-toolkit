# Workspace format (`oic.docs.workspace/v0`)

A workspace is a ZIP that expands into ordinary files. People edit it in any editor, agents edit it with file tools or MCP, and the browser or CLI rebuilds exports from it.

```
riverbend-workspace/
├── manifest.json          schema, engine and adapter versions, input hashes, coverage, review counts
├── toolkit.config.json    identity, appearance, sections, redaction, context
├── evidence/              inputs, entities, relationships, diagnostics, coverage (JSON, read-only)
├── content/
│   ├── document.json      section order, status, refs and structure
│   └── sections/          one Markdown file per section: edit these
├── assets/                logo and images (PNG, JPEG, WebP)
├── exports/               reference.html, reference.docx and CSV inventories, if included
├── README.md              for people
├── AGENTS.md              rules for AI assistants
└── CLAUDE.md              imports AGENTS.md
```

The original backup isn't included. Redaction choices apply to the evidence in the workspace too.

## Section files

```markdown
---
id: scripts
title: Scripts
status: ai-draft
origin: agent
evidence: 3f2a…
---

Paragraphs, `- lists`, pipe tables, `### headings`, `**Key:** value` facts,
`> **Note:** / **Gap:** / **Warning:**` callouts, `![caption](assets/x.png)` and fenced code.
<!-- refs: script:Riverbend/riverbend.pumps -->
```

`<!-- refs: … -->` after a block keeps source ids attached to the text. The system map is kept as a marker line and regenerated.

## Review states

| Status | Meaning |
| --- | --- |
| `extracted` | Generated verbatim from configuration. Any edit turns it into `ai-draft`. |
| `ai-draft` | Written or edited by an assistant. Needs review. |
| `confirmed` | Reviewed by a person. Agents can't set it (validation fails). |
| `unresolved` | Needs information only the site has. |

## Reimport and regeneration

- Every file is untrusted: config is sanitised, entities and blocks are validated, only raster images are accepted, and unknown Markdown becomes plain paragraphs.
- Sections that were edited, drafted or confirmed keep their text when evidence is regenerated. If the evidence behind them changed, they're flagged `review: evidence-changed` instead of overwritten.
- New section files (with an `id` in the front matter) are added before the coverage section.
- A Word file edited downstream is a finished branch of the work; its changes aren't merged back.

`oic-docs validate <dir>` (or the MCP `validate` tool) checks that cited ids exist, statuses are honest and images exist.
