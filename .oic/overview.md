> **Experimental · testing phase.** It works and it's private, but it's still being proven on real projects. Check generated documents against the source before relying on them, and please report what it gets wrong.

Documentation Toolkit turns the files an Ignition project already produces into documentation a team can hand over. Open a gateway backup, a project export or a tag export and it builds a searchable engineering reference in your browser, with every fact traced to the file it came from. Nothing is uploaded.

## What you get

- **An engineering reference**: system overview, a system map of pages, views and data, projects, navigation, Perspective views, tags and UDTs, alarms, connections, named queries, scripts, cross-references and gaps, plus appendices with complete inventories.
- **Manual frameworks** for operators and maintenance. Screens, alarms and equipment come from configuration. Operating procedures, alarm responses and safety information are marked **Unresolved** until the site supplies them; the toolkit doesn't invent them.
- **Coverage you can trust.** Every resource type is counted as found and read. Anything the toolkit can't interpret yet, such as Vision windows, is listed and explained rather than silently dropped.
- **Your branding**: customer name, logo, revision, a few themes, Letter or A4, section choice, screenshots attached to screens, and redaction of addresses, usernames or code.

## Exports

- Offline HTML: one file with search that opens without a server
- Word (.docx) with real heading styles and tables
- PDF through the browser's print dialog
- CSV inventories of tags, alarms, views and queries
- An agent workspace: evidence as JSON and one Markdown file per section

## Bring your own AI assistant

The basic pack needs no AI. To go further, save the workspace and open it with Claude Code, Codex or another assistant. An optional local extension (`oic-docs`) adds MCP tools to search evidence, trace relationships, write draft sections and rebuild the pack. It reads only the workspace, never touches a gateway, and can't mark anything as confirmed.

## Privacy

Processing happens on your device. The app loads only its own files, keeps working offline once loaded, and never reads credentials from a backup. A CI check fails the build if any request leaves the app's origin.

## Where it fits

Documentation Toolkit reads exported files. It doesn't connect to a gateway, run project code or replace the Designer. It's in preview: project exports, tag exports and 8.3 backups are supported, and 8.1 backups document projects only. It has been tested on a synthetic sample and a small number of real backups. The code is open source under Apache-2.0.
