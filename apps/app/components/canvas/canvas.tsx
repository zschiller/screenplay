"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchContentRef,
} from "react-zoom-pan-pinch"
import {
  useBranches,
  useIframeLayerGroups,
  useIframeLayers,
  useChatSessions,
  useMarkdownLayers,
  useOtherPresences,
  useRoomCollections,
  useSavedViewport,
  useSelfPresence,
  useSetPresence,
  useRepos,
  useYjsHistory,
} from "@/lib/yjs/react"
import { createCanvasOps } from "@/lib/canvas/ops"
import type { TerminalTabRecord } from "@/lib/terminal-tabs"
import { useAppSession } from "@/lib/auth-client"
import { isLocalBuild } from "@/lib/local-mode"
import { useTrafficLightsPresent } from "@/lib/use-traffic-lights"
import { withBasePath } from "@/lib/base-path"
import { PanelRightOpen } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { Kbd } from "@workspace/ui/components/kbd"
import { type EditableTextHandle } from "@workspace/ui/components/editable-text"
import { ShareRoomDialog } from "@/components/share-room-dialog"
import { renameRoom } from "@/lib/rooms-actions"
import { SelectionOverlay } from "./selection-overlay"
import { Comments } from "./comments"
import type { ThreadWithComments } from "@/lib/comments"
import { Cursors } from "./cursors"
import { CursorChat } from "./cursor-chat"
import { FollowingToolbar } from "./following-toolbar"
import { useThumbnailHeartbeat } from "./use-thumbnail-heartbeat"
import { DirtyFrameTracker } from "@/lib/thumbnail/dirty-frames"
import { RoomSidebar } from "@/components/panels/room-sidebar"
import { useBranchPrs } from "@/hooks/use-branch-prs"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@workspace/ui/components/resizable"
import { type PanelImperativeHandle } from "react-resizable-panels"
import { type PanelLayout, writePanelLayout } from "@/lib/panel-layout"
import type { IframeLayerGroupData, ViewportData } from "@/lib/types"
import { chatStore } from "@/lib/chat-store"
import { isBranchBusy } from "@/lib/branch-busy"
import { eligibleTargetFrames } from "@/lib/canvas/element-targeting"
import {
  targetingStore,
  type PickedElement,
  type PickRequest,
} from "@/lib/targeting-store"
import type { DomRect } from "@/lib/postmessage-protocol"
import { useDiffStats } from "@/hooks/use-diff-stats"
import { stopDevServers } from "@/lib/sandbox/lifecycle"
import { useBranchActions } from "@/components/canvas/use-branch-actions"
import { useBranchIntake } from "@/components/canvas/use-branch-intake"
import { useChatTarget } from "@/components/canvas/use-chat-target"
import { useSandboxReconnect } from "@/components/canvas/use-sandbox-reconnect"
import {
  useElementReference,
  type ElementReferenceInputs,
} from "@/components/canvas/use-element-reference"
import { useTabPool } from "@/components/canvas/use-tab-pool"
import { useTerminalTabs } from "@/components/canvas/use-terminal-tabs"
import { useCanvasSelection } from "@/components/canvas/use-canvas-selection"
import { useCanvasInteraction } from "@/components/canvas/use-canvas-interaction"
import { useCanvasKeyboard } from "@/components/canvas/use-canvas-keyboard"
import { useLayerMutations } from "@/components/canvas/use-layer-mutations"
import { useGroupActions } from "@/components/canvas/use-group-actions"
import { useToolMode } from "@/components/canvas/use-tool-mode"
import { useCanvasCamera } from "@/components/canvas/use-canvas-camera"
import { useChatSessionWrites } from "@/components/canvas/use-chat-session-writes"
import { useChatSync } from "@/components/canvas/use-chat-sync"
import { CANVAS_SIZE } from "@/lib/constants"
import {
  computeIframeLayerLayouts,
  deriveCanvasLayout,
  getGroupMembers,
  groupContentHeight,
  groupContentWidth,
  groupGap,
} from "@/lib/canvas/layout"
import type {
  MoveAssemblyGroup,
  ReorderMemberSnapshot,
} from "@/lib/canvas/gesture"
import { type RouteGroup } from "@/lib/canvas/route"
import {
  useCanvasGesture,
  type CanvasGestureInputs,
} from "./use-canvas-gesture"
import { useDrawTool } from "./use-draw-tool"
import { useGestureIntent } from "./use-gesture-intent"
import { useFrameActions } from "./use-frame-actions"
import { ResizeSnapUnderlay } from "./resize-snap-underlay"
import { GroupMergeUnderlay } from "./group-merge-underlay"
import { PlaceholderRectsUnderlay } from "./placeholder-rects-underlay"
import { CanvasMemberLayer } from "./canvas-member-layer"
import { CanvasToolbar } from "./canvas-toolbar"
import { CanvasTopBar } from "./canvas-top-bar"
import { ChatPanelHost } from "./chat-panel-host"

// Stable empty set for the "no pick armed → nothing dimmed" case, so the
// memoized member layer isn't handed a fresh Set identity every render.
const EMPTY_DIMMED_IDS: ReadonlySet<string> = new Set()

// Polls /api/sandbox/:name/logs until it returns 200, then fires onReady once.
// Used to defer selection of a just-created agent until its sandbox is actually
// streaming logs — otherwise flipping selection now shows an empty chat panel.
function LogProbe({
  sandboxName,
  onReady,
}: {
  sandboxName: string
  onReady: () => void
}) {
  const onReadyRef = useRef(onReady)
  useEffect(() => {
    onReadyRef.current = onReady
  })
  useEffect(() => {
    const abort = new AbortController()
    ;(async () => {
      while (!abort.signal.aborted) {
        try {
          const res = await fetch(
            withBasePath(
              `/api/sandbox/${encodeURIComponent(sandboxName)}/logs`
            ),
            { signal: abort.signal, cache: "no-store" }
          )
          if (res.ok) {
            try {
              await res.body?.cancel()
            } catch {}
            onReadyRef.current()
            return
          }
          try {
            await res.body?.cancel()
          } catch {}
        } catch (e) {
          if ((e as Error).name === "AbortError") return
        }
        await new Promise((r) => setTimeout(r, 1500))
      }
    })()
    return () => abort.abort()
  }, [sandboxName])
  return null
}

export function Canvas({
  roomId,
  roomName,
  isOwner,
  sharedWithCount,
  hasThumbnail,
  parentFolder,
  initialLayout,
  initialThreads,
  initialTerminalTabs,
}: {
  roomId: string
  roomName: string
  isOwner: boolean
  sharedWithCount: number
  hasThumbnail: boolean
  // The folder this user filed the Room into, or null for the "All files" root.
  // Drives the breadcrumb's parent crumb so it returns to the Room's home.
  parentFolder: { id: string; name: string } | null
  initialLayout?: PanelLayout
  initialThreads?: ThreadWithComments[]
  initialTerminalTabs?: TerminalTabRecord[]
}) {
  const [currentRoomName, setCurrentRoomName] = useState(roomName)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  // Inline rename of the room name in the floating breadcrumb. The menu's
  // "Rename" item flags a pending edit and `onCloseAutoFocus` starts it once
  // the menu's focus trap has released (see iframe-layer-row for the pattern).
  const roomNameEditableRef = useRef<EditableTextHandle>(null)
  const pendingRoomRenameRef = useRef(false)
  const onRoomMenuCloseAutoFocus = useCallback((e: Event) => {
    if (!pendingRoomRenameRef.current) return
    pendingRoomRenameRef.current = false
    e.preventDefault()
    roomNameEditableRef.current?.startEditing()
  }, [])
  const handleRoomRename = useCallback(
    async (next: string) => {
      const trimmed = next.trim()
      if (!trimmed || trimmed === currentRoomName) return
      const previous = currentRoomName
      setCurrentRoomName(trimmed) // optimistic
      try {
        await renameRoom(roomId, trimmed)
      } catch {
        setCurrentRoomName(previous)
      }
    },
    [currentRoomName, roomId]
  )
  // Chat-Target selection — which target the panel shows, the per-target memory,
  // and the pending-agent readiness — is owned by the `useChatTarget` controller
  // (#569), created once its dependencies are in scope below. The client's
  // Terminal Tabs (`localTerminals`) and their seed / re-fetch-merge /
  // orphan-prune lifecycle are owned by the `useTerminalTabs` controller (#582),
  // created once `agents` is in scope below; the Tab Pool composes it.
  const inspectHandlersRef = useRef<{
    branchRename: (agentId: string, branch: string) => void
    renameChat: (chatId: string, label: string) => void
  }>({ branchRename: () => {}, renameChat: () => {} })

  // Element Reference controller (PRD #570): the single-user "anchor an element
  // / text span and Send to agent" reference path the local build keeps. It
  // owns the comment-mode placement state (`newCommentPos`, `activeThreadId`,
  // `inspectHover`) and the two registries the flow reads — the per-Iframe-Layer
  // DOM accessors and the per-Markdown-Layer TipTap editors — and exposes the
  // placement verbs plus the single `sendReference` verb (over the pure
  // `lib/canvas/chat-reference` decision). Its live inputs arrive through a ref
  // the component repopulates every render (the effect below), breaking the
  // ordering cycle: the placement state is read by the keyboard handler defined
  // just below, while `sendReference` needs the Chat-Target controller and the
  // canvas ops defined far down the component.
  const referenceInputsRef = useRef<ElementReferenceInputs | null>(null)
  const reference = useElementReference(referenceInputsRef)
  const sidebarPanelRef = useRef<PanelImperativeHandle>(null)
  const chatPanelRef = useRef<PanelImperativeHandle>(null)
  // Figma-style wheel pan/zoom listener attaches to this wrapper; declared up
  // here so the Canvas Camera controller (below) can own that listener.
  const canvasWrapperRef = useRef<HTMLDivElement>(null)
  // The react-zoom-pan-pinch transform ref. Owned by the component (read in the
  // pointer/route callbacks below) and driven by the Canvas Camera controller.
  const transformRef = useRef<ReactZoomPanPinchContentRef>(null)
  const setPresence = useSetPresence()
  const self = useSelfPresence()
  const others = useOtherPresences()
  const { data: session } = useAppSession()
  const userId = session?.user.id
  const history = useYjsHistory()
  const collections = useRoomCollections()
  // Canvas Operations seam (#157): the single transaction entry point + the
  // generic single-field `patch`. Trivial single-field writes below go through
  // `ops.patch`; the meaning-bearing verbs land in slices 3–5.
  const ops = useMemo(() => createCanvasOps(collections), [collections])

  // Chat Session Writes controller (PRD #588): the single small owner of the
  // thin add / update / remove Chat Session Canvas Operation wrappers (ADR
  // 0001), which used to be root-level pass-throughs. Tab Pool, Branch Intake,
  // Branch Actions, the Chat Sync owner, and Element Reference all read these
  // verbs from here rather than from a facade the root redefines.
  const { addChatSession, updateChatSession, removeChatSession } =
    useChatSessionWrites(ops)

  // Synced canvas collections — read by the controllers below (selection needs
  // the live Groups; the camera reads the saved viewport).
  const iframeLayers = useIframeLayers()
  const iframeLayerGroups = useIframeLayerGroups()
  const markdownLayers = useMarkdownLayers()
  const savedViewport = useSavedViewport()

  // Canvas Operation wrappers the controllers apply removals / persistence
  // through (ADR 0001: mutations go through `ops`, never the Y.Doc directly).
  const removeIframeLayers = useCallback(
    (ids: string[]) => {
      ops.removeLayers(ids)
    },
    [ops]
  )
  const removeDocumentLayers = useCallback(
    (ids: string[]) => {
      const { removedChatIds } = ops.removeDocuments(ids)
      for (const chatId of removedChatIds) chatStore.cleanup(chatId)
    },
    [ops]
  )
  const saveViewport = useCallback(
    (vp: ViewportData) => {
      ops.saveViewport(vp)
    },
    [ops]
  )

  // Tool Mode controller (PRD #567): the four draw tools (Select / Frame /
  // Document / Comment) as one discriminated value, so "exactly one tool active"
  // holds by construction. The booleans below are read-aliases for the existing
  // call sites; mode changes dispatch `toolMode.set` / `toolMode.toggle`.
  const toolMode = useToolMode()
  const commentMode = toolMode.commentMode
  const documentMode = toolMode.documentMode
  const frameMode = toolMode.frameMode

  // Canvas Selection controller (PRD #567): owns the three selection Sets, the
  // mirror refs the keydown handler reads via `current()`, the delete decision
  // (applied through `ops`), and the overlay / group projections. The locals
  // below alias its state + setters so the existing call sites are unchanged.
  const selection = useCanvasSelection({
    groups: iframeLayerGroups,
    removeIframeLayers,
    removeDocumentLayers,
  })
  const selectedIframeLayerIds = selection.iframeLayerIds
  const selectedGroupIds = selection.groupIds
  const selectedDocumentLayerIds = selection.documentLayerIds
  const setSelectedIframeLayerIds = selection.setIframeLayerIds
  const setSelectedGroupIds = selection.setGroupIds
  const setSelectedDocumentLayerIds = selection.setDocumentLayerIds
  const overlaySelectedIds = selection.overlaySelectedIds
  const groupSelectedIframeLayerIds = selection.groupSelectedIframeLayerIds

  // Awareness mirrors the Interaction controller's cursor-chat verbs read: the
  // latest self pointer (where '/' anchors the bubble) and message (null =
  // closed). Mirrored from `self` after commit (the effect below) so the verbs
  // and the Escape resolver read them without re-binding. Declared here, ahead
  // of the controller that consumes them, so no ordering cycle is introduced.
  const selfPointerRef = useRef<{ x: number; y: number } | null>(null)
  const selfMessageRef = useRef<string | null>(null)
  useEffect(() => {
    selfPointerRef.current = self?.pointer ?? null
    selfMessageRef.current = self?.message ?? null
  })

  // Canvas Interaction controller (PRD #588): the single home for the
  // cross-cutting interaction state that no other controller owned — the focused
  // ("interactive") Iframe Layer, the Create-Flow ("flow") Iframe Layer, the
  // hovered Iframe Layer, the inline-edited Markdown Layer, the space-held pan
  // flag, and the cursor-chat anchor. It wraps `reconcileInteractionMode` (drop
  // a mode whose frame is deleted/deselected) and `resolveEscapeAction` (the
  // Escape precedence) without modifying them, and reads the selection +
  // awareness mirrors above. The locals below alias its state + verbs so the
  // camera, gesture seam, draw tool, keyboard, and render tree read them as
  // before.
  const interaction = useCanvasInteraction({
    iframeLayers,
    selectedIframeLayerIds,
    setPresence,
    selfPointerRef,
    selfMessageRef,
  })
  const focusedIframeLayerId = interaction.focusedIframeLayerId
  const setFocusedIframeLayerId = interaction.setFocusedIframeLayerId
  const createFlowIframeLayerId = interaction.createFlowIframeLayerId
  const setCreateFlowIframeLayerId = interaction.setCreateFlowIframeLayerId
  const hoveredIframeLayerId = interaction.hoveredIframeLayerId
  const setHoveredIframeLayerId = interaction.setHoveredIframeLayerId
  const editingDocumentLayerId = interaction.editingDocumentLayerId
  const setEditingDocumentLayerId = interaction.setEditingDocumentLayerId
  const spaceHeld = interaction.spaceHeld
  const chatAnchor = interaction.chatAnchor
  const closeCursorChat = interaction.closeCursorChat

  // Canvas Camera controller (PRD #567): owns the react-zoom-pan-pinch
  // transform, the zoom / viewport mirrors, persistence, presence broadcast,
  // follow, and the wheel pan/zoom. The locals below alias its values so the
  // rest of the component reads `zoom` / `viewportPos` / `transformRef` as
  // before.
  const camera = useCanvasCamera({
    transformRef,
    canvasWrapperRef,
    setPresence,
    session,
    saveViewport,
    savedViewport,
    others,
    overlaySelectedIds,
    groupSelectedIframeLayerIds,
    focusedIframeLayerId,
    createFlowIframeLayerId,
    editingDocumentLayerId,
    spaceHeld,
  })
  const zoom = camera.zoom
  const viewportPos = camera.viewportPos
  // Drives the `grabbing` cursor — drag pans only, so a trackpad pan doesn't
  // flip the cursor to a grabbing hand.
  const isDragPanning = camera.isDragPanning
  // The screen-space overlays/underlays read `zoom`/`viewportPos`, which the
  // camera intentionally stops syncing mid-zoom AND mid-pan (perf — the layers
  // glide imperatively). Frozen, the overlays would lag the content and snap on
  // settle, so hide them for the duration of either gesture.
  const isCameraMoving = camera.isZooming || camera.isPanning
  const isZooming = camera.isZooming
  const followingConnectionId = camera.followingConnectionId

  // Per-frame dirty/ready bookkeeping for the thumbnail heartbeat (#474): the
  // Iframe Layers report their ready/HMR transitions into this tracker, and the
  // heartbeat POSTs only the dirty subset. One instance per mounted Canvas.
  const captureTracker = useMemo(() => new DirtyFrameTracker(), [])
  const { flushLayout } = useThumbnailHeartbeat(
    roomId,
    hasThumbnail,
    captureTracker
  )
  const handleCaptureReadyChange = useCallback(
    (id: string, ready: boolean) => captureTracker.setReady(id, ready),
    [captureTracker]
  )
  const handleCaptureDirty = useCallback(
    (id: string) => captureTracker.markDirty(id),
    [captureTracker]
  )

  // The identity + stable-color publish (with the placeholder-viewport seed) and
  // the selection → presence broadcast are presence effects, owned by the Canvas
  // Camera controller now (PRD #588) — the canvas presence owner.

  // Canvas Keyboard controller (PRD #579, cut 4/4): owns the global
  // keydown/keyup listeners and the whole shortcut map, dispatching into the
  // bundled controllers (Tool Mode, Selection, Element Reference, Yjs history,
  // Interaction), the panel refs, and the cursor-chat verbs. The Escape
  // precedence stays in the pure `resolveEscapeAction`, wrapped by the
  // Interaction controller's `resolveEscape`; the keyboard only applies the
  // chosen exit.
  useCanvasKeyboard({
    toolMode,
    selection,
    reference,
    history,
    interaction,
    sidebarPanelRef,
    chatPanelRef,
  })

  // Prune capture bookkeeping for frames removed from the canvas so a deleted
  // frame's stale dirty flag never lands in a POSTed subset (#474).
  useEffect(() => {
    captureTracker.retain(new Set(iframeLayers.map((layer) => layer.id)))
  }, [captureTracker, iframeLayers])
  const iframeLayerLayouts = useMemo(
    () =>
      computeIframeLayerLayouts(
        iframeLayerGroups,
        iframeLayers,
        markdownLayers
      ),
    [iframeLayerGroups, iframeLayers, markdownLayers]
  )
  // Ref mirror so callbacks that only need the current snapshot (e.g.
  // `requestReorderDrag` computing the cursor's grab offset) can read it
  // without re-binding on every layout change.
  const iframeLayerLayoutsRef = useRef(iframeLayerLayouts)
  useEffect(() => {
    iframeLayerLayoutsRef.current = iframeLayerLayouts
  })

  // Canvas Gesture FSM (gap-resize + reorder + group-move/merge + marquee +
  // device-resize — the full #535 migration). The hook holds the gesture state,
  // exposes the Gesture Preview fed into `deriveCanvasLayout` and the overlays
  // below, and applies emitted Gesture Intents through the Canvas Operations —
  // the gesture itself never touches the Y.Doc.
  // The gesture seam is created high in the component (its `dispatch`/`preview`
  // feed `deriveCanvasLayout` below), but most of its inputs — the derived
  // handle geometry, the draw-tool drafts — are defined further down. A ref the
  // component repopulates every render (the effect near the bottom) breaks that
  // ordering cycle, exactly as the old geometry refs did.
  const gestureInputsRef = useRef<CanvasGestureInputs | null>(null)
  const {
    getState: getGestureState,
    preview: gesturePreview,
    handlers: canvasGestureHandlers,
    layerHandlers: gestureLayerHandlers,
    activeGapHandle,
    hoveredReorderIframeLayerId,
    isLayerDragging,
    resetHandleHover,
  } = useCanvasGesture(gestureInputsRef)

  // Apply an emitted Gesture Intent — the gesture seam's commit side, owned by
  // `useGestureIntent`: canvas-mutating intents through Canvas Operations,
  // selection-only ones through the Canvas Selection controller. The gesture
  // itself never touches the Y.Doc.
  const applyGestureIntent = useGestureIntent({ collections, ops, selection })

  /**
   * Whole-Canvas geometry for the current frame: the effective (mid-gesture)
   * layout plus the placeholder rects and gap/reorder handle positions derived
   * from it. All the math lives in the React-free `lib/canvas/layout` module;
   * this component is a consumer that feeds it plain snapshots of state and
   * renders the result. The effective layout diverges from `iframeLayerLayouts`
   * only while a reorder drag has popped a member out of its group's flex flow.
   */
  const canvasLayout = useMemo(
    () =>
      deriveCanvasLayout({
        groups: iframeLayerGroups,
        iframeLayers,
        markdownLayers,
        selection: {
          iframeLayerIds: selectedIframeLayerIds,
          documentLayerIds: selectedDocumentLayerIds,
          groupIds: selectedGroupIds,
        },
        // The Gesture Preview's reorder slice drives the pop-out reflow: while
        // popped, the dragged Member floats at the cursor and its siblings close
        // the gap. In-flow reorder needs neither field (it commits live to the
        // Group), so both stay null until meta lifts the Member out.
        activeReorderDrag:
          gesturePreview.reorder && gesturePreview.reorder.popped
            ? {
                memberId: gesturePreview.reorder.memberId,
                cursor: gesturePreview.reorder.cursor,
                grabOffset: gesturePreview.reorder.grabOffset,
              }
            : null,
        poppedMemberId:
          gesturePreview.reorder && gesturePreview.reorder.popped
            ? gesturePreview.reorder.memberId
            : null,
        // Placeholders are tool-gated, not selection-gated: armed Frame tool
        // appends frames, armed Document tool appends documents, neither tool
        // → no placeholders.
        placeholderTool: frameMode ? "frame" : documentMode ? "document" : null,
        gapOverride: gesturePreview.gapOverride,
      }),
    [
      iframeLayerGroups,
      iframeLayers,
      markdownLayers,
      selectedIframeLayerIds,
      selectedDocumentLayerIds,
      selectedGroupIds,
      gesturePreview.reorder,
      gesturePreview.gapOverride,
      frameMode,
      documentMode,
    ]
  )
  const effectiveIframeLayerLayouts = canvasLayout.layouts
  const sortedIframeLayerGroups = useMemo(() => {
    return [...iframeLayerGroups].sort((a, b) => {
      const ao = a.sidebarOrder ?? Number.MAX_SAFE_INTEGER
      const bo = b.sidebarOrder ?? Number.MAX_SAFE_INTEGER
      if (ao !== bo) return ao - bo
      return a.id.localeCompare(b.id)
    })
  }, [iframeLayerGroups])

  // Canvas z-order matches the sidebar list: first row in the sidebar paints
  // on top. We can't reorder the DOM (would reload iframes / re-mount TipTap),
  // so the React iteration stays stable and we project sidebar position onto
  // a per-group `z-index` instead.
  const groupZIndex = useMemo(() => {
    const m = new Map<string, number>()
    sortedIframeLayerGroups.forEach((g, i) => {
      m.set(g.id, sortedIframeLayerGroups.length - i)
    })
    return m
  }, [sortedIframeLayerGroups])

  /**
   * Display name per group. Persisted on the group itself so reordering
   * doesn't renumber existing groups; legacy groups without a stored name
   * fall back to "Group" so the UI doesn't render `undefined`.
   */
  const groupDisplayNames = useMemo(() => {
    const names = new Map<string, string>()
    for (const g of sortedIframeLayerGroups) {
      names.set(g.id, g.name ?? "Group")
    }
    return names
  }, [sortedIframeLayerGroups])

  // World-space rects for each group's trailing "add frame" placeholder, the
  // inter-member gap handles, and the per-member reorder dots — all derived by
  // the layout module from the effective layout above and the live selection.
  // Drawn by `PlaceholderRectsUnderlay`, `SelectionOverlay`, and the flat
  // member layer, which project these world-space values to screen-space.
  const placeholderRects = canvasLayout.placeholderRects
  const gapHandles = canvasLayout.gapHandles
  const reorderHandles = canvasLayout.reorderHandles

  // `groupSelectedIframeLayerIds` (every member of a selected group) and
  // `overlaySelectedIds` (the iframe ∪ markdown union the overlay reads) are
  // projections owned by the Canvas Selection controller, aliased above.
  const repos = useRepos()
  const agents = useBranches()

  // Leaving the Room takes its Branches' dev servers with it on desktop:
  // local dev servers are host processes with no auto-stop timer, so without
  // this they'd run until the app quits. Fire-and-forget — navigation must
  // never wait on the kill — and gated on the local build so the hosted app
  // (where Rooms are collaborative and sandboxes hibernate on their own)
  // doesn't even make the call. Reopening the Room relaunches via reconnect.
  // Room *deletion* doesn't need this: deleteRoom tears down the Sandboxes
  // themselves server-side, dev servers included.
  const stopRoomDevServers = useCallback(() => {
    if (!isLocalBuild) return
    const names = agents.map((a) => a.sandboxName).filter(Boolean)
    if (names.length > 0) void stopDevServers(names).catch(() => {})
  }, [agents])

  // Terminal Tab controller (PRD #579, cut 3/4): owns this client's
  // `localTerminals` plus their first-paint seed, the `listTerminalTabsAction`
  // re-fetch-and-merge, and the orphan prune (drop tab + delete persisted row
  // when the Branch is gone). The Tab Pool composes it for the apply-side; the
  // Chat-Target controller reads `localTerminals` to resolve a selected tab's
  // target.
  const terminalTabs = useTerminalTabs({
    roomId,
    agents,
    initialTerminalTabs,
  })

  const diffStats = useDiffStats(agents, repos)
  const { branchPrs, setBranchPr } = useBranchPrs(agents, repos)

  const chatSessions = useChatSessions()

  const agentDomains = useMemo(() => {
    const domains: Record<
      string,
      {
        previewDomain: string
        branch: string
        discoveredRoutes?: { route: string; label: string }[]
      }
    > = {}
    for (const agent of agents) {
      if (agent.previewDomain) {
        domains[agent.id] = {
          previewDomain: agent.previewDomain,
          branch: agent.ref,
          discoveredRoutes: agent.discoveredRoutes,
        }
      }
    }
    return domains
  }, [agents])

  const getViewportCenter = camera.getViewportCenter

  // Chat-Target selection controller (PRD #569): owns which Chat Target the
  // panel shows — the selected agent/doc/chat, the per-target memory, and the
  // pending-agent readiness — and resolves the `ChatPanelTarget`. The symmetric
  // sibling of the Tab Pool controller (which owns the tabs *within* a target);
  // both `useTabPool` and `useBranchIntake` compose with it for selection.
  const chatTarget = useChatTarget({
    agents,
    chatSessions,
    markdownLayers,
    localTerminals: terminalTabs.localTerminals,
    chatPanelRef,
  })

  // Repo create/update/remove storage writes live on the Branch Intake
  // controller now (#592) — the root no longer defines thin `ops` wrappers just
  // to pass them back into intake.

  // Frame / document creation and the structural group mutations live on the
  // Group Operations controller (`useGroupActions`), constructed below.

  /**
   * Start a reorder drag programmatically from a layer-owned element (e.g. the
   * frame's name label). Mirrors the path taken when the user grabs the
   * reorder dot directly: pointer capture is moved to the canvas wrapper so
   * the gesture seam's pointer move/up handlers (`useCanvasGesture`) drive the
   * gesture. Returns `true` if the reorder started (so the caller
   * can skip its own fallback drag), or `false` for single-member groups
   * where reorder doesn't make sense.
   */
  // Snapshot a group's members (kind + width) for the reorder gesture's
  // sibling-center math. Stable for a drag — reordering never resizes a member
  // or moves the group — so the FSM can carry it in its start context.
  const reorderOrderSnapshot = useCallback(
    (group: IframeLayerGroupData): ReorderMemberSnapshot[] =>
      getGroupMembers(group).map((m) => {
        const size =
          m.kind === "iframe-layer"
            ? collections.iframeLayers.get(m.id)
            : collections.markdownLayers.get(m.id)
        return { id: m.id, kind: m.kind, width: size?.width ?? null }
      }),
    [collections]
  )

  // Plain group snapshots the gesture seam routes a pointer-down against — the
  // world anchor, effective gap, and per-member kind/width the reorder walk
  // reads. Rebuilt when the groups or their members' widths change.
  const routeGroups = useMemo<RouteGroup[]>(
    () =>
      iframeLayerGroups.map((g) => ({
        id: g.id,
        x: g.x,
        gap: groupGap(g),
        members: reorderOrderSnapshot(g),
      })),
    [iframeLayerGroups, reorderOrderSnapshot]
  )

  // Markdown-layer ids, so the marquee hit-test can classify a covered layer as
  // a document (it lives in the shared layout map alongside frames).
  const markdownLayerIdSet = useMemo(
    () => new Set(markdownLayers.map((d) => d.id)),
    [markdownLayers]
  )

  // Project the live collections into the plain snapshots the Layer-initiated
  // group-move assembly (`assembleMoveStart`, called inside the gesture
  // controller) reads: each group's anchor, gap, members, content-bbox size, and
  // member sizes, plus every layer's world rect. Built lazily at drag start (not
  // per render) so the per-group content/member sizes are computed once per drag,
  // matching the cost profile of the old inline `handleLayerGroupDragStart`.
  const buildMoveAssembly = useCallback(() => {
    const allGroups = collections.iframeLayerGroups.toArray()
    const abArr = collections.iframeLayers.toArray()
    const docArr = collections.markdownLayers.toArray()
    const groups: MoveAssemblyGroup[] = allGroups.map((g) => {
      const members = getGroupMembers(g)
      const memberSizes: Array<{ width: number; height: number }> = []
      for (const m of members) {
        const size =
          m.kind === "iframe-layer"
            ? collections.iframeLayers.get(m.id)
            : collections.markdownLayers.get(m.id)
        if (size) memberSizes.push({ width: size.width, height: size.height })
      }
      return {
        id: g.id,
        x: g.x,
        y: g.y,
        gap: groupGap(g),
        members: members.map((m) => ({ kind: m.kind, id: m.id })),
        contentWidth: groupContentWidth(g, abArr, docArr),
        contentHeight: groupContentHeight(g, abArr, docArr),
        memberSizes,
      }
    })
    return { groups, layouts: iframeLayerLayoutsRef.current.values() }
  }, [collections])

  // `removeIframeLayers` / `removeDocumentLayers` are defined up top (the Canvas
  // Operation wrappers the controllers apply removals through). The single
  // sidebar "remove frame" path — remove + keep selection on the neighbor —
  // lives on the Canvas Selection controller as `removeIframeLayerAndReselect`.
  const removeIframeLayer = selection.removeIframeLayerAndReselect

  // The route handler reads the latest Create Flow selection through the
  // Interaction controller's mirror ref, so it stays a stable callback across
  // toggles without every consumer re-binding.
  const createFlowIframeLayerIdRef = interaction.createFlowIframeLayerIdRef

  // Layer Mutation controller (PRD #579, cut 1/4): the thin per-Layer Canvas
  // Operation wrappers — Iframe Layer field writers (rename / assignAgent /
  // updateState / updateScroll / updateKnobs / updateKnobValues /
  // updateSharedState / updateRoute / fitToContent) and Markdown Layer writers
  // (resizeDocument / setTitle / setTitleCache) —
  // bundled into one `LayerMutations` object passed to `CanvasMemberLayer` as a
  // single prop, the way `selection` / `camera` / `reference` already are.
  // `updateRoute` reads `transformRef` (the Create-Flow pan) and the live
  // `createFlowIframeLayerIdRef` through refs to stay stable across renders.
  const layerMutations = useLayerMutations({
    ops,
    collections,
    captureTracker,
    transformRef,
    createFlowIframeLayerIdRef,
  })

  // Group Operations controller (PRD #588): the structural sibling of
  // `useLayerMutations`. Where the Layer Mutation bundle writes a field on one
  // Layer, this owns "create / move / reorder / remove the groups and frames
  // themselves" — frame creation (blank / for-agent / routes-group /
  // append-to-group), document creation, cross-group `moveMember`, group
  // reorder / rename / delete — bundled into one `GroupActions` object passed to
  // the render tree. Every verb routes through `ops` (ADR 0001); the composed
  // ones keep their bodies (the `moveMember` splice, `removeIframeLayerGroup`'s
  // chat cleanup + selection follow, the viewport-centered creators). The thin
  // multi-Layer remove wrappers (`removeIframeLayers` / `removeDocumentLayers`)
  // stay up top because the Selection controller consumes them at construction,
  // ahead of this controller.
  const groupActions = useGroupActions({
    ops,
    collections,
    getViewportCenter,
    rememberDocChat: chatTarget.rememberDocChat,
    selection,
  })
  // Alias the controller verbs to the local names the render tree / other
  // controllers read, so the call sites stay a verbatim move.
  const addFrame = groupActions.addFrame
  const addIframeLayer = groupActions.addIframeLayer
  const addRoutesGroupForAgent = groupActions.addRoutesGroupForAgent
  const addDocumentLayer = groupActions.addDocumentLayer
  const reorderIframeLayerGroups = groupActions.reorderIframeLayerGroups
  const moveMember = groupActions.moveMember
  const renameIframeLayerGroup = groupActions.renameIframeLayerGroup
  const removeIframeLayerGroup = groupActions.removeIframeLayerGroup

  // `removeIframeLayers` / `removeDocumentLayers` are defined up top (Canvas
  // Operation wrappers the Selection controller and the sidebar's remove-frame /
  // remove-document actions share).

  // Branch update/remove storage writes live on the Branch Intake controller
  // now (#592); `updateAgentInStorage` is exposed off it for the consumers
  // outside intake (Branch Actions, Sandbox Reconnect's heartbeat, sidebar).

  // The thin add / update / remove Chat Session writes live on the Chat Session
  // Writes controller now (PRD #588), aliased from it up top.

  // --- Handlers ---

  // Zoom-to actions delegate the fit math to the Canvas Camera controller
  // (`zoomToElement` / `zoomToRect`, over the pure `lib/canvas/camera`).
  // Frame actions — zoom-to / play / add-frame-for-agent — the sidebar and
  // member layer call. Aliased to the existing handler names so call sites are
  // unchanged. See `use-frame-actions`.
  const frameActions = useFrameActions({
    camera,
    agents,
    iframeLayers,
    iframeLayerGroups,
    effectiveIframeLayerLayouts,
    addIframeLayer,
    addRoutesGroupForAgent,
    roomId,
  })
  const handleSelectIframeLayer = frameActions.selectIframeLayer
  const handleZoomToDocument = frameActions.zoomToDocument
  const handleZoomToGroup = frameActions.zoomToGroup
  const handleAddIframeLayerForAgent = frameActions.addIframeLayerForAgent
  const handleShowRoutesForAgent = frameActions.showRoutesForAgent
  const handlePlayAgent = frameActions.playAgent
  const handlePlayIframeLayer = frameActions.playIframeLayer

  const handleSelectAgent = chatTarget.selectAgent

  // Repopulate the Element Reference controller's live inputs every render so
  // its placement verbs and `sendReference` read the current snapshots, the
  // Chat-Target controller, and the canvas ops seam — without re-binding the
  // controller on each change (mirrors `iframeLayerLayoutsRef` /
  // `gestureInputsRef`). The rename callbacks read `inspectHandlersRef` so they
  // stay current as the Tab Pool / Branch Intake wiring lands later.
  useEffect(() => {
    referenceInputsRef.current = {
      roomId,
      markdownLayers,
      chatSessions,
      iframeLayerLayouts,
      addChatSession,
      chatTarget,
      onChatRename: (chatId, label) =>
        inspectHandlersRef.current.renameChat(chatId, label),
      onBranchRename: (agentId, branch) =>
        inspectHandlersRef.current.branchRename(agentId, branch),
    }
  })

  // Tab Pool controller (PRD #563): the chat/terminal/tab apply-side — create,
  // close, remove, select, rename, reopen, and the `seed` entry Branch Intake
  // calls — lifted into `useTabPool`. The component renders the tab strip and
  // calls these verbs; the controller owns the chat-store and Y.Doc tab writes,
  // the Terminal Tab server actions, the never-empty invariant, and the
  // agent-pool-vs-doc-pool split (over the pure `resolveTabClose` decision).
  const tabPool = useTabPool({
    addChatSession,
    updateChatSession,
    removeChatSession,
    roomId,
    userId,
    agents,
    chatSessions,
    terminalTabs,
    chatTarget,
  })

  // Branch Intake controller (PRD #562): the Repo -> Branch -> Sandbox
  // create/teardown orchestration, Branch rename, and the seed-tab / seed-frame
  // handoff, lifted into `useBranchIntake`. The component calls the verbs; the
  // controller owns the ordering invariants and the Sandbox Provider calls.
  const {
    createRepo,
    createBranch,
    createBranchFromGitBranch,
    removeRepo: removeRepoIntake,
    removeBranch: removeBranchIntake,
    renameBranch,
    updateRepoInStorage,
    updateAgentInStorage,
  } = useBranchIntake({
    ops,
    repos,
    agents,
    iframeLayers,
    roomId,
    updateChatSession,
    createDefaultTabForBranch: tabPool.seed,
    getViewportCenter,
    setSelectedGroupIds,
    setSelectedIframeLayerIds,
    handleSelectIframeLayer,
    chatTarget,
  })

  // Branch Actions controller (PRD #577, Module A): the Branch menu's
  // git / sandbox-lifecycle family — rebase, create PR, restart dev server,
  // restart sandbox, recreate — lifted into `useBranchActions`. The component's
  // menu handlers shrink to thin calls into these verbs; the conflict-risk
  // routing (ADR 0005) lives in the pure core (`lib/branch/actions`), and the
  // engine route applies Module B's `dispatchPrompt`.
  const branchActions = useBranchActions({
    agents,
    repos,
    chatSessions,
    roomId,
    chatTarget,
    addChatSession,
    updateChatSession,
    updateAgentInStorage,
    setBranchPr,
  })

  useEffect(() => {
    inspectHandlersRef.current = {
      branchRename: renameBranch,
      renameChat: tabPool.rename,
    }
  })

  // Chat history load, the streaming-heal hydration, and the `useChatStreamEvents`
  // broadcast handling are owned by the Chat Sync controller now (PRD #588),
  // called below once its `updateChatSession` dependency is in scope.

  // The frame-seed-on-provision effect (auto-seed + zoom-to once an agent's
  // sandbox finishes provisioning) lives on the Branch Intake controller now
  // (PRD #588), beside the eager seed it defers to.

  // Sandbox Reconnect controller (PRD #579, cut 2/4): the single home for all
  // mount-time Sandbox-lifecycle orchestration — the reconnect/recover-on-mount
  // recovery (over the pure `resolveReconnect`), the visibility-gated ~20-minute
  // keep-alive heartbeat, and the streaming-heal hydration. Lifted out of this
  // composition root so the recovery cascade — including the expired-snapshot →
  // Recreate rule (ADR 0005) — is testable as a pure decision.
  useSandboxReconnect({
    agents,
    repos,
    roomId,
    updateAgentInStorage,
  })

  // Chat Sync controller (PRD #588): the single owner of the chat-store ↔ Y.Doc
  // sync effects — history load, the streaming-heal hydration (moved off Sandbox
  // Reconnect), and the `useChatStreamEvents` broadcast handling that mirrors
  // streaming / rename signals into the Chat Session for late joiners.
  useChatSync({ chatSessions, roomId, updateChatSession })

  // Mount-time Sandbox recovery (reconnect) and the keep-alive heartbeat live in
  // `useSandboxReconnect`, called above; the streaming-heal hydration that used
  // to ride along there now lives on the Chat Sync owner.

  // Following another user's viewport, the manual follow-break, the Figma-style
  // wheel pan/zoom, and the forwarded-from-iframe wheel all live in the Canvas
  // Camera controller now (`camera.follow` / `camera.breakFollow` /
  // `camera.handleIframeWheel`, plus the wheel listener it attaches to
  // `canvasWrapperRef`).

  // The scroll-pin effect that keeps the canvas wrapper / transform wrapper from
  // drifting off-axis lives on the Canvas Camera controller now (PRD #588),
  // beside the viewport transform it guards.

  // Draw tools (Document / Frame) — the Tool Mode sibling that turns a released
  // draft into a new Layer. Owns the in-flight draft rects the SelectionOverlay
  // draws; the gesture seam shares its pointer stream with `drawTool`.
  const { drawTool, documentDraft, frameDraft } = useDrawTool({
    documentMode,
    frameMode,
    addDocumentLayer,
    addFrame,
    toolMode,
    setSelectedIframeLayerIds,
    setSelectedDocumentLayerIds,
    setEditingDocumentLayerId,
  })

  // Repopulate the gesture seam's inputs every render so its pointer handlers
  // read the latest geometry, mode flags, and Canvas Operations — the same
  // commit-time ref mirroring the old geometry refs used, lifted to one place.
  useEffect(() => {
    gestureInputsRef.current = {
      applyIntent: applyGestureIntent,
      getTransform: () => transformRef.current?.state ?? null,
      zoom,
      spaceHeld,
      focusedLayer: focusedIframeLayerId !== null,
      commentMode,
      documentMode,
      frameMode,
      reorderHandles,
      gapHandles,
      groups: routeGroups,
      memberLayouts: iframeLayerLayouts,
      marqueeLayouts: iframeLayerLayouts,
      markdownLayerIds: markdownLayerIdSet,
      baseIframeLayerIds: selectedIframeLayerIds,
      baseDocumentLayerIds: selectedDocumentLayerIds,
      selectedGroupIds,
      drawTool,
      getWrapper: () => canvasWrapperRef.current,
      getMoveAssembly: buildMoveAssembly,
      getIframeLayerSize: (id) => {
        const a = collections.iframeLayers.get(id)
        return a ? { width: a.width, height: a.height } : null
      },
      markFrameDirty: (id) => captureTracker.markDirty(id),
      clearLayerHover: () => setHoveredIframeLayerId(null),
    }
  })

  // Click on iframeLayer to select. Clicking a child frame whose parent group is
  // currently selected pierces — the click moves selection to the child. To
  // keep group drag working, callers must skip selection on pointerdown when
  // the group is selected (see IframeLayer.onPointerDownCapture).
  //
  // Shift-click extends the selection and supports a *mixed* set of frames,
  // documents, and whole groups. Two rules keep group/child selection from
  // overlapping (a member is only ever represented once):
  //   - A frame whose parent group is already selected can't be added on its
  //     own — the group owns it. We no-op rather than splitting the group.
  //   - Selecting a group (below) drops any of its members that were
  //     individually selected, so the group supersedes its children.
  // The shift-toggle / parent-group guard / member-drop rules all live on the
  // Canvas Selection controller now; these are thin aliases the render tree and
  // sidebar keep calling.
  const handleIframeLayerSelect = selection.selectIframeLayer
  const handleGroupSelect = selection.selectGroup
  const handleDocumentLayerSelect = selection.selectDocumentLayer

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const ref = transformRef.current
      if (!ref) return
      const { positionX, positionY, scale } = ref.state
      // Use coordinates relative to the canvas wrapper (currentTarget),
      // not the viewport, so cursor positions work regardless of sidebar width
      const rect = e.currentTarget.getBoundingClientRect()
      const relX = e.clientX - rect.left
      const relY = e.clientY - rect.top
      const canvasX = (relX - positionX) / scale
      const canvasY = (relY - positionY) / scale
      setPresence({ pointer: { x: canvasX, y: canvasY } })

      // Hit-test for hover highlight. Suppressed while a reorder or layer
      // drag is active so the dragged iframeLayer sweeping over its siblings
      // doesn't paint a hover outline on each one in turn. (The gap-handle and
      // reorder-dot hover tracking lives in the gesture controller's
      // `onPointerMove` alongside the state it drives.)
      let hovered: string | null = null
      if (getGestureState().kind !== "reorder" && !isLayerDragging()) {
        for (const layout of iframeLayerLayouts.values()) {
          if (
            canvasX >= layout.x &&
            canvasX <= layout.x + layout.width &&
            canvasY >= layout.y &&
            canvasY <= layout.y + layout.height
          ) {
            hovered = layout.id
            break
          }
        }
      }
      setHoveredIframeLayerId(hovered)
    },
    [
      setPresence,
      iframeLayerLayouts,
      isLayerDragging,
      getGestureState,
      setHoveredIframeLayerId,
    ]
  )

  const handlePointerLeave = useCallback(() => {
    setPresence({ pointer: null })
    setHoveredIframeLayerId(null)
    resetHandleHover()
  }, [setPresence, resetHandleHover, setHoveredIframeLayerId])

  // Comment-mode canvas click: convert the screen point to canvas (world)
  // coordinates — the camera concern that stays in the component — and hand it
  // to the Element Reference controller, which owns the hit-test + composer
  // placement.
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (!commentMode) return
      const ref = transformRef.current
      if (!ref) return
      const { positionX, positionY, scale } = ref.state
      const rect = e.currentTarget.getBoundingClientRect()
      const canvasX = (e.clientX - rect.left - positionX) / scale
      const canvasY = (e.clientY - rect.top - positionY) / scale
      reference.place(canvasX, canvasY)
    },
    [commentMode, reference]
  )

  // Element targeting (PRD #616, slice #618): the Canvas is the sole fulfiller
  // of composer pick requests. A request arms a one-shot crosshair pick
  // restricted to the requesting branch's own frames (via `eligibleTargetFrames`)
  // and reuses the same `elementAtPoint` hit-test the comment path does; the
  // next canvas click resolves it with the picked element, and Esc / a miss
  // cancels it with `null`. State drives the cursor + click routing; the ref
  // lets the async resolver and the Esc listener read the live request without
  // re-binding.
  const [targetPick, setTargetPick] = useState<PickRequest | null>(null)
  const targetPickRef = useRef<PickRequest | null>(null)
  const setTargetPickBoth = useCallback((req: PickRequest | null) => {
    targetPickRef.current = req
    setTargetPick(req)
  }, [])

  // Publish which branches currently have an eligible (open) frame so each
  // branch's Composer can disable its target affordance when picking would have
  // nothing to hit (#619). A branch is targetable exactly when some frame on the
  // canvas is assigned to it — the same `branchId` match `eligibleTargetFrames`
  // makes. Cleared on unmount so a stale set doesn't outlive the Room.
  const eligibleTargetBranchIds = useMemo(() => {
    const ids = new Set<string>()
    for (const layer of iframeLayers) {
      if (layer.branchId) ids.add(layer.branchId)
    }
    return ids
  }, [iframeLayers])
  useEffect(() => {
    targetingStore.publishEligibleBranches(eligibleTargetBranchIds)
  }, [eligibleTargetBranchIds])
  useEffect(() => {
    return () => targetingStore.publishEligibleBranches(new Set())
  }, [])

  // During a pick, dim every frame that isn't eligible for the requesting branch
  // so it's visually clear what can be targeted; the eligible frames stay at full
  // opacity and are the only ones the hit-test (below) resolves against. Empty
  // (no dimming) whenever no pick is armed.
  const dimmedIframeLayerIds = useMemo(() => {
    if (!targetPick) return EMPTY_DIMMED_IDS
    const eligible = new Set(
      eligibleTargetFrames(targetPick.branchId, iframeLayers).map((l) => l.id)
    )
    const dimmed = new Set<string>()
    for (const layer of iframeLayers) {
      if (!eligible.has(layer.id)) dimmed.add(layer.id)
    }
    return dimmed
  }, [targetPick, iframeLayers])

  useEffect(() => {
    const unregister = targetingStore.register((request) => {
      // A second request supersedes an unfinished one — cancel the stale pick.
      const prev = targetPickRef.current
      if (prev) prev.resolve(null)
      setTargetPickBoth(request)
    })
    return () => {
      unregister()
      // Resolve any in-flight pick on unmount so its promise never dangles.
      const prev = targetPickRef.current
      if (prev) prev.resolve(null)
      targetPickRef.current = null
    }
  }, [setTargetPickBoth])

  const resolveTargetPick = useCallback(
    (picked: PickedElement | null) => {
      const active = targetPickRef.current
      if (!active) return
      active.resolve(picked)
      setTargetPickBoth(null)
    },
    [setTargetPickBoth]
  )

  // Esc cancels an armed pick with no token. Capture-phase so it wins over the
  // canvas keyboard controller's own Escape precedence while a pick is open.
  useEffect(() => {
    if (!targetPick) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopPropagation()
      resolveTargetPick(null)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [targetPick, resolveTargetPick])

  // Element highlight (PRD #616, slice #620): outline the element a hovered
  // composer / message token references. We resolve the selector to a rect via
  // the referenced frame's bridge and draw it on the SelectionOverlay — the same
  // canvas that draws the pick/inspect rect — so the outline keeps a constant
  // 1px stroke at any zoom. (The earlier in-iframe box scaled with the frame, so
  // its border thickened/thinned as you zoomed.) A closed frame or a stale
  // selector resolves to nothing and the highlight simply clears; a newer hover
  // supersedes any in-flight resolve via the seq guard.
  const [highlightRect, setHighlightRect] = useState<{
    iframeLayerId: string
    rect: DomRect
  } | null>(null)
  const highlightSeqRef = useRef(0)
  useEffect(() => {
    let active = true
    const unregister = targetingStore.registerHighlight((target) => {
      const seq = ++highlightSeqRef.current
      const dom = target
        ? reference.getIframeLayerDom(target.iframeLayerId)
        : undefined
      if (!target || !dom) {
        setHighlightRect(null)
        return
      }
      dom
        .getRectsForSelectors([target.selector])
        .then(([rect]) => {
          // Drop a resolve superseded by a newer hover or a torn-down effect.
          if (!active || seq !== highlightSeqRef.current) return
          setHighlightRect(
            rect ? { iframeLayerId: target.iframeLayerId, rect } : null
          )
        })
        .catch(() => {
          if (active && seq === highlightSeqRef.current) setHighlightRect(null)
        })
    })
    return () => {
      active = false
      unregister()
      setHighlightRect(null)
    }
  }, [reference])

  // Targeting-mode canvas click: convert to world coords (same camera math as
  // the comment path), hit-test only the requesting branch's eligible frames,
  // then resolve the pick with the deepest element at that point. A click that
  // lands outside every eligible frame cancels.
  const handleTargetClick = useCallback(
    (e: React.MouseEvent) => {
      const active = targetPickRef.current
      if (!active) return
      const tref = transformRef.current
      if (!tref) {
        resolveTargetPick(null)
        return
      }
      const { positionX, positionY, scale } = tref.state
      const rect = e.currentTarget.getBoundingClientRect()
      const canvasX = (e.clientX - rect.left - positionX) / scale
      const canvasY = (e.clientY - rect.top - positionY) / scale

      const eligible = eligibleTargetFrames(active.branchId, iframeLayers)
      const eligibleIds = new Set(eligible.map((l) => l.id))

      for (const layout of iframeLayerLayouts.values()) {
        if (!eligibleIds.has(layout.id)) continue
        if (
          canvasX >= layout.x &&
          canvasX <= layout.x + layout.width &&
          canvasY >= layout.y &&
          canvasY <= layout.y + layout.height
        ) {
          const localX = canvasX - layout.x
          const localY = canvasY - layout.y
          const dom = reference.getIframeLayerDom(layout.id)
          const layer = eligible.find((l) => l.id === layout.id)
          if (!dom || !layer) {
            resolveTargetPick(null)
            return
          }
          // End pick mode immediately; the elementAtPoint round-trip is async and
          // resolves the (already-captured) request directly below.
          setTargetPickBoth(null)
          dom
            .elementAtPoint(localX, localY)
            .then((result) => {
              if (!result || !result.tagName) {
                active.resolve(null)
                return
              }
              active.resolve({
                tagName: result.tagName,
                id: result.id,
                selector: result.selector,
                route: layer.route ?? "/",
                iframeLayerId: layout.id,
                frameLabel: layer.label,
              })
            })
            .catch(() => active.resolve(null))
          return
        }
      }
      // Miss — clicked outside every eligible frame.
      resolveTargetPick(null)
    },
    [
      iframeLayers,
      iframeLayerLayouts,
      reference,
      resolveTargetPick,
      setTargetPickBoth,
    ]
  )

  // The selection → presence broadcast lives on the Canvas Camera controller now
  // (PRD #588) — the canvas presence owner.

  // Collect other users' selections for the overlay, plus the per-layer color
  // of the remote user who has each id selected (used to tint that frame/doc
  // name and group label to match the remote selection rect).
  // `remoteSelectionColors` covers directly-selected *and* group-member ids
  // (both get a tinted name); `remoteGroupSelectionColors` covers only group
  // members (drives the group label). First writer wins if two users overlap.
  //
  // Memoized on `others` so a pan — which rebroadcasts our own viewport ~60x/s
  // but leaves the peer set untouched (see `useOtherPresences`) — doesn't
  // rebuild these and re-render the memoized member layer every frame.
  const {
    othersSelections,
    remoteSelectionColors,
    remoteGroupSelectionColors,
  } = useMemo(() => {
    const othersSelections = others.map(({ presence }) => ({
      selectedIframeLayerIds: presence.selectedIframeLayerIds ?? [],
      groupSelectedIframeLayerIds: presence.groupSelectedIframeLayerIds ?? [],
      color: presence.color,
      name: presence.identity.name || "Anonymous",
    }))
    const remoteSelectionColors = new Map<string, string>()
    const remoteGroupSelectionColors = new Map<string, string>()
    for (const o of othersSelections) {
      for (const id of o.selectedIframeLayerIds) {
        if (!remoteSelectionColors.has(id))
          remoteSelectionColors.set(id, o.color)
      }
      for (const id of o.groupSelectedIframeLayerIds) {
        if (!remoteSelectionColors.has(id))
          remoteSelectionColors.set(id, o.color)
        if (!remoteGroupSelectionColors.has(id))
          remoteGroupSelectionColors.set(id, o.color)
      }
    }
    return {
      othersSelections,
      remoteSelectionColors,
      remoteGroupSelectionColors,
    }
  }, [others])

  const [chatCollapsed, setChatCollapsed] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  // Desktop + non-fullscreen: the macOS traffic lights overlay the top-left,
  // so the collapsed-sidebar pills must shift right to clear them.
  const trafficLightsPresent = useTrafficLightsPresent()

  // Expand the collapsed chat panel when the logs stream actually starts,
  // so the panel opens as the user sees live install/boot output — not
  // earlier (when the sandbox doesn't exist yet and the stream would just
  // show "Connecting…").
  const handleLogsReady = useCallback(() => {
    const panel = chatPanelRef.current
    if (panel?.isCollapsed()) {
      panel.expand()
      const { inPixels } = panel.getSize()
      if (inPixels < 480) panel.resize(480)
    }
  }, [])
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const onLayoutChanged = useCallback((layout: PanelLayout) => {
    writePanelLayout("canvas-layout", layout)
  }, [])

  return (
    <>
      {chatTarget.pendingProbes.map(({ agentId, sandboxName }) => (
        <LogProbe
          key={agentId}
          sandboxName={sandboxName}
          onReady={() => chatTarget.handlePendingReady(agentId)}
        />
      ))}
      <ResizablePanelGroup
        orientation="horizontal"
        className="fixed inset-0 bg-muted/30"
        defaultLayout={initialLayout}
        onLayoutChanged={onLayoutChanged}
      >
        {/* Sidebar */}
        <ResizablePanel
          id="sidebar"
          defaultSize="240px"
          minSize="180px"
          maxSize="480px"
          collapsible
          collapsedSize="0px"
          groupResizeBehavior="preserve-pixel-size"
          panelRef={sidebarPanelRef}
          onResize={(size, _id, prev) => {
            setSidebarCollapsed(size.inPixels === 0)
            if (prev) {
              const delta = size.inPixels - prev.inPixels
              if (delta !== 0) {
                const ref = transformRef.current
                if (ref) {
                  const { positionX, positionY, scale } = ref.state
                  ref.setTransform(positionX - delta, positionY, scale, 0)
                }
              }
            }
          }}
        >
          <RoomSidebar
            repos={repos}
            branches={agents}
            iframeLayers={iframeLayers}
            markdownLayers={markdownLayers}
            iframeLayerGroups={sortedIframeLayerGroups}
            selectedIframeLayerIds={selectedIframeLayerIds}
            selectedGroupIds={selectedGroupIds}
            selectedDocumentLayerIds={selectedDocumentLayerIds}
            onSelectGroup={handleGroupSelect}
            onZoomToGroup={handleZoomToGroup}
            onSelectDocument={handleDocumentLayerSelect}
            onZoomToDocument={handleZoomToDocument}
            onRenameDocument={layerMutations.setTitle}
            onRemoveDocument={(id) => removeDocumentLayers([id])}
            onSelectBranch={handleSelectAgent}
            onCreateRepo={createRepo}
            onUpdateRepo={updateRepoInStorage}
            onRemoveRepo={removeRepoIntake}
            onCreateBranchFromGitBranch={createBranchFromGitBranch}
            onCreateWorkspace={createBranch}
            onRebaseOnDefault={branchActions.rebaseOnDefault}
            onRestartDevServer={branchActions.restartDevServer}
            onCreatePr={branchActions.createPullRequest}
            onRefreshBranch={branchActions.restartSandbox}
            onRecreateBranch={branchActions.recreate}
            onRemoveBranch={removeBranchIntake}
            onAddIframeLayer={handleAddIframeLayerForAgent}
            onPlayBranch={handlePlayAgent}
            onShowRoutes={handleShowRoutesForAgent}
            onUpdateBranch={updateAgentInStorage}
            onRenameBranch={renameBranch}
            onSelectIframeLayer={handleIframeLayerSelect}
            onZoomToIframeLayer={handleSelectIframeLayer}
            onRenameIframeLayer={layerMutations.rename}
            onRemoveIframeLayer={removeIframeLayer}
            onReorderIframeLayerGroups={reorderIframeLayerGroups}
            onReorderRepos={ops.reorderRepos}
            onReorderBranches={ops.reorderBranches}
            onMoveMember={moveMember}
            onRenameIframeLayerGroup={renameIframeLayerGroup}
            onRemoveIframeLayerGroup={removeIframeLayerGroup}
            onCollapseSidebar={() => sidebarPanelRef.current?.collapse()}
            activeBranchIds={
              new Set(
                agents
                  .filter((a) => isBranchBusy(a.id, chatSessions))
                  .map((a) => a.id)
              )
            }
            chatPanelBranchId={
              chatCollapsed ? null : chatTarget.selectedAgentId
            }
            branchPrs={branchPrs}
          />
        </ResizablePanel>
        <ResizableHandle className="focus-visible:ring-0" />

        {/* Canvas */}
        {/* react-resizable-panels wraps each panel's children in a div with
            `overflow: auto` + `max-width/height: 100%`. The canvas fills that
            wrapper exactly (`h-full w-full`), so sub-pixel width rounding mid
            drag-resize momentarily overflows it and flashes a scrollbar — which
            steals vertical space and shoves the bottom toolbar (absolutely
            pinned to `bottom-0`) up and down. The panel never needs to scroll —
            the transformed world is clipped — so pin it to `overflow: hidden`.
            Inline style (not a className) is required: the library sets
            `overflow: auto` inline, which wins over any class. */}
        <ResizablePanel id="canvas" style={{ overflow: "hidden" }}>
          <div
            className="relative h-full w-full"
            data-canvas-wrapper
            ref={canvasWrapperRef}
            style={{
              clipPath: "inset(0)",
              cursor: isDragPanning
                ? "grabbing"
                : spaceHeld
                  ? "grab"
                  : documentMode || frameMode || commentMode || targetPick
                    ? "crosshair"
                    : activeGapHandle
                      ? "col-resize"
                      : gesturePreview.reorder
                        ? "grabbing"
                        : hoveredReorderIframeLayerId
                          ? "grab"
                          : undefined,
            }}
            onPointerDownCapture={canvasGestureHandlers.onPointerDownCapture}
            onPointerDown={canvasGestureHandlers.onPointerDown}
            onPointerMove={(e) => {
              handlePointerMove(e)
              canvasGestureHandlers.onPointerMove(e)
            }}
            onPointerUp={canvasGestureHandlers.onPointerUp}
            onPointerLeave={handlePointerLeave}
            onClick={
              commentMode
                ? handleCanvasClick
                : targetPick
                  ? handleTargetClick
                  : undefined
            }
          >
            {/* Device-snap ghosts render BEFORE TransformWrapper in DOM order
                so the iframeLayer iframes paint on top — the parts of each ghost
                that extend past the active iframeLayer remain visible. Same
                screen-space canvas approach as SelectionOverlay so the 1px
                outlines stay crisp at any zoom. */}
            <ResizeSnapUnderlay
              zoom={zoom}
              viewportPos={viewportPos}
              iframeLayerRect={(() => {
                const resizeSnap = gesturePreview.resizeSnap
                if (!resizeSnap) return null
                const layout = effectiveIframeLayerLayouts.get(
                  resizeSnap.iframeLayerId
                )
                if (!layout) return null
                return {
                  x: layout.x,
                  y: layout.y,
                  width: layout.width,
                  height: layout.height,
                }
              })()}
              anchor={gesturePreview.resizeSnap?.anchor ?? "tl"}
              candidates={gesturePreview.resizeSnap?.candidates ?? []}
              snappedPresetId={
                gesturePreview.resizeSnap?.snappedPresetId ?? null
              }
            />

            <GroupMergeUnderlay
              zoom={zoom}
              viewportPos={viewportPos}
              rects={gesturePreview.mergeRects}
            />

            {/* "+ frame" placeholder outlines. Underlay so the slot reads as
                a backdrop hint rather than overlay chrome — selection rings
                and iframe content paint on top. */}
            <PlaceholderRectsUnderlay
              zoom={zoom}
              viewportPos={viewportPos}
              rects={placeholderRects}
            />

            <TransformWrapper
              ref={transformRef}
              {...camera.transformWrapperProps}
            >
              <TransformComponent
                wrapperStyle={{
                  width: "100%",
                  height: "100%",
                }}
                contentStyle={{
                  width: CANVAS_SIZE,
                  height: CANVAS_SIZE,
                }}
              >
                <div
                  className="relative"
                  style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}
                  // Hides frame labels mid-zoom (CSS in globals.css). They read
                  // the deferred `zoom` for their counter-scale, so they'd
                  // balloon/snap during a zoom — cheaper to hide than thread
                  // `isZooming` down through every layer.
                  data-zooming={isZooming || undefined}
                >
                  <CanvasMemberLayer
                    iframeLayerGroups={iframeLayerGroups}
                    iframeLayers={iframeLayers}
                    markdownLayers={markdownLayers}
                    selection={selection}
                    onIframeWheel={camera.handleIframeWheel}
                    reference={reference}
                    gesturePreview={gesturePreview}
                    gestureLayerHandlers={gestureLayerHandlers}
                    effectiveIframeLayerLayouts={effectiveIframeLayerLayouts}
                    iframeLayerLayouts={iframeLayerLayouts}
                    groupZIndex={groupZIndex}
                    groupDisplayNames={groupDisplayNames}
                    placeholderRects={placeholderRects}
                    placeholderTool={
                      frameMode ? "frame" : documentMode ? "document" : null
                    }
                    remoteSelectionColors={remoteSelectionColors}
                    remoteGroupSelectionColors={remoteGroupSelectionColors}
                    agentDomains={agentDomains}
                    agents={agents}
                    repos={repos}
                    zoom={zoom}
                    spaceHeld={spaceHeld}
                    commentMode={commentMode}
                    pickActive={!!targetPick}
                    dimmedIframeLayerIds={dimmedIframeLayerIds}
                    selfName={self?.identity.name || "Anonymous"}
                    selfColor={self?.color || "#888888"}
                    editingDocumentLayerId={editingDocumentLayerId}
                    setEditingDocumentLayerId={setEditingDocumentLayerId}
                    focusedIframeLayerId={focusedIframeLayerId}
                    setFocusedIframeLayerId={setFocusedIframeLayerId}
                    createFlowIframeLayerId={createFlowIframeLayerId}
                    setCreateFlowIframeLayerId={setCreateFlowIframeLayerId}
                    removeIframeLayer={removeIframeLayer}
                    handlePlayIframeLayer={handlePlayIframeLayer}
                    handleCaptureReadyChange={handleCaptureReadyChange}
                    handleCaptureDirty={handleCaptureDirty}
                    layerMutations={layerMutations}
                    groupActions={groupActions}
                  />
                </div>
              </TransformComponent>
            </TransformWrapper>

            {/* Comment pins live in their own screen-space layer above the
                  selection overlay so pins/popovers aren't painted over by it.
                  The transform mirrors what TransformComponent applies, so the
                  children still position in world coordinates. In the local
                  build there are no persisted threads (so no pins); this still
                  renders the composer that anchors an element/selection and
                  sends it to the agent (#417). */}
            <div
              className="pointer-events-none absolute inset-0 z-20"
              style={{
                transformOrigin: "0 0",
                transform: `translate(${viewportPos.x}px, ${viewportPos.y}px) scale(${zoom})`,
                // Hidden mid-zoom AND mid-pan: this transform reads the deferred
                // zoom/viewportPos, so it would lag the canvas and snap on settle.
                visibility: isCameraMoving ? "hidden" : undefined,
              }}
            >
              <Comments
                roomId={roomId}
                zoom={zoom}
                newCommentPos={reference.newCommentPos}
                onNewCommentPlaced={() => {
                  reference.clearComposer()
                  toolMode.set("select")
                }}
                onCancelComment={reference.clearComposer}
                iframeLayers={Array.from(iframeLayerLayouts.values())}
                getIframeLayerDom={reference.getIframeLayerDom}
                getDocumentEditor={reference.getDocumentEditor}
                documentEditorsVersion={reference.documentEditorsVersion}
                initialThreads={initialThreads}
                onSendToChat={reference.sendReference}
                activeThreadId={reference.activeThreadId}
                onActivateThread={reference.setActiveThread}
              />
            </div>

            {/* Portal target for floating frame toolbars. Lives above the
                  SelectionOverlay so the toolbar isn't painted over by hover
                  rings or resize handles. Children (rendered via createPortal
                  from iframe-layer) position themselves in canvas-wrapper
                  coords via a rAF loop. */}
            <div
              id="frame-toolbar-portal"
              className="pointer-events-none absolute inset-0 z-30"
            />

            {/* Portal target for the inline "Comment" bubble that appears
                  above text selections inside a document layer. Same reason
                  as the toolbar portal: the bubble lives inside the world
                  transform's stacking context, so an internal z-index can't
                  lift it above the SelectionOverlay sibling. Portaled out
                  and positioned via rAF from markdown-layer. */}
            <div
              id="inline-comment-bubble-portal"
              className="pointer-events-none absolute inset-0 z-30"
            />

            {/* `hidden` mid-zoom and mid-pan — it reads the deferred zoom/
                viewportPos, so it would lag the canvas and snap on settle.
                Passed as a prop (not a wrapper) because the canvas sizes itself
                from its parent. */}
            <SelectionOverlay
              hidden={isCameraMoving}
              zoom={zoom}
              viewportPos={viewportPos}
              selectedIframeLayerIds={overlaySelectedIds}
              groupSelectedIframeLayerIds={groupSelectedIframeLayerIds}
              focusedIframeLayerId={focusedIframeLayerId}
              hoveredIframeLayerId={hoveredIframeLayerId}
              iframeLayerLayouts={effectiveIframeLayerLayouts}
              hideResizeHandles={
                editingDocumentLayerId !== null || selectedGroupIds.size > 0
              }
              gapHandles={gapHandles}
              reorderHandles={reorderHandles}
              hoveredReorderIframeLayerId={hoveredReorderIframeLayerId}
              reorderDragShift={(() => {
                // While popped, `effectiveIframeLayerLayouts` already
                // places the dragged frame at `cursor - grab`, so no extra
                // shift is needed for the selection overlay (which reads
                // from that same map). Only the in-flow reorder case
                // needs a translation delta layered on top of the raw
                // flex slot.
                const reorderPreview = gesturePreview.reorder
                if (!reorderPreview || reorderPreview.popped) return null
                const layout = iframeLayerLayouts.get(reorderPreview.memberId)
                if (!layout) return null
                const grab = reorderPreview.grabOffset ?? {
                  x: layout.width / 2,
                  y: layout.height / 2,
                }
                return {
                  iframeLayerId: reorderPreview.memberId,
                  dx: reorderPreview.cursor.x - grab.x - layout.x,
                  dy: 0,
                }
              })()}
              marquee={gesturePreview.marqueeRect}
              frameDraft={frameDraft}
              documentDraft={documentDraft}
              othersSelections={othersSelections}
              snapGuides={gesturePreview.snapGuides}
              isResizeSnapped={
                gesturePreview.resizeSnap?.snappedPresetId != null
              }
              inspectRect={(() => {
                // Show the live hover overlay while in commentMode or during an
                // armed element pick, so the user can see what element they're
                // about to anchor a comment to / target.
                const source =
                  commentMode || targetPick ? reference.inspectHover : null
                if (!source) return null
                const layout = iframeLayerLayouts.get(source.iframeLayerId)
                if (!layout) return null
                return {
                  x: layout.x + source.rect.x,
                  y: layout.y + source.rect.y,
                  width: source.rect.width,
                  height: source.rect.height,
                }
              })()}
              highlightRect={(() => {
                // Token-hover outline, projected the same way as inspectRect so
                // it draws on the overlay canvas with a zoom-independent stroke.
                if (!highlightRect) return null
                const layout = iframeLayerLayouts.get(
                  highlightRect.iframeLayerId
                )
                if (!layout) return null
                return {
                  x: layout.x + highlightRect.rect.x,
                  y: layout.y + highlightRect.rect.y,
                  width: highlightRect.rect.width,
                  height: highlightRect.rect.height,
                }
              })()}
            />
            <Cursors viewport={{ ...viewportPos, zoom }} />
            {chatAnchor && self?.message != null ? (
              <CursorChat
                screenX={chatAnchor.x * zoom + viewportPos.x}
                screenY={chatAnchor.y * zoom + viewportPos.y}
                color={self.color}
                value={self.message}
                onChange={(next) => setPresence({ message: next })}
                onClose={closeCursorChat}
              />
            ) : null}
            {/* Window-drag strip: spans the full toolbar height across the top
                of the canvas, sitting BEHIND the floating pills (z-[9998]) so
                the pills stay clickable while the empty toolbar area drags the
                native window. */}
            <div
              data-tauri-drag-region
              className="absolute top-0 right-0 left-0 z-[9997] h-12"
            />
            <CanvasTopBar
              roomId={roomId}
              isOwner={isOwner}
              sharedWithCount={sharedWithCount}
              parentFolder={parentFolder}
              currentRoomName={currentRoomName}
              onRoomRename={handleRoomRename}
              sidebarCollapsed={sidebarCollapsed}
              trafficLightsPresent={trafficLightsPresent}
              sidebarPanelRef={sidebarPanelRef}
              roomNameEditableRef={roomNameEditableRef}
              pendingRoomRenameRef={pendingRoomRenameRef}
              onRoomMenuCloseAutoFocus={onRoomMenuCloseAutoFocus}
              deleteDialogOpen={deleteDialogOpen}
              onDeleteDialogOpenChange={setDeleteDialogOpen}
              stopRoomDevServers={stopRoomDevServers}
              flushLayout={flushLayout}
            />
            <CanvasToolbar
              toolMode={toolMode}
              onClearMode={reference.clearMode}
            />
            {/* Only render the top-right pill when it has content: the
                Share/Following controls (web only) or the expand-chat button
                (when the right sidebar is collapsed). On desktop with the chat
                open it would otherwise be an empty floating pill. */}
            {(!isLocalBuild || chatCollapsed) && (
              <div className="pointer-events-none absolute top-0 right-0 z-[9998] flex h-12 items-center px-2">
                <div
                  className="pointer-events-auto flex items-center gap-1 rounded-lg bg-background p-1 shadow-md outline outline-1 outline-foreground/5"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Following other users' viewports and sharing are part of
                    the multi-user surface, excluded from the local build
                    (PRD #404, issue #417). */}
                  {!isLocalBuild && (
                    <>
                      <FollowingToolbar
                        followingId={followingConnectionId}
                        onFollow={camera.follow}
                      />
                      <Button
                        size="sm"
                        onClick={() => setShareDialogOpen(true)}
                      >
                        Share
                      </Button>
                      <ShareRoomDialog
                        open={shareDialogOpen}
                        onOpenChange={setShareDialogOpen}
                        roomId={roomId}
                        roomName={currentRoomName}
                      />
                    </>
                  )}
                  {chatCollapsed && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => chatPanelRef.current?.expand()}
                          >
                            <PanelRightOpen className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          Expand chat <Kbd>⌘I</Kbd>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              </div>
            )}
          </div>
        </ResizablePanel>
        <ResizableHandle
          className={chatCollapsed ? "w-0 opacity-0" : "focus-visible:ring-0"}
          disabled={chatCollapsed}
        />

        {/* Chat — right panel */}
        <ResizablePanel
          id="chat"
          defaultSize="0px"
          minSize="420px"
          maxSize="900px"
          collapsible
          collapsedSize="0px"
          groupResizeBehavior="preserve-pixel-size"
          panelRef={chatPanelRef}
          onResize={(size) => setChatCollapsed(size.inPixels === 0)}
        >
          <ChatPanelHost
            chatTarget={chatTarget}
            tabPool={tabPool}
            agents={agents}
            markdownLayers={markdownLayers}
            chatSessions={chatSessions}
            localTerminals={terminalTabs.localTerminals}
            repos={repos}
            roomId={roomId}
            diffStats={diffStats}
            branchPrs={branchPrs}
            chatPanelRef={chatPanelRef}
            onRenameBranch={renameBranch}
            onUpdateChatSession={updateChatSession}
            onSetBranchPr={setBranchPr}
            onLogsReady={handleLogsReady}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </>
  )
}
