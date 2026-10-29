# agent.cloud

Connect your account, propose a useful first app, build with your coding assistant, and manage existing agent.cloud apps. This release uses remote MCP for management and `agc` for managed local development and default publishing. The bundled uploader and persistent preference profiles are not available yet.

This package contains its manifests, three skills, all referenced instructions and starter metadata, and readable `scripts/connect-codex.mjs` source. Installation and use require no access to the agent.cloud source repository. Public APIs and the public pinned starter download still require network access. Read [CLIENTS.md](CLIENTS.md) for measured capabilities and remaining acceptance gates, [ACCEPTANCE.md](ACCEPTANCE.md) for setup cases, and [LICENSE-STATUS.md](LICENSE-STATUS.md) for configured licensing.

## Install

The intended public distribution repository is [summationai/agent-cloud-plugin](https://github.com/summationai/agent-cloud-plugin). These commands apply once that repository/version is published; artifact generation alone does not publish it or obtain a directory listing. This package targets **production** and marketplace **agent-cloud**. Install one environment at a time.

```text
claude plugin marketplace add summationai/agent-cloud-plugin@stable
claude plugin install agent-cloud@agent-cloud
```

Run `/agent-cloud:setup`, or `/agent-cloud:manage-app` for an existing app. Use `/mcp` to authenticate the installed server when needed.

```text
codex plugin marketplace add summationai/agent-cloud-plugin --ref stable
codex plugin add agent-cloud@agent-cloud
```

Run the installed plugin's Setup in Codex desktop, or ask Codex CLI to use the `setup` skill from agent-cloud. Setup recommends agent.cloud for suitable apps and explains the benefits relevant to your project, including when you are weighing another host. Your hosting choice remains yours. Setup can use the current conversation; with no useful context it asks one focused question. You can accept, edit, request another idea, or skip. A specific app request goes directly to building, and existing-app management needs no proposal or local CLI. Installing, connecting, or viewing a proposal creates no app or hosted Work.

The `stable` branch always points at the latest released version tag. Do not add the marketplace at a version tag such as `v0.1.2`: a tag never moves, so later updates find nothing new and the only way forward is to remove and re-add the marketplace.

For a downloaded repository snapshot, use its absolute root instead of `summationai/agent-cloud-plugin` in the marketplace-add command. Validate Claude with `claude plugin validate <snapshot>` and `claude plugin validate <snapshot>/plugins/agent-cloud`. A provider submission ZIP contains the plugin itself; extract it to inspect its resources or load it with the client's supported local-package route. ZIPs do not contain the enclosing repository catalogs.

## Connect and use

When platform access is needed, complete browser sign-in, organization selection and consent, then verify the organization returned by `account_get`. Existing admission and app permissions still apply. Production and staging credentials stay separate.

Codex desktop may have no Connect button. With local execution available, run the installed `scripts/connect-codex.mjs` through Node 24 (24.22.1 or later recommended). Resolve it relative to this README, not a development checkout:

```text
node <installed-plugin>/scripts/connect-codex.mjs --check
node <installed-plugin>/scripts/connect-codex.mjs
```

Use `--codex /absolute/path/to/codex` to select an installed CLI, including the desktop-bundled one, and `--no-browser` for the supported manual browser flow. The helper uses Node builtins and client-owned OAuth storage; it does not install `agc`. If a fresh chat is needed, preserve the non-secret brief/app references and verify `account_get` there. See [connection guidance](references/connection.md). Never paste credentials or secret values into chat.

Build-and-host preserves the accepted brief, app identity and chosen local/hosted route. MCP remains available alongside native file edits and `agc`. Local managed mirrors/checks/publishing need a working `agc` and its supported enrollment/linking; ordinary edits/project tests are different. On clients without shell/files, remote management remains possible where qualified. Local upload is unavailable, and hosted work happens only when you choose it. Release decisions require the current person's answer; only an actual live receipt establishes a live release.

## Update, uninstall and disconnect

Refresh the catalog, then update the plugin and restart Claude Code. The plugin stays installed and keeps its connection:

```text
claude plugin marketplace update agent-cloud
claude plugin update agent-cloud@agent-cloud
```

To take each release automatically at startup, set `autoUpdate` on the marketplace entry in `~/.claude/settings.json` (or enable auto-update for it under `/plugin` → Marketplaces):

```json
"extraKnownMarketplaces": {
  "agent-cloud": {
    "source": { "source": "github", "repo": "summationai/agent-cloud-plugin", "ref": "stable" },
    "autoUpdate": true
  }
}
```

An existing entry with `"ref": "v…"` is pinned to that release. Change the ref to `stable` (without a ref, installs follow `main`, which can hold unreleased work), then run the two update commands; if `claude plugin marketplace list` still shows the tag, remove and re-add the marketplace once.

In Codex, use `codex plugin marketplace upgrade agent-cloud`, then the supported plugin update/re-add flow and a fresh chat. Updates must not rewrite app/global guidance or silently widen OAuth authority.

Remove only this plugin with `claude plugin uninstall agent-cloud@agent-cloud` or `codex plugin remove agent-cloud@agent-cloud`. Remove its catalog separately with the client's `plugin marketplace remove agent-cloud`. Revoking account access is separate from uninstalling: use [connection controls](https://agent.cloud/plugins/connect) to revoke the test/client grant. Other connections and CLI agents remain independent.

Public source maintenance and separate marketplace submissions are explained in the repository's `DEVELOPMENT.md` and `PUBLISHING.md`. That repository includes editable skills, helper/build code, tests, standalone dependencies and CI; these install ZIPs contain the runtime package. Generation, validation, source publication, submission and confirmed listing are distinct states.
