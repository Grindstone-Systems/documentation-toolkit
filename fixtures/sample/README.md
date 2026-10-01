# Sample: Riverbend Water Treatment

**Synthetic.** Riverbend isn't a real site. These files imitate an Ignition 8.3 project export and a Designer tag export so the toolkit has something to show and test against without anyone's real configuration.

- `riverbend-project/` — a project export, unzipped (pages, views, scripts, named queries, one legacy Vision window stored as a placeholder binary).
- `riverbend-tags.json` — a tag export with UDT definitions, instances and alarms.

One reference, `[default]Riverbend/Chemical/ChlorineResidual`, deliberately points at a tag that doesn't exist, so the unresolved-reference reporting has something to find.
