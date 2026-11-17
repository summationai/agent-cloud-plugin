---
name: canvas
description: >-
  Build the cards waiting on the person's agent.cloud canvas, and make the card
  they picked a real agent.cloud app. Use when they ask to build their canvas or
  its cards, or to make their canvas pick real.
---

The canvas (its tools are waiting_cards, next_card, write_files, finish and picked_card) shows a few takes on one idea; the person picks one and makes it real. The cards are built by you, on the person's own plan; the canvas never calls a model for them.

## Build the canvas

1. **Sign in first.** If the canvas's tools aren't loaded, or a call says to sign in, start the canvas server's sign-in (in Claude Code, its authenticate tool), give the person the link, and ask them to press Allow and tell you when it's done. Never start builders before the tools are loaded: they can't do anything without them.
2. **Count the cards.** Call waiting_cards. It says how many cards are waiting, without taking any.
3. **One builder per card, all at once.** In Claude Code, start exactly that many `agent-cloud:canvas-builder` subagents in one message, each with the prompt "Build one card from my agent.cloud canvas." They work at low effort, so each card takes about a minute.
4. **Check again.** When they've all reported, call waiting_cards again: a change or another canvas may be waiting. Stop when it says nothing is waiting, and tell the person which cards went live and which, if any, still have failing checks.

Where subagents aren't available (Codex), take the cards yourself: next_card, then write_files until every check passes, then finish, and repeat until next_card says nothing is waiting. Keep each card quick: write the files straight away.

## Make the pick real

When the person asks to make their canvas pick real (they may paste the canvas's link):

1. Call picked_card, with the canvas link if they gave one. It returns the picked card's brief, files and the steps.
2. Follow those steps at your usual effort. This is the build-and-host skill's path: read it for connecting agent.cloud, the `agc` preflight and publishing. Name the app as picked_card suggests unless the person wants another name.
3. Give the person the live URL `agc ship` returns, and say the app is now theirs on agent.cloud, with its own repository and releases.

If picked_card says nothing is picked, ask the person to open the canvas and choose "Pick this one" on the take they want.
