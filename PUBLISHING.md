# Publish and release the source repository

The dedicated destination is **https://github.com/summationai/agent-cloud-plugin**. This repository contains editable source, configuration, readable helper/build/validation scripts, standalone package/lock/toolchain, tests and public CI, together with both catalogs and a generated `plugins/agent-cloud` tree. Maintain this one repository for Claude and Codex; provider ZIPs are release outputs, not the maintained source.

## Bootstrap the one public repository

The initial source export can be copied into an empty Git repository, including hidden `.github/`, `.agents/` and `.claude-plugin/` directories. Preserve the destination's `.git`. Do not copy the private monorepo, its history, credentials, `node_modules` or `dist`. The owner creates or clones the configured destination and copies the complete source export with `cp -R /absolute/generated/repository/. /absolute/public-checkout/`.

Before the initial source push, review the complete source and current licensing/listing status. Unset choices remain visible in `LICENSE-STATUS.md` and the release report; source availability does not imply a distribution license or directory approval. Approved license/text and required listing/review materials are enforced by `--release` before a release-ready package build. Generating this repository does not create a GitHub repository, push code or submit a listing.

## Build and release from this repository

From a clean clone, use Node 24.22.1 or later:

```text
npm ci
npm test
npm run typecheck
npm run sync:generated
npm run check:generated
npm run build -- --release
```

Edit maintained source/configuration here, update the shared package version and lockfile, regenerate and review the install tree. The build produces both provider ZIPs and checksums in `dist/production/` without any access to the private source repository. The public CI checks the same source and generated-tree parity. Verify the release output with `shasum -a 256 -c SHA256SUMS` (or `sha256sum -c SHA256SUMS`), from `dist/production/`.

After the release owner reviews the concrete source/version and configured legal/listing values, from the public checkout:

```text
git status --short
git diff --check
git add .
git diff --cached --stat
git commit -m "Release agent.cloud 0.1.1"
git tag v0.1.1
git push origin HEAD
git push origin v0.1.1
git push origin 'v0.1.1^{commit}:refs/heads/stable'
gh release create v0.1.1 --repo summationai/agent-cloud-plugin --verify-tag --title "agent.cloud 0.1.1" dist/production/submissions/*.zip dist/production/SHA256SUMS
```

Review the staged file list for credentials or unintended local files before committing. `.gitignore` excludes dependency/build directories and environment files. Never move a released tag; publish a new version. Installs follow the `stable` branch, so moving it to the new tag is the step that ships the release: `claude plugin marketplace update` and auto-update read it, and the plugin version must increase for clients to see an update. Move `stable` only to a released tag, never commit to it directly, and protect it on GitHub so only release owners can push. `main` may carry unreleased work. Before advertising Git installation, install from the actual public URL/ref in clean Claude and Codex profiles and repeat the acceptance cases. Local-path success does not establish public transport or directory acceptance.

## Submit each provider artifact

**OpenAI:** upload `dist/production/submissions/agent-cloud-0.1.1-production-openai.zip`. Its root contains portable `plugin.json`, `mcp.json`, skills and every runtime resource. Use the verified publishing identity and [plugin submission dashboard](https://developers.openai.com/plugins/deploy/submission). Include the remote HTTPS MCP configuration in the initial ZIP, complete domain/authentication/tool scans, and supply review materials. Enter reviewer credentials only in the secure dashboard. Follow the applicable review route for desktop helper execution; remote-MCP review does not establish every local capability.

**Claude:** use `dist/production/submissions/agent-cloud-0.1.1-production-claude.zip`. Its root contains `.claude-plugin/plugin.json`, `.mcp.json`, skills and all runtime resources. Extract it and run `claude plugin validate <extracted-plugin> --strict`, plus directory-profile checks when preparing that submission. The repository's `.claude-plugin/marketplace.json` is the own-marketplace route; [Anthropic directory submission](https://claude.ai/directory/manage) and official-marketplace placement are separate. Follow [publishing guidance](https://code.claude.com/docs/en/plugins/publish) and current portal upload requirements.

`dist/production/release-report.json` distinguishes structural validation from unresolved metadata. Source publication, uploaded/submitted, approved/listed and published package states are recorded separately. Source repository availability alone is not provider approval or a successful connected Setup/publishing journey.
