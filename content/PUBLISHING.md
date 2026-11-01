# Publish and release the source repository

The dedicated destination is **{{repository}}**. This repository contains editable source, configuration, readable helper/build/validation scripts, standalone package/lock/toolchain, tests and public CI, together with both catalogs and a generated `plugins/agent-cloud` tree. Maintain this one repository for Claude and Codex; provider ZIPs are release outputs, not the maintained source.

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

Until the workflow in "Releases publish themselves on merge" below is built, the release owner publishes by hand. After the release owner reviews the concrete source/version and configured legal/listing values, from the public checkout:

```text
git status --short
git diff --check
git add .
git diff --cached --stat
git commit -m "Release agent.cloud {{version}}"
git tag v{{version}}
git push origin HEAD
git push origin v{{version}}
git push origin 'v{{version}}^{commit}:refs/heads/{{channel}}'
gh release create v{{version}} --repo {{repositorySlug}} --verify-tag --title "agent.cloud {{version}}" dist/production/submissions/*.zip dist/production/SHA256SUMS
```

Review the staged file list for credentials or unintended local files before committing. `.gitignore` excludes dependency/build directories and environment files. Never move a released tag; publish a new version. Installs follow the `{{channel}}` branch, so moving it to the new tag is the step that ships the release: `claude plugin marketplace update` and auto-update read it, and the plugin version must increase for clients to see an update. Move `{{channel}}` only to a released tag, never commit to it directly, and protect it on GitHub so only release owners can push. `main` may carry unreleased work. Before advertising Git installation, install from the actual public URL/ref in clean Claude and Codex profiles and repeat the acceptance cases. Local-path success does not establish public transport or directory acceptance.

## Releases publish themselves on merge

**Status:** spec, proposed 1 Nov 2026. Not built: the hand steps above are how a release goes out until it is. v0.2.0 went out by hand on 30 Oct, and 0.2.1 (9b4dbfd, merged 1 Nov) is waiting for the same.

**Who it's for and why.** Today a release owner has to run every step above, so a merged version waits for a person even when nothing a person must decide has changed. This workflow publishes a merged version by itself. A person is asked only for the two things that are theirs: a changed license, or a changed listing.

**Rules.**

- **PUB-1: A merge that bumps the version publishes it.** A push to `main` whose `package.json` version differs from its first parent's, with no `v<version>` tag yet, starts a publish of that commit. A push that doesn't change the version publishes nothing. A run that stopped can be started again by hand (`workflow_dispatch` with the version), and it goes through the same rules.
- **PUB-2: One version, higher than the last.** These must all carry the same version: `package.json`, `package-lock.json`, `release.json`, and the generated `plugins/agent-cloud` manifests (`plugin.json`, `.claude-plugin/plugin.json`, `bundle.json`). It must also be greater, by semver, than the newest released tag. Otherwise the run fails before anything is built or pushed, and names the file or the tag.
- **PUB-3: The same checks a release owner runs.** The run does `npm ci`, `npm test`, `npm run typecheck`, `npm run check:generated` and then `npm run build -- --release`. The `--release` build is the legal and listing gate: it fails on an unset license, a missing icon or any other release-readiness gap. Any failure stops the run with no tag, release or `{{channel}}` move.
- **PUB-4: A changed license or listing waits for the release owner; nothing else does.** The run compares these against the newest released tag:
  - the license (`release.config.json` `license`, `release-assets/LICENSE`);
  - the listing values (`release.config.json` `marketplace`, `plugin` and `openai`, and `release-assets/icon.png`).

  If any of them changed, or there's no released tag yet, the publish job waits for a release owner's approval on the repository's `release` environment, whose required reviewers are the release owners. The approval page shows the diff. Code, skills, pins, docs and every other change publish with no person.
- **PUB-5: Checksums before anything is pushed.** The run writes `SHA256SUMS` for both provider ZIPs in `dist/production/` and checks it with `sha256sum -c SHA256SUMS` before it tags.
- **PUB-6: Tag, then a GitHub release.** The run tags the merge commit `v<version>`, pushes the tag, and runs `gh release create v<version> --verify-tag --title "agent.cloud <version>"` with both ZIPs and `SHA256SUMS`. Its notes name the merged pull request. A version with a pre-release suffix (`-alpha.N`, `-rc.N`) becomes a GitHub pre-release and never moves `{{channel}}`.
- **PUB-7: `{{channel}}` moves only after the published assets verify.** The run downloads the release's assets from GitHub and checks them two ways: `sha256sum -c` against the published `SHA256SUMS`, and against the digests of the ZIPs it built. Only then does it push `v<version>^{commit}:refs/heads/{{channel}}`, as a fast-forward. `check.yml`'s existing "Release channel points at the released tag" step must then pass on `{{channel}}`. If the assets don't verify, `{{channel}}` stays where it was, the release is marked a pre-release with a note saying why, and the run fails.
- **PUB-8: A re-run picks up where it stopped, and never moves a tag.**
  - A tag that already points at the same commit is kept, and the run goes on.
  - A release that already has the same assets is kept.
  - A tag at another commit stops the run with a failure.
  - Publishes run one at a time, in one concurrency group: a second bump queues behind the first and is never cancelled.
- **PUB-9: A bad release rolls back by moving `{{channel}}` to the previous tag, then a fix goes forward.** A release owner runs the workflow's rollback (`workflow_dispatch` with `rollback_to: v<older>`, behind the `release` environment). It moves `{{channel}}` back to that tag's commit, and only to a released, non-pre-release tag older than `{{channel}}`. The bad release and its tag stay: tags never move. The release is marked a pre-release with a note naming the rollback.
  - Installs and `claude plugin marketplace update` read `{{channel}}`, so new installs get the older version at once.
  - A client that already updated keeps the bad version until a higher one ships, because clients update only when the version goes up. So a rollback is followed by a fix-forward: a pull request that reverts the change and bumps the patch version, which publishes by PUB-1.
- **PUB-10: The least access that does the job.** Only the publish and rollback jobs get `contents: write`, through `GITHUB_TOKEN`; every other job stays `contents: read`, as `check.yml` is now. No other secret is used. A ruleset protects `{{channel}}` so that only this workflow and the release owners can push to it, and nobody commits to it directly. `main`'s protection is unchanged.
- **PUB-11: Each run says what it did.** The job summary lists the version, the tag and commit, the release URL, each asset's SHA-256, whether a release owner was asked (and who approved), and `{{channel}}`'s move from one commit to the other. A rollback lists the same.

**Out of scope.** The provider submissions below (OpenAI's dashboard, Anthropic's directory) stay a person's. So does anything a reviewer must enter. This spec doesn't publish to npm or change how the source is built.

**Before it's built (prove the outside service, on a scratch repository).**
- A client that installed version N, from a marketplace whose `{{channel}}` moves back to N−1, keeps N and doesn't downgrade. PUB-9's fix-forward depends on this.
- `GITHUB_TOKEN` can push `{{channel}}` under a ruleset that bypasses only this workflow.
- An environment approval holds the job until a required reviewer approves.

**How each rule is tested.** The workflow's decisions live in `scripts/release.mjs` as functions that take plain inputs, tested in `test/release-workflow.test.ts` by rule ID. The workflow file only calls them and the commands above.
- PUB-1: version changed or unchanged against the first parent; a tag that already exists; the manual re-run.
- PUB-2: each file out of step with the others; equal to the newest tag; lower than it; pre-release ordering.
- PUB-3: each command's failure stops the run before the tag step. The workflow's step order is checked from the YAML.
- PUB-4: a change to each listed license or listing path asks the release owner; a change to code, skills, pins or docs doesn't; with no previous tag it asks.
- PUB-5 and PUB-7: a ZIP edited after `SHA256SUMS`, a downloaded asset that differs, and a missing asset each keep `{{channel}}` where it was.
- PUB-6: a pre-release version never moves `{{channel}}`.
- PUB-8: tag at the same commit goes on; tag at another commit fails; the concurrency group never cancels.
- PUB-9: rollback only to an older, released, non-pre-release tag, and refused otherwise.
- PUB-10: the workflow's `permissions` per job, read from the YAML.
- PUB-11: the summary's fields.

The whole workflow is then rehearsed end to end on a scratch repository, publishing and rolling back a version, before it runs here.

## Submit each provider artifact

**OpenAI:** upload `dist/production/submissions/agent-cloud-{{version}}-production-openai.zip`. Its root contains portable `plugin.json`, `mcp.json`, skills and every runtime resource. Use the verified publishing identity and [plugin submission dashboard](https://developers.openai.com/plugins/deploy/submission). Include the remote HTTPS MCP configuration in the initial ZIP, complete domain/authentication/tool scans, and supply review materials. Enter reviewer credentials only in the secure dashboard. Follow the applicable review route for desktop helper execution; remote-MCP review does not establish every local capability.

**Claude:** use `dist/production/submissions/agent-cloud-{{version}}-production-claude.zip`. Its root contains `.claude-plugin/plugin.json`, `.mcp.json`, skills and all runtime resources. Extract it and run `claude plugin validate <extracted-plugin> --strict`, plus directory-profile checks when preparing that submission. The repository's `.claude-plugin/marketplace.json` is the own-marketplace route; [Anthropic directory submission](https://claude.ai/directory/manage) and official-marketplace placement are separate. Follow [publishing guidance](https://code.claude.com/docs/en/plugins/publish) and current portal upload requirements.

`dist/production/release-report.json` distinguishes structural validation from unresolved metadata. Source publication, uploaded/submitted, approved/listed and published package states are recorded separately. Source repository availability alone is not provider approval or a successful connected Setup/publishing journey.
