# Client capabilities and acceptance

Launch targets are Claude Code and Codex desktop/CLI. The plugin connects to production agent.cloud and installs from this repository's `stable` branch. A listing in the Claude or OpenAI directory is separate from that route.

| Surface | Measured package capability | Remaining gate |
| --- | --- | --- |
| Claude Code 2.1.310, macOS 26.5.2 arm64 | Local-path marketplace install/uninstall and native manifest validation. On 2.1.318: strict validation with the directory checks of the 0.3.9 archive, and a production OAuth connection for a builder in one organization where `account_get` names that organization | Connected setup conversations and publishing journeys |
| Codex CLI 0.165.0-alpha.1.2, macOS 26.5.2 arm64 | Local-path install/uninstall; installed bundle matches its digest; bundled Node helper loads | Connected setup conversations and publishing journeys |
| Codex desktop | Earlier integration probe loaded Setup and authenticated tools after explicit login | Actual packaged fresh/existing-chat Setup and person/org connection |
| Other or shell-less surfaces | Only capabilities separately qualified | Local filesystem, shell, runtime, upload and publishing are not assumed |

Shared package tests validate portable schemas, skill metadata, complete relative resources, deterministic output, source exclusions and helper behavior. Independent agent-only forward review covered cold setup, developer context, existing-app management, repeated acceptance and a shell-less local request. These checks do not establish real-client conversational acceptance. Use the bundled [acceptance cases](ACCEPTANCE.md) to record the exact client/version/environment, package digest, observed responses and tool calls for each release.

Setup uses relevant current-conversation context and creates no durable profile. CLI-managed mirrors/checks/default publishing need `agc`; ordinary edits/project tests do not replace those checks. This release has no bundled uploader. M1 person/org OAuth is measured for Claude Code only. M1 for Codex, M2 conversations/desktop, M3 publishing and M4 fallback remain separate gates. The public repository is the install route. A directory listing is advertised only after that directory approves it.
