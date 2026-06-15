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
  useChatStreamEvents,
  useMarkdownLayers,
  useOtherPresences,
  useRoomCollections,
  useSavedViewport,
  useSelfPresence,
  useSetPresence,
  useRepos,
  useYjsHistory,
} from "@/lib/yjs/react"
import { reconcileInteractionMode } from "@/lib/canvas/interaction-mode"
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
import type {
  BranchData,
  IframeLayerGroupData,
  ChatSessionData,
  GroupMember,
  ViewportData,
  RepoData,
} from "@/lib/types"
import { chatStore } from "@/lib/chat-store"
import { isBranchBusy } from "@/lib/branch-busy"
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
import { useCanvasKeyboard } from "@/components/canvas/use-canvas-keyboard"
import { useLayerMutations } from "@/components/canvas/use-layer-mutations"
import { useToolMode } from "@/components/canvas/use-tool-mode"
import { useCanvasCamera } from "@/components/canvas/use-canvas-camera"
import { openExternal } from "@/lib/open-external"
import {
  DEFAULT_IFRAME_LAYER_WIDTH,
  DEFAULT_IFRAME_LAYER_HEIGHT,
  CANVAS_SIZE,
} from "@/lib/constants"
import {
  computeIframeLayerLayouts,
  deriveCanvasLayout,
  getGroupMembers,
  groupContentHeight,
  groupContentWidth,
  groupGap,
  placeNewIframeLayerGroup,
} from "@/lib/canvas/layout"
import type {
  GestureIntent,
  MoveAssemblyGroup,
  ReorderMemberSnapshot,
} from "@/lib/canvas/gesture"
import { type RouteGroup } from "@/lib/canvas/route"
import {
  useCanvasGesture,
  type CanvasDrawTool,
  type CanvasGestureInputs,
} from "./use-canvas-gesture"
import { ResizeSnapUnderlay } from "./resize-snap-underlay"
import { GroupMergeUnderlay } from "./group-merge-underlay"
import { PlaceholderRectsUnderlay } from "./placeholder-rects-underlay"
import { CanvasMemberLayer } from "./canvas-member-layer"
import { CanvasToolbar } from "./canvas-toolbar"
import { CanvasTopBar } from "./canvas-top-bar"
import { ChatPanelHost } from "./chat-panel-host"

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
  const [focusedIframeLayerId, setFocusedIframeLayerId] = useState<
    string | null
  >(null)
  // IframeLayer currently in Create Flow mode. Mutually exclusive with
  // `focusedIframeLayerId` — toggling one clears the other.
  const [createFlowIframeLayerId, setCreateFlowIframeLayerId] = useState<
    string | null
  >(null)
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
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [hoveredIframeLayerId, setHoveredIframeLayerId] = useState<
    string | null
  >(null)
  const [editingDocumentLayerId, setEditingDocumentLayerId] = useState<
    string | null
  >(null)
  const [documentDraft, setDocumentDraft] = useState<{
    startX: number
    startY: number
    currentX: number
    currentY: number
  } | null>(null)
  const documentDraftRef = useRef<{
    startX: number
    startY: number
    currentX: number
    currentY: number
  } | null>(null)
  const [frameDraft, setFrameDraft] = useState<{
    startX: number
    startY: number
    currentX: number
    currentY: number
  } | null>(null)
  const frameDraftRef = useRef<{
    startX: number
    startY: number
    currentX: number
    currentY: number
  } | null>(null)
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

  // Canvas Operation: set a group's inter-member gap. Applied by the Canvas
  // Gesture's `setGroupGap` intent on gap-resize release. Defined up here so the
  // gesture hook (which forwards intents to it) can reference it.
  const setGroupGap = useCallback(
    (groupId: string, gap: number) => {
      ops.patch("iframeLayerGroups", groupId, { gap: Math.max(0, gap) })
    },
    [ops]
  )

  // Canvas Operation: translate every group referenced by `ids` by (dx, dy).
  // Applied by the Canvas Gesture's `moveBy` intent on each move. Defined up
  // here so the gesture hook (which forwards intents to it) can reference it.
  const moveIframeLayersByDelta = useCallback(
    (ids: readonly string[], dx: number, dy: number) => {
      const idSet = new Set(ids)
      ops.batch(() => {
        for (const g of collections.iframeLayerGroups.toArray()) {
          if (getGroupMembers(g).some((m) => idSet.has(m.id))) {
            ops.patch("iframeLayerGroups", g.id, { x: g.x + dx, y: g.y + dy })
          }
        }
      })
    },
    [collections, ops]
  )

  // Canvas Operation: apply one device-resize step. Resizes the layer to the
  // gesture's snapped size and shifts the parent group so the un-dragged edge
  // stays pinned (the shift is non-zero only for left/top edge drags). Applied
  // from the Canvas Gesture's `resizeLayer` intent on every resize move — the
  // frame resizes live, as it did before the FSM port. Defined up here so the
  // gesture hook can reference it.
  const resizeLayer = useCallback(
    (
      iframeLayerId: string,
      width: number,
      height: number,
      shiftX: number,
      shiftY: number
    ) => {
      ops.batch(() => {
        if (shiftX !== 0 || shiftY !== 0) {
          for (const g of collections.iframeLayerGroups.toArray()) {
            if (getGroupMembers(g).some((m) => m.id === iframeLayerId)) {
              ops.patch("iframeLayerGroups", g.id, {
                x: g.x + shiftX,
                y: g.y + shiftY,
              })
              break
            }
          }
        }
        ops.patch("iframeLayers", iframeLayerId, { width, height })
      })
    },
    [collections, ops]
  )

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

  // Canvas Camera controller (PRD #567): owns the react-zoom-pan-pinch
  // transform, the zoom / viewport mirrors, persistence, presence broadcast,
  // follow, and the wheel pan/zoom. The locals below alias its values so the
  // rest of the component reads `zoom` / `viewportPos` / `transformRef` as
  // before.
  const camera = useCanvasCamera({
    transformRef,
    canvasWrapperRef,
    setPresence,
    saveViewport,
    savedViewport,
    others,
    focusedIframeLayerId,
    createFlowIframeLayerId,
    editingDocumentLayerId,
    spaceHeld,
  })
  const zoom = camera.zoom
  const viewportPos = camera.viewportPos
  const isPanning = camera.isPanning
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

  // Publish identity + a stable color into awareness on mount and whenever the
  // session changes. Seed a placeholder viewport so `useSelfPresence` returns
  // non-null before TransformWrapper's `onInit` fires (otherwise the self
  // avatar is missing from the pile until the first transform state ticks in).
  const colorRef = useRef<string>("")
  useEffect(() => {
    if (!session?.user) return
    if (!colorRef.current) {
      const palette = [
        "#E57373",
        "#64B5F6",
        "#81C784",
        "#FFB74D",
        "#BA68C8",
        "#4DD0E1",
        "#FF8A65",
        "#A1887F",
      ]
      colorRef.current = palette[Math.floor(Math.random() * palette.length)]
    }
    setPresence({
      identity: {
        id: session.user.id,
        name: session.user.name || "Anonymous",
        avatar: session.user.image ?? undefined,
      },
      color: colorRef.current,
      viewport: { x: 0, y: 0, zoom: 1 },
    })
  }, [session, setPresence])

  // Figma-style cursor chat. `chatAnchor` snapshots the canvas-space pointer
  // position at the moment '/' is pressed so the bubble stays put while the
  // user types instead of jittering with every micro-mouse-move. Live message
  // text lives in awareness so peers see each keystroke (`presence.message`).
  const [chatAnchor, setChatAnchor] = useState<{ x: number; y: number } | null>(
    null
  )
  const selfPointerRef = useRef<{ x: number; y: number } | null>(null)
  const selfMessageRef = useRef<string | null>(null)
  const closeCursorChat = useCallback(() => {
    setChatAnchor(null)
    setPresence({ message: null })
  }, [setPresence])
  const openCursorChat = useCallback(() => {
    const ptr = selfPointerRef.current
    if (!ptr) return
    setChatAnchor(ptr)
    setPresence({ message: "" })
  }, [setPresence])

  // Refs so keyboard handler stays current without re-binding. The selection
  // and Tool Mode mirror refs now live inside their controllers (read via
  // `selection.current()` / `toolMode.current()`); only the cursor-chat and
  // inline-edit refs remain the component's own.
  const editingDocumentLayerIdRef = useRef(editingDocumentLayerId)

  // Keep the above "latest value" refs current — written after commit (not
  // during render) so the long-lived keyboard/pointer handlers below can read
  // them without re-binding on every render.
  useEffect(() => {
    selfPointerRef.current = self?.pointer ?? null
    selfMessageRef.current = self?.message ?? null
    editingDocumentLayerIdRef.current = editingDocumentLayerId
  })

  // Canvas Keyboard controller (PRD #579, cut 4/4): owns the global
  // keydown/keyup listeners and the whole shortcut map, dispatching into the
  // bundled controllers (Tool Mode, Selection, Element Reference, Yjs history),
  // the panel refs, the cursor-chat verbs, and the focus / Create-Flow setters.
  // The Escape precedence stays in the pure `resolveEscapeAction`; the
  // controller only applies the chosen exit.
  useCanvasKeyboard({
    toolMode,
    selection,
    reference,
    history,
    focusedIframeLayerId,
    setFocusedIframeLayerId,
    createFlowIframeLayerId,
    setCreateFlowIframeLayerId,
    editingDocumentLayerIdRef,
    setEditingDocumentLayerId,
    cursorChatMessageRef: selfMessageRef,
    openCursorChat,
    closeCursorChat,
    sidebarPanelRef,
    chatPanelRef,
    setSpaceHeld,
  })

  // Prune capture bookkeeping for frames removed from the canvas so a deleted
  // frame's stale dirty flag never lands in a POSTed subset (#474).
  useEffect(() => {
    captureTracker.retain(new Set(iframeLayers.map((layer) => layer.id)))
  }, [captureTracker, iframeLayers])
  // Drop out of Focus or Create Flow mode the instant the frame it targets is
  // gone OR deselected, so the canvas pans/zooms/scrolls again with no Escape
  // needed. We reconcile against the live layer set and the current selection
  // rather than patching each delete/deselect call-site, so every exit path is
  // covered at once — single-frame remove, keyboard Delete/Backspace,
  // Group-cascade delete, a remote collaborator deleting the frame out from
  // under us, and the user clicking away to deselect the frame. Writes back only
  // when an id actually changed, so unrelated layer edits don't churn state or
  // fight the Escape handler.
  useEffect(() => {
    const existingLayerIds = new Set(iframeLayers.map((layer) => layer.id))
    const next = reconcileInteractionMode({
      focusedId: focusedIframeLayerId,
      createFlowId: createFlowIframeLayerId,
      existingLayerIds,
      selectedLayerIds: selectedIframeLayerIds,
    })
    if (next.focusedId !== focusedIframeLayerId) {
      // Syncing mode state down from the external Y.Doc layer set; the guard
      // above keeps this from looping.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFocusedIframeLayerId(next.focusedId)
    }
    if (next.createFlowId !== createFlowIframeLayerId) {
      setCreateFlowIframeLayerId(next.createFlowId)
    }
  }, [
    iframeLayers,
    focusedIframeLayerId,
    createFlowIframeLayerId,
    selectedIframeLayerIds,
  ])
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

  // Apply an emitted Gesture Intent: canvas-mutating intents through the Canvas
  // Operations, selection-only ones (`marqueeSelect` / `selectMember`) through
  // local selection state. The gesture itself never touches the Y.Doc.
  const applyGestureIntent = useCallback(
    (intent: GestureIntent) => {
      switch (intent.type) {
        case "setGroupGap":
          setGroupGap(intent.groupId, intent.gap)
          break
        case "moveBy":
          moveIframeLayersByDelta(intent.memberIds, intent.dx, intent.dy)
          break
        case "mergeGroups": {
          // The target absorbs the source — its world (x, y) stays put, so the
          // merged row stays where the user dropped onto. Read the source's
          // members before the merge so selection can follow the dragged layers.
          const source = collections.iframeLayerGroups.get(intent.sourceId)
          const target = collections.iframeLayerGroups.get(intent.targetId)
          if (!source || !target || source.id === target.id) break
          const sourceMembers = getGroupMembers(source)
          if (sourceMembers.length === 0) break
          ops.mergeGroups(source.id, target.id)
          // Keep the dragged layers selected rather than the merged target group.
          // The source group is gone, so map its former members to individual
          // iframe/document selections.
          const draggedIframeIds = new Set<string>()
          const draggedDocumentIds = new Set<string>()
          for (const m of sourceMembers) {
            if (m.kind === "iframe-layer") draggedIframeIds.add(m.id)
            else if (m.kind === "markdown-layer") draggedDocumentIds.add(m.id)
          }
          setSelectedGroupIds(new Set())
          setSelectedIframeLayerIds(draggedIframeIds)
          setSelectedDocumentLayerIds(draggedDocumentIds)
          break
        }
        case "reorderMember":
          // In-flow reorder commits live: each tick the cursor crosses a sibling
          // center, the gesture emits the new ordering and we write it.
          ops.patch("iframeLayerGroups", intent.groupId, {
            members: intent.members,
          })
          break
        case "popOutToNewGroup": {
          // Meta held at release → split the popped Member into a fresh Group
          // anchored where it was floating; select it like the old inline path.
          // Skip if the underlying layer vanished mid-drag so we never select a
          // group that `splitToNewGroup` declined to create.
          const exists =
            collections.iframeLayers.get(intent.memberId) != null ||
            collections.markdownLayers.get(intent.memberId) != null
          if (!exists) break
          const newGroupId = ops.splitToNewGroup([intent.memberId], {
            x: intent.x,
            y: intent.y,
          })
          setSelectedGroupIds(new Set([newGroupId]))
          break
        }
        case "selectMember":
          // Click-no-move from a Member's label falls through to plain
          // selection — the same selection interface the click path uses.
          selection.selectMember(intent.memberId, intent.kind, intent.additive)
          break
        // Selection-only intent: applied to local selection state, never the
        // Y.Doc. A marquee never selects groups, so the interface clears them.
        case "marqueeSelect":
          selection.applyMarquee(intent.iframeLayerIds, intent.documentLayerIds)
          break
        case "resizeLayer":
          resizeLayer(
            intent.iframeLayerId,
            intent.width,
            intent.height,
            intent.shiftX,
            intent.shiftY
          )
          break
      }
    },
    [
      collections,
      ops,
      selection,
      setGroupGap,
      moveIframeLayersByDelta,
      resizeLayer,
      setSelectedGroupIds,
      setSelectedIframeLayerIds,
      setSelectedDocumentLayerIds,
    ]
  )

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

  // --- Repo mutations ---

  const addRepoToStorage = useCallback(
    (id: string, data: RepoData) => {
      ops.createRepo(id, data)
    },
    [ops]
  )

  const updateRepoInStorage = useCallback(
    (id: string, data: Partial<RepoData>) => {
      ops.patch("repos", id, data)
    },
    [ops]
  )

  const removeRepoFromStorage = useCallback(
    (id: string) => {
      const { removedChatIds } = ops.removeRepo(id)
      // Clear the client chat-store mirror for the Chat Sessions the verb
      // deleted from the Y.Doc (their identity is gone; the conversation lives
      // client-side).
      for (const chatId of removedChatIds) chatStore.cleanup(chatId)
    },
    [ops]
  )

  // --- IframeLayer mutations ---

  /** Add an iframeLayer — used by the manual "add screen" button. Always creates a fresh group. */
  const addIframeLayer = useCallback(
    (agentId: string, label: string): string | undefined => {
      const agent = collections.branches.get(agentId)
      if (!agent || agent.status !== "running") return
      const { cx, cy } = getViewportCenter()
      return ops.createFrameForAgent(agentId, { x: cx, y: cy }, label).layerId
    },
    [collections, getViewportCenter, ops]
  )

  /** Add an empty frame not associated with any agent/branch/route. Creates a new single-iframeLayer group. */
  const addFrame = useCallback(
    (x: number, y: number, width: number, height: number): string => {
      return ops.createBlankFrame({ x, y }, { width, height })
    },
    [ops]
  )

  /**
   * Create a new group for an agent containing one iframeLayer per discovered
   * route. The group is positioned to the right of all existing groups,
   * top-aligned with the topmost. Returns the new group's id and the id of
   * its first iframeLayer (handy for zooming after the DOM updates).
   */
  const addRoutesGroupForAgent = useCallback(
    (
      agentId: string,
      routes: { route: string; label: string }[]
    ): { groupId: string; firstIframeLayerId: string } | undefined => {
      const { cx, cy } = getViewportCenter()
      const result = ops.createFramesForRoutes(agentId, routes, {
        x: cx,
        y: cy,
      })
      if (!result) return
      return {
        groupId: result.groupId,
        firstIframeLayerId: result.firstLayerId,
      }
    },
    [getViewportCenter, ops]
  )

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

  // Use a ref so the route handler (passed as a stable callback to many
  // places) sees the latest Create Flow selection without forcing every
  // consumer to re-bind on toggle.
  const createFlowIframeLayerIdRef = useRef<string | null>(null)
  useEffect(() => {
    createFlowIframeLayerIdRef.current = createFlowIframeLayerId
  })

  // Layer Mutation controller (PRD #579, cut 1/4): the thin per-Layer Canvas
  // Operation wrappers — Iframe Layer field writers (rename / assignAgent /
  // updateState / updateScroll / updateKnobs / updateKnobValues /
  // updateSharedState / updateRoute / fitToContent), Markdown Layer writers
  // (resizeDocument / setTitle / setTitleCache), and addIframeLayerToGroup —
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

  /** Reorder groups in the sidebar Frames list. */
  const reorderIframeLayerGroups = useCallback(
    (orderedIds: string[]) => {
      ops.batch(() => {
        orderedIds.forEach((id, index) => {
          ops.patch("iframeLayerGroups", id, { sidebarOrder: index })
        })
      })
    },
    [ops]
  )

  /**
   * Move a single member across groups (Figma-style sidebar drag). Handles
   * three cases in one transaction so undo is atomic:
   *  - drop into an existing group at a specific index
   *  - drop into the gap between groups → spawn a new single-member group
   *    placed near the viewport center, then renumber `sidebarOrder`
   *  - either case may leave the source group empty → delete it
   */
  const moveMember = useCallback(
    (
      member: GroupMember,
      target:
        | { kind: "into-group"; groupId: string; index: number }
        | { kind: "new-group"; sidebarIndex: number }
    ) => {
      const allGroups = collections.iframeLayerGroups.toArray()
      const sourceGroup = allGroups.find((g) =>
        getGroupMembers(g).some(
          (m) => m.kind === member.kind && m.id === member.id
        )
      )
      if (!sourceGroup) return

      if (target.kind === "into-group") {
        // Cross-group move or same-group reorder — the verb finds the source,
        // splices the member into the target at `index`, and prunes the source
        // if the move empties it.
        ops.moveLayerToGroup(member.id, target.groupId, target.index)
        return
      }

      // target.kind === "new-group" — split the member into a fresh group, then
      // renumber sidebar order so it slots in at the requested index. Placement
      // (canvas-space) is the caller's job; the verb owns the member move,
      // group creation/naming, and source pruning.
      const memberSize = (() => {
        if (member.kind === "iframe-layer") {
          const ab = collections.iframeLayers.get(member.id)
          return ab ? { width: ab.width, height: ab.height } : null
        }
        if (member.kind === "markdown-layer") {
          const d = collections.markdownLayers.get(member.id)
          return d ? { width: d.width, height: d.height } : null
        }
        return null
      })()
      if (!memberSize) return

      const sourceWillEmpty =
        getGroupMembers(sourceGroup).filter(
          (m) => !(m.kind === member.kind && m.id === member.id)
        ).length === 0
      const { cx, cy } = getViewportCenter()
      const groupsForPlacement = allGroups.filter(
        (g) => g.id !== sourceGroup.id || !sourceWillEmpty
      )
      const { x, y } = placeNewIframeLayerGroup(
        groupsForPlacement,
        collections.iframeLayers.toArray(),
        { x: cx, y: cy },
        memberSize.width,
        memberSize.height
      )

      // One batch so the split + sidebar renumber land as a single undo step.
      ops.batch(() => {
        const newGroupId = ops.splitToNewGroup([member.id], { x, y })
        // Renumber sidebarOrder over the post-mutation set so the new group
        // lands at target.sidebarIndex. Use the freshly read snapshot, then
        // splice in the new id; an `update` on a pruned source is a no-op.
        const orderedIds = collections.iframeLayerGroups
          .toArray()
          .filter((g) => g.id !== newGroupId)
          .sort((a, b) => (a.sidebarOrder ?? 0) - (b.sidebarOrder ?? 0))
          .map((g) => g.id)
        const clamped = Math.max(
          0,
          Math.min(target.sidebarIndex, orderedIds.length)
        )
        const finalOrder = [
          ...orderedIds.slice(0, clamped),
          newGroupId,
          ...orderedIds.slice(clamped),
        ]
        finalOrder.forEach((id, index) => {
          ops.patch("iframeLayerGroups", id, { sidebarOrder: index })
        })
      })
    },
    [collections, getViewportCenter, ops]
  )

  const renameIframeLayerGroup = useCallback(
    (groupId: string, name: string) => {
      ops.patch("iframeLayerGroups", groupId, { name })
    },
    [ops]
  )

  /** Delete an entire group + all its members (iframeLayers, markdownLayers). */
  const removeIframeLayerGroup = useCallback(
    (groupId: string) => {
      const g = collections.iframeLayerGroups.get(groupId)
      if (!g) return
      const members = getGroupMembers(g)
      const iframeLayerIds = members
        .filter((m) => m.kind === "iframe-layer")
        .map((m) => m.id)
      const documentIds = members
        .filter((m) => m.kind === "markdown-layer")
        .map((m) => m.id)
      // Compose both removal verbs under one batch so the group teardown is a
      // single transaction (one undo step). Each verb prunes the group as its
      // last member of that kind leaves.
      let removedChatIds: string[] = []
      ops.batch(() => {
        if (iframeLayerIds.length > 0) ops.removeLayers(iframeLayerIds)
        if (documentIds.length > 0) {
          removedChatIds = ops.removeDocuments(documentIds).removedChatIds
        }
      })
      for (const chatId of removedChatIds) chatStore.cleanup(chatId)
      selection.removeGroupFromSelection(groupId)
    },
    [collections, ops, selection]
  )

  // --- Document layer mutations ---

  /**
   * Wrap a new document in a fresh single-member group at the given canvas
   * coords. Mirrors `addFrame` so docs and iframeLayers have parallel
   * "create at canvas position" entry points.
   */
  const addDocumentLayer = useCallback(
    (
      canvasX: number,
      canvasY: number,
      width: number,
      height: number
    ): string => {
      const { docId, chatId } = ops.createDocument(
        { x: canvasX, y: canvasY },
        { width, height }
      )
      chatTarget.rememberDocChat(docId, chatId)
      return docId
    },
    [ops, chatTarget]
  )

  // `removeDocumentLayers` is defined up top (a Canvas Operation wrapper the
  // controllers and the sidebar's remove-document action share).

  // --- Agent mutations ---

  const updateAgentInStorage = useCallback(
    (id: string, data: Partial<BranchData>) => {
      ops.patch("branches", id, data)
    },
    [ops]
  )

  const removeAgentFromStorage = useCallback(
    (id: string) => {
      const { removedChatIds } = ops.removeBranch(id)
      for (const chatId of removedChatIds) chatStore.cleanup(chatId)
    },
    [ops]
  )

  // --- Chat session mutations ---

  const addChatSession = useCallback(
    (id: string, data: ChatSessionData) => {
      ops.addChatSession(id, data)
    },
    [ops]
  )

  const updateChatSession = useCallback(
    (id: string, data: Partial<ChatSessionData>) => {
      ops.patch("chatSessions", id, data)
    },
    [ops]
  )

  const removeChatSession = useCallback(
    (id: string) => {
      ops.removeChatSession(id)
    },
    [ops]
  )

  // --- Handlers ---

  // Zoom-to actions delegate the fit math to the Canvas Camera controller
  // (`zoomToElement` / `zoomToRect`, over the pure `lib/canvas/camera`).
  const handleSelectIframeLayer = useCallback(
    (iframeLayerId: string) => {
      const el = document.getElementById(`iframe-layer-${iframeLayerId}`)
      if (el) camera.zoomToElement(el)
    },
    [camera]
  )

  const handleZoomToDocument = useCallback(
    (markdownLayerId: string) => {
      const el = document.getElementById(`markdown-layer-${markdownLayerId}`)
      if (el) camera.zoomToElement(el)
    },
    [camera]
  )

  const handleZoomToGroup = useCallback(
    (groupId: string) => {
      const group = iframeLayerGroups.find((g) => g.id === groupId)
      if (!group) return
      const members = getGroupMembers(group)
      if (members.length === 0) return
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const m of members) {
        const layout = effectiveIframeLayerLayouts.get(m.id)
        if (!layout) continue
        if (layout.x < minX) minX = layout.x
        if (layout.y < minY) minY = layout.y
        if (layout.x + layout.width > maxX) maxX = layout.x + layout.width
        if (layout.y + layout.height > maxY) maxY = layout.y + layout.height
      }
      if (!isFinite(minX) || !isFinite(minY)) return
      camera.zoomToRect({
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      })
    },
    [camera, iframeLayerGroups, effectiveIframeLayerLayouts]
  )

  const handleAddIframeLayerForAgent = useCallback(
    (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId)
      if (!agent || agent.status !== "running") return
      const existing = iframeLayers.filter((a) => a.branchId === agentId)
      const newId = addIframeLayer(agentId, `Frame ${existing.length + 1}`)
      if (newId) {
        // Wait for DOM to render the new iframeLayer, then zoom to it
        requestAnimationFrame(() => {
          handleSelectIframeLayer(newId)
        })
      }
    },
    [agents, iframeLayers, addIframeLayer, handleSelectIframeLayer]
  )

  const handleShowRoutesForAgent = useCallback(
    (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId)
      if (!agent) return
      const routes = agent.discoveredRoutes ?? []
      if (routes.length === 0) {
        alert("No routes have been discovered for this branch yet.")
        return
      }
      const result = addRoutesGroupForAgent(agentId, routes)
      if (result) {
        requestAnimationFrame(() => {
          handleSelectIframeLayer(result.firstIframeLayerId)
        })
      }
    },
    [agents, addRoutesGroupForAgent, handleSelectIframeLayer]
  )

  const handlePlayAgent = useCallback(
    (branchId: string) => {
      openExternal(`/play/${roomId}/${branchId}`)
    },
    [roomId]
  )

  const handlePlayIframeLayer = useCallback(
    (iframeLayerId: string) => {
      const iframeLayer = iframeLayers.find((a) => a.id === iframeLayerId)
      if (!iframeLayer?.branchId) return
      const params = new URLSearchParams()
      params.set("iframe-layer", iframeLayerId)
      if (iframeLayer.route) params.set("route", iframeLayer.route)
      if (
        iframeLayer.knobValues &&
        Object.keys(iframeLayer.knobValues).length > 0
      ) {
        try {
          const json = JSON.stringify(iframeLayer.knobValues)
          const b64 =
            typeof btoa === "function"
              ? btoa(json)
              : Buffer.from(json, "utf-8").toString("base64")
          params.set("k", encodeURIComponent(b64))
        } catch {}
      }
      const url = `/play/${roomId}/${iframeLayer.branchId}?${params.toString()}`
      openExternal(url)
    },
    [iframeLayers, roomId]
  )

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
      agents,
      iframeLayers,
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
  } = useBranchIntake({
    ops,
    repos,
    agents,
    roomId,
    addRepoToStorage,
    removeRepoFromStorage,
    removeAgentFromStorage,
    updateAgentInStorage,
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

  // Load history for all chat sessions so other clients can see past
  // messages for chats they haven't opened yet. Terminal tabs can't reach this
  // loop by construction — they're a distinct type in `localTerminals`, never
  // in `chatSessions` — so terminal scrollback never enters the chat-store.
  useEffect(() => {
    for (const cs of chatSessions) {
      chatStore.loadHistory(cs.id)
    }
  }, [chatSessions])

  // Seed iframeLayers for agents whose sandbox has finished provisioning. The
  // flag is set at create time and cleared here after the first seed, so
  // deleting the last frame for a branch later does not re-spawn one.
  useEffect(() => {
    const pending = agents.filter(
      (a) =>
        a.pendingIframeLayerSeed === true &&
        a.status === "running" &&
        a.previewDomain &&
        !iframeLayers.some((ab) => ab.branchId === a.id)
    )
    if (pending.length === 0) return
    const { cx, cy } = getViewportCenter()
    const target = pending[0]!
    // Seed one per tick — `seedFrameForAgent` reads the Yjs snapshot for
    // layout, and the snapshot only refreshes after the previous mutation
    // settles. Letting React re-render between seeds avoids stacking groups.
    // The verb creates the frame and clears `pendingIframeLayerSeed` in one
    // transaction, so this reactive trigger is the only seed logic left here.
    const { layerId } = ops.seedFrameForAgent(target.id, { x: cx, y: cy })
    // Selecting the just-seeded frame is the intended reaction to a Yjs
    // mutation triggered by externally-driven agent state, not an avoidable
    // render cascade. Goes through the Canvas Selection setters.
    setSelectedIframeLayerIds(new Set([layerId]))
    setSelectedGroupIds(new Set())
    // Wait for the new iframeLayer DOM node to mount before zooming.
    requestAnimationFrame(() => {
      handleSelectIframeLayer(layerId)
    })
  }, [
    agents,
    iframeLayers,
    ops,
    getViewportCenter,
    handleSelectIframeLayer,
    setSelectedIframeLayerIds,
    setSelectedGroupIds,
  ])

  // Sandbox Reconnect controller (PRD #579, cut 2/4): the single home for all
  // mount-time Sandbox-lifecycle orchestration — the reconnect/recover-on-mount
  // recovery (over the pure `resolveReconnect`), the visibility-gated ~20-minute
  // keep-alive heartbeat, and the streaming-heal hydration. Lifted out of this
  // composition root so the recovery cascade — including the expired-snapshot →
  // Recreate rule (ADR 0005) — is testable as a pure decision.
  useSandboxReconnect({
    agents,
    repos,
    chatSessions,
    roomId,
    updateAgentInStorage,
  })

  // Receive server-broadcast chat events via the room Y.Doc and feed into chat store.
  useChatStreamEvents((e) => {
    chatStore.handleBroadcastEvent(e)
    // Mirror streaming state into the chat session so late joiners see it.
    if (e.type === "chat-stream-start") {
      updateChatSession(e.chatId, { isStreaming: true })
    } else if (e.type === "chat-stream-end") {
      updateChatSession(e.chatId, { isStreaming: false })
    } else if (e.type === "chat-control" && e.control.kind === "chat_rename") {
      // Apply the auto-generated label here, at the canvas level, rather than
      // relying on the per-chat `onChatRename` callback: that callback is an
      // inline arrow re-registered on every AgentChat render, so a rename
      // broadcast landing during the clear/re-set window would be dropped.
      // Writing the Y.Doc here is independent of which chat tab is mounted.
      updateChatSession(e.chatId, { label: e.control.label })
    }
  })

  // Mount-time Sandbox recovery (reconnect), the keep-alive heartbeat, and the
  // streaming-heal hydration now all live in `useSandboxReconnect`, called above.

  // Following another user's viewport, the manual follow-break, the Figma-style
  // wheel pan/zoom, and the forwarded-from-iframe wheel all live in the Canvas
  // Camera controller now (`camera.follow` / `camera.breakFollow` /
  // `camera.handleIframeWheel`, plus the wheel listener it attaches to
  // `canvasWrapperRef`).

  // Cross-origin iframes inside an iframeLayer can cause the browser to walk up
  // the ancestor chain calling `scrollIntoView` (e.g. when their content
  // autofocuses an input). `overflow: hidden` does not block programmatic
  // scrolling, so the canvas wrapper / transform wrapper silently drift from
  // (0, 0) and the rendered canvas slides off-axis from the transform state.
  // Pin both elements' scroll positions to 0 on every scroll event.
  useEffect(() => {
    const el = canvasWrapperRef.current
    if (!el) return

    const transformWrapper = el.querySelector<HTMLElement>(
      ".react-transform-wrapper"
    )

    const pin = (e: Event) => {
      const t = e.currentTarget as HTMLElement
      if (t.scrollLeft !== 0) t.scrollLeft = 0
      if (t.scrollTop !== 0) t.scrollTop = 0
    }

    const targets: HTMLElement[] = [el]
    if (transformWrapper) targets.push(transformWrapper)
    for (const t of targets) {
      t.addEventListener("scroll", pin, { passive: true })
    }
    return () => {
      for (const t of targets) {
        t.removeEventListener("scroll", pin)
      }
    }
  }, [])

  /**
   * The draw-tool drafts (document / frame mode) the gesture seam shares its
   * pointer handlers with but that aren't gestures — they create a layer rather
   * than reducing through the FSM. The hook owns the handler ordering (drafts
   * sit after reorder/gap, before marquee); this keeps the draft domain logic
   * (default sizes, layer creation, selection) in the component.
   */
  const drawTool = useMemo<CanvasDrawTool>(
    () => ({
      beginDraft: (canvas) => {
        if (documentMode) {
          documentDraftRef.current = {
            startX: canvas.x,
            startY: canvas.y,
            currentX: canvas.x,
            currentY: canvas.y,
          }
          setDocumentDraft(documentDraftRef.current)
        } else if (frameMode) {
          frameDraftRef.current = {
            startX: canvas.x,
            startY: canvas.y,
            currentX: canvas.x,
            currentY: canvas.y,
          }
          setFrameDraft(frameDraftRef.current)
        }
      },
      updateDraft: (canvas) => {
        if (documentDraftRef.current) {
          const next = {
            ...documentDraftRef.current,
            currentX: canvas.x,
            currentY: canvas.y,
          }
          documentDraftRef.current = next
          setDocumentDraft(next)
          return true
        }
        if (frameDraftRef.current) {
          const next = {
            ...frameDraftRef.current,
            currentX: canvas.x,
            currentY: canvas.y,
          }
          frameDraftRef.current = next
          setFrameDraft(next)
          return true
        }
        return false
      },
      commitDraft: () => {
        // Document-tool: release creates a new document layer. Click-without-drag
        // uses a sensible default size; drag sets explicit bounds.
        if (documentDraftRef.current) {
          const d = documentDraftRef.current
          documentDraftRef.current = null
          setDocumentDraft(null)
          const dx = d.currentX - d.startX
          const dy = d.currentY - d.startY
          const DEFAULT_W = 480
          const DEFAULT_H = 640
          let x: number
          let y: number
          let w: number
          let h: number
          if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
            w = DEFAULT_W
            h = DEFAULT_H
            x = d.startX
            y = d.startY
          } else {
            x = Math.min(d.startX, d.currentX)
            y = Math.min(d.startY, d.currentY)
            w = Math.max(200, Math.abs(dx))
            h = Math.max(120, Math.abs(dy))
          }
          const id = addDocumentLayer(x, y, w, h)
          toolMode.set("select")
          setSelectedIframeLayerIds(new Set())
          setSelectedDocumentLayerIds(new Set([id]))
          setEditingDocumentLayerId(id)
          return true
        }
        // Frame-tool: release creates a new empty frame.
        if (frameDraftRef.current) {
          const d = frameDraftRef.current
          frameDraftRef.current = null
          setFrameDraft(null)
          const dx = d.currentX - d.startX
          const dy = d.currentY - d.startY
          let x: number
          let y: number
          let w: number
          let h: number
          if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
            w = DEFAULT_IFRAME_LAYER_WIDTH
            h = DEFAULT_IFRAME_LAYER_HEIGHT
            x = d.startX - w / 2
            y = d.startY - h / 2
          } else {
            x = Math.min(d.startX, d.currentX)
            y = Math.min(d.startY, d.currentY)
            w = Math.abs(dx)
            h = Math.abs(dy)
          }
          const id = addFrame(x, y, w, h)
          toolMode.set("select")
          setSelectedDocumentLayerIds(new Set())
          setSelectedIframeLayerIds(new Set([id]))
          return true
        }
        return false
      },
    }),
    [
      documentMode,
      frameMode,
      addDocumentLayer,
      addFrame,
      toolMode,
      setSelectedIframeLayerIds,
      setSelectedDocumentLayerIds,
    ]
  )

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
    [setPresence, iframeLayerLayouts, isLayerDragging, getGestureState]
  )

  const handlePointerLeave = useCallback(() => {
    setPresence({ pointer: null })
    setHoveredIframeLayerId(null)
    resetHandleHover()
  }, [setPresence, resetHandleHover])

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

  // Broadcast selection to other users via presence. Doc IDs ride alongside
  // iframeLayer IDs so remote selection rings render uniformly (the overlay
  // looks both up against `iframeLayerLayouts`, which already includes docs).
  useEffect(() => {
    setPresence({
      selectedIframeLayerIds: Array.from(overlaySelectedIds),
      groupSelectedIframeLayerIds: Array.from(groupSelectedIframeLayerIds),
    })
  }, [overlaySelectedIds, groupSelectedIframeLayerIds, setPresence])

  // Collect other users' selections for the overlay
  const othersSelections = others.map(({ presence }) => ({
    selectedIframeLayerIds: presence.selectedIframeLayerIds ?? [],
    groupSelectedIframeLayerIds: presence.groupSelectedIframeLayerIds ?? [],
    color: presence.color,
    name: presence.identity.name || "Anonymous",
  }))

  // Per-layer color of the remote user who has it selected, used to tint that
  // frame/doc name and group label to match the remote selection rect.
  // `remoteSelectionColors` covers directly-selected *and* group-member ids
  // (both get a tinted name); `remoteGroupSelectionColors` covers only group
  // members (drives the group label). First writer wins if two users overlap.
  const remoteSelectionColors = new Map<string, string>()
  const remoteGroupSelectionColors = new Map<string, string>()
  for (const o of othersSelections) {
    for (const id of o.selectedIframeLayerIds) {
      if (!remoteSelectionColors.has(id)) remoteSelectionColors.set(id, o.color)
    }
    for (const id of o.groupSelectedIframeLayerIds) {
      if (!remoteSelectionColors.has(id)) remoteSelectionColors.set(id, o.color)
      if (!remoteGroupSelectionColors.has(id))
        remoteGroupSelectionColors.set(id, o.color)
    }
  }

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
              cursor: isPanning
                ? "grabbing"
                : spaceHeld
                  ? "grab"
                  : documentMode || frameMode || commentMode
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
            onClick={commentMode ? handleCanvasClick : undefined}
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
                >
                  <CanvasMemberLayer
                    iframeLayerGroups={iframeLayerGroups}
                    iframeLayers={iframeLayers}
                    markdownLayers={markdownLayers}
                    selection={selection}
                    camera={camera}
                    reference={reference}
                    gesturePreview={gesturePreview}
                    gestureLayerHandlers={gestureLayerHandlers}
                    effectiveIframeLayerLayouts={effectiveIframeLayerLayouts}
                    iframeLayerLayouts={iframeLayerLayouts}
                    groupZIndex={groupZIndex}
                    groupDisplayNames={groupDisplayNames}
                    placeholderRects={placeholderRects}
                    remoteSelectionColors={remoteSelectionColors}
                    remoteGroupSelectionColors={remoteGroupSelectionColors}
                    agentDomains={agentDomains}
                    agents={agents}
                    zoom={zoom}
                    spaceHeld={spaceHeld}
                    commentMode={commentMode}
                    self={self}
                    editingDocumentLayerId={editingDocumentLayerId}
                    setEditingDocumentLayerId={setEditingDocumentLayerId}
                    focusedIframeLayerId={focusedIframeLayerId}
                    setFocusedIframeLayerId={setFocusedIframeLayerId}
                    createFlowIframeLayerId={createFlowIframeLayerId}
                    setCreateFlowIframeLayerId={setCreateFlowIframeLayerId}
                    renameIframeLayerGroup={renameIframeLayerGroup}
                    removeIframeLayer={removeIframeLayer}
                    handlePlayIframeLayer={handlePlayIframeLayer}
                    handleCaptureReadyChange={handleCaptureReadyChange}
                    handleCaptureDirty={handleCaptureDirty}
                    layerMutations={layerMutations}
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

            <SelectionOverlay
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
                // Show the live hover overlay while in commentMode so the
                // user can see what element they're about to anchor to.
                const source = commentMode ? reference.inspectHover : null
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
          minSize="360px"
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
