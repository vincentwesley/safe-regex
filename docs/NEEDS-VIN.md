# Things that need Vin

Everything else is done and verified (see HANDOVER.md). These items need repository-owner access or a decision only the owner can make. None blocks using the library.

## 1. Tag and release v1.0.0 (required) — done 2026-11-15

**Done 2026-11-15:** tag `v1.0.0` pushed and release published: https://github.com/vincentwesley/safe-regex/releases/tag/v1.0.0

The project is merged into `main` (pull request #1, merge commit `a6715bf`), but the session that built it could not create the tag: its git access only allows pushing to its working branch, and `git push origin v1.0.0` was refused by the remote. Tag the merged `main`:

```bash
git clone https://github.com/vincentwesley/safe-regex.git
cd safe-regex
git checkout main
git pull
git tag -a v1.0.0 -m "safe-regex 1.0.0"
git push origin v1.0.0
```

Then create the GitHub release (web UI: Releases → Draft a new release → choose tag `v1.0.0` → title `v1.0.0` → paste the `[1.0.0]` section of CHANGELOG.md → Publish), or with the GitHub CLI:

```bash
gh release create v1.0.0 --title "v1.0.0" --notes-file <(sed -n '/## \[1.0.0\]/,$p' CHANGELOG.md)
```

After the tag exists, the README's install line works: `npm install github:vincentwesley/safe-regex#v1.0.0`.

## 2. Turn on private vulnerability reporting — done 2026-11-15

**Done 2026-11-15:** enabled (API reports `"enabled": true`).

SECURITY.md tells reporters to use GitHub's private "Report a vulnerability" button. Enable it: repository **Settings → Code security → Private vulnerability reporting → Enable**.

## 3. Optional: host the playground on GitHub Pages — done 2026-11-15

**Done 2026-11-15:** Pages source set to GitHub Actions, workflow added as `.github/workflows/pages.yml`, site live at https://vincentwesley.github.io/safe-regex/ and linked from the README.

Not required (the playground builds to `dist/playground/` and runs from any static server). To publish it: **Settings → Pages → Build and deployment → Source: GitHub Actions**, then add this workflow as `.github/workflows/pages.yml`:

```yaml
name: Pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with: { node-version: 22, cache: npm }
      - run: npm ci --ignore-scripts
      - run: npm run build
      - uses: actions/upload-pages-artifact@56afc609e74202658d3ffba0e8f6dda462b719fa # v3.0.1
        with: { path: dist/playground }
      - id: deployment
        uses: actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e # v4.0.5
```

The site would then be at `https://vincentwesley.github.io/safe-regex/`; add that link to the README.

## 4. Optional: publish to npm — done 2026-11-16

**Done 2026-11-16:** `@vincentwesley/safe-regex@1.0.0` published from a clean checkout of the `v1.0.0` tag (npm org `vincentwesley`, 2FA by security key): https://www.npmjs.com/package/@vincentwesley/safe-regex. Future releases: `npm publish --access public` from a real terminal (the security-key approval needs an interactive prompt).
