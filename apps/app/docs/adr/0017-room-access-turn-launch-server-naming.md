# 17. Room writes go through Room Access, Turn Launch owns turn ordering and stop, the server applies auto-naming

Date: 2026-09-28

Status: Accepted

## Context

The 2026-09-28 architecture review found three places where the same rule was
re-derived at every call site, and where getting it wrong at one site was a
real bug rather than a style issue:

- **Room-doc access.** Server actions, routes and pages each checked
  membership (or didn't) before calling the raw `mutateRoomDoc`/`readRoomDoc`
  helpers. On the hosted build a non-member could write a Branch's PR and diff
  fields, because that path never checked.
- **Starting and stopping a turn.** The stream route and the plan route each
  carried their own copy of the start-up steps (resolve the Engine, prepare the
  target, resolve the plan, persist, start the run, broadcast), and the order
  matters: a client joining mid-stream replays back to the latest
  `chat-stream-start`, so anything broadcast before it is lost. Stopping lived
  in its own route, and a stopped run looked different live than after a
  reload.
- **Auto-naming.** A new chat's first turn names the chat and, while it is
  still auto-named, the Branch. Clients applied the names from a broadcast and
  one of them renamed the git branch, so whether (and how many times) a rename
  happened depended on which surfaces were mounted.

## Decision

- **Every room-scoped server read or write goes through Room Access**
  (`lib/room-access.ts`; #900, #904, #906). `openRoom(roomId)` resolves the
  session and requires membership before anything touches the Room, and hands
  back the only room-doc access the caller gets. Routes use
  `openRoomForRoute(roomId, chatId?)`, which maps failures to 401/403 and
  refuses a chat recorded under another Room. Code working on a member's
  behalf (an agent turn's tools and naming, comment doorbells, PR create,
  thumbnail capture, Room teardown) takes the opened `RoomDoc` or `RoomReader`,
  never a bare `roomId`. The only session-less opener, `readRoomForServer`, is
  read only and serves work no request started (the thumbnail layout rebuild).
  The raw helpers are private: `room-access-guard.test.ts` fails if anything
  else imports them.
- **Turn Launch owns turn ordering and the stop outcome**
  (`lib/agent/turn-launch.ts`; #907, #908, #909). `launchTurn` is the one place
  the start-up order lives, and the one way a plan is resolved (explicit
  accept or reject, and the implicit reject of a follow-up message). Each
  Chat Target kind supplies only its own setup; routes are auth, parsing and
  HTTP mapping. `stopTurn` records the run as `aborted`
  (`STOPPED_RUN_STATUS`), broadcasts a "Stopped" marker, and always ends the
  stream; the history route rebuilds the same marker from the run status, so
  a live stop reads exactly like a reload. A run superseded by a plan decision
  or a new message leaves nothing. Neither outcome is an error.
- **The server, not clients, applies auto-naming** (`lib/agent/auto-naming.ts`;
  #910). While preparing a sandbox turn, Turn Launch writes the chat label, the
  Workspace title (only when it has none) and the Branch's new ref and
  auto-named flag to the room doc in one transaction that checks the flag, so
  racing turns claim the rename at most once. After the response it renames
  the git branch; if git refuses, the Branch is put back unless someone renamed
  it again. Names are never broadcast; clients observe the doc.

## Consequences

- A new server entry point that touches a room doc starts with `openRoom` or
  `openRoomForRoute`; there is no other import that compiles past the guard
  test. Membership rules change in one place.
- Changing the start-up order, the plan-resolution rule or how a stopped run
  reads is a change to Turn Launch and its tests, not to a route.
- Auto-naming works the same with zero, one or many clients open, including
  when the only surface is a Terminal Tab or an API caller.
- Branch Intake still calls `/api/agent/generate-names` to pick names for
  prompt-seeded Branches before they exist. That is choosing a new Branch's
  name, not renaming one, and stays client-initiated.
- Future architecture reviews should treat these three seams as settled rather
  than re-suggesting them. See `CONTEXT.md` (**Room Access**, **Turn Launch**,
  **Chat Sync**).
