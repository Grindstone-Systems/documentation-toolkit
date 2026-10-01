# The OIC listing

Documentation Toolkit is listed the same way as Visual Toolkit: the profile lives in this repo (`.oic/`) and OIC publishes a reviewed, pinned snapshot of it. Nothing publishes automatically.

| Piece | Where |
| --- | --- |
| Profile | `.oic/project.yaml` (schema `oic/project/v2`) |
| Long description | `.oic/overview.md` (≤ 20 KB) |
| Media | `.oic/media/*.jpg`, `logo.png` (≤ 8 images; PNG/JPEG/WebP ≤ 2 MB and ≤ 12 MP each) |
| Registration | `open-industrial-collective/website`: `content/sources.json` → `documentation-toolkit` (repository ID 1396831416, controller 10232151) |
| Listing | https://openindustrialcollective.org/projects/documentation-toolkit |

## 1. Change the profile or media here

```bash
pnpm oic:media           # regenerate the screenshots and logo (starts Vite, drives your Chrome)
pnpm oic:media evidence  # or only shots whose name matches
pnpm oic:check           # check the profile with OIC's importer and Charter preflight
```

`oic:check` runs OIC's own profile check, the importer and Charter preflight a reviewer runs, from a cached clone of the public website repo (or the checkout in `OIC_WEBSITE`). `pnpm oic:check --ref HEAD` checks exactly what OIC would import, and its digest matches the reviewer's `fetch`. CI runs the same check through the `open-industrial-collective/website/profile-check` Action. A clean check is not an approval.

Keep claims accurate:
- Screenshots use the synthetic Riverbend sample. Say so; never use a customer's project.
- Keep the version support statement (8.x projects, tag JSON, 8.1 and 8.3 backups with gateway configuration) in step with `docs/EVIDENCE.md`.
- State that AI is optional and uses the user's own assistant.

Commit and push to `main`.

## 2. First publication (once)

Done on 2026-09-30: enrollment in [website#20](https://github.com/open-industrial-collective/website/issues/20), registered and approved in [website#21](https://github.com/open-industrial-collective/website/pull/21), first pinned to `abb3777`. The steps, for reference:

0. Open a **Submit a listing** issue in the website repo with the repository, manifest path, relationship (numeric repository and account IDs), free-access URL, costs and the listing permissions.

1. The repo must be public and the app deployed to Pages (`docs/HOSTING.md`), because the profile links to both.
2. In the website repo, register the source in `content/sources.json` the way `visual-toolkit` is registered (repo id, `main`, controller).
3. Fetch and approve: `npm run profile -- fetch documentation-toolkit --path .oic/project.yaml`, then `npm run profile -- approve documentation-toolkit --digest <digest>`, `npm run check`, commit and push.

## 3. Updates

Either wait for the website's daily **Check registered project profiles** job or run `gh workflow run refresh.yml -R open-industrial-collective/website`, then approve the `profile-update/documentation-toolkit` PR the same way as for Visual Toolkit (see `visual-toolkit/docs/OIC_LISTING.md`).

Commit identity: use the b-mac-gs noreply email in public repos.
