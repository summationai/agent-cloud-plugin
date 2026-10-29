# Maintain the plugin source

This is an independent source repository for agent.cloud. Clone it, install its pinned public npm dependencies and make changes here; no agent.cloud monorepo checkout, workspace link, private package or private build service is needed.

Use Node 24.22.1 or later:

```text
npm ci
npm test
npm run typecheck
npm run build
npm run check:generated
```

## Editable inputs and generated outputs

- `skills/`, `references/` and `scripts/connect-codex.mjs` are the maintained workflow/helper sources.
- `content/` contains the documentation templates shared by generated outputs.
- `release.config.json` controls the one public repository, marketplace/publisher metadata, listing resources and licensing. Configured source assets live under `release-assets/`.
- `pins.json` records the public starter archive/digest and supported management protocol version. Update these deliberately when compatibility is qualified; generated helpers do not import another repository.
- `scripts/build.mjs`, `release-config.mjs`, `validate.mjs` and `generated.mjs` are the complete readable build/config/validation tools. `schemas/` contains the pinned public portable schemas. `test/` includes package, helper, release and source/drift tests.
- `package.json` owns the shared version and toolchain. `package-lock.json` is standalone and pins public registry dependencies. After dependency/version changes, update and commit both files.
- `plugins/agent-cloud/`, both root marketplace catalogs and the root consumer/release documentation are generated installation files committed for Git-based client installation. Do not edit those copies by hand. `dist/` and `node_modules/` are ignored.

After editing source or configuration, run the tests and `npm run sync:generated`, review the changes, then `npm run check:generated`. Sync replaces only the declared generated files; it preserves `.git`, source inputs and other local files. The check fails if a source change has not been reflected in the installation tree. The public GitHub workflow runs install, tests, typecheck, build and this drift check. On the `stable` release branch it also checks that the commit is the `v<version>` tag for the package version.

## Reproduce submission artifacts

`npm run build` writes `dist/production/` containing a complete source repository export, both provider ZIPs, validation report and `SHA256SUMS`. `npm run build:staging` targets the separate staging service/catalog. To build one submission, use `npm run build -- --target openai` or `npm run build -- --target claude`. All target content and manifests are generated from the same source version.

```text
npm run validate -- openai dist/production/submissions/agent-cloud-0.1.1-production-openai.zip
npm run validate -- claude dist/production/submissions/agent-cloud-0.1.1-production-claude.zip
```

Provider ZIPs contain only the installable plugin, readable runtime helper and resources; build tools, development tests and dependency files belong in this source repository. Every ZIP is decompressed and validated during build. Add `--release` after configuring approved licensing/listing values and review materials to enforce the selected targets' metadata gate. These checks do not establish public URL reachability, client acceptance or provider approval.

Read [PUBLISHING.md](PUBLISHING.md) for tagging this source repository, publishing its release artifacts and making the separate provider submissions. Once published, maintain this public repository as the source of truth for future plugin versions.
