# Documentation Toolkit — agent instructions

This is a Grindstone Systems project for the Open Industrial Collective: one repo with a single package. `lib/` is the engine, `app/` is the browser app, and `cli/` is the optional local extension (`oic-docs`, including the MCP server). The vision plan is an internal document kept locally in `docs/sources/` (gitignored, never published). Status is in `docs/ROADMAP.md` and decisions are in `docs/DECISIONS.md`. It follows the same pattern as `visual-toolkit`.

- Keep it simple. One package and one TypeScript engine shared by the browser and the CLI. Don't add a second parser in another language.
- **Browser-local and private.** Inputs never leave the device: no analytics, telemetry, remote fonts or fallback servers. Never read credential values. See `docs/PRIVACY.md`.
- **$0 hosting.** Static site on GitHub Pages, deployed by Actions on every push to `main`. Use the `b-mac-gs` GitHub account, not `bwmcclai`.
- **Deterministic output.** The same input and config produce the same evidence, documents and ZIPs. Adapter output changes bump the adapter version in `lib/extract.ts`.
- **Never invent procedures.** Operating steps, alarm responses and safety information stay Unresolved unless a person supplies them. Only people confirm sections.
- **Count, don't drop.** Anything found but not read goes into coverage with a reason.
- **Fixtures are synthetic.** Never commit real backups, project exports or customer names. Real backups can be probed locally with `oic-docs inspect`.
- Extend Ignition, never replace it. Don't claim Inductive Automation endorsement.
- Run `pnpm check` before calling work done, and `pnpm build && pnpm privacy:check` for anything that touches the app. `pnpm oic:check` validates the OIC listing (docs/OIC_LISTING.md).
