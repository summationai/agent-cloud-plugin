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

Until the workflow in "Releases publish themselves on merge" below is built, the release owner publishes by hand. After the release owner reviews the concrete source/version and configured legal/listing values, from the public checkout:

```text
git status --short
git diff --check
git add .
git diff --cached --stat
git commit -m "Release agent.cloud 0.3.3"
git tag v0.3.3
git push origin HEAD
git push origin v0.3.3
git push origin 'v0.3.3^{commit}:refs/heads/stable'
gh release create v0.3.3 --repo summationai/agent-cloud-plugin --verify-tag --title "agent.cloud 0.3.3" dist/production/submissions/*.zip dist/production/SHA256SUMS
```

Review the staged file list for credentials or unintended local files before committing. `.gitignore` excludes dependency/build directories and environment files. Never move a released tag; publish a new version. Installs follow the `stable` branch, so moving it to the new tag is the step that ships the release: `claude plugin marketplace update` and auto-update read it, and the plugin version must increase for clients to see an update. Move `stable` only to a released tag, never commit to it directly, and protect it on GitHub so only release owners can push. `main` may carry unreleased work. Before advertising Git installation, install from the actual public URL/ref in clean Claude and Codex profiles and repeat the acceptance cases. Local-path success does not establish public transport or directory acceptance.

## Releases publish themselves on merge

**Status:** spec, proposed 1 Nov 2026. Built as `.github/workflows/release.yml` and `scripts/release.mjs`, tested in `test/release-workflow.test.ts`, and not yet run here: the scratch-repository proofs below come first, and the hand steps above are how a release goes out until then. v0.2.0 went out by hand on 30 Oct, and 0.2.1 (9b4dbfd, merged 1 Nov) is waiting for the same.

**Who it's for and why.** Today a release owner has to run every step above, so a merged version waits for a person even when nothing a person must decide has changed. This workflow publishes a merged version by itself. A person is asked only for the two things that are theirs: a changed license, or a changed listing.

**Rules.**

- **PUB-1: A merge that bumps the version publishes it.** A push to `main` whose `package.json` version differs from its first parent's, with no `v<version>` tag yet, starts a publish of that commit. A push that doesn't change the version publishes nothing. A run that stopped can be started again by hand (`workflow_dispatch` with the version); it goes through the same rules and resumes by PUB-8.
- **PUB-2: One version, higher than the last.** These must all carry the same version: `package.json`, `package-lock.json`, `release.json`, and the generated `plugins/agent-cloud` manifests (`plugin.json`, `.claude-plugin/plugin.json`, `bundle.json`). It must also be greater, by semver, than every other `v*` tag. A `v<version>` tag already at this same commit is this version's own, left by a run that stopped before it finished, and the run resumes from it (PUB-8); one at another commit is a failure. Otherwise the run fails before anything is built or pushed, and names the file or the tag.
- **PUB-3: The same checks a release owner runs.** The run does `npm ci`, `npm test`, `npm run typecheck`, `npm run check:generated` and then `npm run build -- --release`. The `--release` build is the legal and listing gate: it fails on an unset license, a missing icon or any other release-readiness gap. Any failure stops the run with no tag, release or `stable` move.
- **PUB-4: A changed license or listing waits for the release owner; nothing else does.** The run compares what the release-ready build selects, by content, against the same read from the tree of the newest published release (a GitHub release that's published and not a pre-release, never a tag alone or a draft) with the same loader (`scripts/release-config.mjs`):
  - the license: its identifier, and the bytes of the license text `license.file` names, wherever it points;
  - the listing: `release.config.json`'s `marketplace`, `plugin` and `openai` values, and the bytes of the icon `plugin.icon` names, wherever it points.

  A file that moved, or a path that now names another file, counts as a change only when the selected bytes or values differ.

  If any of them changed, or there's no published release yet, the publish job waits for a release owner's approval on the repository's `release` environment, whose required reviewers are the release owners. The approval page shows the diff. Code, skills, pins, docs and every other change publish with no person.
- **PUB-5: Checksums before anything is pushed.** The run writes `SHA256SUMS` for both provider ZIPs in `dist/production/` and checks it with `sha256sum -c SHA256SUMS` before it tags.
- **PUB-6: Tag, then a GitHub release.** The run tags the merge commit `v<version>`, pushes the tag, and runs `gh release create v<version> --verify-tag --title "agent.cloud <version>"` with both ZIPs and `SHA256SUMS`. Its notes name the merged pull request. A version with a pre-release suffix (`-alpha.N`, `-rc.N`) becomes a GitHub pre-release and never moves `stable`.
- **PUB-7: `stable` moves only after the published assets verify.** The run downloads the release's assets from GitHub and checks them two ways: `sha256sum -c` against the published `SHA256SUMS`, and against the digests of the ZIPs it built. Only then, and only if the release is published and not quarantined (read again just before), does it push `v<version>^{commit}:refs/heads/stable`, as a fast-forward. It then reads `stable` back from GitHub and checks that it points at `v<version>^{commit}`, the same check as `check.yml`'s "Release channel points at the released tag" step. The run does this itself because a push made with `GITHUB_TOKEN` starts no other workflow, so `check.yml` won't run on it. If the assets don't verify, `stable` stays where it was, the release is marked a pre-release with a note saying why, and the run fails.
- **PUB-8: A re-run picks up where it stopped, and never moves a tag.**
  - A tag that already points at the same commit is kept, and the run goes on (PUB-2's resume).
  - A published release is kept and given only the assets it's missing, never a replacement, and the run goes on to PUB-7's checks.
  - A draft that a stopped run left gets every asset again and is published.
  - A release that's quarantined, marked a pre-release by a rollback or a failed verify while its version isn't one, is never resumed: the run fails, and the fix ships as a higher version.
  - A `stable` already at this tag's commit leaves nothing to do, and the run ends successfully.
  - A tag at another commit stops the run with a failure.
  - Publishes run one at a time, in one concurrency group that keeps every pending run in order (`queue: max`): a later push never replaces a version bump that's waiting.
- **PUB-9: A bad release rolls back by moving `stable` to the previous tag, then a fix goes forward.** A release owner runs the workflow's rollback (`workflow_dispatch` with `rollback_to: v<older>`, behind the `release` environment). It moves `stable` back to that tag's commit, and only to an older tag whose GitHub release is published, not a draft, a pre-release or quarantined. Before it moves `stable`, it marks the bad release a pre-release with a note naming the rollback, so a publish re-run refuses that version and a rollback retried after a move that failed computes the same target and finishes; one that finds `stable` already at the target only reads it back. It then reads `stable` back as PUB-7 does. The bad release and its tag stay: tags never move.
  - Installs read `stable`, so a new install gets the older version at once.
  - A client that already updated gets the older version back on its next update, even though the version went down. In Claude Code that's `claude plugin marketplace update` then `claude plugin update`; in Codex, `codex plugin marketplace upgrade` then re-adding the plugin. Both were proven on a scratch repository on 1 Nov 2026 (below).
  - Background auto-update isn't proven to follow a lower version. So a rollback is still followed by a fix-forward: a pull request that reverts the change and bumps the patch version, which publishes by PUB-1.
- **PUB-10: The least access that does the job.**
  - Only the publish and rollback jobs get `contents: write`, through `GITHUB_TOKEN`, for tags and releases. Every other job stays `contents: read`, as `check.yml` is now.
  - A ruleset on `stable` restricts updates, deletions and force pushes. Its bypass list holds exactly two entries: the repository's one deploy key, and the release owners' team.
  - `GITHUB_TOKEN` can't move `stable`. GitHub refuses GitHub Actions as a ruleset bypass actor, so the workflow pushes `stable` with that deploy key instead.
  - The deploy key's private half is the workflow's only other secret, `STABLE_DEPLOY_KEY`. It's a secret of a `stable-push` environment that only `main` may deploy to, so a branch or a fork can't read it. The move and the rollback's move are the only steps that use it.
  - `main`'s protection is unchanged.
- **PUB-11: Each run says what it did.** The job summary lists the version, the tag and commit, the release URL, each asset's SHA-256, whether a release owner was asked (and who approved), and `stable`'s move from one commit to the other. A rollback lists the same. What it says comes from each step's outcome: Published only when the tag, the release, its verification and (for a version that isn't a pre-release) `stable`'s move all succeeded; otherwise where it stopped (at the tag or before it, or at the release, nothing published) or what's partial (quarantined because its assets didn't verify, or released with `stable` not moved). It links the release only when the release step succeeded.

**Out of scope.** The provider submissions below (OpenAI's dashboard, Anthropic's directory) stay a person's. So does anything a reviewer must enter. This spec doesn't publish to npm or change how the source is built.

**The outside service, as proven on scratch repositories (1 Nov 2026).**
- **Clients follow `stable` down (PUB-9).**
  - Claude Code installed proof-plugin 1.0.1 from a marketplace at `stable`. Then `stable` moved back to 1.0.0, and `claude plugin marketplace update` plus `claude plugin update` answered "updated from 1.0.1 to 1.0.0".
  - Codex, after `codex plugin marketplace upgrade` and re-adding the plugin, had 1.0.0 installed in place of 1.0.1.
  - Background auto-update wasn't tested.
- **`GITHUB_TOKEN` can't move a protected `stable`; a deploy key can (PUB-10).**
  - Adding GitHub Actions (app 15368) as a ruleset bypass was refused, on a personal repository and on an organization's: "Actor GitHub Actions integration must be part of the ruleset source or owner organization".
  - A `GITHUB_TOKEN` push was refused with "GH013: Repository rule violations found for refs/heads/stable. Cannot update this protected ref", and so was a repository admin's own push.
  - With the ruleset's bypass set to the deploy key, a workflow pushing with that key, read from a `main`-only environment's secret, fast-forwarded `stable` and force-moved it back. GitHub answered "Bypassed rule violations".
- **A push made with `GITHUB_TOKEN` starts no workflow (PUB-7).** A workflow on `push: branches: [stable]` didn't run.
- **An environment approval holds the job (PUB-4).** A job on a `release` environment with a required reviewer sat in `waiting` until the reviewer approved it, then ran.

**How each rule is tested.** The workflow's decisions live in `scripts/release.mjs` as functions that take plain inputs, tested in `test/release-workflow.test.ts` by rule ID. The workflow file only calls them and the commands above.
- PUB-1: version changed or unchanged against the first parent; a tag that already exists; the manual re-run.
- PUB-2: each file out of step with the others; equal to another tag; lower than the newest; pre-release ordering; this version's own tag at this commit resumes, at another commit fails.
- PUB-3: each command's failure stops the run before the tag step. The workflow's step order is checked from the YAML.
- PUB-4: the baseline is the newest published release: an unpublished tag or a draft after it never counts, on a real repository. Each of these asks the release owner: a changed license identifier, changed license bytes, `license.file` pointing at a file with other bytes, the same three for the icon, and each changed listing value. A moved file with the same bytes doesn't ask, and neither does a change to code, skills, pins or docs. With no previous tag it asks. Each case runs on the real loader and build, not on path names.
- PUB-5 and PUB-7: a ZIP edited after `SHA256SUMS`, a downloaded asset that differs, and a missing asset each keep `stable` where it was. A `stable` read back at another commit fails the run, and a draft or quarantined release never moves it.
- PUB-6: a pre-release version never moves `stable`.
- PUB-8: each partial state resumes from where it stopped: a tag only; a draft with some or all assets; a published release missing assets; a tag, its release and `stable` moved (nothing left to do). A quarantined release is refused, a tag at another commit fails, and the concurrency group keeps every pending run.
- PUB-9: rollback only to an older tag with a published, non-pre-release release; a draft or quarantined one is refused.
- PUB-10: the workflow's `permissions` per job, the jobs on the `stable-push` environment, and `STABLE_DEPLOY_KEY` as the only secret and only in the channel-moving steps, all read from the YAML.
- PUB-11: the summary's fields.

The whole workflow is then rehearsed end to end on a scratch repository before it runs here: a publish, a run stopped after its tag and then resumed, and a rollback.

## Submit each provider artifact

**OpenAI:** upload `dist/production/submissions/agent-cloud-0.3.3-production-openai.zip`. Its root contains portable `plugin.json`, `mcp.json`, skills and every runtime resource. Use the verified publishing identity and [plugin submission dashboard](https://developers.openai.com/plugins/deploy/submission). Include the remote HTTPS MCP configuration in the initial ZIP, complete domain/authentication/tool scans, and supply review materials. Enter reviewer credentials only in the secure dashboard. Follow the applicable review route for desktop helper execution; remote-MCP review does not establish every local capability.

Both MCP servers have their own review cases: edit `openai.mcpServers.agent-cloud.test_cases` and `openai.mcpServers.canvas.test_cases` in `release.config.json`. The build places each set in that server's `extensions.com.openai.review.test_cases` in `mcp.json`; plugin-level `review.test_cases` is not used with multiple servers. Release-ready output requires five positive and three negative cases for each server, and reports the server by name when its cases are incomplete. Run all sixteen cases with the reviewer account before submission. The portable transport schema remains pinned; OpenAI server review extensions are validated separately. The current submission portal connects one server per plugin, even though the package declares both; confirm the intended directory connection in the portal.

Enter the reviewer-accessible demo recording URL directly in the OpenAI submission portal under **Metadata & Skills → Review information → Review details**. Keep it out of `release.config.json`, configuration overrides, the public repository and submission ZIPs; the build rejects `demo_recording_url` in release configuration and plugin review metadata. Omit that field entirely so a package upload preserves the URL saved in the portal; an empty string would clear the saved value. Reviewer credentials and sign-in instructions also belong only in the secure dashboard. The `--release` gate checks package requirements without requiring or verifying the portal-only recording. Supply and verify the recording in the portal before submitting for MCP review. See [OpenAI's submission guide](https://developers.openai.com/plugins/deploy/submission).

**Claude:** use `dist/production/submissions/agent-cloud-0.3.3-production-claude.zip`. Its root contains `.claude-plugin/plugin.json`, `.mcp.json`, skills and all runtime resources. Extract it and run `claude plugin validate <extracted-plugin> --strict`, plus directory-profile checks when preparing that submission. The repository's `.claude-plugin/marketplace.json` is the own-marketplace route; [Anthropic directory submission](https://claude.ai/directory/manage) and official-marketplace placement are separate. Follow [publishing guidance](https://code.claude.com/docs/en/plugins/publish) and current portal upload requirements.

`dist/production/release-report.json` distinguishes structural validation from unresolved metadata. Source publication, uploaded/submitted, approved/listed and published package states are recorded separately. Source repository availability alone is not provider approval or a successful connected Setup/publishing journey.
