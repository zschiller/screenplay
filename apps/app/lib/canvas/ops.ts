import { nanoid } from "nanoid"
import {
  FIT_CONTENT_MAX_HEIGHT,
  IFRAME_LAYER_GROUP_GAP,
  MIN_IFRAME_LAYER_HEIGHT,
  MIN_IFRAME_LAYER_WIDTH,
  MOCKUP_MIN_HEIGHT,
  MOCKUP_MIN_WIDTH,
} from "@/lib/constants"
import {
  getGroupMembers,
  groupContentHeight,
  groupContentWidth,
  nextGroupNumber,
  placeNewIframeLayerGroup,
} from "@/lib/canvas/layout"
import {
  hiddenDoneFrames,
  keepHiddenMembers,
  shownIndexToMemberIndex,
} from "@/lib/canvas/done-workspaces"
import { sizedLayersOf } from "@/lib/canvas/sized-layers"
import {
  FIRST_PAGE,
  groupPageId,
  groupsOnPage,
  nextPageName,
  orderedPages,
  resolvePageId,
} from "@/lib/canvas/pages"
import { pageViewKey } from "@/lib/canvas/page-views"
import { lastChangedBy } from "@/lib/canvas/layer-chat"
import { getIframeLayerSizePreset } from "@/lib/iframe-layer-sizes"
import { routeToLabel } from "@/lib/route-utils"
import { mockupHtml, writeMockupHtml } from "@/lib/yjs/mockup-html"
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
  MockupLayerData,
  PageData,
  PageViewData,
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

/**
 * The origin of a height Fit to content follows from the page. Not
 * {@link CANVAS_OPS_ORIGIN}, so Undo never steps through it: the page made
 * the change, nobody edited anything.
 */
export const CONTENT_HEIGHT_ORIGIN = Symbol("content-height")

/** The keyed collections `patch` can write, mapped to their record type. */
type RecordByKey = {
  repos: RepoData
  branches: BranchData
  iframeLayers: IframeLayerData
  iframeLayerGroups: IframeLayerGroupData
  markdownLayers: MarkdownLayerData
  mockupLayers: MockupLayerData
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
  /**
   * The Branch's chat. `id` is for a caller that already points at the chat
   * (a drawn Mockup's owner, #1359); a fresh one is minted otherwise.
   */
  chat?: { id?: string; label: string; model?: string }
  /**
   * A frame already on the canvas to show the new Branch in (a drawn frame
   * answered by New chat, #1356). It is assigned in the same transaction and
   * the Branch skips its own frame seed; a frame that's gone by then is
   * ignored and the deferred seed runs as usual.
   */
  frameId?: string
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
   * Record `userId`'s view of `pageId` (#1838) and that they're on it now:
   * where their camera goes when they come back, and where the canvas opens
   * for them next time. Never a ⌘Z step.
   */
  savePageView(userId: string, pageId: string, viewport: ViewportData): void
  /**
   * Drop every member's view of `pageId`, for deleting the page: call it in
   * the delete's transaction so ⌘Z brings the views back with the page.
   */
  removePageViews(pageId: string): void
  /** Drop every view `userId` has, when they leave or are removed. */
  removeMemberViews(userId: string): void
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
   * fragment-key owner). `lastChangedByChatId` records the chat that made it
   * (#1724); a Document made by hand has none. Returns the new document and Group ids.
   */
  createDocument(
    anchor: { x: number; y: number },
    size: { width: number; height: number },
    opts?: { lastChangedByChatId?: string }
  ): { docId: string; groupId: string }
  /**
   * Create a Branch record from `spec`, allocating its id and setting the
   * deferred-seed flag `pendingIframeLayerSeed` (unless `spec.frameId` hands
   * it a frame to show it in). When `spec.chat` is given,
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
   * Show the Workspace `branchId` in the Iframe Layer with `layerId`, keeping
   * its route and state, or moving it to `options.route` in the same write.
   * The Group's own Workspace moves with it only when the frame is the Group's
   * one frame, or the Group has none yet. Whether the Group's label names a
   * Workspace comes from its frames (`groupWorkspace`).
   */
  assignBranch(
    layerId: string,
    branchId: string,
    options?: { route?: string }
  ): void
  /**
   * Show the Workspace `branchId` in the whole Group `groupId` (#869): the
   * Group takes it, and so does every frame in it, each keeping its route,
   * state and size. Documents, and frames a Done Workspace hides, are
   * untouched. One transaction, so one undo
   * step.
   */
  assignGroupBranch(groupId: string, branchId: string): void
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
   * heading and records `lastChangedByChatId`; the multi-collection write is why this
   * earns a verb. Returns the new document id, or `undefined` when the Group
   * is missing.
   */
  addDocumentToGroup(
    groupId: string,
    size: { width: number; height: number },
    opts?: { lastChangedByChatId?: string }
  ): { docId: string } | undefined
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
   * (pruning a Group emptied by the removal). Documents own no Chat Sessions
   * since #1314 (the chat that made one outlives it), so `removedChatIds` is
   * always empty, as for {@link removeLayers}.
   */
  removeDocuments(ids: string[]): { removedChatIds: string[] }
  /**
   * Create a Mockup Layer (#1309) showing `spec.html`. With `groupId` it joins
   * the end of that Group's row, beside the layers it sits with; otherwise it
   * starts a fresh Group at `anchor` (canvas-space top-left), or beside the
   * existing Groups when no anchor is given. `lastChangedByChatId` names the chat
   * that made it. The record and its HTML text commit together. `id` lets a caller that
   * names the Mockup before it exists (a drawn box's ask, #1359) pick it.
   * Returns `undefined` when `groupId` names a missing Group.
   */
  createMockup(spec: {
    id?: string
    html: string
    title: string
    width: number
    height: number
    lastChangedByChatId?: string
    groupId?: string
    anchor?: { x: number; y: number }
  }): { mockupId: string; groupId: string } | undefined
  /**
   * Replace a Mockup Layer's page and/or title. The record and
   * its HTML text commit together. Returns false when the mockup is gone.
   */
  updateMockup(id: string, patch: { html?: string; title?: string }): boolean
  /**
   * Copy a Mockup Layer (page, size, knobs and last chat) to the end of its
   * Group's row, named "<title> copy" — the mockup bar's
   * Duplicate. Returns the copy's id, or `undefined` when the mockup is gone.
   */
  duplicateMockup(id: string): string | undefined
  /**
   * Set a frame's or Mockup's height to its page's content height, while its
   * Fit to content is on. Committed under {@link CONTENT_HEIGHT_ORIGIN}.
   * Returns whether the height changed.
   */
  followContentHeight(id: string, height: number): boolean
  /**
   * Copy an Iframe Layer (size, label, Workspace and route) to the end of its
   * Group's row, named "<label> copy" — the frame menu's Duplicate. Returns
   * the copy's id, or `undefined` when the frame or its Group is gone.
   */
  duplicateIframeLayer(id: string): string | undefined
  /**
   * Remove the given Mockup Layers, dropping them from any Group (pruning a
   * Group emptied by the removal). Their HTML texts stay in the doc, like a
   * document's body, so Undo brings a mockup back whole.
   */
  removeMockups(ids: string[]): { removedChatIds: string[] }
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
   *
   * `index` counts the target's shown Members, the Canvas's view: a Done
   * Workspace's hidden frames (#976) are skipped and keep their places. It
   * counts them with the moving Member lifted out, unless `gapIncludesMover`
   * says it is a gap among them as the caller sees them, the Member still in
   * place (a sidebar drop).
   */
  moveLayerToGroup(
    layerId: string,
    targetGroupId: string,
    index?: number,
    options?: { gapIncludesMover?: boolean }
  ): void
  /**
   * Write a Group's Members in the order the Canvas's view shows them. A Done
   * Workspace's hidden frames (#976), which the view leaves out, keep their
   * places.
   */
  reorderGroupMembers(groupId: string, members: GroupMember[]): void
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
  /** The canvas's Pages in list order (#1835); never empty, since a canvas
   *  with none recorded reads as one "Page 1". */
  listPages(): PageData[]
  /**
   * The Groups on page `pageId` (a page that's gone reads as the first); with
   * no id, on the page new Groups land on (see {@link CanvasOpsOptions}).
   */
  groupsOnPage(pageId?: string): IframeLayerGroupData[]
  /**
   * Add a Page at the end of the list, named `name` or the next "Page N".
   * The first write to a canvas's pages also records the "Page 1" it has
   * shown so far, in the same transaction. Returns the new page's id.
   */
  createPage(options?: { name?: string }): string
  /**
   * Rename a Page; a blank name is ignored. A canvas whose pages aren't
   * recorded yet records its "Page 1" to rename it.
   */
  renamePage(pageId: string, name: string): void
  /**
   * Move a Group to page `pageId` (#1837), placed right of what's already
   * there, top-aligned with it, so it overlaps nothing; on an empty page it
   * keeps its spot. No-op if the Group or page is missing, or it's there.
   */
  moveGroupToPage(groupId: string, pageId: string): void
  /**
   * Move Layers to page `pageId` (#1837) in a new Group placed as
   * {@link moveGroupToPage} places one; the Groups they leave keep the Group
   * invariant. Layers that are all of one Group move that Group instead.
   * Returns the id of the Group they're in on that page, if any moved.
   */
  moveLayersToPage(layerIds: string[], pageId: string): string | undefined
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

/** A new Document's record: its size above the document floor, no title yet,
 *  and the chat that made it, if any, as its last changer. */
function newDocument(
  id: string,
  size: { width: number; height: number },
  { lastChangedByChatId }: { lastChangedByChatId?: string }
): MarkdownLayerData {
  return {
    id,
    // Documents have their own minimum dimensions, distinct from frames.
    width: Math.max(200, size.width),
    height: Math.max(120, size.height),
    title: "",
    ...(lastChangedByChatId ? { lastChangedByChatId } : {}),
  }
}

/** How a {@link CanvasOps} places what it creates. */
export type CanvasOpsOptions = {
  /**
   * The Page new Groups land on: the one the person is looking at, for the
   * canvas's own ops. Placement beside existing Groups then counts only that
   * page's. Without it (server-side callers), new Groups go on the first page.
   */
  currentPageId?: () => string | undefined
}

export function createCanvasOps(
  collections: RoomCollections,
  options: CanvasOpsOptions = {}
): CanvasOps {
  const { doc } = collections

  function listPages(): PageData[] {
    return orderedPages(collections.pages.toArray())
  }

  function groupsOnPageOf(pageId?: string): IframeLayerGroupData[] {
    const pages = listPages()
    return groupsOnPage(
      collections.iframeLayerGroups.toArray(),
      pages,
      pageId ?? targetPageId() ?? pages[0]!.id
    )
  }

  // The page a new Group lands on, when the caller says (see
  // `CanvasOpsOptions`); otherwise it gets no `pageId`, which is the first.
  function targetPageId(): string | undefined {
    const pageId = options.currentPageId?.()
    return pageId ? resolvePageId(listPages(), pageId) : undefined
  }

  function pageField(): { pageId?: string } {
    const pageId = targetPageId()
    return pageId ? { pageId } : {}
  }

  // The Groups a new one is placed beside: only those on its page.
  function placementGroups(): IframeLayerGroupData[] {
    return groupsOnPageOf()
  }

  function createPage({ name }: { name?: string } = {}): string {
    const id = nanoid()
    batch(() => {
      const recorded = collections.pages.toArray()
      if (recorded.length === 0)
        collections.pages.set(FIRST_PAGE.id, FIRST_PAGE)
      const pages = orderedPages(recorded)
      const order = Math.max(...pages.map((p) => p.order)) + 1
      collections.pages.set(id, {
        id,
        name: name?.trim() || nextPageName(pages),
        order,
      })
    })
    return id
  }

  function renamePage(pageId: string, name: string): void {
    const trimmed = name.trim()
    if (!trimmed) return
    batch(() => {
      if (collections.pages.has(pageId)) {
        collections.pages.update(pageId, { name: trimmed })
      } else if (
        pageId === FIRST_PAGE.id &&
        !collections.pages.toArray().length
      ) {
        collections.pages.set(pageId, { ...FIRST_PAGE, name: trimmed })
      }
    })
  }

  // The recorded page `pageId`, if there is one: a canvas whose pages aren't
  // recorded has only its first, so nothing can move off it.
  function recordedPage(pageId: string): PageData | undefined {
    return collections.pages.get(pageId)
  }

  // Where a `width` × `height` Group arriving on `pageId` goes: right of the
  // page's Groups, top-aligned with the topmost; at `from` when it's empty.
  function arrivalSpot(
    pageId: string,
    from: { x: number; y: number },
    width: number,
    height: number
  ): { x: number; y: number } {
    return placeNewIframeLayerGroup(
      groupsOnPageOf(pageId),
      collections.iframeLayers.toArray(),
      { x: from.x + width / 2, y: from.y + height / 2 },
      width,
      height,
      sizedLayersOf(collections)
    )
  }

  function groupSize(group: IframeLayerGroupData): {
    width: number
    height: number
  } {
    const frames = collections.iframeLayers.toArray()
    const sized = sizedLayersOf(collections)
    return {
      width: groupContentWidth(group, frames, sized),
      height: groupContentHeight(group, frames, sized),
    }
  }

  function moveGroupToPage(groupId: string, pageId: string): void {
    batch(() => {
      const group = collections.iframeLayerGroups.get(groupId)
      if (!group || !recordedPage(pageId)) return
      if (groupPageId(group, listPages()) === pageId) return
      const { width, height } = groupSize(group)
      const { x, y } = arrivalSpot(pageId, group, width, height)
      collections.iframeLayerGroups.update(groupId, { pageId, x, y })
    })
  }

  function moveLayersToPage(
    layerIds: string[],
    pageId: string
  ): string | undefined {
    let movedTo: string | undefined
    batch(() => {
      if (!recordedPage(pageId)) return
      const ids = new Set(layerIds)
      const pages = listPages()
      const sources = collections.iframeLayerGroups
        .toArray()
        .filter((g) => getGroupMembers(g).some((m) => ids.has(m.id)))
        .filter((g) => groupPageId(g, pages) !== pageId)
      if (sources.length === 0) return
      // All of one Group: it moves whole, keeping its name and Workspace.
      const only = sources.length === 1 ? sources[0]! : undefined
      if (only && getGroupMembers(only).every((m) => ids.has(m.id))) {
        moveGroupToPage(only.id, pageId)
        movedTo = only.id
        return
      }
      const memberById = new Map(
        sources.flatMap((g) => getGroupMembers(g)).map((m) => [m.id, m])
      )
      const memberIds = layerIds.filter((id) => memberById.has(id))
      const members = memberIds.map((id) => memberById.get(id)!)
      // The new Group has the default gap.
      const { width, height } = groupSize({
        ...sources[0]!,
        members,
        gap: undefined,
      })
      const spot = arrivalSpot(pageId, sources[0]!, width, height)
      movedTo = splitToNewGroup(memberIds, spot)
      collections.iframeLayerGroups.update(movedTo, { pageId })
    })
    return movedTo
  }

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
      clearBranchIfNoFrames(group.id)
    }
  }

  // A Group holding only documents has no Workspace (#871): once its last
  // frame leaves (moved, split off or deleted) it drops the one it named, so
  // the next frame to join sets it. Caller must already be inside a `batch`.
  function clearBranchIfNoFrames(groupId: string): void {
    const group = collections.iframeLayerGroups.get(groupId)
    if (!group?.branchId) return
    if (getGroupMembers(group).some((m) => m.kind === "iframe-layer")) return
    collections.iframeLayerGroups.update(groupId, { branchId: undefined })
  }

  // A Group whose Workspace was removed falls back to its leftmost remaining
  // frame's (see `groupBranchId`) rather than naming a Workspace that's gone.
  function clearGroupBranches(branchIds: ReadonlySet<string>): void {
    for (const group of collections.iframeLayerGroups.toArray()) {
      if (group.branchId && branchIds.has(group.branchId)) {
        collections.iframeLayerGroups.update(group.id, { branchId: undefined })
      }
    }
  }

  function assignBranch(
    layerId: string,
    branchId: string,
    options?: { route?: string }
  ): void {
    batch(() => {
      if (!collections.iframeLayers.has(layerId)) return
      collections.iframeLayers.update(
        layerId,
        options?.route ? { branchId, route: options.route } : { branchId }
      )
      const group = collections.iframeLayerGroups
        .toArray()
        .find((g) => getGroupMembers(g).some((m) => m.id === layerId))
      if (!group) return
      const frames = getGroupMembers(group).filter(
        (m) => m.kind === "iframe-layer"
      )
      // The Group's Workspace follows its only frame, and an unassigned Group
      // takes the first Workspace a frame picks. Otherwise the Group keeps
      // its own.
      if (!group.branchId || frames.length === 1) {
        collections.iframeLayerGroups.update(group.id, { branchId })
      }
    })
  }

  function assignGroupBranch(groupId: string, branchId: string): void {
    batch(() => {
      const group = collections.iframeLayerGroups.get(groupId)
      if (!group) return
      // The Group label offers its switcher only while every frame it shows
      // is on one Workspace (#1276), so a pick moves them all. Frames a Done
      // Workspace hides stay put, so Reopen brings them back as they were.
      for (const m of getGroupMembers(group)) {
        if (m.kind !== "iframe-layer") continue
        const frame = collections.iframeLayers.get(m.id)
        if (!frame) continue
        if (frame.branchId && collections.branches.get(frame.branchId)?.doneAt)
          continue
        collections.iframeLayers.update(m.id, { branchId })
      }
      collections.iframeLayerGroups.update(groupId, { branchId })
    })
  }

  function savePageView(
    userId: string,
    pageId: string,
    viewport: ViewportData
  ): void {
    batch(() => {
      collections.pageViews.set(pageViewKey(userId, pageId), {
        userId,
        pageId,
        x: viewport.x,
        y: viewport.y,
        zoom: viewport.zoom,
        seenAt: Date.now(),
      })
    })
  }

  function removeViewsWhere(match: (v: PageViewData) => boolean): void {
    batch(() => {
      for (const v of collections.pageViews.toArray())
        if (match(v))
          collections.pageViews.delete(pageViewKey(v.userId, v.pageId))
    })
  }

  function removePageViews(pageId: string): void {
    removeViewsWhere((v) => v.pageId === pageId)
  }

  function removeMemberViews(userId: string): void {
    removeViewsWhere((v) => v.userId === userId)
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
        ...pageField(),
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
        placementGroups(),
        collections.iframeLayers.toArray(),
        anchor,
        width,
        height,
        sizedLayersOf(collections)
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
        ...pageField(),
        x,
        y,
        members: [{ kind: "iframe-layer", id: layerId }],
        branchId: agentId,
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
        placementGroups(),
        collections.iframeLayers.toArray(),
        anchor,
        width,
        height,
        sizedLayersOf(collections)
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
        ...pageField(),
        x,
        y,
        members: layerIds.map((id) => ({ kind: "iframe-layer", id })),
        branchId: agentId,
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
        placementGroups(),
        collections.iframeLayers.toArray(),
        anchor,
        width,
        height,
        sizedLayersOf(collections)
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
        ...pageField(),
        x,
        y,
        members: layerIds.map((id) => ({ kind: "iframe-layer", id })),
        // The Group shows its first frame's Workspace; the others are
        // exceptions that name their own.
        branchId: frames[0]!.agentId,
      })
    })
    return { groupId, layerIds }
  }

  function createDocument(
    anchor: { x: number; y: number },
    size: { width: number; height: number },
    opts: { lastChangedByChatId?: string } = {}
  ): { docId: string; groupId: string } {
    const docId = nanoid()
    const groupId = nanoid()
    batch(() => {
      collections.markdownLayers.set(docId, newDocument(docId, size, opts))
      collections.iframeLayerGroups.set(groupId, {
        id: groupId,
        name: `Group ${nextGroupNumber(collections.iframeLayerGroups.toArray())}`,
        ...pageField(),
        x: anchor.x,
        y: anchor.y,
        members: [{ kind: "markdown-layer", id: docId }],
      })
      // Seed the body fragment with the schema-required title heading so every
      // peer sees the same shape from creation (rather than the first client to
      // mount the editor filling an empty fragment locally). The fragment key
      // has one owner — `documentFragment` (slice 1).
      seedDocumentFragment(documentFragment(doc, docId))
    })
    return { docId, groupId }
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
      const frameId =
        spec.frameId && collections.iframeLayers.has(spec.frameId)
          ? spec.frameId
          : undefined
      collections.branches.set(branchId, {
        ...spec.branch,
        id: branchId,
        pendingIframeLayerSeed: !frameId,
      })
      if (frameId) assignBranch(frameId, branchId)
      if (spec.chat) {
        chatId = spec.chat.id ?? nanoid()
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
    size: { width: number; height: number },
    opts: { lastChangedByChatId?: string } = {}
  ): { docId: string } | undefined {
    const docId = nanoid()
    let created = false
    batch(() => {
      const group = collections.iframeLayerGroups.get(groupId)
      if (!group) return
      collections.markdownLayers.set(docId, newDocument(docId, size, opts))
      collections.iframeLayerGroups.update(groupId, {
        members: [
          ...getGroupMembers(group),
          { kind: "markdown-layer", id: docId },
        ],
      })
      // Seed the title heading exactly as createDocument does, so a
      // Group-appended Document is indistinguishable from a freshly created
      // one.
      seedDocumentFragment(documentFragment(doc, docId))
      created = true
    })
    return created ? { docId } : undefined
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
    batch(() => {
      for (const id of ids) collections.markdownLayers.delete(id)
      removeMembersMatching(
        (m) => m.kind === "markdown-layer" && idSet.has(m.id)
      )
    })
    return { removedChatIds: [] }
  }

  function createMockup(spec: {
    id?: string
    html: string
    title: string
    width: number
    height: number
    lastChangedByChatId?: string
    groupId?: string
    anchor?: { x: number; y: number }
  }): { mockupId: string; groupId: string } | undefined {
    const mockupId = spec.id ?? nanoid()
    let groupId = spec.groupId
    batch(() => {
      const group = groupId
        ? collections.iframeLayerGroups.get(groupId)
        : undefined
      if (groupId && !group) {
        groupId = undefined
        return
      }
      collections.mockupLayers.set(mockupId, {
        id: mockupId,
        width: Math.max(MOCKUP_MIN_WIDTH, spec.width),
        height: Math.max(MOCKUP_MIN_HEIGHT, spec.height),
        title: spec.title,
        ...(spec.lastChangedByChatId
          ? { lastChangedByChatId: spec.lastChangedByChatId }
          : {}),
      })
      writeMockupHtml(mockupHtml(doc, mockupId), spec.html)
      const member = { kind: "mockup-layer" as const, id: mockupId }
      if (group) {
        collections.iframeLayerGroups.update(group.id, {
          members: [...getGroupMembers(group), member],
        })
        return
      }
      groupId = nanoid()
      const anchor =
        spec.anchor ??
        placeNewIframeLayerGroup(
          placementGroups(),
          collections.iframeLayers.toArray(),
          { x: 0, y: 0 },
          spec.width,
          spec.height,
          sizedLayersOf(collections)
        )
      collections.iframeLayerGroups.set(groupId, {
        id: groupId,
        name: `Group ${nextGroupNumber(collections.iframeLayerGroups.toArray())}`,
        ...pageField(),
        x: anchor.x,
        y: anchor.y,
        members: [member],
      })
    })
    return groupId ? { mockupId, groupId } : undefined
  }

  function updateMockup(
    id: string,
    patch: { html?: string; title?: string }
  ): boolean {
    if (!collections.mockupLayers.get(id)) return false
    batch(() => {
      if (patch.title !== undefined) {
        collections.mockupLayers.update(id, { title: patch.title })
      }
      if (patch.html !== undefined) {
        writeMockupHtml(mockupHtml(doc, id), patch.html)
      }
    })
    return true
  }

  function duplicateMockup(id: string): string | undefined {
    const source = collections.mockupLayers.get(id)
    const group = collections.iframeLayerGroups
      .toArray()
      .find((g) =>
        getGroupMembers(g).some((m) => m.kind === "mockup-layer" && m.id === id)
      )
    if (!source || !group) return
    const copyId = nanoid()
    batch(() => {
      createMockup({
        id: copyId,
        html: mockupHtml(doc, id).toString(),
        title: source.title ? `${source.title} copy` : "",
        width: source.width,
        height: source.height,
        lastChangedByChatId: lastChangedBy(source),
        groupId: group.id,
      })
      if (source.fitHeight) {
        collections.mockupLayers.update(copyId, { fitHeight: true })
      }
      // The page re-declares its knobs on load; carry them so the Knobs
      // button and the values match the original from the first paint.
      if (source.knobs || source.knobValues) {
        collections.mockupLayers.update(copyId, {
          ...(source.knobs ? { knobs: source.knobs } : {}),
          ...(source.knobValues ? { knobValues: source.knobValues } : {}),
        })
      }
    })
    return copyId
  }

  function duplicateIframeLayer(id: string): string | undefined {
    const source = collections.iframeLayers.get(id)
    const group = collections.iframeLayerGroups
      .toArray()
      .find((g) =>
        getGroupMembers(g).some((m) => m.kind === "iframe-layer" && m.id === id)
      )
    if (!source || !group) return
    let copyId: string | undefined
    batch(() => {
      copyId = addFrameToGroup(group.id, {
        width: source.width,
        height: source.height,
        label: source.label ? `${source.label} copy` : "Frame",
        ...(source.branchId ? { branchId: source.branchId } : {}),
        ...(source.route ? { route: source.route } : {}),
      })
      if (copyId && source.fitHeight) {
        collections.iframeLayers.update(copyId, { fitHeight: true })
      }
    })
    return copyId
  }

  function followContentHeight(id: string, height: number): boolean {
    const frame = collections.iframeLayers.get(id)
    const mockup = frame ? undefined : collections.mockupLayers.get(id)
    const layer = frame ?? mockup
    if (!layer?.fitHeight) return false
    const min = frame ? MIN_IFRAME_LAYER_HEIGHT : MOCKUP_MIN_HEIGHT
    const next = Math.min(
      FIT_CONTENT_MAX_HEIGHT,
      Math.max(min, Math.ceil(height))
    )
    if (next === layer.height) return false
    doc.transact(() => {
      if (frame) collections.iframeLayers.update(id, { height: next })
      else collections.mockupLayers.update(id, { height: next })
    }, CONTENT_HEIGHT_ORIGIN)
    return true
  }

  function removeMockups(ids: string[]): { removedChatIds: string[] } {
    if (ids.length === 0) return { removedChatIds: [] }
    const idSet = new Set(ids)
    batch(() => {
      for (const id of ids) collections.mockupLayers.delete(id)
      removeMembersMatching((m) => m.kind === "mockup-layer" && idSet.has(m.id))
    })
    return { removedChatIds: [] }
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
      clearGroupBranches(new Set([branchId]))
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
      clearGroupBranches(branchIds)
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

  /** Whether a Member is one of a Done Workspace's frames the Canvas hides. */
  function hiddenFromView(): (m: GroupMember) => boolean {
    const hidden = hiddenDoneFrames({
      groups: collections.iframeLayerGroups.toArray(),
      iframeLayers: collections.iframeLayers.toArray(),
      branches: collections.branches.toArray(),
    })
    return (m) => m.kind === "iframe-layer" && hidden.has(m.id)
  }

  function reorderGroupMembers(groupId: string, members: GroupMember[]): void {
    batch(() => {
      const group = collections.iframeLayerGroups.get(groupId)
      if (!group) return
      collections.iframeLayerGroups.update(groupId, {
        members: keepHiddenMembers(getGroupMembers(group), members),
      })
    })
  }

  function moveLayerToGroup(
    layerId: string,
    targetGroupId: string,
    index?: number,
    options: { gapIncludesMover?: boolean } = {}
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
      const isHidden = hiddenFromView()
      // A gap counted with the Member still in place lands one earlier once it
      // is lifted out, when it sat before the gap.
      const shownBefore =
        options.gapIncludesMover && source.id === target.id
          ? getGroupMembers(target)
              .slice(
                0,
                getGroupMembers(target).findIndex((m) => m.id === layerId)
              )
              .filter((m) => !isHidden(m)).length
          : -1
      const shownIndex =
        index != null && shownBefore >= 0 && shownBefore < index
          ? index - 1
          : index
      const at =
        shownIndex == null
          ? targetMembers.length
          : shownIndexToMemberIndex(
              targetMembers,
              Math.max(0, shownIndex),
              isHidden
            )
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
      clearBranchIfNoFrames(source.id)
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
      let sourcePageId: string | undefined
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
        if (touchedSources.size === 0) sourcePageId = group.pageId
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
      const branchId = newMembers
        .filter((m) => m.kind === "iframe-layer")
        .map((m) => collections.iframeLayers.get(m.id)?.branchId)
        .find((id): id is string => !!id)
      collections.iframeLayerGroups.set(newGroupId, {
        id: newGroupId,
        name: `Group ${nextGroupNumber(collections.iframeLayerGroups.toArray())}`,
        // The new Group stays on the page its Members came from.
        ...(sourcePageId ? { pageId: sourcePageId } : {}),
        x: anchor.x,
        y: anchor.y,
        members: newMembers,
        ...(branchId ? { branchId } : {}),
      })
      for (const sourceId of touchedSources) {
        pruneIfEmpty(sourceId)
        clearBranchIfNoFrames(sourceId)
      }
    })
    return newGroupId
  }

  return {
    batch,
    patch,
    savePageView,
    removePageViews,
    removeMemberViews,
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
    assignBranch,
    assignGroupBranch,
    navigateRoute,
    addFrameToGroup,
    addDocumentToGroup,
    renameDocument,
    removeLayers,
    removeDocuments,
    createMockup,
    updateMockup,
    duplicateMockup,
    duplicateIframeLayer,
    followContentHeight,
    removeMockups,
    removeBranch,
    removeRepo,
    reorderRepos,
    reorderBranches,
    moveLayerToGroup,
    reorderGroupMembers,
    mergeGroups,
    splitToNewGroup,
    listPages,
    groupsOnPage: groupsOnPageOf,
    createPage,
    renamePage,
    moveGroupToPage,
    moveLayersToPage,
    internal: { pruneIfEmpty },
  }
}
