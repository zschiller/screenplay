# 28. ⌘Z undoes only your own changes

Date: 2026-09-30

Status: Accepted (backfilled 2026-10-07)

## Context

A canvas is edited at once by several people and by the Coordinator, whose
arrange operations arrive through sync like a teammate's. A shared undo stack
would let one person's ⌘Z revert someone else's work, or the Coordinator's.

## Decision

- **⌘Z tracks only this member's own transactions** (`lib/canvas/undo.ts`,
  PR #1213). Changes from teammates and the Coordinator arrive via sync and are
  never undone by your ⌘Z.
- **The Coordinator's changes are undone by asking it** (#864); it keeps each
  turn's changes for that.
- **Some writes are outside undo**: live frame fields (route, scroll, iframe
  state, Knobs, shared state, the live flag), chat and plan writes, and
  anything touching branches or repos. Pages are in scope.
- **Deletes of frames, Documents, Groups and memory happen at once**, undone
  with ⌘Z rather than a confirm.

## Consequences

- ⌘Z is predictable in a shared room: it only ever reverts what you did.
- Undoing an agent's or teammate's change is a conversation or a manual edit,
  not a keystroke.
- Removing a chat or a repo keeps a confirm, since undo can't bring back a
  sandbox.

Rejected: one shared undo stack; ⌘Z reverting the Coordinator's last action.
