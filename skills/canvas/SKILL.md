---
name: canvas
description: >-
  Build an app with the person on their agent.cloud canvas: start one from their
  idea, try versions that differ on purpose, ask them at the forks that matter,
  and build the cards waiting on it; and make the card they picked a real
  agent.cloud app. Use when they bring an app idea or a change to one, say
  they'd like to make an app on their canvas, ask to build their canvas or its
  cards, or ask to make their canvas pick real.
---

The canvas (its tools are waiting_cards, next_card, write_files, finish and picked_card) shows a few takes on one idea; the person picks one and makes it real. The cards are built by you, on the person's own plan; the canvas never calls a model for them.

## Drive the canvas

The canvas is where you and the person build an app together. They see your cards and questions live at the canvas link; you see the canvas with read_canvas.

When they bring an app idea, or a change to one, you drive the canvas: you choose the path, and they decide at the forks that matter.

When they haven't said what to make yet (only that they'd like to make something), ask them in one short message what they'd like to make, offering three ideas that fit them, and start a canvas only once they answer.

The end state: a live app they chose at every fork that mattered, every critical decision theirs, every other decision recorded with its reason on its card, using as little of their time as possible.

Start with start_canvas (or read_canvas for a canvas they have) and give them the link. Then write your goal (write_note, kind goal: what you will end with, which forks you will ask them about, roughly how long) and ask them to agree it (ask, critical true).

Then choose the play that fits the problem. These are examples, not a menu:
- A landing page or a small app: three variations that differ in look; ask; they pick.
- A change to a card they have: one riff on that card.
- A big app: a plan note (its parts), then riff the first fork that matters, ask, build on their pick, then the next fork. When a fork is about one part of a page (the schedule, the check-in panel, the header), cut the picked card into parts first (parts), riff only that part (riff with part) so everything else holds still, and mix their favourite parts from different cards back into one (mix).
- An idea they are unsure about: three variations that differ in approach, then go on from their pick.

Riffs: name one axis (approach, look, voice or scope) and hold everything else the same, so they compare one thing; at most three takes, each with a one-line reason they read on its card. A first round from a blank brief may differ in both approach and look. When you build the cards yourself, build them all before you end your turn. If builders you start run in the background, keep checking read_canvas until every card has landed before you end your turn: ending it can stop them, and the person is waiting to compare.

Ask where taste decides and the options look different: the overall direction, the main screen's layout, tone and brand, the core flow. Decide yourself where it is invisible or conventional: the data model, routes, validation, empty and loading states; accessibility is never optional. One open question at a time, 2 or 3 options, always your recommendation and why.

Critical decisions wait for the person (ask with critical true): the goal; anything hard to undo (publishing, deleting, sending anything to people); money; people's data or sign-in; connecting a real data source or secret; importing data; a change of direction that throws away work they picked. For anything else, if they do not answer, your recommendation stands, marked as decided for them, and you keep going.

See your own work: render each card you build before you finish it, and fix what looks wrong; render a card before you ask the person about it. Read the canvas again before each decision: people comment, switch picks and move things.

Restraint: a canvas with 40 cards is noise. Make few, distinct cards, each answering a question.

When they have the version they want, they choose Pick this one on it, and you make it real when they ask (picked_card).

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
