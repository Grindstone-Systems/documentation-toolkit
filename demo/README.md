# Demo backup

`riverbend-demo.gwbk` is a **synthetic** Ignition 8.3 gateway backup for demonstrating Documentation Toolkit. Open it in the app (**Open backup or project**) or with `oic-docs inspect demo/riverbend-demo.gwbk`.

It has the file layout of a real 8.3 backup around the fictional Riverbend water plant:

- Two projects: `Riverbend` (Perspective pages and views, scripts, named queries, a Vision window) inheriting from `Riverbend_Global`.
- Tags, UDT definitions and instances, and alarms, stored the 8.3 way (one `tags.json` per folder).
- Two OPC connections, a SQL Server connection, three devices, a user source, alarm notification, journal and schedule.
- Things the toolkit must refuse: fake passwords and password hashes, keystores and certificates. They're excluded and counted, never shown.
- One deliberately missing tag, so gap reporting has something to find.

Everything is fictional, and it is **not a restorable backup**. Never load it into a real gateway. Regenerate it with `pnpm demo:backup`.
