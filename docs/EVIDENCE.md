# Evidence model (`oic.docs.evidence/v0`)

Adapters turn inputs into evidence; documents cite it. It's platform-neutral so future adapters (L5X, other SCADA) reuse the packs and renderers unchanged. Types are in `lib/types.ts`.

| Part | What it holds |
| --- | --- |
| `inputs` | One record per file: name, size, SHA-256, detected format, adapter and version, platform version |
| `entities` | Things in the system: `project`, `page`, `view`, `script`, `event-script`, `named-query`, `tag-provider`, `tag-folder`, `tag`, `udt-type`, `udt-instance`, `alarm`, `opc-connection`, `database-connection`, `device`, `user-source`, `gateway`, `resource` |
| `relationships` | `routes-to`, `embeds-view`, `binds-tag`, `calls-query`, `calls-script`, `instance-of`, `has-alarm`, `uses-connection`, `contains` |
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
- **`to`** is set when the target resolved to an entity in the input. Otherwise the reference is reported as a gap, except connections when no gateway backup was supplied, which are reported once as a limit of the input.

## Ignition adapters

| Input | Adapter | Reads |
| --- | --- | --- |
| Project export ZIP (8.x) | `ignition.project` | `project.json`; Perspective views (components, bindings, embedded views, navigation, scripts), page configuration and docks, style classes; script library (`code.py`); named queries (`query.sql` + attributes); gateway event scripts. Other modules are listed |
| Tag export JSON | `ignition.tags` | Folders, atomic tags, UDT definitions and instances, alarms. UDT members are expanded per instance with parameters substituted into OPC item paths |
| Gateway backup 8.3 | `ignition.gateway` | Every project under `projects/`, plus `config/resources/**`: tag providers and definitions, UDT types, OPC and database connections, devices, user sources (count only) and other settings. Built-in images, themes, drivers and translations are counted and skipped |
| Gateway backup 8.1 and earlier | `ignition.gateway` | Projects only. Gateway configuration is in `db_backup_sqlite.idb`, which is reported but not decoded yet |

Resource formats come from the Ignition 8.3 documentation on project export and gateway backup, and from inspecting real exports. Adapters are versioned in `lib/extract.ts`.
