# Check the CLI before managed local work

Keep the selected app ID, organization ID/slug, environment, folder and accepted brief from MCP. A local command must operate on that same app. Use `app_instructions_get` for the current starter and CLI requirements; keep the returned revision.

## Find the executable for this environment

The environment installers name their launchers `agc-staging` and `agc-production`; an existing production installation may be named `agc` or `agentcloud`. Do not assume bare `agc` selects staging. Use the executable you actually find, with these commands in order:

```text
<cli> version
<cli> help reference
```

Require the version envelope to identify `product: agent.cloud` and the selected control origin/environment. Check its actual build and runtime against current platform guidance; the shared package version alone does not prove that a particular build supports strict app verification. Require `init --app-id` in help before using it. A missing command, foreign product, incompatible build or wrong environment stops this boundary. Do not recover by dropping the app ID or pointing another environment's launcher at this app.

When installation is needed, use the selected control's supported install/update flow within the person's and host's permissions. Node-based installation and the helper use Node 24.22.1 or later. Do not change system runtimes or shell profiles. A task-local process PATH, supported disposable install root, state home and writable npm cache can isolate a permitted test installation. Preserve existing installs and credentials. A denied installation is not permission to try another installation route. This package has no M4 uploader; preserve source and app references if the CLI cannot run.

## Enroll without creating another app

Plugin OAuth and CLI enrollment are separate. Preserve any independently enrolled CLI identities; do not mint an anonymous replacement, copy the plugin token or edit a credential file.

Prepare or preserve the selected app's `agentcloud.toml`, including `[app] name`, `org` and explicit `control`. For a new project, verify the package's published starter archive digest after matching its pin to current MCP guidance, then prepare its service configuration in a safe empty folder. Strict init does not download a starter or infer services. Keep an existing project's source, settings and instructions. Prepare this manifest before checking `whoami`: its organization selects the saved per-organization identity, while a folder without it may report an unrelated default agent.

Run these commands from the prepared folder, trying strict verification without a join code first:

```text
<cli> whoami
<cli> init --app-id <selected_app_id> --org <selected_org_slug>
```

Before managed publishing, require `whoami` to report a connected person-backed agent with Builder purpose in the selected organization. Compare its `data.owner` with MCP `account_get`'s `data.context.person_id`; the person must match even though the CLI and plugin agent IDs are separate. Another person's agent in the same organization, a deploy key/task token, an unclaimed identity or unverifiable owner stops before upload. Preserve both references and use supported identity selection/enrollment to reconcile; do not overwrite credentials to force a match.

If the selected organization has no usable CLI identity, retain the selected app even if `whoami` or another command offers ordinary `init` as its generic next step. If explicit fresh enrollment is required, obtain the console's normal person-backed enrollment for that organization and add its `--join` option privately to this same strict command. Keep the code out of conversation, logs and evidence. Require `verified_existing: true`, `created_app: false` and the exact selected app ID/org/control. If enrollment succeeds but verification fails, preserve the saved identity and retry strict verification without the consumed join code. Never prepare or recover this path with ordinary init/create-or-link. A missing app, wrong identity, organization or environment is a reconciliation failure, not a reason to create one.

## Develop and follow one release

Read builder state before local publishing. Honor the person's chosen local route through the platform's guarded builder transition. Do not bypass an in-flight refusal or restore hosted ownership after publishing.

Use native tools for edits, then the verified CLI for `doctor`, `up --detach`, `migrate` when needed and `check`. Ordinary project tests are useful but do not prove managed mirror checks passed.

Invoke `ship` once and retain its operation ID. Use `wait <op>` or actual discovered MCP observation of that same operation. After lost command output, reconcile status/releases and any known operation before retrying; never initiate an MCP release to replace an uncertain CLI ship. Fetch current decision details and obtain the person's actual answer under the existing approval rules. Only an actual `outcome: live` with its receipt justifies reporting a live release. Keep using MCP for the same app's status, logs and management afterwards.

When using an explicit release key, retain it before `ship`. If its output is lost, use the discovered `release_find` tool with that same app ID and key to recover the existing operation. To switch from `release_find` to `operation_get`, retain `operation.id` and make the first `operation_get` call without a cursor. Continue with cursors returned by `operation_get` for that same app and operation. Cursors belong to their tool, connection and query; do not carry them across those boundaries. On `plugin.cursor_invalid`, restart that read without its cursor, keeping the same operation. A cursor refusal is not a reason to ship again.
