# Hosting at $0

Everything runs in the visitor's browser: parsing, documents, exports and the sample. Hosting is serving a folder of static files (about 110 KB of compressed JavaScript, plus fonts and a lazily loaded worker and sample).

| Piece | Where | Cost |
| --- | --- | --- |
| Code and issues | Public repo `Grindstone-Systems/documentation-toolkit` | $0 |
| App | GitHub Pages, deployed by `.github/workflows/deploy-pages.yml` on every push to `main` | $0 for public repos |
| Tests | GitHub Actions (`ci.yml`) on every pull request | $0 for public repos |

### One-time steps

1. Create the public repo and push.
2. In **Settings → Pages**, set **Source: GitHub Actions**.
3. Optional: a custom domain or the OIC route `/tools/documentation-toolkit`. Set the repo variable `PAGES_BASE` to the path the app is served from.

There's no AI cost to host: assistants run on the user's own subscription, on their machine.
