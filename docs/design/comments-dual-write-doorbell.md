# Design note — Comments: concentrate the dual-write, split the doorbell

Status: **proposed** (not yet implemented). Captured from an architecture
review + design grilling session. Pick up from here.

See `CONTEXT.md` for domain terms. Relevant code: `lib/comments.ts` (the
server module), `lib/db/schema.ts` (`thread`, `comment`, `threadRead`),
`components/canvas/comments.tsx` + `components/play/player-comments.tsx`
(the clients that observe the doorbell).

---

## Problem

Comments use a **dual-write**: Postgres is the source of truth, and a
`commentsRevision` counter in the room's Y.Doc is a **doorbell** — connected
clients observe it and refetch the thread list when it changes
(`bumpCommentsRevision`, `comments.ts:96`).

Three issues:

1. **The doorbell + roomId plumbing is copy-pasted ~8×.** Most mutations work
   from a `threadId` / `commentId`, so each separately re-derives the `roomId`
   (via `.returning({ roomId })` or an extra `select`) just to call
   `bumpCommentsRevision`: `createThreadWithFirstComment` (266), `appendComment`
   (294–299), `editComment` (322–327), `deleteComment` (351–363, twice),
   `setThreadResolved` (379), `deleteThread` (387), `markThreadUnread`
   (421–426). A new mutation that forgets the bump leaves clients silently stale.

2. **Write and doorbell aren't one unit.** They're two sequential awaits to two
   different stores, gated by `if (threadRow)`. If the bump throws or the guard
   misses, Postgres has the change but no client is told.

3. **Read fanout is inconsistent.** `markThreadUnread` rings the doorbell "so
   other tabs refresh" (419); `markThreadRead` (390) rings **nothing**. Root
   cause: the doorbell is **room-global**, but `unread` is **per-user** (computed
   from `threadRead`, `comments.ts:176`). Ringing the room doorbell on every read
   would make *every* client in the room refetch — and reads happen constantly
   (opening a thread marks it read). So `markThreadRead` skips it to avoid the
   storm, while `markThreadUnread` rings it anyway. The signal is too coarse to
   target one user's own tabs.

## Decisions settled in the grilling session

1. **Two named doorbells, not one overloaded counter.**
   - `commentsRevision` (room-global, as today) — rung on **content** changes
     (thread/comment create, edit, delete, resolve). Every client in the room
     refetches.
   - **per-user doorbell** — a per-user revision in the Y.Doc, e.g.
     `doc.getMap("commentsRead").set(userId, n + 1)`. Rung on **read-state**
     changes (`markThreadRead` / `markThreadUnread`) so only *that user's* tabs
     refresh their unread flags. No room-wide storm.

   This makes read fanout **consistent**: both `markThreadRead` and
   `markThreadUnread` ring the per-user doorbell, neither rings the room one.
   `markThreadUnread` stops over-broadcasting to the whole room.

2. **One seam, so the doorbell is unforgettable.** A tiny internal pair —

   ```ts
   signalContentChange(roomId): Promise<void>          // bumps commentsRevision
   signalReadChange(roomId, userId): Promise<void>      // bumps commentsRead[userId]
   ```

   — and the mutations are restructured so each captures the `roomId` (and
   `userId` for reads) from its write's `.returning()` and ends with exactly one
   signal call. The repeated "extra select + `if (row) bump`" dance collapses.
   A test asserts every content mutation rings the content doorbell and every
   read mutation rings the per-user one (catches a future forgotten signal).

3. **Not a transaction — unforgettable + eventually consistent.** Postgres and
   the Y.Doc are different stores; the two writes can't share a transaction. The
   realistic bar is: the signal always fires after a successful Postgres write,
   and clients self-heal on their next natural load if a doorbell is ever missed.

4. **Keep the coarse room counter for content changes.** Per-thread granularity
   (telling clients *which* thread changed so they patch one entry instead of
   refetching the list) is a separate performance pass — noted, not done here.

## Client side

The clients already observe `commentsRevision` to trigger a refetch. They gain a
sibling observer on `commentsRead[currentUserId]` that refetches (or just
recomputes unread) for the acting user's own tabs. Two small observers, same
pattern.

## Tests

- every content mutation (`create`, `append`, `edit`, `delete*`, `resolve`)
  increments `commentsRevision` exactly once;
- `markThreadRead` / `markThreadUnread` increment `commentsRead[userId]` and do
  **not** touch `commentsRevision`;
- a forgotten signal fails the per-mutation coverage test.

## Migration (incremental)

1. Introduce `signalContentChange` / `signalReadChange`; replace the 8
   `bumpCommentsRevision` sites with the appropriate one (reads → per-user).
2. Add the per-user `commentsRead` observer in `comments.tsx` /
   `player-comments.tsx`.
3. Delete the now-unused inline roomId-lookup-then-bump boilerplate.

## Notes

- No new DB columns — both doorbells live in the Y.Doc `meta` / a `commentsRead`
  map; `threadRead` already stores the per-user read source of truth.
