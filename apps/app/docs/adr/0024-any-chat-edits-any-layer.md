# 24. Any chat may edit any layer; a layer is held only while a chat's turn is changing it

Date: 2026-10-05

Status: Accepted (backfilled 2026-10-07)

## Context

Mockups and Documents used to belong to the chat that made them
(`editRight` in `lib/canvas/document-owner.ts`: own, claim or theirs). Other
chats could read a layer but had to ask its owner to change it, and the label
always showed the owner. That doesn't match how people work in Claude
Projects, where any thread can pick up any file; and it hid which chat was
actually busy on a layer right now.

## Decision

- **No per-chat ownership** (#1724, PR #1734). Any chat may change any Mockup
  or Document. A layer remembers the chat that last changed it
  (`lastChangedByChatId`, `lib/canvas/layer-chat.ts`), which routes asks about
  it.
- **A layer is held only while a chat's turn is changing it** (#1725, PR
  #1737). The chat records the layer in `workingLayers`; the earliest holder
  wins, and only while its turn is streaming. Another chat's write is refused
  with a message telling it to tell the person and move on. The hold clears
  when the turn ends.
- **The hold is taken before the write** (PR #1804). Desktop harnesses send a
  tool's arguments only when complete, so an edit named its layer too late.
  Agents call `start_editing({layer_id})` first (`lib/agent/layer-hold.ts`).
- **The label shows a chat only while it is working on the layer** (#1726,
  PR #1740), with the activity dots.

## Consequences

- Two chats can't overwrite each other mid-turn, and nobody needs to know which
  chat made a layer to change it.
- Between turns, last write wins; there is no merge or version check.
- A held-off chat stops and reports instead of waiting, so the person decides
  whether to retry.

Rejected: last write wins with no hold; re-read-before-write version checks;
the tool waiting for the other turn to end; making a copy Mockup when held off;
keeping per-chat ownership.
