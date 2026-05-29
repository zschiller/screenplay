# Design note — Canvas Operations module

Status: **proposed** (not yet implemented). Captured from an architecture
review + design grilling session. Pick up from here.

See `CONTEXT.md` for the domain terms used below (Canvas, Group, Member,
Iframe Layer, Markdown Layer, Chat Session, Canvas Operation).

---

## Problem

Committed canvas state lives in the room's Y.Doc, wrapped by the generic
`YjsCollection<T>` CRDT helper (`apps/web/lib/yjs/schema.ts:59`). That helper is
a thin, domain-agnostic adapter: `set` / `update` / `delete` over a
`Y.Map<Y.Map>`. It knows nothing about Groups, Members, or Chat Sessions.

So every piece of canvas *meaning* lives in `apps/web/components/canvas/canvas.tsx`
(~5,400 lines), spread across ~80 direct mutation sites that poke the
collections by hand. Consequences:

- **Copy-pasted invariants.** The "remove a Member, then delete the Group if it
  has no Members left, else write back the remaining Members" block is repeated
  ~6 times (e.g. `1080`, `1706`, `2199`, `2241`, and inside the move handlers
  `1910`/`1970`/`4020`). Nothing enforces it; a new delete path can forget it.
- **Dual-write with a hardcoded key.** A Markdown Layer's title is written to
  both the TipTap `Y.XmlFragment` heading and the layer record, using the
  `markdown-layer-${id}` key duplicated in `canvas.tsx` (`2112`, `2188`) and
  `apps/web/lib/yjs/context.tsx:54`.
- **No test surface.** canvas.tsx has zero tests. The mutation logic can only be
  exercised through React + a live Liveblocks-backed Y.Doc.
- **No single place** to add validation, logging, or undo.

Deletion test: delete the per-handler mutation code and the invariants reappear
in every caller. The complexity is real and currently has nowhere to live.

## The deepening

Introduce a deep **Canvas Operations** module — `createCanvasOps(collections)`
in `apps/web/lib/canvas/ops.ts` — that fronts the generic `YjsCollection`
wrapper with a small interface of meaning-bearing verbs. canvas.tsx calls verbs;
the orchestration, invariants, and transaction handling move behind the seam.

```
canvas.tsx (render + view state + intent)
        │  ops.removeAgent(id), ops.mergeGroups(a, b), ops.patch(...)
        ▼
createCanvasOps(collections)        ← deep module, React-free
        │  doc.transact(fn, CANVAS_OPS_ORIGIN)
        ▼
YjsCollection<T> (generic CRDT)     ← now an internal seam
        ▼
Y.Doc (Liveblocks in prod, bare Y.Doc in tests)
```

## Decisions settled in the grilling session

1. **React-free, Y.Doc-only.** The module operates on `collections` and nothing
   else — no React, no zustand, no DOM. View concerns (viewport, zoom, pointer,
   selection, refs) stay in canvas.tsx. Verbs take **canvas-space coordinates**
   as plain args; the caller does any screen→canvas conversion. This is the
   testability win: tests run against a bare `new Y.Doc()`.

2. **Group invariant, enforced.** No Group is ever *committed* to the Y.Doc with
   zero Members. A single internal `pruneIfEmpty(groupId)` backs all removal
   paths. Inside one verb's transaction a Group may pass through zero Members,
   but it is pruned before the transaction closes, so no observer (local or
   remote) ever sees it. Empty Groups exist only in uncommitted client-side drag
   state — aborting a drag commits nothing.

3. **Chat Session split.** The Y.Doc holds the Chat Session *identity* (id,
   label, target); the *conversation* (messages, streaming, draft) lives in the
   client `chat-store` (zustand) because messages are large + server-authoritative,
   not collaboratively edited. Verbs that delete Chat Sessions stay Y.Doc-pure
   and **return the deleted `chatIds`** so canvas.tsx clears the chat-store
   mirror. (The conversation lifecycle itself is candidate #5, separate from this.)

4. **Module form: factory.** `const ops = useMemo(() => createCanvasOps(collections), [collections])`.
   Mirrors how `collections` is already consumed.

5. **Mutation surface: ~12 deep verbs + one generic `patch`.** A site earns a
   named verb only if it touches ≥2 collections, enforces the Group invariant,
   or dual-writes a fragment. Single-collection single-field writes (scroll,
   knobs, iframeState, sharedState, route, label, group name/gap/sidebarOrder)
   go through a generic, per-collection-typed `patch(key, id, fields)` — one
   home, not ~60 named setters, and not left inline.

6. **The module owns the transaction entry point.** `ops.batch(fn)` is the only
   way to open a transaction; verbs self-wrap `doc.transact(fn, CANVAS_OPS_ORIGIN)`
   and nest under an outer `ops.batch`. The raw `collections.transact(` calls
   (~15 of them) are removed from canvas.tsx. This makes the `CANVAS_OPS_ORIGIN`
   stamp uniform, which lets a future `Y.UndoManager` scoped to that origin
   provide Undo essentially for free, and gives logging/validation a single hook.

7. **Deferred-seed flag owned by verbs.** Agent creation sets
   `pendingIframeLayerSeed: true` (`canvas.tsx:3223`); a frame is seeded later
   once `previewDomain` arrives, flipping the flag false (`3391`). The verbs own
   both transitions (`createAgent` sets it; `seedFrameForAgent` clears it
   *atomically* with the layer write, so flag and frame can't desync). Only the
   reactive trigger ("previewDomain arrived → seed now") stays in canvas.tsx.

8. **Scope = the whole room Y.Doc.** Because `removeAgent` (`2241`) atomically
   deletes the agent row + its iframe layers + its chat sessions + prunes groups,
   the module owns write-orchestration for *all* room collections (agents,
   workspaces, chat-session identity, iframe layers, groups, markdown layers,
   viewport). Sandbox/server concerns (the `fetch("/api/agent/create")`,
   `restartSandbox`, etc.) and React state (`setPendingAgentIds`, refs) stay in
   canvas.tsx.

9. **Fragment key has one owner.** `markdown-layer-${id}` moves into
   `apps/web/lib/yjs/fragment-text.ts` as `documentFragment(doc, id)`; both the
   module and `context.tsx` call it.

## Interface sketch

`createCanvasOps(collections)` returns:

```
// transactions
batch(fn): void                                   // only way to open a transaction

// creates (placement via existing pure fns, ids allocated internally)
createFrameForAgent(agentId, anchor, label?)      -> { layerId, groupId }
createBlankFrame(anchor, size)                    -> layerId
createFramesForRoutes(agentId, routes, anchor)    -> { groupId, firstLayerId }
createDocument(anchor, ...)                        -> { docId, groupId, chatId }
createAgent(spec)                                  -> { agentId, chatId }   // sets pendingIframeLayerSeed
seedFrameForAgent(agentId, anchor)                -> { layerId, groupId }   // clears the flag atomically

// dual-write
renameDocument(docId, title)                       // fragment heading + record

// deletes (cascade + prune; return freed chat ids for the chat-store mirror)
removeLayers(ids)                                  -> { removedChatIds }
removeDocuments(ids)                               -> { removedChatIds }
removeAgent(agentId)                               -> { removedChatIds }
removeWorkspace(workspaceId)                       -> { removedChatIds }

// membership reshuffle (+ prune)
moveLayerToGroup(layerId, targetGroupId): void
mergeGroups(sourceGroupId, targetGroupId): void
splitToNewGroup(memberIds, anchor)                -> groupId

// everything else: generic, typed per collection
patch<K extends keyof RoomCollections>(key: K, id, fields: Partial<Value<K>>): void
```

### Behind the seam (internal, not part of the interface)

- `pruneIfEmpty(groupId)` — the single home of the Group invariant.
- id allocation (`nanoid`).
- placement via the **unchanged** pure functions
  `placeNewIframeLayerGroup` / `computeIframeLayerLayouts`
  (`apps/web/lib/iframe-layer-layout.ts`), called *inside* the create verbs. The
  placement-race guard (`canvas.tsx:1135`) is preserved because verbs read the
  Group snapshot *inside* their own transaction.
- `CANVAS_OPS_ORIGIN` constant + the `documentFragment(doc, id)` key helper.

## Tests

- **Survive unchanged:** the `iframe-layer-*` pure-function unit tests
  (`iframe-layer-layout`, `-snap`, `-move-snap`, `-sizes`). They stay pure.
- **Born:** postcondition tests against a bare `new Y.Doc()` + `RoomCollections`
  + `createCanvasOps` — no React, no Liveblocks. Examples:
  - `removeAgent` leaves no orphan iframe layers, no empty Groups, returns the
    correct `removedChatIds`, and the agent's chat sessions are gone.
  - `moveLayerToGroup` / `mergeGroups` prune the source Group when it empties.
  - `createDocument` seeds the fragment at the correct key and creates the
    Group + Chat Session.
  - invariant sweep: after every verb, no committed Group has zero Members.

The interface is the test surface.

## Migration (incremental; each step independently reviewable)

1. Add `createCanvasOps` + `batch` + `pruneIfEmpty` + the **delete / move /
   merge** verbs and their bare-Y.Doc tests; migrate those ~6 call sites. Highest
   invariant payoff first.
2. Move the **create** verbs (frame / routes / document / agent / seed).
3. Replace all remaining inline writes and raw `collections.transact(` calls
   with `ops.patch` / `ops.batch`.
4. Relocate the fragment key to `fragment-text.ts`.

(A later, optional step: add a `Y.UndoManager` scoped to `CANVAS_OPS_ORIGIN`
for canvas Undo — unblocked by decision #6, not required by this refactor.)

## Out of scope

- The Chat Session *conversation* lifecycle (messages, streaming, the zustand
  mirror) — that's candidate #5 (agent run / chat lifecycle). This module only
  owns the Chat Session identity row and hands back freed `chatIds`.
- Sandbox/server orchestration — stays in canvas.tsx and the API routes.
