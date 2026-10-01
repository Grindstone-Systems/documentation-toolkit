# Feasibility: parsing backups in the browser

The plan treats full browser parsing of `.gwbk` files as a gate, not an established capability. This is what the prototype found on 2026-09-29.

## Formats

- **Project exports** (8.x) are ZIPs of file-based resources: a folder per resource with `resource.json` plus content files (`view.json`, `code.py`, `query.sql`, `config.json`). Readable with a ZIP reader and `JSON.parse`.
- **Gateway backups, 8.3** are ZIPs with a `backupinfo.xml`, a `projects/` folder in the same format as project exports, and gateway configuration as files under `config/resources/<collection>/<module>/<type>/…` (`config.json`, `tags.json`, `resource.json`). Also readable with a ZIP reader and `JSON.parse`, so **no SQLite or other decoder is needed for 8.3.**
- **Gateway backups, 8.1** keep projects as files, but tags, connections and devices live in `db_backup_sqlite.idb`, a SQLite database. A small read-only SQLite reader in the engine (`lib/sqlite.ts`) decodes it in the browser worker and the CLI alike. Tags are one `TAGCONFIG` row per node holding the same JSON as a tag export, linked to their folder by `FOLDERID`; UDT definitions hang off a `_types_` folder id, and instance overrides are rows with an `<instance>.<member>` id carrying only the changed properties. Connections, devices, providers and profiles are ordinary tables. Checked against Node's built-in SQLite on every table of backup C, with identical results.
- Some resources stay binary in both versions (Vision windows and templates, reports, transaction groups, alarm pipelines). They're listed by name and counted as not read.

## Measurements

Real backups from Grindstone's own development gateways, read with the same engine the browser uses (Node 23, Apple Silicon). Numbers only; the backups aren't in the repo.

| Backup | Ignition | Size | Projects | Views | Tags | Extract | Build document |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | 8.3.9 | 9.3 MB | 2 | 13 | 86 | 57 ms | 9 ms |
| B | 8.3.9 | 4.3 MB | 2 | 37 | 0 | 92 ms | 3 ms |
| C | 8.1.45 | 66.4 MB | 7 | 59 | 1,381 | 90 ms | 4 ms |

Backup C's tags are 1,130 standalone tags plus 251 UDT members expanded from 19 definitions and 70 instances; its 2.5 MB internal database decodes in about 15 ms. Before the reader, the same backup documented no tags (86 ms extract, 2 ms build). The sample project extracts in the browser worker in about 40 ms. Most of a large backup is `user-lib/` Python libraries and module files, which the adapter never decompresses: selective decompression from the central directory is what keeps it fast.

## Still open

- The plan's targets (useful preview within 30 s, basic pack within 2 min) need the agreed reference fixture and test machine. These numbers suggest a wide margin, but backups with tens of thousands of tags are untested.
- Memory: the browser holds the whole file plus the entries it reads. Limits are 250,000 entries, 64 MB per entry and 768 MB decompressed in total; a very large backup may need streaming reads.
- Offline search under `file://` works in Chrome (inline script and index). Check Safari and Firefox.
- Browser print-to-PDF quality against the template standard.
