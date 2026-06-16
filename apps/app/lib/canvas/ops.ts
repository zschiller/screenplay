import { nanoid } from "nanoid"
import {
  IFRAME_LAYER_GROUP_GAP,
  MIN_IFRAME_LAYER_HEIGHT,
  MIN_IFRAME_LAYER_WIDTH,
} from "@/lib/constants"
import {
  getGroupMembers,
  nextGroupNumber,
  placeNewIframeLayerGroup,
} from "@/lib/canvas/layout"
import { getIframeLayerSizePreset } from "@/lib/iframe-layer-sizes"
import { routeToLabel } from "@/lib/route-utils"
import {
  documentFragment,
  seedDocumentFragment,
  setFragmentTitle,
} from "@/lib/yjs/fragment-text"
import type {
  BranchData,
  ChatSessionData,
  GroupMember,
  IframeLayerData,
  IframeLayerGroupData,
  MarkdownLayerData,
  PlanData,
  ViewportData,
  RepoData,
} from "@/lib/types"
import type {
  CommentPosition,
  RoomCollections,
  YjsCollection,
} from "@/lib/yjs/schema"

/**
 * Canvas Operations — the deep write-seam fronting the generic `YjsCollection`
 * CRDT wrapper for the room Y.Doc (see `apps/app/CONTEXT.md`, "Canvas
 * Operation"). `canvas.tsx` calls verbs here; orchestration, the Group
 * invariant, and transaction scoping live behind the seam, React-free.
 *
 * This module is the scaffold (slice 2, #157): `batch`, the generic `patch`,
 * the uniform {@link CANVAS_OPS_ORIGIN}, and the internal `pruneIfEmpty`
 * chokepoint that the meaning-bearing removal/restructure verbs (slice 3,
 * #158) will route every Member-removing write through. Tests construct it
 * against a bare `Y.Doc` with no React or Liveblocks.
 */

/**
 * The Yjs transaction origin stamped on every mutation committed through this
 * module. A single uniform origin is what lets a future `Y.UndoManager` track
 * exactly the canvas's own edits (and nothing from sync) for Undo/Redo.
 */
export const CANVAS_OPS_ORIGIN = Symbol("canvas-ops")

/** The keyed collections `patch` can write, mapped to their record type. */
type RecordByKey = {
  repos: RepoData
  branches: BranchData
  iframeLayers: IframeLayerData
  iframeLayerGroups: IframeLayerGroupData
  markdownLayers: MarkdownLayerData
  chatSessions: ChatSessionData
  plans: PlanData
  commentPositions: CommentPosition
}
type CollectionKey = keyof RecordByKey

/**
 * Input to {@link CanvasOps.createBranch}. The verb allocates the Branch id and
 * owns the `pendingIframeLayerSeed` flag, so the caller supplies neither. A
 * `chat` sub-spec is optional: when present the verb pre-creates a Chat Session
 * targeting the new Branch (the parallel-spawn flow uses this); when absent the
 * server's chat-ensure path creates the chat lazily, as before.
 */
export type CreateBranchSpec = {
  branch: Omit<BranchData, "id" | "pendingIframeLayerSeed">
  chat?: { label: string; model?: string }
}

export type CanvasOps = {
  /** The sole way to open a transaction; wraps the body in the canvas-ops origin. */
  batch(fn: () => void): void
  /**
   * Trivial single-field write: merge `fields` onto an existing record in
   * `key`'s collection, within the canvas-ops origin. No-op when the record is
   * missing (mirrors `YjsCollection.update`). Sites that touch ≥2 collections,
   * enforce the Group invariant, or dual-write a fragment earn a named verb
   * instead.
   */
  patch<K extends CollectionKey>(
    key: K,
    id: string,
    fields: Partial<RecordByKey[K]>
  ): void
  /**
   * Persist the saved viewport (the singleton restored on room load). A thin
   * verb — the viewport is its own Y.Doc singleton, not a keyed collection
   * `patch` can address — but routing it through the seam keeps every committed
   * canvas mutation under the uniform origin.
   */
  saveViewport(viewport: ViewportData): void
  /**
   * Create a Repo record. Composes under one {@link batch} with
   * {@link createBranch} so a repo and its first Branch land as a single
   * undo step; a thin verb because `patch` only updates existing records.
   */
  createRepo(id: string, data: RepoData): void
  /**
   * Create a Chat Session identity record (the standalone chat-tab lifecycle:
   * new tab, reopen-as-new, plan submit). The conversation itself lives in the
   * client chat-store; this writes only the Y.Doc identity. A thin verb
   * because `patch` only updates existing records.
   */
  addChatSession(id: string, data: ChatSessionData): void
  /**
   * Delete a single Chat Session identity record (closing a chat tab for good).
   * Chat Sessions are leaf entities with no Group-invariant cascade, so unlike
   * the removal verbs this is a bare delete behind the seam. The caller clears
   * the client chat-store mirror.
   */
  removeChatSession(id: string): void
  /**
   * Create a blank Iframe Layer (bound to no agent) in a fresh single-member
   * Group anchored at `anchor` (canvas-space top-left). `size` is clamped up to
   * the minimum frame dimensions. Returns the new layer's id.
   */
  createBlankFrame(
    anchor: { x: number; y: number },
    size: { width: number; height: number }
  ): string
  /**
   * Create an Iframe Layer bound to `agentId` in a fresh single-member Group,
   * sized from the agent's repo preset. `anchor` is the viewport center
   * (canvas-space); the verb reads the live Group snapshot inside its
   * transaction and places the Group beside the existing ones (the
   * placement-race guard). Returns the new layer and Group ids.
   */
  createFrameForAgent(
    agentId: string,
    anchor: { x: number; y: number },
    label?: string
  ): { layerId: string; groupId: string }
  /**
   * Create one agent-bound Iframe Layer per discovered route, gathered into a
   * single fresh "Routes" Group placed beside the existing ones (same
   * placement-race guard as {@link createFrameForAgent}). Each frame carries
   * its route and a label (the route's own, falling back to one derived from
   * the path). Returns the new Group id and its first layer's id, or
   * `undefined` for an empty route list.
   */
  createFramesForRoutes(
    agentId: string,
    routes: { route: string; label: string }[],
    anchor: { x: number; y: number }
  ): { groupId: string; firstLayerId: string } | undefined
  /**
   * Create one agent-bound Iframe Layer per Branch, all gathered into a single
   * fresh Group placed beside the existing ones (same placement-race guard as
   * {@link createFrameForAgent}). This is the eager frame-seed for the
   * prompt-first New-Workspace create: one Branch yields a single-member Group,
   * a bulk create yields one Group holding every Branch's frame. Each frame is
   * sized from its own Branch's Repo preset and labelled (falling back to
   * "Frame 1"), and every Branch's `pendingIframeLayerSeed` is cleared in the
   * same transaction so the deferred reactive seeder never adds a duplicate.
   * Returns the new Group id and its layer ids, or `undefined` for an empty
   * list.
   */
  createFramesForAgents(
    frames: { agentId: string; label?: string }[],
    anchor: { x: number; y: number }
  ): { groupId: string; layerIds: string[] } | undefined
  /**
   * Create a Document (Markdown Layer) in a fresh single-member Group anchored
   * at `anchor` (canvas-space top-left), `size` clamped to the document floor.
   * Seeds the body fragment's title heading via `documentFragment` (the single
   * fragment-key owner) and pre-creates a Chat Session targeting the Document.
   * Returns the new document, Group, and chat ids.
   */
  createDocument(
    anchor: { x: number; y: number },
    size: { width: number; height: number }
  ): { docId: string; groupId: string; chatId: string }
  /**
   * Create a Branch record from `spec`, allocating its id and setting the
   * deferred-seed flag `pendingIframeLayerSeed`. When `spec.chat` is given,
   * also pre-creates a Chat Session targeting the Branch and returns its
   * `chatId`; otherwise `chatId` is `undefined`. The caller owns all
   * surrounding orchestration (branch-name generation, the provisioning fetch,
   * pending-Branch bookkeeping).
   */
  createBranch(spec: CreateBranchSpec): { branchId: string; chatId?: string }
  /**
   * Seed the deferred frame for `agentId` once its sandbox is provisioned:
   * create the agent-bound frame (like {@link createFrameForAgent}) and clear
   * `pendingIframeLayerSeed` in the same transaction, so the seed can never
   * race a later frame delete into re-seeding. `anchor` is the viewport center.
   */
  seedFrameForAgent(
    agentId: string,
    anchor: { x: number; y: number },
    label?: string
  ): { layerId: string; groupId: string }
  /**
   * Navigate the Iframe Layer with `layerId` to `route`: write its new route
   * and, when the route changed, register it on the bound agent's
   * `discoveredRoutes` (deduped). When `cloneTrail` is set (the canvas's Create
   * Flow mode), first drop a clone of the frame — carrying its *previous* route
   * — into the same Group immediately to the frame's left, so the navigated
   * frame stays put while a trail grows leftward. Returns `{ viewportShift }`:
   * the pixels the caller should pan the viewport right to keep the navigated
   * frame visually anchored (0 when no clone was made). All Y.Doc writes — the
   * clone create, the member splice, the route update, the discoveredRoutes
   * merge — commit atomically behind the seam; the viewport pan stays in the
   * caller.
   */
  navigateRoute(
    layerId: string,
    route: string,
    options: { cloneTrail: boolean }
  ): { viewportShift: number }
  /**
   * Append a new Iframe Layer to an existing Group, created from the resolved
   * `frame` spec (the caller mirrors size/agent/route off the group's last
   * sibling) and spliced onto the end of the Group's current member row. The
   * layer write plus the member-list update commit atomically — the two-
   * collection write is why this earns a verb over `patch`. Returns the new
   * layer's id, or `undefined` when the Group is missing.
   */
  addFrameToGroup(
    groupId: string,
    frame: {
      width: number
      height: number
      label: string
      branchId?: string
      route?: string
    }
  ): string | undefined
  /**
   * Append a new Document (Markdown Layer) to an existing Group — the Document
   * sibling of {@link addFrameToGroup}, sized from the resolved `size` (the
   * caller mirrors the Group's last sibling) and spliced onto the end of the
   * member row. Like {@link createDocument} it seeds the body fragment's title
   * heading and pre-creates a Chat Session targeting the Document; the
   * multi-collection write is why this earns a verb. Returns the new document
   * and chat ids, or `undefined` when the Group is missing.
   */
  addDocumentToGroup(
    groupId: string,
    size: { width: number; height: number }
  ): { docId: string; chatId: string } | undefined
  /**
   * Rename a Document (Markdown Layer) from outside the editor (sidebar, agent
   * tool): write `title` into the body fragment's first heading — the source
   * of truth every peer's editor renders — and mirror it onto the record's
   * cached `title`, atomically. No-op when the Document is missing (never
   * seeds a heading for a Document that was never created). The fragment-key
   * dual-write is why this earns a verb over `patch`.
   */
  renameDocument(docId: string, title: string): void
  /**
   * Remove the given Iframe Layers and drop them from any Group that held
   * them, pruning a Group emptied by the removal. Iframe Layers own no Chat
   * Sessions, so `removedChatIds` is always empty — the field is present so
   * every delete verb shares one shape.
   */
  removeLayers(ids: string[]): { removedChatIds: string[] }
  /**
   * Remove the given Markdown Layers (Documents): drop them from any Group
   * (pruning a Group emptied by the removal) and delete the Chat Sessions
   * targeting them, returning those `removedChatIds` so the caller can clear
   * the client chat-store mirror.
   */
  removeDocuments(ids: string[]): { removedChatIds: string[] }
  /**
   * Remove a Branch and everything keyed to it — its Iframe Layers, its Chat
   * Sessions, and its Members in any Group (pruning Groups emptied by the
   * cascade) — atomically. Returns the `removedChatIds` for the client mirror.
   */
  removeBranch(branchId: string): { removedChatIds: string[] }
  /**
   * Remove a repo and cascade across every Branch it owns — their Iframe
   * Layers, Chat Sessions, and Members (pruning Groups emptied by the cascade)
   * — atomically. Returns the `removedChatIds` for the client mirror.
   */
  removeRepo(id: string): { removedChatIds: string[] }
  /**
   * Reorder the in-room sidebar's repo list: renumber each Repo's
   * `sidebarOrder` to its index in `orderedIds`, in one batch under the
   * canvas-ops origin. Makes the manual order the shared source of truth from
   * the first drag on. Mirrors {@link reorderBranches} and the Canvas section's
   * group reorder.
   */
  reorderRepos(orderedIds: string[]): void
  /**
   * Reorder the Branch list within a single Repo: renumber the
   * `sidebarOrder` of each Branch in `orderedIds` to its index, in one batch
   * under the canvas-ops origin. Ids not belonging to `repoId` are
   * ignored, so reordering one Repo's Branches never touches another's —
   * the within-repo constraint lives here, not just in the UI.
   */
  reorderBranches(repoId: string, orderedIds: string[]): void
  /**
   * Move the Member with `layerId` out of whatever Group holds it and into
   * `targetGroupId` at `index` (appended when `index` is omitted), pruning the
   * source Group if the move empties it. When source and target are the same
   * Group this reorders the Member to `index`. No-op if the layer or target is
   * missing.
   */
  moveLayerToGroup(layerId: string, targetGroupId: string, index?: number): void
  /**
   * Merge the source Group into the target: append every source Member onto
   * the target's row and prune the emptied source. The target keeps its
   * world-space origin. No-op if either Group is missing, they are the same,
   * or the source is empty.
   */
  mergeGroups(sourceGroupId: string, targetGroupId: string): void
  /**
   * Detach `memberIds` from whatever Group(s) hold them and gather them — in
   * the given order — into a fresh Group anchored at `anchor` (canvas-space),
   * pruning any source Group the split empties. Returns the new Group's id.
   * The caller owns screen→canvas conversion and placement of `anchor`.
   */
  splitToNewGroup(memberIds: string[], anchor: { x: number; y: number }): string
  /**
   * @internal Not a public verb — the single Group-invariant chokepoint the
   * removal/restructure verbs (#158) route Member removal through. Exposed
   * here (behind `internal`) so those verbs and the invariant tests reach the
   * one implementation rather than re-deriving "delete the Group when its last
   * Member leaves".
   */
  internal: {
    pruneIfEmpty(groupId: string): void
  }
}

export function createCanvasOps(collections: RoomCollections): CanvasOps {
  const { doc } = collections

  function batch(fn: () => void): void {
    doc.transact(fn, CANVAS_OPS_ORIGIN)
  }

  function patch<K extends CollectionKey>(
    key: K,
    id: string,
    fields: Partial<RecordByKey[K]>
  ): void {
    batch(() => {
      ;(collections[key] as YjsCollection<RecordByKey[K]>).update(id, fields)
    })
  }

  // The Group invariant (CONTEXT.md): no Group is ever *committed* with zero
  // Members. A Group may pass through zero Members inside a transaction, but is
  // pruned before it closes. Self-wraps in `batch` so it is safe to call
  // standalone and composes cleanly when a verb calls it inside its own batch
  // (nested Yjs transactions reuse the outer one, keeping the canvas-ops origin).
  function pruneIfEmpty(groupId: string): void {
    batch(() => {
      const group = collections.iframeLayerGroups.get(groupId)
      if (group && (group.members?.length ?? 0) === 0) {
        collections.iframeLayerGroups.delete(groupId)
      }
    })
  }

  // The one Member-removal path every removal verb routes through: drop every
  // Member matching `match` from each Group, then prune the Groups the removal
  // emptied. Caller must already be inside a `batch`. `toArray()` is a
  // transaction-stable snapshot, so a single pass over the Groups is correct
  // even as members are rewritten underneath.
  function removeMembersMatching(
    match: (member: GroupMember) => boolean
  ): void {
    for (const group of collections.iframeLayerGroups.toArray()) {
      const before = getGroupMembers(group)
      const remaining = before.filter((m) => !match(m))
      if (remaining.length === before.length) continue
      collections.iframeLayerGroups.update(group.id, { members: remaining })
      pruneIfEmpty(group.id)
    }
  }

  function saveViewport(viewport: ViewportData): void {
    batch(() => {
      collections.savedViewport.set(viewport)
    })
  }

  function createRepo(id: string, data: RepoData): void {
    batch(() => {
      collections.repos.set(id, data)
    })
  }

  function addChatSession(id: string, data: ChatSessionData): void {
    batch(() => {
      collections.chatSessions.set(id, data)
    })
  }

  function removeChatSession(id: string): void {
    batch(() => {
      collections.chatSessions.delete(id)
    })
  }

  // --- Create verbs ---

  // Default frame size for a new Iframe Layer bound to `agentId`: the size
  // preset configured on the agent's repo, falling back to the default
  // preset. React-free and Y.Doc-only, so it lives behind the seam.
  function defaultSizeForAgent(agentId: string): {
    width: number
    height: number
  } {
    const agent = collections.branches.get(agentId)
    const repo = agent ? collections.repos.get(agent.repoId) : undefined
    const preset = getIframeLayerSizePreset(repo?.defaultIframeLayerSizeId)
    return { width: preset.width, height: preset.height }
  }

  function createBlankFrame(
    anchor: { x: number; y: number },
    size: { width: number; height: number }
  ): string {
    const layerId = nanoid()
    const groupId = nanoid()
    batch(() => {
      collections.iframeLayers.set(layerId, {
        id: layerId,
        width: Math.max(MIN_IFRAME_LAYER_WIDTH, size.width),
        height: Math.max(MIN_IFRAME_LAYER_HEIGHT, size.height),
        label: "Frame",
        iframeState: {},
      })
      collections.iframeLayerGroups.set(groupId, {
        id: groupId,
        name: `Group ${nextGroupNumber(collections.iframeLayerGroups.toArray())}`,
        x: anchor.x,
        y: anchor.y,
        members: [{ kind: "iframe-layer", id: layerId }],
      })
    })
    return layerId
  }

  function createFrameForAgent(
    agentId: string,
    anchor: { x: number; y: number },
    label = "Frame 1"
  ): { layerId: string; groupId: string } {
    const layerId = nanoid()
    const groupId = nanoid()
    batch(() => {
      const { width, height } = defaultSizeForAgent(agentId)
      // Read the Group snapshot inside the transaction so concurrently-created
      // frames don't race on a stale doc and overlap (the placement-race guard).
      const { x, y } = placeNewIframeLayerGroup(
        collections.iframeLayerGroups.toArray(),
        collections.iframeLayers.toArray(),
        anchor,
        width,
        height
      )
      collections.iframeLayers.set(layerId, {
        id: layerId,
        branchId: agentId,
        width,
        height,
        label,
        iframeState: {},
      })
      collections.iframeLayerGroups.set(groupId, {
        id: groupId,
        name: `Group ${nextGroupNumber(collections.iframeLayerGroups.toArray())}`,
        x,
        y,
        members: [{ kind: "iframe-layer", id: layerId }],
      })
    })
    return { layerId, groupId }
  }

  function createFramesForRoutes(
    agentId: string,
    routes: { route: string; label: string }[],
    anchor: { x: number; y: number }
  ): { groupId: string; firstLayerId: string } | undefined {
    if (routes.length === 0) return undefined
    const layerIds = routes.map(() => nanoid())
    const groupId = nanoid()
    batch(() => {
      const { width, height } = defaultSizeForAgent(agentId)
      // Placement-race guard: read the live Group snapshot inside the transaction.
      const { x, y } = placeNewIframeLayerGroup(
        collections.iframeLayerGroups.toArray(),
        collections.iframeLayers.toArray(),
        anchor,
        width,
        height
      )
      routes.forEach((r, i) => {
        collections.iframeLayers.set(layerIds[i]!, {
          id: layerIds[i]!,
          branchId: agentId,
          width,
          height,
          label: r.label || routeToLabel(r.route),
          iframeState: {},
          route: r.route,
        })
      })
      collections.iframeLayerGroups.set(groupId, {
        id: groupId,
        name: `Routes ${nextGroupNumber(collections.iframeLayerGroups.toArray())}`,
        x,
        y,
        members: layerIds.map((id) => ({ kind: "iframe-layer", id })),
      })
    })
    return { groupId, firstLayerId: layerIds[0]! }
  }

  function createFramesForAgents(
    frames: { agentId: string; label?: string }[],
    anchor: { x: number; y: number }
  ): { groupId: string; layerIds: string[] } | undefined {
    if (frames.length === 0) return undefined
    const layerIds = frames.map(() => nanoid())
    const groupId = nanoid()
    batch(() => {
      // Placement reads the first frame's preset; every Branch in one bulk
      // create shares a Repo, so a single size drives the Group's anchor — the
      // same shape `createFramesForRoutes` uses for its multi-frame Group.
      const { width, height } = defaultSizeForAgent(frames[0]!.agentId)
      // Placement-race guard: read the live Group snapshot inside the transaction.
      const { x, y } = placeNewIframeLayerGroup(
        collections.iframeLayerGroups.toArray(),
        collections.iframeLayers.toArray(),
        anchor,
        width,
        height
      )
      frames.forEach((frame, i) => {
        const size = defaultSizeForAgent(frame.agentId)
        collections.iframeLayers.set(layerIds[i]!, {
          id: layerIds[i]!,
          branchId: frame.agentId,
          width: size.width,
          height: size.height,
          label: frame.label || "Frame 1",
          iframeState: {},
        })
        // Seeding the frame eagerly fulfils the deferred-seed contract, so clear
        // the flag in the same transaction — the reactive seeder must never add
        // a second frame for these Branches (mirrors `seedFrameForAgent`).
        collections.branches.update(frame.agentId, {
          pendingIframeLayerSeed: false,
        })
      })
      collections.iframeLayerGroups.set(groupId, {
        id: groupId,
        name: `Group ${nextGroupNumber(collections.iframeLayerGroups.toArray())}`,
        x,
        y,
        members: layerIds.map((id) => ({ kind: "iframe-layer", id })),
      })
    })
    return { groupId, layerIds }
  }

  function createDocument(
    anchor: { x: number; y: number },
    size: { width: number; height: number }
  ): { docId: string; groupId: string; chatId: string } {
    const docId = nanoid()
    const groupId = nanoid()
    const chatId = nanoid()
    batch(() => {
      collections.markdownLayers.set(docId, {
        id: docId,
        // Documents have their own minimum dimensions, distinct from frames.
        width: Math.max(200, size.width),
        height: Math.max(120, size.height),
        title: "",
      })
      collections.iframeLayerGroups.set(groupId, {
        id: groupId,
        name: `Group ${nextGroupNumber(collections.iframeLayerGroups.toArray())}`,
        x: anchor.x,
        y: anchor.y,
        members: [{ kind: "markdown-layer", id: docId }],
      })
      // Seed the body fragment with the schema-required title heading so every
      // peer sees the same shape from creation (rather than the first client to
      // mount the editor filling an empty fragment locally). The fragment key
      // has one owner — `documentFragment` (slice 1).
      seedDocumentFragment(documentFragment(doc, docId))
      // Pre-create an empty Chat Session targeting the Document so its chat tab
      // is ready the first time the panel opens.
      collections.chatSessions.set(chatId, {
        id: chatId,
        markdownLayerId: docId,
        label: "Untitled",
        createdAt: Date.now(),
      })
    })
    return { docId, groupId, chatId }
  }

  function createBranch(spec: CreateBranchSpec): {
    branchId: string
    chatId?: string
  } {
    const branchId = nanoid()
    let chatId: string | undefined
    batch(() => {
      // The verb owns the deferred-seed flag: the reactive "previewDomain
      // arrived → seed" trigger in canvas.tsx clears it via `seedFrameForAgent`
      // once and never re-seeds (parent decision 7).
      collections.branches.set(branchId, {
        ...spec.branch,
        id: branchId,
        pendingIframeLayerSeed: true,
      })
      if (spec.chat) {
        chatId = nanoid()
        collections.chatSessions.set(chatId, {
          id: chatId,
          branchId,
          label: spec.chat.label,
          createdAt: Date.now(),
          ...(spec.chat.model ? { model: spec.chat.model } : {}),
        })
      }
    })
    return { branchId, chatId }
  }

  function seedFrameForAgent(
    agentId: string,
    anchor: { x: number; y: number },
    label = "Frame 1"
  ): { layerId: string; groupId: string } {
    let result: { layerId: string; groupId: string }
    batch(() => {
      // Nested `createFrameForAgent` reuses this transaction (Yjs nests
      // transactions), so the frame write and the flag clear commit as one
      // atomic step — deleting the frame later can never re-trigger the seed.
      result = createFrameForAgent(agentId, anchor, label)
      collections.branches.update(agentId, { pendingIframeLayerSeed: false })
    })
    return result!
  }

  function navigateRoute(
    layerId: string,
    route: string,
    options: { cloneTrail: boolean }
  ): { viewportShift: number } {
    let viewportShift = 0
    batch(() => {
      const layer = collections.iframeLayers.get(layerId)
      const previousRoute = layer?.route

      // Create Flow: every meaningful navigation leaves a clone of the frame's
      // previous route in the same Group, just to the left of the navigated
      // frame. The Group origin stays put; the caller pans the viewport right
      // by the clone's width so the trail appears to grow leftward.
      if (
        options.cloneTrail &&
        layer &&
        previousRoute !== undefined &&
        previousRoute !== route
      ) {
        const group = collections.iframeLayerGroups
          .toArray()
          .find((g) => getGroupMembers(g).some((m) => m.id === layerId))
        if (group) {
          const cloneId = nanoid()
          collections.iframeLayers.set(cloneId, {
            id: cloneId,
            ...(layer.branchId ? { branchId: layer.branchId } : {}),
            width: layer.width,
            height: layer.height,
            label: layer.label,
            iframeState: {},
            route: previousRoute,
            ...(layer.knobs ? { knobs: layer.knobs } : {}),
            ...(layer.knobValues ? { knobValues: layer.knobValues } : {}),
          })
          const members = getGroupMembers(group)
          const idx = members.findIndex((m) => m.id === layerId)
          const nextMembers: GroupMember[] = [
            ...members.slice(0, idx),
            { kind: "iframe-layer", id: cloneId },
            ...members.slice(idx),
          ]
          collections.iframeLayerGroups.update(group.id, {
            members: nextMembers,
          })
          viewportShift = layer.width + (group.gap ?? IFRAME_LAYER_GROUP_GAP)
        }
      }

      collections.iframeLayers.update(layerId, { route })

      const branchId = layer?.branchId
      if (!branchId) return
      const agent = collections.branches.get(branchId)
      if (!agent) return
      const existing = agent.discoveredRoutes ?? []
      if (existing.some((r) => r.route === route)) return
      collections.branches.update(branchId, {
        discoveredRoutes: [...existing, { route, label: routeToLabel(route) }],
      })
    })
    return { viewportShift }
  }

  function addFrameToGroup(
    groupId: string,
    frame: {
      width: number
      height: number
      label: string
      branchId?: string
      route?: string
    }
  ): string | undefined {
    const layerId = nanoid()
    let created = false
    batch(() => {
      const group = collections.iframeLayerGroups.get(groupId)
      if (!group) return
      collections.iframeLayers.set(layerId, {
        id: layerId,
        ...(frame.branchId ? { branchId: frame.branchId } : {}),
        width: frame.width,
        height: frame.height,
        label: frame.label,
        iframeState: {},
        ...(frame.route ? { route: frame.route } : {}),
      })
      collections.iframeLayerGroups.update(groupId, {
        members: [
          ...getGroupMembers(group),
          { kind: "iframe-layer", id: layerId },
        ],
      })
      created = true
    })
    return created ? layerId : undefined
  }

  function addDocumentToGroup(
    groupId: string,
    size: { width: number; height: number }
  ): { docId: string; chatId: string } | undefined {
    const docId = nanoid()
    const chatId = nanoid()
    let created = false
    batch(() => {
      const group = collections.iframeLayerGroups.get(groupId)
      if (!group) return
      collections.markdownLayers.set(docId, {
        id: docId,
        // Documents have their own minimum dimensions, distinct from frames.
        width: Math.max(200, size.width),
        height: Math.max(120, size.height),
        title: "",
      })
      collections.iframeLayerGroups.update(groupId, {
        members: [
          ...getGroupMembers(group),
          { kind: "markdown-layer", id: docId },
        ],
      })
      // Seed the title heading + pre-create the chat exactly as createDocument
      // does, so a Group-appended Document is indistinguishable from a freshly
      // created one (same fragment shape, same ready chat tab).
      seedDocumentFragment(documentFragment(doc, docId))
      collections.chatSessions.set(chatId, {
        id: chatId,
        markdownLayerId: docId,
        label: "Untitled",
        createdAt: Date.now(),
      })
      created = true
    })
    return created ? { docId, chatId } : undefined
  }

  function renameDocument(docId: string, title: string): void {
    batch(() => {
      if (!collections.markdownLayers.has(docId)) return
      // The fragment heading is what every peer's editor renders; the record
      // `title` is the cache the sidebar/agent tools read. Both move together
      // so a rename can never leave the two views disagreeing.
      setFragmentTitle(documentFragment(doc, docId), title)
      collections.markdownLayers.update(docId, { title })
    })
  }

  function removeLayers(ids: string[]): { removedChatIds: string[] } {
    if (ids.length === 0) return { removedChatIds: [] }
    const idSet = new Set(ids)
    batch(() => {
      for (const id of ids) collections.iframeLayers.delete(id)
      removeMembersMatching((m) => m.kind === "iframe-layer" && idSet.has(m.id))
    })
    return { removedChatIds: [] }
  }

  function removeDocuments(ids: string[]): { removedChatIds: string[] } {
    if (ids.length === 0) return { removedChatIds: [] }
    const idSet = new Set(ids)
    const removedChatIds: string[] = []
    batch(() => {
      for (const id of ids) collections.markdownLayers.delete(id)
      for (const chat of collections.chatSessions.toArray()) {
        if (chat.markdownLayerId && idSet.has(chat.markdownLayerId)) {
          collections.chatSessions.delete(chat.id)
          removedChatIds.push(chat.id)
        }
      }
      removeMembersMatching(
        (m) => m.kind === "markdown-layer" && idSet.has(m.id)
      )
    })
    return { removedChatIds }
  }

  function removeBranch(branchId: string): { removedChatIds: string[] } {
    const removedChatIds: string[] = []
    batch(() => {
      collections.branches.delete(branchId)
      const removedLayerIds = new Set<string>()
      for (const layer of collections.iframeLayers.toArray()) {
        if (layer.branchId === branchId) {
          collections.iframeLayers.delete(layer.id)
          removedLayerIds.add(layer.id)
        }
      }
      for (const chat of collections.chatSessions.toArray()) {
        if (chat.branchId === branchId) {
          collections.chatSessions.delete(chat.id)
          removedChatIds.push(chat.id)
        }
      }
      removeMembersMatching(
        (m) => m.kind === "iframe-layer" && removedLayerIds.has(m.id)
      )
    })
    return { removedChatIds }
  }

  function removeRepo(id: string): { removedChatIds: string[] } {
    const removedChatIds: string[] = []
    batch(() => {
      collections.repos.delete(id)
      const branchIds = new Set<string>()
      for (const branch of collections.branches.toArray()) {
        if (branch.repoId === id) {
          collections.branches.delete(branch.id)
          branchIds.add(branch.id)
        }
      }
      const removedLayerIds = new Set<string>()
      for (const layer of collections.iframeLayers.toArray()) {
        if (layer.branchId && branchIds.has(layer.branchId)) {
          collections.iframeLayers.delete(layer.id)
          removedLayerIds.add(layer.id)
        }
      }
      for (const chat of collections.chatSessions.toArray()) {
        if (chat.branchId && branchIds.has(chat.branchId)) {
          collections.chatSessions.delete(chat.id)
          removedChatIds.push(chat.id)
        }
      }
      removeMembersMatching(
        (m) => m.kind === "iframe-layer" && removedLayerIds.has(m.id)
      )
    })
    return { removedChatIds }
  }

  function reorderRepos(orderedIds: string[]): void {
    batch(() => {
      orderedIds.forEach((id, index) => {
        collections.repos.update(id, { sidebarOrder: index })
      })
    })
  }

  function reorderBranches(repoId: string, orderedIds: string[]): void {
    batch(() => {
      orderedIds.forEach((id, index) => {
        // Confine the renumber to this Repo's own Branches: an id that
        // isn't one of its Branches is skipped, so a stray cross-repo id can
        // never reorder a sibling Repo's Branches.
        const branch = collections.branches.get(id)
        if (!branch || branch.repoId !== repoId) return
        collections.branches.update(id, { sidebarOrder: index })
      })
    })
  }

  function moveLayerToGroup(
    layerId: string,
    targetGroupId: string,
    index?: number
  ): void {
    batch(() => {
      const target = collections.iframeLayerGroups.get(targetGroupId)
      if (!target) return
      const source = collections.iframeLayerGroups
        .toArray()
        .find((g) => getGroupMembers(g).some((m) => m.id === layerId))
      if (!source) return
      const member = getGroupMembers(source).find((m) => m.id === layerId)
      if (!member) return

      const sourceRemaining = getGroupMembers(source).filter(
        (m) => m.id !== layerId
      )
      // Drop any existing copy from the target's own list so a same-Group
      // reorder (source === target) splices the Member back in at `index`
      // rather than duplicating it.
      const targetMembers = getGroupMembers(target).filter(
        (m) => m.id !== layerId
      )
      const at =
        index == null
          ? targetMembers.length
          : Math.max(0, Math.min(index, targetMembers.length))
      const nextTarget: GroupMember[] = [
        ...targetMembers.slice(0, at),
        member,
        ...targetMembers.slice(at),
      ]

      collections.iframeLayerGroups.update(source.id, {
        members: sourceRemaining,
      })
      collections.iframeLayerGroups.update(target.id, { members: nextTarget })
      pruneIfEmpty(source.id)
    })
  }

  function mergeGroups(sourceGroupId: string, targetGroupId: string): void {
    if (sourceGroupId === targetGroupId) return
    batch(() => {
      const source = collections.iframeLayerGroups.get(sourceGroupId)
      const target = collections.iframeLayerGroups.get(targetGroupId)
      if (!source || !target) return
      const sourceMembers = getGroupMembers(source)
      if (sourceMembers.length === 0) return
      collections.iframeLayerGroups.update(target.id, {
        members: [...getGroupMembers(target), ...sourceMembers],
      })
      collections.iframeLayerGroups.update(source.id, { members: [] })
      pruneIfEmpty(source.id)
    })
  }

  function splitToNewGroup(
    memberIds: string[],
    anchor: { x: number; y: number }
  ): string {
    const newGroupId = nanoid()
    batch(() => {
      const idSet = new Set(memberIds)
      const memberById = new Map<string, GroupMember>()
      const touchedSources = new Set<string>()
      for (const group of collections.iframeLayerGroups.toArray()) {
        const members = getGroupMembers(group)
        let touched = false
        for (const m of members) {
          if (idSet.has(m.id)) {
            memberById.set(m.id, m)
            touched = true
          }
        }
        if (!touched) continue
        touchedSources.add(group.id)
        collections.iframeLayerGroups.update(group.id, {
          members: members.filter((m) => !idSet.has(m.id)),
        })
      }
      // Preserve caller-requested order; drop ids that matched no Member.
      const newMembers = memberIds
        .map((id) => memberById.get(id))
        .filter((m): m is GroupMember => m !== undefined)
      if (newMembers.length === 0) return
      collections.iframeLayerGroups.set(newGroupId, {
        id: newGroupId,
        name: `Group ${nextGroupNumber(collections.iframeLayerGroups.toArray())}`,
        x: anchor.x,
        y: anchor.y,
        members: newMembers,
      })
      for (const sourceId of touchedSources) pruneIfEmpty(sourceId)
    })
    return newGroupId
  }

  return {
    batch,
    patch,
    saveViewport,
    createRepo,
    addChatSession,
    removeChatSession,
    createBlankFrame,
    createFrameForAgent,
    createFramesForRoutes,
    createFramesForAgents,
    createDocument,
    createBranch,
    seedFrameForAgent,
    navigateRoute,
    addFrameToGroup,
    addDocumentToGroup,
    renameDocument,
    removeLayers,
    removeDocuments,
    removeBranch,
    removeRepo,
    reorderRepos,
    reorderBranches,
    moveLayerToGroup,
    mergeGroups,
    splitToNewGroup,
    internal: { pruneIfEmpty },
  }
}
