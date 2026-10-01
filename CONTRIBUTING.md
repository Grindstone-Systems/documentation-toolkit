# Contributing

Thank you for helping build Documentation Toolkit.

- **Add or extend an adapter:** adapters live in `lib/adapters/` and write to a `Collector`. Give entities stable ids, keep explicit and inferred relationships apart (`explicit`), mark runtime-built references `dynamic`, and count every resource type you find in coverage, including the ones you can't read yet. Bump the adapter version in `lib/extract.ts` when output changes.
- **Add a section or pack:** builders live in `lib/document/packs.ts`. Sections state only what the evidence shows and cite it in `refs`. Anything a site must supply is `unresolved`.
- **Fixtures:** synthetic only. Extend `fixtures/sample/` or build archives in tests with `zipOf`. Never commit real backups or customer names.
- **Security:** inputs are untrusted. Don't execute anything from them, don't render raw HTML from them, and don't read credential values.

Run `pnpm check` before opening a pull request.
