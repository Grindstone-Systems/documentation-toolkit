# Evidence model (`oic.docs.evidence/v0`)

Adapters turn inputs into evidence; documents cite it. It's platform-neutral so future adapters (L5X, other SCADA) reuse the packs and renderers unchanged. Types are in `lib/types.ts`.

| Part | What it holds |
| --- | --- |
| `inputs` | One record per file: name, size, SHA-256, detected format, adapter and version, platform version |
| `entities` | Things in the system: `project`, `page`, `view`, `script`, `event-script`, `named-query`, `tag-provider`, `tag-folder`, `tag`, `udt-type`, `udt-instance`, `alarm`, `opc-connection`, `database-connection`, `device`, `user-source`, `gateway`, `resource`; and, only from a [supplement](#supplied-evidence-oicdocssupplementv0), `controller`, `plc-tag`, `io-point`, `disagreement`, `runtime-fact` |
| `relationships` | `routes-to`, `embeds-view`, `binds-tag`, `calls-query`, `calls-script`, `instance-of`, `has-alarm`, `uses-connection`, `contains`; from a supplement, `reads-plc-tag`, `wired-to`, `concerns`, `about` |
| `diagnostics` | Warnings and notes, with a source locator where there is one |
| `coverage` | Per resource type: how many were found and how many were read, and why they differ |

## Entities

- **Stable ids** such as `view:Riverbend/Pumps/PumpStation`, `tag:[default]Riverbend/Intake/RawFlow` or `alarm:[default]Riverbend/Clearwell/Level#Low Level`. User and agent edits attach to them across re-imports.
- **`source`** is `{ input, path, at? }`: the file the user chose, the entry inside it, and optionally a JSON pointer.
- **`fields`** are short scalars and lists. Script and SQL text is clipped.
- **`sensitive`** marks fields as `address`, `username` or `code` so exports can redact them. Credential values are never extracted at all.
- **`interpreted: false`** means the resource was listed by name but its content isn't decoded yet (for example Vision windows stored as binary).

## Relationships

- **`explicit`** is true for declared configuration (bindings, page routes, expression references, UDT types) and false for links inferred by reading script text.
- **`dynamic`** marks references built at runtime (indirect bindings, parameters, string concatenation). They're counted but never guessed.
- **`to`** is set when the target resolved to an entity in the input. Otherwise the reference is reported as a gap, except connections when no gateway backup was supplied, which are reported once as a limit of the input, and supplied `concerns` and `about` relationships, whose `target` may name something that is missing by design (a disagreement's other side, a resource the inputs don't contain).

## Ignition adapters

| Input | Adapter | Reads |
| --- | --- | --- |
| Project export ZIP (8.x) | `ignition.project` | `project.json`; Perspective views (components, bindings, embedded views, navigation, scripts), page configuration and docks, style classes; script library (`code.py`); named queries (`query.sql` + attributes); gateway event scripts. Other modules are listed |
| Tag export JSON | `ignition.tags` | Folders, atomic tags, UDT definitions and instances, alarms. UDT members are expanded per instance with parameters substituted into OPC item paths |
| Gateway backup 8.3 | `ignition.gateway` | Every project under `projects/`, plus `config/resources/**`: tag providers and definitions, UDT types, OPC and database connections, devices, user sources (count only) and other settings. Built-in images, themes, drivers and translations are counted and skipped |
| Gateway backup 8.1 | `ignition.gateway` | Every project under `projects/`, plus the internal database `db_backup_sqlite.idb`: tag providers, folders, tags, UDT definitions and instances (with overrides) and alarms from `TAGCONFIG`; OPC connections, database connections, devices (with the driver's address and port), user sources (names only) and profiles such as tag groups, alarm journals, schedules and historians. Only named, non-credential columns are read. Other tables are counted by row in coverage: users and security material never read, platform defaults and logs skipped, remaining settings tables listed as not documented yet |

Resource formats come from the Ignition 8.3 documentation on project export and gateway backup, and from inspecting real exports. The 8.1 table layout was learned from a real 8.1.45 backup; tests use a synthetic database built from SQL in the same shape (`test/idb81.ts`). 8.1 entities keep the ids an 8.3 backup of the same gateway would give them (`resource:gateway/ignition/tag-group/<provider>/<name>` and so on), and their `source` points at `db_backup_sqlite.idb` with the table and row key in `at`. Adapters are versioned in `lib/extract.ts`.

## Supplied evidence (`oic.docs.supplement/v0`)

Some evidence can't come from Ignition files: the PLC program, the I/O list, and what the running system did. A host that already parses and cites those (FATE is the first) hands them to the toolkit as one JSON file, detected by its `schema` field before any tag-export check, whatever it's called. It's read in the browser like any other input, and from a folder of JSON files in the CLI.

```json
{ "schema": "oic.docs.supplement/v0", "producer": "FATE", "entities": [], "relationships": [], "coverage": [], "diagnostics": [] }
```

Entities, relationships, coverage and diagnostics are the evidence types above. Each supplied entity and relationship keeps its own `source`, naming the document the fact came from (`line1-controller.L5X`, `line1-io-list.xlsx`, `alarm journal`, `audit log`, `tag history`) with `path` and `at` locating it (`line 123`, `row 4`, a window). A missing source cites the supplement file itself, with a note.

| Kind | Id | Fields |
| --- | --- | --- |
| `controller` | `controller:<name>` | `processorType`, `softwareRevision`, `tags` (count) |
| `plc-tag` | `plc-tag:<controller>/<name>` (program tags `Program:<P>.<name>`) | `controller`, `dataType`, `tagType`, `aliasFor`, `description`, `program` |
| `io-point` | `io-point:<address>` | `address`, `tag`, `description`, `type` (DI/DO/AI/AO…), `equipment` |
| `disagreement` | `disagreement:<kind>:<subject>` | `kind` (`renamed`, `io-without-plc`, `ignition-without-plc`, `alarm-missing` or another), `text` (one sentence), `subject`, `expected`, `address` |
| `runtime-fact` | `runtime-fact:<metric>:<subject id>` | `metric`, `windowFrom`, `windowTo`; `alarm-activations`: `activations`, `perDay`, `complete`; `normal-range`: `min`, `p05`, `median`, `p95`, `max`, `samples`, `unit`; `last-change`: `at`, `by`, `action` |

| Relationship | From → to | Meaning |
| --- | --- | --- |
| `reads-plc-tag` | `tag` → `plc-tag` | The Ignition tag's OPC item path reads this PLC tag |
| `wired-to` | `io-point` → `plc-tag` | The I/O list row's point is this PLC tag |
| `concerns` | `disagreement` → any | One side of a disagreement, cited by its `source`; each disagreement has two |
| `about` | `runtime-fact` → any | The entity the fact describes |

A `reads-plc-tag` or `wired-to` without a PLC tag is a gap like any other reference. A `concerns` or `about` without `to` isn't: its `target` names the missing side.

The adapter is defensive, and counts what it refuses in coverage and warnings rather than dropping it silently:

- **Adds, never overrides.** Only the five kinds above are accepted. An entity of an Ignition kind (`tag`, `alarm`, …) or any other kind is refused, as is any relationship type other than the four above, so a supplement can't change what Ignition's own files say. Ids must start with their kind's prefix and are never replaced: a repeated id keeps the first (`duplicate-id`).
- **Bounded.** At most 100,000 entities, 200,000 relationships and 1,000 coverage items and diagnostics; strings are clipped (500 characters for fields, 50 items per list); only fields shaped like evidence values (short scalars and lists of strings) are kept.
- **No credentials.** Field names that look like credentials (the same rule as gateway settings) are never read, and counted in `secrets-excluded`.
- **Redaction.** `sensitive` marks are honoured; the `by` of a `last-change` fact is a username unless marked otherwise.

| Input | Adapter | Reads |
| --- | --- | --- |
| Supplement JSON (`oic.docs.supplement/v0`) | `oic.supplement` | Controllers, PLC tags, I/O points, PLC/HMI disagreements and runtime facts a host supplies, with their own sources; its coverage and diagnostics. Packs gain *Controllers and I/O*, *PLC and HMI disagreements*, *Runtime facts* and *Appendix: PLC tags and I/O*, and exports gain `plc-tags.csv`, `io-points.csv` and `disagreements.csv`, only when it's present |
