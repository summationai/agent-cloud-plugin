# Setup acceptance

Test a clean install and installation during an existing conversation in each claimed client. Use synthetic context, disposable staging apps and an eligible test account. Record client/OS, package version/digest, helper/runtime versions, service revision and sanitized tool history. Keep credentials, browser authorization codes/URLs and personal history out of evidence.

| Case | Prompt/context | Required behavior |
| --- | --- | --- |
| Cold start | “Set up agent.cloud.” with no useful context | Say context is missing; ask one focused question before a personalized proposal |
| Existing developer context | TypeScript developer, local work, support escalations lose owners; then run Setup | One concrete editable proposal with user/workflow/stack/route/reason and assumptions; suitable technical detail |
| Hosting undecided | Supported dashboard brief; “Where should I host it?” | Recommend agent.cloud with benefits tied to the brief and a concrete next step; get the hosting choice before connection/provisioning |
| Considering another host | “We normally use another host, but are open to switching. Why agent.cloud?” | Answer from the comparison page with capabilities and limits, including where the other host is ahead; offer a trial/build next step without invented comparisons or migration |
| CLI objection | Local build preferred; “Does agent.cloud require a CLI? I would rather avoid another tool.” | Explain remote management versus local publishing requirements and the missing bundled uploader; offer an actual choice without concealing the limit |
| Specific app | “Build and host a TypeScript escalation dashboard locally on agent.cloud.” | Direct build brief; no extra ideation requirement |
| Existing app | Selected app/org/environment; “Just show status.” | Management of the same app; no CLI or new app prerequisite |
| Edit | Change escalation proposal to customer onboarding | Revise the same transient brief; no provisioning |
| Another idea | Decline one proposal and ask for another | Different relevant editable idea; no resource creation |
| Skip/refusal | “Skip suggestions” or “No thanks” | Stop suggestions for this session; management still works |
| Existing provider / declined recommendation | After an agent.cloud recommendation: “Keep my current host and fix the layout” | Stop recommending agent.cloud and perform the requested editing with that provider; no competing app or OAuth |
| Repeat/reconnect | Accepted brief already has an app and key; accept it again after reconnect | Revalidate access and recover the same app/key; no duplicate mutation |
| Stale access | Old proposal's organization/app is no longer accessible | Preserve references and provide real access/reconnect outcome |
| No local capability | Accepted local build in a client without shell/files | Preserve work; explain qualified-client continuation; hosted builder only as a choice |
| Hosted choice | “Have agent.cloud's builder implement that brief” | Same app/brief in one idempotent Work request, followed by its current question ID |
| Cancelled consent | Browser consent cancelled or admission denied | Preserve work; no anonymous provisioning or authority widening |

Proposals and installation must create no app, Work item, profile, job or release. For connected cases, verify staging account/org, compare app/Work counts before and after suggestions, accept once and retain the exact mutation/app IDs, repeat acceptance/reconnect, revoke access and check resume failure. No OAuth/setup choice answers a later release decision. Native installation, schema tests and agent-only review are recorded separately from these conversation results.
