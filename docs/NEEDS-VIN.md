# Things that need Vin

Everything else is done and verified (see HANDOVER.md). These items need repository-owner access or a decision only the owner can make. None blocks using the library.

## 1. Tag and release v1.0.0 (if not already present)

Check first: <https://github.com/vincentwesley/safe-regex/tags>. If `v1.0.0` is missing (the session that built this could only push to its working branch, so it may not have been able to push a tag):

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

## 2. Merge the pull request (if it is still open)

All work is in one pull request from `claude/nice-dijkstra-k7m4sp`. If it wasn't merged automatically, review and merge it (squash or merge commit both fine), then do step 1 on `main`.

## 3. Turn on private vulnerability reporting

SECURITY.md tells reporters to use GitHub's private "Report a vulnerability" button. Enable it: repository **Settings → Code security → Private vulnerability reporting → Enable**.

## 4. Optional: host the playground on GitHub Pages

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
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist/playground }
      - id: deployment
        uses: actions/deploy-pages@v4
```

The site would then be at `https://vincentwesley.github.io/safe-regex/`; add that link to the README.

## 5. Optional: publish to npm

Deliberately not done (needs your npm token). If you want it: `npm login`, then `npm publish --access public` from a clean checkout of the tag. The package name is `@vincentwesley/safe-regex`; change it in `package.json` first if you prefer another scope.
