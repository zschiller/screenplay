# 21. The Coordinator only delegates, acts without confirm gates, and wakes only for failures and delegated work

Date: 2026-10-06

Status: Accepted (backfilled 2026-10-07)

## Context

The Coordinator is the canvas's project chat, modelled on Claude Projects:
chats are its threads. Three questions kept coming back:

- **Does it make things?** An early cut of no-repo chats (PR #1409) let it
  write Mockups and Documents itself.
- **Does it ask first?** It shipped with plan review and confirm cards before
  creating chats, opening PRs and removing chats (#898, #899, #901), and
  desktop harnesses got the same cards (PR #1220).
- **When does it speak?** Every chat turn woke it, and its wake prompt invited
  it to restate results, so its chat got noisier than Claude Projects
  (exploration 2026-10-06).

## Decision

- **It only delegates** (#1316). It starts chats, messages them, arranges the
  canvas and moves the camera; it makes no code, Mockups or Documents itself.
  That holds on a canvas with no repo too: a drawn Mockup or a doc ask starts a
  no-repo chat (ADR 0023).
- **No confirm gates** (#1217, PR #1286). `create_workspaces`,
  `open_pull_request` and `remove_workspace` act at once, hosted and desktop;
  the plan and confirm gate code was removed. Undo is by asking it, since it
  keeps each turn's changes.
- **It wakes only for failures and delegated work** (PR #1797). A chat's turn
  wakes it only when the turn failed or the chat's current task came from the
  Coordinator (`wakesOnTurnEnd` in `lib/agent/coordinator-wake.ts`). PR-event
  turns are quiet. Follow-ups between it and a chat stop after two hops
  (`WAKE_FOLLOW_UP_LIMIT`). No "Catching up" cue.

## Consequences

- Chats never fight over layout or the camera: only the Coordinator moves them.
- A mistaken PR or removal isn't stopped before it happens; recovery is asking
  the Coordinator to undo, or reopening.
- A chat someone talks to directly finishes without the Coordinator hearing
  about it unless it failed.

Rejected: the Coordinator writing Mockups or Documents (reverted from PR
#1409); plan review and confirm cards (shipped, then removed in PR #1286);
waking on every turn, and no wakes at all (exploration options C).
