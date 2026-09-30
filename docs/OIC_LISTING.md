# The OIC listing

Documentation Toolkit is listed the same way as Visual Toolkit: the profile lives in this repo (`.oic/`) and OIC publishes a reviewed, pinned snapshot of it. Nothing publishes automatically.

| Piece | Where |
| --- | --- |
| Profile | `.oic/project.yaml` (schema `oic/project/v2`) |
| Long description | `.oic/overview.md` (≤ 20 KB) |
| Media | `.oic/media/*.jpg`, `logo.png` (≤ 8 images; PNG/JPEG/WebP ≤ 2 MB and ≤ 12 MP each) |
| Registration | `open-industrial-collective/website`: `content/sources.json` → `documentation-toolkit` (not registered yet) |

## 1. Change the profile or media here

```bash
pnpm oic:media           # regenerate the screenshots and logo (starts Vite, drives your Chrome)
pnpm oic:media evidence  # or only shots whose name matches
pnpm oic:check           # validate the profile against the catalog schema and the image limits
```

`oic:check` reads the schema from a sibling checkout of the website repo (`../open-industrial-collective/website/src/project-v2.schema.json`); set `OIC_SCHEMA` to use another path.

Keep claims accurate:
- Screenshots use the synthetic Riverbend sample. Say so; never use a customer's project.
- Keep the version support statement (8.x projects, tag JSON, 8.3 backups; 8.1 projects only) in step with `docs/EVIDENCE.md`.
- State that AI is optional and uses the user's own assistant.

Commit and push to `main`.

## 2. First publication (once)

1. The repo must be public and the app deployed to Pages (`docs/HOSTING.md`), because the profile links to both.
2. In the website repo, register the source in `content/sources.json` the way `visual-toolkit` is registered (repo id, `main`, controller).
3. Fetch and approve: `npm run profile -- fetch documentation-toolkit --path .oic/project.yaml`, then `npm run profile -- approve documentation-toolkit --digest <digest>`, `npm run check`, commit and push.

## 3. Updates

Either wait for the website's daily **Check registered project profiles** job or run `gh workflow run refresh.yml -R open-industrial-collective/website`, then approve the `profile-update/documentation-toolkit` PR the same way as for Visual Toolkit (see `visual-toolkit/docs/OIC_LISTING.md`).

Commit identity: use the b-mac-gs noreply email in public repos.
