"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchContentRef,
} from "react-zoom-pan-pinch"
import { nanoid } from "nanoid"
import { toast } from "sonner"
import {
  uniqueNamesGenerator,
  adjectives,
  colors,
  animals,
} from "unique-names-generator"
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
import { resolveEscapeAction } from "@/lib/canvas/escape"
import { reconcileInteractionMode } from "@/lib/canvas/interaction-mode"
import { createCanvasOps } from "@/lib/canvas/ops"
import {
  createTerminalTab,
  DEFAULT_HARNESS_KEY,
  readLastHarnessKey,
  readLastTabKind,
} from "@/lib/canvas/tab-kind"
import {
  createTerminalTabAction,
  deleteTerminalTabAction,
  killTerminalSessionAction,
  listTerminalTabsAction,
} from "@/lib/terminal-tabs-actions"
import type { TerminalTabRecord } from "@/lib/terminal-tabs"
import { partitionTerminalsByBranch } from "@/lib/terminal/orphan-tabs"
import { useAppSession } from "@/lib/auth-client"
import { isLocalBuild } from "@/lib/local-mode"
import { useTrafficLightsPresent } from "@/lib/use-traffic-lights"
import { withBasePath } from "@/lib/base-path"
import {
  FileText,
  Frame,
  MessageSquare,
  MoreHorizontal,
  MousePointer2,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Trash2,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@workspace/ui/components/button"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { Kbd } from "@workspace/ui/components/kbd"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  EditableText,
  type EditableTextHandle,
} from "@workspace/ui/components/editable-text"
import { DeleteRoomDialog } from "@/components/delete-room-dialog"
import { ShareRoomDialog } from "@/components/share-room-dialog"
import { deleteRoom, renameRoom } from "@/lib/rooms-actions"
import { IframeLayer } from "./iframe-layer"
import { MarkdownLayer, type InlineCommentDraft } from "./markdown-layer"
import { formatQuoteForChat } from "@/lib/document-comments"
import type { SendToChatContext } from "./comments"
import { SelectionOverlay } from "./selection-overlay"
import {
  anchorCornerForEdge,
  computeDeviceSnap,
  computeMergeSnap,
  computeMoveSnap,
  type AnchorCorner,
  type MergeSnapCandidate,
  type ResizeEdge,
  type SnapCandidate,
  type SnapGuide,
  type Rect as MoveSnapRect,
} from "@/lib/canvas/snap"
import { Comments } from "./comments"
import type { ThreadWithComments } from "@/lib/comments"
import { Cursors } from "./cursors"
import { CursorChat } from "./cursor-chat"
import { FollowingToolbar } from "./following-toolbar"
import { useThumbnailHeartbeat } from "./use-thumbnail-heartbeat"
import type { ScreenplayDom, WheelForward } from "@/hooks/use-screenplay-dom"
import type { DomRect } from "@/lib/postmessage-protocol"
import { inputStore } from "@/lib/input-store"
import type { JsonObject, JsonValue } from "@/lib/postmessage-protocol"
import { RoomSidebar } from "@/components/panels/room-sidebar"
import { ChatPanel, type ChatPanelTarget } from "@/components/agent/chat-panel"
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
  TabKind,
  TerminalTabData,
} from "@/lib/types"
import { chatStore } from "@/lib/chat-store"
import { isBranchBusy } from "@/lib/branch-busy"
import type { RepoPickerSelection } from "@/components/repo-picker"
import {
  planBranchCreations,
  type ComposerSpec,
} from "@/lib/branch-create-planner"
import { useDiffStats } from "@/hooks/use-diff-stats"
import { renameAgentBranch } from "@/lib/sandbox/git"
import {
  restartSandbox,
  recreateSandbox,
  restartDevServer,
  reconnectSandbox,
  keepAliveSandbox,
  stopDevServers,
  deleteSandboxes,
} from "@/lib/sandbox/lifecycle"
import { deleteBranch } from "@/lib/github-actions"
import { createPullRequestAction } from "@/lib/create-pr-action"
import { openExternal } from "@/lib/open-external"
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
  DEFAULT_IFRAME_LAYER_WIDTH,
  DEFAULT_IFRAME_LAYER_HEIGHT,
  MIN_IFRAME_LAYER_WIDTH,
  MIN_IFRAME_LAYER_HEIGHT,
  CANVAS_SIZE,
} from "@/lib/constants"
import {
  computeIframeLayerLayouts,
  deriveCanvasLayout,
  getGroupMemberIds,
  getGroupMembers,
  groupContentHeight,
  groupContentWidth,
  groupGap,
  placeNewIframeLayerGroup,
} from "@/lib/canvas/layout"
import { ResizeSnapUnderlay } from "./resize-snap-underlay"
import { GroupMergeUnderlay } from "./group-merge-underlay"
import { PlaceholderRectsUnderlay } from "./placeholder-rects-underlay"

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
  hasThumbnail,
  initialLayout,
  initialThreads,
  initialTerminalTabs,
}: {
  roomId: string
  roomName: string
  hasThumbnail: boolean
  initialLayout?: PanelLayout
  initialThreads?: ThreadWithComments[]
  initialTerminalTabs?: TerminalTabRecord[]
}) {
  const router = useRouter()
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
  const [zoom, setZoom] = useState(1)
  const [viewportPos, setViewportPos] = useState({ x: 0, y: 0 })
  const [focusedIframeLayerId, setFocusedIframeLayerId] = useState<
    string | null
  >(null)
  // IframeLayer currently in Create Flow mode. Mutually exclusive with
  // `focusedIframeLayerId` — toggling one clears the other.
  const [createFlowIframeLayerId, setCreateFlowIframeLayerId] = useState<
    string | null
  >(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  /**
   * When a chat tab is targeting a document layer (instead of an agent's
   * branch), the panel pivots into "doc mode" — the picker shows a doc
   * pill, the tools are doc-mutation tools, etc. Mutually exclusive with
   * `selectedAgentId` from the panel's POV.
   */
  const [selectedDocumentChatTargetId, setSelectedDocumentChatTargetId] =
    useState<string | null>(null)
  // Agents created this session whose sandbox isn't streaming logs yet.
  // A LogProbe is rendered for each; on ready we flip selection and drop
  // the id. No cleanup effect — filtering in render handles deletions,
  // so agents from Liveblocks can be a new reference every render safely.
  const [pendingAgentIds, setPendingAgentIds] = useState<string[]>([])
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  // Terminal tabs are deliberately kept out of the shared `chatSessions` Y.Doc
  // collection: they're per-user, BYO-harness shells that must never appear in
  // collaborators' tab strips or enter the conversation model. They live in
  // this client's state, but their identity/metadata is persisted per
  // user+room+branch in Postgres (#258, the `terminal_tab` table) — so a reload
  // restores them and they follow the User across devices. Only the tab
  // identity is stored, never scrollback. Co-view across clients is still a
  // deliberate non-goal — see ADR 0002 / follow-up.
  // Seed from the server-fetched tabs (page.tsx) so restored terminals are on
  // the very first client paint — same as chats (which arrive in the synced
  // Y.Doc). Without this seed they'd pop in a beat late, after the client-side
  // `listTerminalTabsAction` round-trip below resolves.
  const [localTerminals, setLocalTerminals] = useState<TerminalTabData[]>(() =>
    (initialTerminalTabs ?? []).map((r) =>
      createTerminalTab({
        id: r.id,
        branchId: r.branch,
        createdAt: r.createdAt,
        label: r.label,
        harnessKey: r.harnessKey ?? undefined,
      })
    )
  )
  const isLocalTerminal = useCallback(
    (id: string | null) => !!id && localTerminals.some((t) => t.id === id),
    [localTerminals]
  )
  // Re-fetch this User's persisted terminal tabs for the room (#258): keeps the
  // seeded set fresh on client-side Branch/room navigation (when the component
  // doesn't remount, so the seed above is stale) and reconciles tabs opened on
  // another device. Merge rather than replace, so a tab the user opened before
  // this resolved isn't dropped.
  useEffect(() => {
    let cancelled = false
    listTerminalTabsAction({ roomId })
      .then((rows) => {
        if (cancelled) return
        const restored = rows.map((r) =>
          createTerminalTab({
            id: r.id,
            branchId: r.branch,
            createdAt: r.createdAt,
            label: r.label,
            harnessKey: r.harnessKey ?? undefined,
          })
        )
        setLocalTerminals((prev) => {
          const localOnly = prev.filter(
            (t) => !restored.some((r) => r.id === t.id)
          )
          return [...restored, ...localOnly]
        })
      })
      .catch((err) => {
        console.error("Failed to restore terminal tabs", err)
      })
    return () => {
      cancelled = true
    }
  }, [roomId])
  // Per-repo / per-agent memory so switching back restores prior selection
  const selectedAgentByRepoRef = useRef<Record<string, string>>({})
  const selectedChatByAgentRef = useRef<Record<string, string>>({})
  /** Per-document memory: switching back to a doc target restores the last open chat tab. */
  const selectedChatByDocumentRef = useRef<Record<string, string>>({})
  const inspectHandlersRef = useRef<{
    branchRename: (agentId: string, branch: string) => void
    renameChat: (chatId: string, label: string) => void
  }>({ branchRename: () => {}, renameChat: () => {} })
  const [followingConnectionId, setFollowingConnectionId] = useState<
    number | null
  >(null)
  // Per-iframeLayer iframe DOM accessor registry. IframeLayers register on mount and
  // unregister on unmount; selector-anchored comments use it to query element
  // rects in the right iframe.
  const iframeLayerDomsRef = useRef(new Map<string, ScreenplayDom>())
  const [, setIframeLayerDomsVersion] = useState(0)
  const handleIframeLayerDomReady = useCallback(
    (id: string, dom: ScreenplayDom | null) => {
      const map = iframeLayerDomsRef.current
      if (dom) map.set(id, dom)
      else map.delete(id)
      setIframeLayerDomsVersion((v) => v + 1)
    },
    []
  )
  const getIframeLayerDom = useCallback(
    (id: string): ScreenplayDom | undefined =>
      iframeLayerDomsRef.current.get(id),
    []
  )
  // Same registry pattern as iframe DOMs, but for doc-layer TipTap editors.
  // Inline-comment threads use this to push highlight ranges into the
  // editor and to compute where to anchor each thread's canvas pin.
  const documentEditorsRef = useRef(
    new Map<string, import("@tiptap/core").Editor>()
  )
  const [documentEditorsVersion, setDocumentEditorsVersion] = useState(0)
  const handleDocumentEditorReady = useCallback(
    (id: string, editor: import("@tiptap/core").Editor | null) => {
      const map = documentEditorsRef.current
      if (editor) map.set(id, editor)
      else map.delete(id)
      setDocumentEditorsVersion((v) => v + 1)
    },
    []
  )
  const getDocumentEditor = useCallback(
    (id: string): import("@tiptap/core").Editor | undefined =>
      documentEditorsRef.current.get(id),
    []
  )
  const [commentMode, setCommentMode] = useState(false)
  const [newCommentPos, setNewCommentPos] = useState<{
    x: number
    y: number
    iframeLayerId?: string
    selector?: string | null
    offsetX?: number | null
    offsetY?: number | null
    documentId?: string | null
    anchorStart?: string | null
    anchorEnd?: string | null
    quotedText?: string | null
    lineFrom?: number | null
    lineTo?: number | null
  } | null>(null)
  const [activeCommentThreadId, setActiveCommentThreadId] = useState<
    string | null
  >(null)
  const [inspectHover, setInspectHover] = useState<{
    iframeLayerId: string
    rect: DomRect
  } | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [selectedIframeLayerIds, setSelectedIframeLayerIds] = useState<
    Set<string>
  >(new Set())
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(
    new Set()
  )
  const [selectedDocumentLayerIds, setSelectedDocumentLayerIds] = useState<
    Set<string>
  >(new Set())
  const [hoveredIframeLayerId, setHoveredIframeLayerId] = useState<
    string | null
  >(null)
  const [marquee, setMarquee] = useState<{
    startX: number
    startY: number
    currentX: number
    currentY: number
  } | null>(null)
  const marqueeRef = useRef<{
    startX: number
    startY: number
    shiftKey: boolean
    baseIframeLayers: Set<string>
    baseDocumentLayers: Set<string>
  } | null>(null)
  const [documentMode, setDocumentMode] = useState(false)
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
  const [frameMode, setFrameMode] = useState(false)
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
  const gapDragRef = useRef<{
    groupId: string
    gapIndex: number
    startGap: number
    startCanvasX: number
  } | null>(null)
  const [activeGapHandle, setActiveGapHandle] = useState<{
    groupId: string
    gapIndex: number
  } | null>(null)
  const reorderDragRef = useRef<{
    groupId: string
    iframeLayerId: string
    /** Pointer position (canvas space) at drag start — used on pointerup to
     *  distinguish a click (no movement → fire selection) from a drag. */
    startCanvas: { x: number; y: number }
    /** Vector from the dragged frame's top-left to the cursor at drag start.
     *  Preserves the grab point so the frame stays under the cursor exactly
     *  where the user grabbed it (rather than jumping to be center-aligned). */
    grabOffset: { x: number; y: number }
    /** Shift key state captured at pointerdown. Used when a click-no-move
     *  release falls through to selection so shift-click still works. */
    startShiftKey: boolean
    /** When `true`, a release without movement triggers selection of the
     *  layer — set for drags initiated from the frame's name label so the
     *  user can still single-click to select. The reorder-dot path leaves
     *  this `false` since the dot itself isn't a selection affordance. */
    selectOnNoMove: boolean
  } | null>(null)
  const [reorderDraggingIframeLayerId, setReorderDraggingIframeLayerId] =
    useState<string | null>(null)
  /**
   * In-flight group-merge state. `sourceGroupId` is set when a layer drag
   * begins translating exactly one group; mirrored into `groupDragSourceRef`
   * so the drag-end handler can read it without re-binding on every render.
   * The currently-snapped target id lives in `groupDragTargetRef` and is
   * synced from the memoized snap computation below.
   */
  const groupDragSourceRef = useRef<string | null>(null)
  const groupDragTargetRef = useRef<string | null>(null)
  const [draggingSourceGroupId, setDraggingSourceGroupId] = useState<
    string | null
  >(null)
  /** True while any layer (frame or group) is being dragged — used to
   *  suppress the hover outline so sweeping over sibling frames during a
   *  drag doesn't paint a hover rect on each one in turn. */
  const layerDraggingRef = useRef(false)
  /**
   * Edge/center snap state for the current move drag. `startUnion` is the
   * world-space bbox of every layer that will move at drag start; `candidates`
   * are the rects we snap against (everything that *won't* move). On each
   * pointermove we recompute the snap from the raw rect (start + cumulative
   * cursor delta) — that way the rect "sticks" to a snap line as the cursor
   * keeps moving, since the snap delta absorbs the cursor shift until it
   * exceeds the threshold. `appliedSnap` is the snap delta we already applied
   * to the world position; the per-frame adjustment is
   * `cursorDelta + (newSnap - appliedSnap)`.
   */
  const dragSnapStateRef = useRef<{
    startUnion: MoveSnapRect
    candidates: MoveSnapRect[]
    appliedSnap: { x: number; y: number }
  } | null>(null)
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([])
  /**
   * Merge-snap state for the current group drag. The merge targets (every
   * other group's trailing "+ frame" slot) and the dragged group's member
   * sizes are stationary for the gesture, so they're captured once at drag
   * start; only the source's live position changes, which `applyMergeSnap`
   * reads each heartbeat. `null` whenever the drag can't merge (multi-group
   * drag, or no source group).
   */
  const mergeSnapStateRef = useRef<{
    sourceContentW: number
    sourceContentH: number
    memberSizes: Array<{ width: number; height: number }>
    candidates: MergeSnapCandidate[]
  } | null>(null)
  /** World-space highlight rects for the merge preview — drives `GroupMergeUnderlay`. */
  const [groupDragSnapRects, setGroupDragSnapRects] = useState<
    MoveSnapRect[] | null
  >(null)
  /** Cursor in canvas space while a reorder drag is active — drives the lifted iframeLayer's translate. */
  const [reorderDragCursor, setReorderDragCursor] = useState<{
    x: number
    y: number
  } | null>(null)
  /** Grab offset for the active reorder drag, mirrored into state (set
   *  alongside `reorderDragRef` at drag-start) so layout math can read it
   *  during render without touching the ref. Constant for a drag's duration. */
  const [reorderGrabOffset, setReorderGrabOffset] = useState<{
    x: number
    y: number
  } | null>(null)
  /** True while the user is holding the meta/cmd key during a reorder drag —
   * pops the iframeLayer out of its source group as a preview. The pop is only
   * committed (new group created, source group updated) on pointer-up if the
   * key is still held. */
  const [reorderDragPopped, setReorderDragPopped] = useState(false)
  // Track meta-key changes during a reorder drag even when the pointer isn't
  // moving, so the popped preview kicks in the instant the user presses cmd.
  useEffect(() => {
    if (!reorderDraggingIframeLayerId) return
    const onKey = (ev: KeyboardEvent) => setReorderDragPopped(ev.metaKey)
    window.addEventListener("keydown", onKey)
    window.addEventListener("keyup", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("keyup", onKey)
    }
  }, [reorderDraggingIframeLayerId])

  const transformRef = useRef<ReactZoomPanPinchContentRef>(null)
  const viewportRestoredRef = useRef(false)
  const sidebarPanelRef = useRef<PanelImperativeHandle>(null)
  const chatPanelRef = useRef<PanelImperativeHandle>(null)
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
  useThumbnailHeartbeat(roomId, hasThumbnail)

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

  // Refs so keyboard handler stays current without re-binding
  const selectedIframeLayerIdsRef = useRef(selectedIframeLayerIds)
  const selectedGroupIdsRef = useRef(selectedGroupIds)
  const selectedDocumentLayerIdsRef = useRef(selectedDocumentLayerIds)
  const editingDocumentLayerIdRef = useRef(editingDocumentLayerId)
  const documentModeRef = useRef(documentMode)
  const frameModeRef = useRef(frameMode)
  const removeIframeLayersRef = useRef<(ids: string[]) => void>(() => {})
  const removeDocumentLayersRef = useRef<(ids: string[]) => void>(() => {})

  // Keep the above "latest value" refs current — written after commit (not
  // during render) so the long-lived keyboard/pointer handlers below can read
  // them without re-binding on every render.
  useEffect(() => {
    selfPointerRef.current = self?.pointer ?? null
    selfMessageRef.current = self?.message ?? null
    selectedIframeLayerIdsRef.current = selectedIframeLayerIds
    selectedGroupIdsRef.current = selectedGroupIds
    selectedDocumentLayerIdsRef.current = selectedDocumentLayerIds
    editingDocumentLayerIdRef.current = editingDocumentLayerId
    documentModeRef.current = documentMode
    frameModeRef.current = frameMode
  })

  // Keyboard shortcuts
  useEffect(() => {
    const isEditing = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (e.target as HTMLElement)?.isContentEditable
      )
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Precedence (innermost/most-transient first) lives in the React-free
        // `resolveEscapeAction`; this switch just applies the chosen exit. The
        // focus / Create Flow steps are the two manual mode exits pinned by
        // lib/canvas/escape.test.ts.
        switch (
          resolveEscapeAction({
            cursorChatOpen: selfMessageRef.current !== null,
            editingDocumentLayerId: editingDocumentLayerIdRef.current,
            documentMode: documentModeRef.current,
            frameMode: frameModeRef.current,
            commentMode,
            hasNewCommentPos: newCommentPos !== null,
            focusedIframeLayerId,
            createFlowIframeLayerId,
          })
        ) {
          case "close-cursor-chat":
            closeCursorChat()
            break
          case "stop-editing-document":
            setEditingDocumentLayerId(null)
            break
          case "exit-document-mode":
            setDocumentMode(false)
            break
          case "exit-frame-mode":
            setFrameMode(false)
            break
          case "exit-comment-mode":
            setCommentMode(false)
            setNewCommentPos(null)
            setInspectHover(null)
            break
          case "exit-focus-mode":
            setFocusedIframeLayerId(null)
            break
          case "exit-create-flow-mode":
            setCreateFlowIframeLayerId(null)
            break
          case "clear-selection":
            setSelectedIframeLayerIds(new Set())
            setSelectedGroupIds(new Set())
            setSelectedDocumentLayerIds(new Set())
            break
        }
        return
      }
      if (e.key === "v" && !e.metaKey && !e.ctrlKey && !isEditing(e)) {
        setCommentMode(false)
        setNewCommentPos(null)
        setInspectHover(null)
        setDocumentMode(false)
        setFrameMode(false)
      }
      if (e.key === "c" && !e.metaKey && !e.ctrlKey && !isEditing(e)) {
        setCommentMode((m) => !m)
        setNewCommentPos(null)
        setInspectHover(null)
        setDocumentMode(false)
        setFrameMode(false)
      }
      if (e.key === "d" && !e.metaKey && !e.ctrlKey && !isEditing(e)) {
        setDocumentMode((m) => !m)
        setCommentMode(false)
        setNewCommentPos(null)
        setInspectHover(null)
        setFrameMode(false)
      }
      if (e.key === "f" && !e.metaKey && !e.ctrlKey && !isEditing(e)) {
        setFrameMode((m) => !m)
        setDocumentMode(false)
        setCommentMode(false)
        setNewCommentPos(null)
        setInspectHover(null)
      }
      // Figma-style cursor chat. Opens an inline input next to the cursor and
      // broadcasts each keystroke through awareness so peers see the message
      // floating beside the user's remote cursor.
      if (
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !isEditing(e) &&
        selfMessageRef.current === null
      ) {
        e.preventDefault()
        openCursorChat()
      }
      if (e.key === "b" && e.metaKey && !e.altKey) {
        e.preventDefault()
        const panel = sidebarPanelRef.current
        if (panel) {
          if (panel.isCollapsed()) panel.expand()
          else panel.collapse()
        }
      }
      if (
        (e.key === "i" || e.key === "I") &&
        e.metaKey &&
        !e.altKey &&
        !e.ctrlKey &&
        !isEditing(e)
      ) {
        e.preventDefault()
        const panel = chatPanelRef.current
        if (panel) {
          if (panel.isCollapsed()) panel.expand()
          else panel.collapse()
        }
      }
      // Toggle both side panels: Cmd+.
      if (
        e.key === "." &&
        e.metaKey &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.shiftKey
      ) {
        e.preventDefault()
        const sidebarPanel = sidebarPanelRef.current
        const chatPanel = chatPanelRef.current
        const anyOpen =
          (sidebarPanel && !sidebarPanel.isCollapsed()) ||
          (chatPanel && !chatPanel.isCollapsed())
        if (anyOpen) {
          if (sidebarPanel && !sidebarPanel.isCollapsed())
            sidebarPanel.collapse()
          if (chatPanel && !chatPanel.isCollapsed()) chatPanel.collapse()
        } else {
          if (sidebarPanel) sidebarPanel.expand()
          if (chatPanel) chatPanel.expand()
        }
      }
      if (e.key === " " && !e.repeat) {
        if (!isEditing(e)) {
          e.preventDefault()
          setSpaceHeld(true)
        }
      }
      // Delete/Backspace removes selected iframeLayers (including all members
      // of selected groups) and document layers.
      if ((e.key === "Delete" || e.key === "Backspace") && !isEditing(e)) {
        const abIds = selectedIframeLayerIdsRef.current
        const grpIds = selectedGroupIdsRef.current
        const docIds = selectedDocumentLayerIdsRef.current
        if (abIds.size > 0 || grpIds.size > 0 || docIds.size > 0) {
          e.preventDefault()
          const allIframeLayerIds = new Set<string>(abIds)
          const allDocumentIds = new Set<string>(docIds)
          if (grpIds.size > 0) {
            // Selecting a whole group cascades the delete to every member,
            // regardless of kind.
            for (const g of collections.iframeLayerGroups.toArray()) {
              if (!grpIds.has(g.id)) continue
              for (const m of getGroupMembers(g)) {
                if (m.kind === "iframe-layer") allIframeLayerIds.add(m.id)
                else if (m.kind === "markdown-layer") allDocumentIds.add(m.id)
              }
            }
          }
          if (allIframeLayerIds.size > 0) {
            // Single-frame delete: keep selection on the right neighbor (or
            // left if there's nothing to the right). Multi-frame deletes
            // clear selection — no obvious "next" candidate.
            let nextSelected: string | null = null
            if (allIframeLayerIds.size === 1 && allDocumentIds.size === 0) {
              const onlyId = allIframeLayerIds.values().next().value as string
              for (const g of collections.iframeLayerGroups.toArray()) {
                const ids = getGroupMemberIds(g, "iframe-layer")
                const idx = ids.indexOf(onlyId)
                if (idx === -1) continue
                nextSelected = ids[idx + 1] ?? ids[idx - 1] ?? null
                break
              }
            }
            removeIframeLayersRef.current(Array.from(allIframeLayerIds))
            setSelectedIframeLayerIds(
              nextSelected ? new Set([nextSelected]) : new Set()
            )
            setSelectedGroupIds(new Set())
          }
          if (allDocumentIds.size > 0) {
            removeDocumentLayersRef.current(Array.from(allDocumentIds))
            setSelectedDocumentLayerIds(new Set())
          }
        }
      }
      // Undo: Cmd/Ctrl+Z
      if (
        e.key === "z" &&
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !isEditing(e)
      ) {
        e.preventDefault()
        history.undo()
      }
      // Redo: Cmd/Ctrl+Shift+Z
      if (
        e.key === "z" &&
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        !isEditing(e)
      ) {
        e.preventDefault()
        history.redo()
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") {
        setSpaceHeld(false)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
    }
  }, [
    commentMode,
    newCommentPos,
    focusedIframeLayerId,
    createFlowIframeLayerId,
    history,
    openCursorChat,
    closeCursorChat,
    collections,
  ])

  const iframeLayers = useIframeLayers()
  const iframeLayerGroups = useIframeLayerGroups()
  const markdownLayers = useMarkdownLayers()
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
  const reorderDragRef_iframeLayerId = reorderDraggingIframeLayerId
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
        activeReorderDrag:
          reorderDragPopped && reorderDragRef_iframeLayerId && reorderDragCursor
            ? {
                memberId: reorderDragRef_iframeLayerId,
                cursor: reorderDragCursor,
                grabOffset: reorderGrabOffset,
              }
            : null,
        poppedMemberId: reorderDragPopped ? reorderDragRef_iframeLayerId : null,
      }),
    [
      iframeLayerGroups,
      iframeLayers,
      markdownLayers,
      selectedIframeLayerIds,
      selectedDocumentLayerIds,
      selectedGroupIds,
      reorderDragPopped,
      reorderDragRef_iframeLayerId,
      reorderDragCursor,
      reorderGrabOffset,
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

  const gapHandlesRef = useRef(gapHandles)

  const reorderHandles = canvasLayout.reorderHandles

  const reorderHandlesRef = useRef(reorderHandles)
  // Mirror the latest hit-test geometry into refs after commit (not during
  // render) so the pointer hit-testers can read it without re-binding.
  useEffect(() => {
    gapHandlesRef.current = gapHandles
    reorderHandlesRef.current = reorderHandles
  })
  const [hoveredReorderIframeLayerId, setHoveredReorderIframeLayerId] =
    useState<string | null>(null)

  /**
   * Hit-test the reorder dots in screen-space — the visual is 12px across at
   * any zoom, and we add a small pad so it stays grabbable at the edges.
   */
  const hitTestReorderHandle = useCallback(
    (canvasX: number, canvasY: number, currentZoom: number) => {
      const radiusCanvas = 8 / currentZoom
      for (const h of reorderHandlesRef.current) {
        const dx = canvasX - h.centerX
        const dy = canvasY - h.centerY
        if (dx * dx + dy * dy <= radiusCanvas * radiusCanvas) return h
      }
      return null
    },
    []
  )

  /**
   * World-space hit test against the entire gap area between two iframeLayers —
   * matches the symaphore behavior where hovering anywhere in the gap reveals
   * the handle. The 6px screen-space pad keeps the handle grabbable when the
   * gap has been collapsed to 0 (cursor is then over the touching edge of an
   * iframeLayer, but the canvas wrapper still picks the gap drag).
   */
  const hitTestGapHandle = useCallback(
    (canvasX: number, canvasY: number, currentZoom: number) => {
      const padCanvas = 6 / currentZoom
      for (const h of gapHandlesRef.current) {
        if (canvasY < h.top || canvasY > h.bottom) continue
        if (canvasX < h.left - padCanvas || canvasX > h.right + padCanvas)
          continue
        return h
      }
      return null
    },
    []
  )

  /** Set of iframeLayer ids whose parent group is currently selected. */
  const groupSelectedIframeLayerIds = useMemo(() => {
    const ids = new Set<string>()
    if (selectedGroupIds.size === 0) return ids
    for (const g of iframeLayerGroups) {
      if (!selectedGroupIds.has(g.id)) continue
      // Highlight every member of the selected group — iframeLayers *and*
      // markdownLayers — so docs visually participate in group selection the
      // same way frames do.
      for (const m of getGroupMembers(g)) ids.add(m.id)
    }
    return ids
  }, [iframeLayerGroups, selectedGroupIds])
  // Documents share iframeLayer layouts and the same selection visuals (1px
  // fuchsia ring on hover/select, resize handle dots when single-selected).
  // The overlay treats every member id uniformly via `iframeLayerLayouts`, so
  // we just merge selection sets here.
  const overlaySelectedIds = useMemo(() => {
    const ids = new Set<string>(selectedIframeLayerIds)
    for (const id of selectedDocumentLayerIds) ids.add(id)
    return ids
  }, [selectedIframeLayerIds, selectedDocumentLayerIds])
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

  // Lazily prune terminal tabs whose Branch no longer exists (branch deleted),
  // so a dead terminal never lingers pointing at a gone sandbox (#260). We get
  // here only post-sync (render is gated on the Yjs initial sync), so an absent
  // branch is a genuinely deleted one — not an unhydrated collection — making it
  // safe to also delete the persisted row, not just drop the tab from the strip.
  // Depends on `localTerminals` too so a row restored from Postgres for an
  // already-deleted branch is pruned on connect/load, with no background job.
  // The state update here reconciles React state with externally-sourced data
  // (Postgres-restored terminal rows vs. live branches), which is a legitimate
  // effect sync rather than an avoidable render cascade.
  useEffect(() => {
    const branchIds = new Set(agents.map((a) => a.id))
    const { orphaned } = partitionTerminalsByBranch(localTerminals, branchIds)
    if (orphaned.length === 0) return
    // Drop the orphans from the tab strip…
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalTerminals((prev) => prev.filter((t) => branchIds.has(t.branchId)))
    // …and delete their `terminalTab` rows so they don't resurrect next load.
    // Best-effort + idempotent: deleting an already-gone row is a no-op.
    for (const orphan of orphaned) {
      deleteTerminalTabAction({ roomId, id: orphan.id }).catch((err) => {
        console.error("Failed to prune orphaned terminal tab", err)
      })
    }
  }, [agents, localTerminals, roomId])

  const diffStats = useDiffStats(agents, repos)
  const { branchPrs, setBranchPr } = useBranchPrs(agents, repos)

  const chatSessions = useChatSessions()
  const savedViewport = useSavedViewport()

  const saveViewport = useCallback(
    (vp: ViewportData) => {
      ops.saveViewport(vp)
    },
    [ops]
  )

  const saveViewportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const saveViewportDebounced = useCallback(
    (vp: ViewportData) => {
      if (saveViewportTimerRef.current)
        clearTimeout(saveViewportTimerRef.current)
      saveViewportTimerRef.current = setTimeout(() => saveViewport(vp), 500)
    },
    [saveViewport]
  )

  useEffect(() => {
    if (viewportRestoredRef.current) return
    if (!savedViewport) return
    const ref = transformRef.current
    if (!ref) return
    viewportRestoredRef.current = true
    ref.setTransform(savedViewport.x, savedViewport.y, savedViewport.zoom, 0)
    setZoom(savedViewport.zoom)
    setViewportPos({ x: savedViewport.x, y: savedViewport.y })
    setPresence({ viewport: savedViewport })
  }, [savedViewport, setPresence])

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

  const getViewportCenter = useCallback(() => {
    const ref = transformRef.current
    let cx = CANVAS_SIZE / 2
    let cy = CANVAS_SIZE / 2

    if (ref) {
      const { positionX, positionY, scale } = ref.state
      const w = window.innerWidth
      const h = window.innerHeight
      cx = (-positionX + w / 2) / scale
      cy = (-positionY + h / 2) / scale
    }
    return { cx, cy }
  }, [])

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

  /** Append a new iframeLayer to an existing group, mirroring the last sibling iframeLayer's size and agent. */
  const addIframeLayerToGroup = useCallback(
    (groupId: string): string | undefined => {
      const group = collections.iframeLayerGroups.get(groupId)
      if (!group) return
      const members = getGroupMembers(group)
      if (members.length === 0) return
      // Mirror the last *iframeLayer* sibling for size/agent/route when one
      // exists. For doc-only groups, fall back to the last member's bounds
      // so the new frame visually replaces the placeholder rect the user
      // just clicked.
      const iframeLayerIds = getGroupMemberIds(group, "iframe-layer")
      const lastIframeLayerId = iframeLayerIds[iframeLayerIds.length - 1]
      const lastIframeLayer = lastIframeLayerId
        ? collections.iframeLayers.get(lastIframeLayerId)
        : undefined
      let width: number
      let height: number
      let branchId: string | undefined
      let route: string | undefined
      if (lastIframeLayer) {
        width = lastIframeLayer.width
        height = lastIframeLayer.height
        branchId = lastIframeLayer.branchId
        route = lastIframeLayer.route
      } else {
        const lastMember = members[members.length - 1]!
        const lastDoc = collections.markdownLayers.get(lastMember.id)
        if (!lastDoc) return
        width = lastDoc.width
        height = lastDoc.height
      }
      return ops.addFrameToGroup(groupId, {
        width,
        height,
        label: branchId ? `Frame ${iframeLayerIds.length + 1}` : "Frame",
        ...(branchId ? { branchId } : {}),
        ...(route ? { route } : {}),
      })
    },
    [collections, ops]
  )

  /** Translate the groups containing any of the given iframeLayers/markdownLayers by (dx, dy). */
  const moveIframeLayersByDelta = useCallback(
    (ids: string[], dx: number, dy: number) => {
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

  /**
   * Called from a layer's drag hook the moment a drag actually begins.
   * `layerId` is the layer the user grabbed. If the drag will translate
   * exactly one group (single-layer drag, or multi-select confined to a
   * single group), we arm the merge-snap by remembering its source group.
   * Drags that move multiple groups don't enable snapping — it would be
   * ambiguous which group merges into which.
   */
  /**
   * Start a reorder drag programmatically from a layer-owned element (e.g. the
   * frame's name label). Mirrors the path taken when the user grabs the
   * reorder dot directly: pointer capture is moved to the canvas wrapper so
   * the existing `handleCanvasPointerMove` / `handleCanvasPointerUp` handlers
   * drive the gesture. Returns `true` if the reorder started (so the caller
   * can skip its own fallback drag), or `false` for single-member groups
   * where reorder doesn't make sense.
   */
  const requestReorderDrag = useCallback(
    (iframeLayerId: string, e: React.PointerEvent): boolean => {
      const group = collections.iframeLayerGroups
        .toArray()
        .find((g) => getGroupMembers(g).some((m) => m.id === iframeLayerId))
      if (!group) return false
      if (getGroupMembers(group).length < 2) return false
      const wrapper = canvasWrapperRef.current
      if (!wrapper) return false
      const transform = transformRef.current
      if (!transform) return false
      const rect = wrapper.getBoundingClientRect()
      const { positionX, positionY, scale } = transform.state
      const canvas = {
        x: (e.clientX - rect.left - positionX) / scale,
        y: (e.clientY - rect.top - positionY) / scale,
      }
      const layout = iframeLayerLayoutsRef.current.get(iframeLayerId)
      const grabOffset = layout
        ? { x: canvas.x - layout.x, y: canvas.y - layout.y }
        : { x: 0, y: 0 }
      reorderDragRef.current = {
        groupId: group.id,
        iframeLayerId,
        startCanvas: canvas,
        grabOffset,
        startShiftKey: e.shiftKey,
        selectOnNoMove: true,
      }
      setReorderDraggingIframeLayerId(iframeLayerId)
      setReorderGrabOffset(grabOffset)
      wrapper.setPointerCapture(e.pointerId)
      e.stopPropagation()
      e.preventDefault()
      return true
    },
    [collections]
  )

  /**
   * Recompute the group merge-snap from the source group's *live* position and
   * publish the result: the hot target into `groupDragTargetRef` (read by the
   * drag-end handler) and the highlight rects into state (drawn by
   * `GroupMergeUnderlay`). No-op when the drag can't merge (multi-group drag,
   * no captured state) or when meta/cmd is held to drop freely. Called off the
   * render path — at drag start, from the move heartbeat after the move is
   * applied, and from the meta-key listener so the preview flips the instant
   * cmd is pressed or released between moves.
   */
  const applyMergeSnap = useCallback(
    (metaKey: boolean) => {
      const state = mergeSnapStateRef.current
      const sourceId = groupDragSourceRef.current
      if (!state || !sourceId || metaKey) {
        groupDragTargetRef.current = null
        setGroupDragSnapRects(null)
        return
      }
      const source = collections.iframeLayerGroups.get(sourceId)
      if (!source) {
        groupDragTargetRef.current = null
        setGroupDragSnapRects(null)
        return
      }
      const result = computeMergeSnap({
        rect: {
          x: source.x,
          y: source.y,
          width: state.sourceContentW,
          height: state.sourceContentH,
        },
        memberSizes: state.memberSizes,
        candidates: state.candidates,
      })
      groupDragTargetRef.current = result?.targetId ?? null
      setGroupDragSnapRects(result?.rects ?? null)
    },
    [collections]
  )

  // Flip the merge-snap preview the instant cmd/meta is pressed or released
  // between moves — meta held drops the group freely instead of merging.
  useEffect(() => {
    if (!draggingSourceGroupId) return
    const onKey = (ev: KeyboardEvent) => applyMergeSnap(ev.metaKey)
    window.addEventListener("keydown", onKey)
    window.addEventListener("keyup", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("keyup", onKey)
    }
  }, [draggingSourceGroupId, applyMergeSnap])

  const handleLayerGroupDragStart = useCallback(
    (layerId: string) => {
      layerDraggingRef.current = true
      setHoveredIframeLayerId(null)
      const selectedAb = selectedIframeLayerIdsRef.current
      const selectedDoc = selectedDocumentLayerIdsRef.current
      const selectedGroups = selectedGroupIdsRef.current
      const allGroups = collections.iframeLayerGroups.toArray()
      const layerSelected = selectedAb.has(layerId) || selectedDoc.has(layerId)
      const layerGroupSelected = allGroups.some(
        (g) =>
          selectedGroups.has(g.id) &&
          getGroupMembers(g).some((m) => m.id === layerId)
      )
      // Collect every group this drag will translate, mirroring the move
      // routing (see IframeLayer.handleDrag): grabbing a selected layer or a
      // member of a selected group drags the whole selection — all selected
      // frames' groups plus all selected groups; anything else drags just the
      // grabbed layer's group. Snapping only arms for a single moving group, so
      // a multi-group (e.g. mixed) drag falls through to the bail below.
      const groupIds = new Set<string>()
      if (layerSelected || layerGroupSelected) {
        for (const g of allGroups) {
          if (
            getGroupMembers(g).some(
              (m) => selectedAb.has(m.id) || selectedDoc.has(m.id)
            )
          )
            groupIds.add(g.id)
        }
        for (const gid of selectedGroups) groupIds.add(gid)
      } else {
        for (const g of allGroups) {
          if (getGroupMembers(g).some((m) => m.id === layerId))
            groupIds.add(g.id)
        }
      }
      if (groupIds.size !== 1) {
        groupDragSourceRef.current = null
        groupDragTargetRef.current = null
        mergeSnapStateRef.current = null
        setGroupDragSnapRects(null)
        setDraggingSourceGroupId(null)
        return
      }
      const sourceId = groupIds.values().next().value as string
      groupDragSourceRef.current = sourceId
      groupDragTargetRef.current = null
      setDraggingSourceGroupId(sourceId)

      // Merge-snap setup. The merge targets are every *other* non-empty group's
      // trailing "+ frame" slot; those don't move during this drag, so capture
      // them — along with the dragged group's member sizes — once here. The
      // source's live position is read each heartbeat in `applyMergeSnap`.
      mergeSnapStateRef.current = null
      setGroupDragSnapRects(null)
      const sourceGroup = collections.iframeLayerGroups.get(sourceId)
      if (sourceGroup) {
        const abArr = collections.iframeLayers.toArray()
        const docArr = collections.markdownLayers.toArray()
        const memberSizes: Array<{ width: number; height: number }> = []
        for (const m of getGroupMembers(sourceGroup)) {
          const size =
            m.kind === "iframe-layer"
              ? collections.iframeLayers.get(m.id)
              : collections.markdownLayers.get(m.id)
          if (size) memberSizes.push({ width: size.width, height: size.height })
        }
        const mergeCandidates: MergeSnapCandidate[] = []
        for (const target of collections.iframeLayerGroups.toArray()) {
          if (target.id === sourceId) continue
          if (getGroupMembers(target).length === 0) continue
          mergeCandidates.push({
            id: target.id,
            rect: {
              x: target.x,
              y: target.y,
              width: groupContentWidth(target, abArr, docArr),
              height: groupContentHeight(target, abArr, docArr),
            },
            gap: groupGap(target),
          })
        }
        mergeSnapStateRef.current = {
          sourceContentW: groupContentWidth(sourceGroup, abArr, docArr),
          sourceContentH: groupContentHeight(sourceGroup, abArr, docArr),
          memberSizes,
          candidates: mergeCandidates,
        }
        // Seed the preview from the resting position so a drag that begins
        // already over a target's slot goes hot immediately, matching the
        // previous render-path memo.
        applyMergeSnap(false)
      }

      // Edge-snap setup. Compute the union bbox of every layer that will move
      // (all members of the affected groups) and collect the rects of every
      // layer that *won't* move as snap candidates.
      const layouts = iframeLayerLayoutsRef.current
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      const candidates: MoveSnapRect[] = []
      for (const layout of layouts.values()) {
        if (groupIds.has(layout.groupId)) {
          if (layout.x < minX) minX = layout.x
          if (layout.y < minY) minY = layout.y
          if (layout.x + layout.width > maxX) maxX = layout.x + layout.width
          if (layout.y + layout.height > maxY) maxY = layout.y + layout.height
        } else {
          candidates.push({
            x: layout.x,
            y: layout.y,
            width: layout.width,
            height: layout.height,
          })
        }
      }
      if (minX < Infinity && candidates.length > 0) {
        dragSnapStateRef.current = {
          startUnion: {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
          },
          candidates,
          appliedSnap: { x: 0, y: 0 },
        }
      } else {
        dragSnapStateRef.current = null
      }
    },
    [collections, applyMergeSnap]
  )

  /**
   * Commit-or-clear when a group drag ends. If a target was snapped and the
   * user isn't holding meta/cmd, append the source group's members onto the
   * target and delete the (now empty) source. The target absorbs the source
   * — its world `(x, y)` stays put, so the merged row stays where the user
   * dropped onto.
   */
  const handleLayerGroupDragEnd = useCallback(
    (metaKey: boolean) => {
      layerDraggingRef.current = false
      dragSnapStateRef.current = null
      mergeSnapStateRef.current = null
      setSnapGuides([])
      setGroupDragSnapRects(null)
      const sourceId = groupDragSourceRef.current
      const targetId = groupDragTargetRef.current
      groupDragSourceRef.current = null
      groupDragTargetRef.current = null
      setDraggingSourceGroupId(null)
      if (!sourceId || !targetId || metaKey) return
      const source = collections.iframeLayerGroups.get(sourceId)
      const target = collections.iframeLayerGroups.get(targetId)
      if (!source || !target || source.id === target.id) return
      const sourceMembers = getGroupMembers(source)
      if (sourceMembers.length === 0) return
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
    },
    [collections, ops]
  )

  /**
   * Per-gesture resize state. The hook emits raw screen-derived deltas every
   * pointer move; we accumulate them against the iframeLayer's size at gesture
   * start so the snap math sees the *un-snapped* proposed size, not the
   * already-snapped value we wrote on the previous frame. Without that, once
   * the iframeLayer locked onto a preset the cumulative delta would never reach
   * the next preset.
   */
  const resizeRawRef = useRef<{
    iframeLayerId: string
    edge: ResizeEdge
    initialWidth: number
    initialHeight: number
    rawDw: number
    rawDh: number
  } | null>(null)

  /**
   * Holding cmd/meta (or ctrl on non-Mac) during a resize disables the
   * device-size snap so the user can fine-tune freely past a preset.
   * Tracked via window listeners so it stays accurate even between pointer
   * moves (e.g. user presses cmd while idle on a preset width).
   */
  const resizeMetaHeldRef = useRef(false)
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      resizeMetaHeldRef.current = ev.metaKey
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("keyup", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("keyup", onKey)
    }
  }, [])

  /** Snap underlay state — drives the device-size ghosts shown during a resize. */
  const [resizeSnap, setResizeSnap] = useState<{
    iframeLayerId: string
    edge: ResizeEdge
    anchor: AnchorCorner
    candidates: SnapCandidate[]
    snappedPresetId: string | null
  } | null>(null)

  const handleResizeStart = useCallback(
    (id: string, edge: ResizeEdge) => {
      const a = collections.iframeLayers.get(id)
      if (!a) return
      resizeRawRef.current = {
        iframeLayerId: id,
        edge,
        initialWidth: a.width,
        initialHeight: a.height,
        rawDw: 0,
        rawDh: 0,
      }
    },
    [collections]
  )

  const handleResizeEnd = useCallback(() => {
    resizeRawRef.current = null
    setResizeSnap(null)
  }, [])

  /**
   * Resize handler from a single iframeLayer's edge.
   * - (dx, dy) shifts the iframeLayer's parent group by that delta — non-zero
   *   only for top (`dy`) and left (`dx`) edges, so the group anchor follows
   *   the dragged edge while the right/bottom stays put.
   * - (dw, dh) is applied to this iframeLayer's own width/height (clamped to
   *   the 320×200 minimum). Other iframeLayers in the group keep their size.
   * - `edge` lets us snap to nearby device-size presets and emit the
   *   underlay state used to render their ghosts.
   */
  const resizeIframeLayerEdge = useCallback(
    (
      id: string,
      edge: ResizeEdge,
      dx: number,
      dy: number,
      dw: number,
      dh: number
    ) => {
      ops.batch(() => {
        const a = collections.iframeLayers.get(id)
        if (!a) return

        // Initialize raw state lazily if startResize didn't fire — defensive
        // against any future call sites that bypass the gesture lifecycle.
        if (
          !resizeRawRef.current ||
          resizeRawRef.current.iframeLayerId !== id
        ) {
          resizeRawRef.current = {
            iframeLayerId: id,
            edge,
            initialWidth: a.width,
            initialHeight: a.height,
            rawDw: 0,
            rawDh: 0,
          }
        }

        const rs = resizeRawRef.current
        rs.rawDw += dw
        rs.rawDh += dh
        const rawWidth = Math.max(
          MIN_IFRAME_LAYER_WIDTH,
          rs.initialWidth + rs.rawDw
        )
        const rawHeight = Math.max(
          MIN_IFRAME_LAYER_HEIGHT,
          rs.initialHeight + rs.rawDh
        )

        // Cmd/meta held → bypass snap entirely (no candidates, no lock).
        const snap = resizeMetaHeldRef.current
          ? {
              candidates: [],
              width: rawWidth,
              height: rawHeight,
              snappedPresetId: null,
              snappedOrientation: null,
            }
          : computeDeviceSnap({ edge, rawWidth, rawHeight, zoom })
        const newWidth = Math.max(MIN_IFRAME_LAYER_WIDTH, snap.width)
        const newHeight = Math.max(MIN_IFRAME_LAYER_HEIGHT, snap.height)
        const actualDw = newWidth - a.width
        const actualDh = newHeight - a.height
        // The resize hook only sends a non-zero `dx`/`dy` for left/top edge
        // drags (where `dx ≈ -dw` and `dy ≈ -dh`). Once the iframeLayer hits its
        // minimum, `actualDw`/`actualDh` shrink toward 0 — mirror them with
        // the opposite sign so the group anchor stays pinned to the
        // un-dragged side instead of marching off with the cursor.
        const shiftX = dx === 0 ? 0 : -actualDw
        const shiftY = dy === 0 ? 0 : -actualDh
        if (shiftX !== 0 || shiftY !== 0) {
          for (const g of collections.iframeLayerGroups.toArray()) {
            if (getGroupMembers(g).some((m) => m.id === id)) {
              ops.patch("iframeLayerGroups", g.id, {
                x: g.x + shiftX,
                y: g.y + shiftY,
              })
              break
            }
          }
        }
        if (actualDw !== 0 || actualDh !== 0) {
          ops.patch("iframeLayers", id, { width: newWidth, height: newHeight })
        }

        setResizeSnap({
          iframeLayerId: id,
          edge,
          anchor: anchorCornerForEdge(edge),
          candidates: snap.candidates,
          snappedPresetId: snap.snappedPresetId,
        })
      })
    },
    [collections, ops, zoom]
  )

  const renameIframeLayer = useCallback(
    (id: string, label: string) => {
      ops.patch("iframeLayers", id, { label })
    },
    [ops]
  )

  const fitIframeLayerToContent = useCallback(
    (id: string, width: number, height: number) => {
      // Ceil rather than round so sub-pixel content extents never shrink the
      // iframeLayer below the actual content (which would creep smaller on each
      // repeated Fit click).
      const newWidth = Math.max(MIN_IFRAME_LAYER_WIDTH, Math.ceil(width))
      const newHeight = Math.max(MIN_IFRAME_LAYER_HEIGHT, Math.ceil(height))
      ops.patch("iframeLayers", id, { width: newWidth, height: newHeight })
    },
    [ops]
  )

  const removeIframeLayers = useCallback(
    (ids: string[]) => {
      ops.removeLayers(ids)
    },
    [ops]
  )
  useEffect(() => {
    removeIframeLayersRef.current = removeIframeLayers
  })

  /**
   * After deleting a single iframeLayer, prefer keeping the user near the same
   * spot in the row: pick the right-hand iframeLayer neighbor, falling back to
   * the left. Skips document members so the next selection is always a
   * frame. Returns null if no neighbor iframeLayer exists.
   */
  const computeNextSelectionAfterDelete = useCallback(
    (deletedId: string): string | null => {
      for (const g of collections.iframeLayerGroups.toArray()) {
        const ids = getGroupMemberIds(g, "iframe-layer")
        const idx = ids.indexOf(deletedId)
        if (idx === -1) continue
        return ids[idx + 1] ?? ids[idx - 1] ?? null
      }
      return null
    },
    [collections]
  )

  const removeIframeLayer = useCallback(
    (id: string) => {
      const next = computeNextSelectionAfterDelete(id)
      removeIframeLayers([id])
      if (next) {
        setSelectedIframeLayerIds(new Set([next]))
        setSelectedGroupIds(new Set())
        setSelectedDocumentLayerIds(new Set())
      } else {
        setSelectedIframeLayerIds(new Set())
      }
    },
    [computeNextSelectionAfterDelete, removeIframeLayers]
  )

  // Use a ref so the route handler (passed as a stable callback to many
  // places) sees the latest Create Flow selection without forcing every
  // consumer to re-bind on toggle.
  const createFlowIframeLayerIdRef = useRef<string | null>(null)
  useEffect(() => {
    createFlowIframeLayerIdRef.current = createFlowIframeLayerId
  })

  const updateIframeLayerRoute = useCallback(
    (id: string, route: string, replace = false) => {
      // In Create Flow mode the verb leaves a clone of the previous route in
      // the group (immediately left of the navigated frame) and reports how far
      // to pan so the navigated frame stays visually anchored as the trail
      // grows leftward. The pan is the only part that touches React/viewport
      // state, so it stays here; every Y.Doc write lives behind the verb.
      //
      // A `replace` change (replaceState / initial-load report) edits the
      // current URL in place rather than navigating, so it never leaves a
      // trail clone — otherwise a framework's post-navigation replaceState
      // (path normalization, query/scroll sync) would double every step.
      const cloneTrail = !replace && createFlowIframeLayerIdRef.current === id
      const { viewportShift } = ops.navigateRoute(id, route, { cloneTrail })

      if (viewportShift > 0) {
        const ref = transformRef.current
        if (ref) {
          const { positionX, positionY, scale } = ref.state
          ref.setTransform(
            positionX - viewportShift * scale,
            positionY,
            scale,
            0
          )
        }
      }
    },
    [ops]
  )

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
   * Reorder the members inside a group — also reflects on the canvas via
   * flex order. Accepts a fully-typed member ordering so callers can mix
   * iframeLayers and markdownLayers in the same row.
   */
  const reorderGroupMembers = useCallback(
    (groupId: string, orderedMembers: GroupMember[]) => {
      ops.patch("iframeLayerGroups", groupId, { members: orderedMembers })
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

  const setGroupGap = useCallback(
    (groupId: string, gap: number) => {
      ops.patch("iframeLayerGroups", groupId, { gap: Math.max(0, gap) })
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
      setSelectedGroupIds((prev) => {
        if (!prev.has(groupId)) return prev
        const next = new Set(prev)
        next.delete(groupId)
        return next
      })
    },
    [collections, ops]
  )

  const assignAgentToIframeLayer = useCallback(
    (iframeLayerId: string, agentId: string) => {
      ops.patch("iframeLayers", iframeLayerId, { branchId: agentId })
    },
    [ops]
  )

  const updateIframeLayerState = useCallback(
    (id: string, state: JsonObject) => {
      ops.patch("iframeLayers", id, { iframeState: state })
    },
    [ops]
  )

  const updateIframeLayerScroll = useCallback(
    (id: string, scrollX: number, scrollY: number) => {
      ops.patch("iframeLayers", id, { scrollX, scrollY })
    },
    [ops]
  )

  const updateIframeLayerKnobs = useCallback(
    (id: string, knobs: JsonValue[]) => {
      ops.patch("iframeLayers", id, { knobs })
    },
    [ops]
  )

  const updateIframeLayerKnobValues = useCallback(
    (id: string, knobValues: JsonObject) => {
      ops.patch("iframeLayers", id, { knobValues })
    },
    [ops]
  )

  const updateIframeLayerSharedState = useCallback(
    (id: string, sharedState: JsonObject) => {
      ops.patch("iframeLayers", id, { sharedState })
    },
    [ops]
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
      selectedChatByDocumentRef.current[docId] = chatId
      return docId
    },
    [ops]
  )

  /**
   * Resize a document by edge deltas. `dw`/`dh` adjust this doc's own width
   * and height; `dx`/`dy` are non-zero only for left/top edge drags and shift
   * the parent group's anchor so the un-dragged side stays put — mirrors
   * `resizeIframeLayerEdge` exactly so docs feel like iframeLayers.
   */
  const resizeDocumentLayer = useCallback(
    (id: string, dx: number, dy: number, dw: number, dh: number) => {
      ops.batch(() => {
        const d = collections.markdownLayers.get(id)
        if (!d) return
        const minW = 200
        const minH = 120
        const newWidth = Math.max(minW, d.width + dw)
        const newHeight = Math.max(minH, d.height + dh)
        const actualDw = newWidth - d.width
        const actualDh = newHeight - d.height
        const shiftX = dx === 0 ? 0 : -actualDw
        const shiftY = dy === 0 ? 0 : -actualDh
        if (shiftX !== 0 || shiftY !== 0) {
          for (const g of collections.iframeLayerGroups.toArray()) {
            if (getGroupMembers(g).some((m) => m.id === id)) {
              ops.patch("iframeLayerGroups", g.id, {
                x: g.x + shiftX,
                y: g.y + shiftY,
              })
              break
            }
          }
        }
        if (actualDw !== 0 || actualDh !== 0) {
          ops.patch("markdownLayers", id, {
            width: newWidth,
            height: newHeight,
          })
        }
      })
    },
    [collections, ops]
  )

  /** Mirror the editor's first-heading text onto the cached `title` field.
   *  Called from inside the editor's update handler so it must NOT rewrite
   *  the heading itself — that would clobber the user's active selection
   *  on every keystroke. Cache-only. */
  const setDocumentLayerTitleCache = useCallback(
    (id: string, title: string) => {
      ops.patch("markdownLayers", id, { title })
    },
    [ops]
  )

  /** Rename a document from outside the editor (sidebar, agent tool). Writes
   *  the new title text into the editor's first heading so every peer's
   *  editor view updates, then mirrors onto the cache. */
  const setDocumentLayerTitle = useCallback(
    (id: string, title: string) => {
      ops.renameDocument(id, title)
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
  useEffect(() => {
    removeDocumentLayersRef.current = removeDocumentLayers
  })

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

  const zoomToDomElement = useCallback((el: HTMLElement) => {
    const ref = transformRef.current
    if (!ref) return
    const padding = 20
    const wrapperW =
      ref.instance.wrapperComponent?.clientWidth ?? window.innerWidth
    const wrapperH =
      ref.instance.wrapperComponent?.clientHeight ?? window.innerHeight
    const scale = Math.min(
      (wrapperW - padding * 2) / el.offsetWidth,
      (wrapperH - padding * 2) / el.offsetHeight,
      ZOOM_MAX
    )
    ref.zoomToElement(el, scale, 300)
  }, [])

  const handleSelectIframeLayer = useCallback(
    (iframeLayerId: string) => {
      const el = document.getElementById(`iframe-layer-${iframeLayerId}`)
      if (el) zoomToDomElement(el)
    },
    [zoomToDomElement]
  )

  const handleZoomToDocument = useCallback(
    (markdownLayerId: string) => {
      const el = document.getElementById(`markdown-layer-${markdownLayerId}`)
      if (el) zoomToDomElement(el)
    },
    [zoomToDomElement]
  )

  const handleZoomToGroup = useCallback(
    (groupId: string) => {
      const ref = transformRef.current
      if (!ref) return
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
      const worldW = maxX - minX
      const worldH = maxY - minY
      if (worldW <= 0 || worldH <= 0) return
      const padding = 20
      const wrapperW =
        ref.instance.wrapperComponent?.clientWidth ?? window.innerWidth
      const wrapperH =
        ref.instance.wrapperComponent?.clientHeight ?? window.innerHeight
      const scale = Math.min(
        (wrapperW - padding * 2) / worldW,
        (wrapperH - padding * 2) / worldH,
        ZOOM_MAX
      )
      const centerX = (minX + maxX) / 2
      const centerY = (minY + maxY) / 2
      const positionX = wrapperW / 2 - centerX * scale
      const positionY = wrapperH / 2 - centerY * scale
      ref.setTransform(positionX, positionY, scale, 300)
    },
    [iframeLayerGroups, effectiveIframeLayerLayouts]
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

  const handleSelectAgent = useCallback(
    (agentId: string | null, options?: { expandPanel?: boolean }) => {
      if (!agentId) return

      // Save outgoing agent's chat selection
      if (selectedAgentId && selectedChatId) {
        selectedChatByAgentRef.current[selectedAgentId] = selectedChatId
      }

      // Save agent selection for its repo
      const agent = agents.find((a) => a.id === agentId)
      if (agent) {
        selectedAgentByRepoRef.current[agent.repoId] = agentId
      }

      setSelectedAgentId(agentId)

      // Restore remembered chat or fall back to first open
      const rememberedChat = selectedChatByAgentRef.current[agentId]
      const agentChats = chatSessions
        .filter((c) => c.branchId === agentId && !c.closedAt)
        .sort((a, b) => a.createdAt - b.createdAt)
      if (rememberedChat && agentChats.some((c) => c.id === rememberedChat)) {
        setSelectedChatId(rememberedChat)
      } else {
        setSelectedChatId(agentChats[0]?.id ?? null)
      }

      if (options?.expandPanel !== false) {
        const panel = chatPanelRef.current
        if (panel?.isCollapsed()) {
          panel.expand()
          const { inPixels } = panel.getSize()
          if (inPixels < 480) panel.resize(480)
        }
      }
    },
    [agents, chatSessions, selectedAgentId, selectedChatId]
  )

  const handleCreateChat = useCallback(
    (agentId: string) => {
      const id = nanoid()
      const data: ChatSessionData = {
        id,
        branchId: agentId,
        label: "Untitled",
        createdAt: Date.now(),
      }
      addChatSession(id, data)
      setSelectedAgentId(agentId)
      setSelectedChatId(id)
    },
    [addChatSession]
  )

  /**
   * Create a new terminal tab against `agentId`'s sandbox. Unlike
   * `handleCreateChat` it builds a `TerminalTabData` (using the tab id as the
   * shared live-view `terminalSessionId`) held in the client-local
   * `localTerminals` collection — never in `chatSessions` — so the panel mounts
   * a terminal body instead of the Engine chat and the conversation model can
   * never, by type, see it.
   */
  const handleCreateTerminal = useCallback(
    (agentId: string, harnessKey: string) => {
      const id = nanoid()
      const tab = createTerminalTab({
        id,
        branchId: agentId,
        createdAt: Date.now(),
        // The harness the operator picked (or the sticky default) — #290. Stored
        // on the row so it's authoritative and survives reload/rebuild.
        harnessKey,
      })
      setLocalTerminals((prev) => [...prev, tab])
      setSelectedAgentId(agentId)
      setSelectedChatId(id)
      // Persist so the tab survives reload and follows the User across devices.
      // Optimistic: the tab is already in local state; a failed write only
      // means it won't be restored next load.
      createTerminalTabAction({
        roomId,
        branch: agentId,
        id: tab.id,
        label: tab.label,
        harnessKey: tab.harnessKey,
        createdAt: tab.createdAt,
      }).catch((err) => {
        console.error("Failed to persist terminal tab", err)
      })
    },
    [roomId]
  )

  /**
   * Create the user's preferred default tab (chat or terminal) for an agent
   * branch. This is the one place the "open a fresh branch" and "the last tab
   * was just closed" flows share, so the auto-created tab always follows the
   * per-user pref ({@link readLastTabKind}) rather than whatever kind happened
   * to be closed. Selects the new tab unless `select` is false (branch-create
   * defers selection to when the sandbox is ready). Returns the new tab id.
   */
  const createDefaultTabForBranch = useCallback(
    (branchId: string, kind: TabKind, options?: { select?: boolean }) => {
      const select = options?.select !== false
      if (kind === "terminal") {
        const tab = createTerminalTab({
          id: nanoid(),
          branchId,
          createdAt: Date.now(),
          // A terminal-default tab launches the same harness as the "+" button:
          // the operator's last-selected harness (#290), falling back to the
          // catalog default. If it's since been uninstalled the server resolves
          // it to a plain shell, so a stale pref degrades gracefully.
          harnessKey:
            (userId ? readLastHarnessKey(userId) : null) ?? DEFAULT_HARNESS_KEY,
        })
        setLocalTerminals((prev) => [...prev, tab])
        if (select) setSelectedChatId(tab.id)
        createTerminalTabAction({
          roomId,
          branch: branchId,
          id: tab.id,
          label: tab.label,
          harnessKey: tab.harnessKey,
          createdAt: tab.createdAt,
        }).catch((err) => {
          console.error("Failed to persist terminal tab", err)
        })
        return tab.id
      }
      const id = nanoid()
      addChatSession(id, {
        id,
        branchId,
        label: "Untitled",
        createdAt: Date.now(),
      })
      if (select) setSelectedChatId(id)
      return id
    },
    [roomId, addChatSession, userId]
  )

  /**
   * Seed a freshly-created branch's default tab to the user's pref. Both kinds
   * (chat or terminal) are seeded client-side now — selection deferred until the
   * sandbox is ready — so the tab shows up immediately rather than only after
   * the provisioning pipeline finishes (the chat pref used to wait on the
   * server's `ensureChatForBranch`, leaving the branch tab-less in the meantime).
   * Since the client always pre-seeds, the server is told to skip its auto chat.
   * Returns the `seedChat` flag to forward to the create API.
   */
  const seedDefaultTabForNewBranch = useCallback(
    (branchId: string): boolean => {
      createDefaultTabForBranch(branchId, readLastTabKind(), { select: false })
      return false
    },
    [createDefaultTabForBranch]
  )

  // Close a local terminal tab: it's ephemeral, so closing simply drops it
  // (no closed-chats archive). The panel must keep at least one tab of *either*
  // kind per agent, so if this terminal is the last tab on its branch — no
  // sibling terminal and no open chat — recreate the user's preferred default
  // tab kind (which may be a chat, not another terminal). This parallels the
  // replacement in handleCloseChat. Otherwise, if it was selected, fall back to
  // a sibling terminal, then an open chat, then clear selection.
  const handleCloseTerminal = useCallback(
    (id: string, nextSelectedId?: string) => {
      const closing = localTerminals.find((t) => t.id === id)
      const branchId = closing?.branchId
      const terminalSiblings = localTerminals
        .filter((t) => t.id !== id && t.branchId === branchId)
        .sort((a, b) => a.createdAt - b.createdAt)
      const chatSiblings = branchId
        ? chatSessions
            .filter((c) => c.branchId === branchId && !c.closedAt)
            .sort((a, b) => a.createdAt - b.createdAt)
        : []
      const needsReplacement =
        !!branchId && terminalSiblings.length === 0 && chatSiblings.length === 0
      setLocalTerminals((prev) => prev.filter((t) => t.id !== id))
      if (needsReplacement && branchId) {
        // createDefaultTabForBranch creates + selects the replacement (and
        // persists it when it's a terminal), so no inline add/select here.
        createDefaultTabForBranch(branchId, readLastTabKind())
      } else if (selectedChatId === id) {
        setSelectedChatId(
          nextSelectedId ??
            terminalSiblings[0]?.id ??
            chatSiblings[0]?.id ??
            null
        )
      }
      // Closing an X permanently deletes the row (a reload alone never does).
      deleteTerminalTabAction({ roomId, id }).catch((err) => {
        console.error("Failed to delete terminal tab", err)
      })
      // …and kills the tab's tmux session so its shell + any running process
      // (e.g. a harness) actually stops, not just the tab UI. Separate from the
      // row delete so a down sandbox can't keep the tab around. Best-effort: a
      // session that's already gone resolves fine.
      const sandboxName = agents.find((a) => a.id === branchId)?.sandboxName
      if (closing && sandboxName) {
        killTerminalSessionAction({
          roomId,
          sandboxName,
          terminalSessionId: closing.terminalSessionId,
        }).catch((err) => {
          console.error("Failed to kill terminal session", err)
        })
      }
    },
    [
      selectedChatId,
      chatSessions,
      localTerminals,
      roomId,
      agents,
      createDefaultTabForBranch,
    ]
  )

  /**
   * Create a new chat tab targeting a document layer. Mirrors
   * `handleCreateChat` but stamps `markdownLayerId` instead of `agentId` so the
   * server picks the doc-targeted flow when this chat first sends a
   * message.
   */
  const handleCreateDocumentChat = useCallback(
    (markdownLayerId: string) => {
      const id = nanoid()
      addChatSession(id, {
        id,
        markdownLayerId,
        label: "Untitled",
        createdAt: Date.now(),
      })
      setSelectedAgentId(null)
      setSelectedDocumentChatTargetId(markdownLayerId)
      setSelectedChatId(id)
      selectedChatByDocumentRef.current[markdownLayerId] = id
    },
    [addChatSession]
  )

  const handleRebaseOnDefault = useCallback(
    (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId)
      if (!agent?.sandboxName || !agent.ref) return
      const repo = repos.find((w) => w.id === agent.repoId)
      if (!repo) return

      const message = `Rebase this branch onto the latest \`origin/${repo.defaultBranch}\`. Fetch first, then rebase. If conflicts come up, walk me through them before resolving.`

      const existingChats = chatSessions
        .filter((c) => c.branchId === agentId && !c.closedAt)
        .sort((a, b) => a.createdAt - b.createdAt)
      const remembered = selectedChatByAgentRef.current[agentId]
      const targetChat =
        existingChats.find((c) => c.id === remembered) ?? existingChats[0]

      let chatId: string
      let planMode: boolean | undefined
      let model: string | undefined
      const targetBusy = targetChat
        ? chatStore.getSnapshot(targetChat.id).isStreaming ||
          targetChat.isStreaming === true
        : false

      if (!targetChat || targetBusy) {
        chatId = nanoid()
        addChatSession(chatId, {
          id: chatId,
          branchId: agentId,
          label: "Untitled",
          createdAt: Date.now(),
        })
      } else {
        chatId = targetChat.id
        planMode = targetChat.planMode
        model = targetChat.model
      }

      const isFirstChat = !chatSessions.some(
        (c) => c.branchId === agentId && c.id !== chatId
      )

      chatStore.sendMessage({
        roomId,
        chatId,
        sandboxName: agent.sandboxName,
        branch: agent.ref,
        message,
        isFirstChat,
        autoNamedBranch: agent.autoNamedBranch,
        planMode,
        model,
        onBranchRename: (branch) =>
          updateAgentInStorage(agentId, {
            ref: branch,
            autoNamedBranch: false,
          }),
        onChatRename: (label) => updateChatSession(chatId, { label }),
      })

      setSelectedAgentId(agentId)
      setSelectedChatId(chatId)
      const panel = chatPanelRef.current
      if (panel?.isCollapsed()) {
        panel.expand()
        const { inPixels } = panel.getSize()
        if (inPixels < 480) panel.resize(480)
      }
    },
    [
      agents,
      repos,
      chatSessions,
      roomId,
      addChatSession,
      updateChatSession,
      updateAgentInStorage,
    ]
  )

  // Open a GitHub PR for a branch directly — the deterministic server action
  // (#355), no model turn. Shared by the Branch menu's "Create pull request"
  // item and the chat panel's button (which calls the action itself); both
  // surface the same toast. Disabled-while-busy is enforced at each trigger.
  const handleCreatePullRequest = useCallback(
    async (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId)
      if (!agent?.sandboxName) return
      const result = await createPullRequestAction(roomId, agent.sandboxName)
      if (result.success) {
        const { url, number } = result.value
        // Write the source of truth immediately so the sidebar icon, branch
        // menu, and chat button reflect the open PR now — not on the next poll.
        setBranchPr(agentId, { number, url, state: "open" })
        toast.success("Pull request created", {
          description: `#${number}`,
          action: {
            label: "View on GitHub",
            onClick: () => openExternal(url),
          },
        })
      } else {
        toast.error("Couldn't create pull request", {
          description: result.error,
        })
      }
    },
    [agents, roomId, setBranchPr]
  )

  const handleCloseChat = useCallback(
    (chatId: string, nextSelectedId?: string) => {
      if (isLocalTerminal(chatId)) {
        handleCloseTerminal(chatId, nextSelectedId)
        return
      }
      const chat = chatSessions.find((c) => c.id === chatId)
      // Filter siblings by the *same* target — agent chats and doc chats
      // each form their own pool. Without the markdownLayerId branch, every
      // doc chat would match every other doc chat (all share an undefined
      // agentId), and replacement chats would lose their document target.
      const sameTarget = (c: ChatSessionData) =>
        chat?.branchId
          ? c.branchId === chat.branchId
          : chat?.markdownLayerId
            ? c.markdownLayerId === chat.markdownLayerId
            : false
      const siblings = chat
        ? chatSessions
            .filter((c) => sameTarget(c) && c.id !== chatId && !c.closedAt)
            .sort((a, b) => a.createdAt - b.createdAt)
        : []
      // An open terminal on the same agent counts as a surviving tab too, so
      // closing the last chat next to a terminal no longer force-spawns a new
      // chat — the panel just keeps the terminal. (Doc chats have no terminals,
      // so this is only ever non-empty for agent targets.)
      const terminalSiblings = chat?.branchId
        ? localTerminals
            .filter((t) => t.branchId === chat.branchId)
            .sort((a, b) => a.createdAt - b.createdAt)
        : []
      updateChatSession(chatId, { closedAt: Date.now() })
      if (chat && siblings.length === 0 && terminalSiblings.length === 0) {
        // No tab of either kind survives on this target — recreate the user's
        // preferred default tab so the panel is never left empty. For an agent
        // target that's whichever kind the pref names (chat or terminal); doc
        // targets have no terminals, so they always recreate a chat.
        if (chat.branchId) {
          createDefaultTabForBranch(chat.branchId, readLastTabKind())
        } else {
          const newId = nanoid()
          addChatSession(newId, {
            id: newId,
            markdownLayerId: chat.markdownLayerId,
            label: "Untitled",
            createdAt: Date.now(),
          })
          setSelectedChatId(newId)
          if (chat.markdownLayerId) {
            selectedChatByDocumentRef.current[chat.markdownLayerId] = newId
          }
        }
      } else if (selectedChatId === chatId) {
        setSelectedChatId(
          nextSelectedId ?? siblings[0]?.id ?? terminalSiblings[0]?.id ?? null
        )
      }
    },
    [
      selectedChatId,
      chatSessions,
      localTerminals,
      updateChatSession,
      addChatSession,
      isLocalTerminal,
      handleCloseTerminal,
      createDefaultTabForBranch,
    ]
  )

  const handleReopenChat = useCallback(
    (chatId: string) => {
      updateChatSession(chatId, { closedAt: 0 })
      setSelectedChatId(chatId)
    },
    [updateChatSession]
  )

  const handleInspectHover = useCallback(
    (iframeLayerId: string, rect: DomRect | null) => {
      if (!rect) {
        setInspectHover((h) => (h?.iframeLayerId === iframeLayerId ? null : h))
      } else {
        setInspectHover({ iframeLayerId, rect })
      }
    },
    []
  )

  // The user clicked the inline "Comment" button on a text selection inside
  // a markdown layer. Open the new-thread composer at the right margin of
  // the doc, anchored to the captured Y.RelativePosition pair. x/y are
  // stored *layer-local* (matching the iframe-layer-thread convention) so
  // the composer's resolvePos can land it correctly by adding the doc
  // tile's canvas origin.
  const handleStartInlineComment = useCallback(
    (draft: InlineCommentDraft) => {
      if (!iframeLayerLayouts.has(draft.documentId)) return
      setNewCommentPos({
        x: draft.canvasX,
        y: draft.canvasY,
        documentId: draft.documentId,
        anchorStart: draft.anchorStart,
        anchorEnd: draft.anchorEnd,
        quotedText: draft.quotedText,
        lineFrom: draft.lineFrom,
        lineTo: draft.lineTo,
      })
    },
    [iframeLayerLayouts]
  )

  // The user clicked an existing inline-comment highlight inside a doc.
  // Open that thread's pin popover.
  const handleSelectInlineThread = useCallback((threadId: string) => {
    setActiveCommentThreadId(threadId)
  }, [])

  // Hand the comment composer's text off to the agent chat instead of
  // creating a comment thread. Comment-mode hit-tests against
  // `iframeLayerLayouts`, which includes both iframeLayers and document layers,
  // so `ctx.iframeLayerId` may be either kind. For iframeLayers we tag the
  // message with the picked route + element so the agent has context to
  // act on; for docs we route to the doc's own chat target and send the
  // note as-is (no route/element to attach).
  const handleCommentSendToChat = useCallback(
    (note: string, ctx: SendToChatContext) => {
      const expandPanel = () => {
        const panel = chatPanelRef.current
        if (panel?.isCollapsed()) {
          panel.expand()
          const { inPixels } = panel.getSize()
          if (inPixels < 480) panel.resize(480)
        }
      }

      // Document-layer comment: pivot the panel to that doc's chat (or
      // create one if none exists / the remembered chat is busy) and send
      // the note — prepended with the quoted span + line range when the
      // user commented on a specific selection.
      const docId = ctx.documentId ?? ctx.iframeLayerId ?? null
      const docLayer = docId
        ? markdownLayers.find((d) => d.id === docId)
        : undefined
      if (docLayer) {
        const messageBody =
          ctx.quotedText &&
          ctx.lineFrom !== null &&
          ctx.lineFrom !== undefined &&
          ctx.lineTo !== null &&
          ctx.lineTo !== undefined
            ? `${formatQuoteForChat({
                quotedText: ctx.quotedText,
                lineFrom: ctx.lineFrom,
                lineTo: ctx.lineTo,
                documentTitle: docLayer.title || null,
              })}\n\n${note}`
            : note
        const remembered = selectedChatByDocumentRef.current[docLayer.id]
        const rememberedChat = remembered
          ? chatSessions.find((c) => c.id === remembered && !c.closedAt)
          : null
        const fallback = chatSessions
          .filter((c) => c.markdownLayerId === docLayer.id && !c.closedAt)
          .sort((a, b) => a.createdAt - b.createdAt)[0]
        const target = rememberedChat ?? fallback ?? null
        const targetBusy = target
          ? chatStore.getSnapshot(target.id).isStreaming ||
            target.isStreaming === true
          : false
        let chatId: string
        let planMode: boolean | undefined
        let model: string | undefined
        if (!target || targetBusy) {
          chatId = nanoid()
          planMode = undefined
          model = undefined
          addChatSession(chatId, {
            id: chatId,
            markdownLayerId: docLayer.id,
            label: "Untitled",
            createdAt: Date.now(),
          })
        } else {
          chatId = target.id
          planMode = target.planMode
          model = target.model
        }
        setSelectedAgentId(null)
        setSelectedDocumentChatTargetId(docLayer.id)
        setSelectedChatId(chatId)
        selectedChatByDocumentRef.current[docLayer.id] = chatId
        const isFirstChat = !chatSessions.some(
          (c) => c.markdownLayerId === docLayer.id && c.id !== chatId
        )
        chatStore.sendMessage({
          roomId,
          chatId,
          markdownLayerId: docLayer.id,
          message: messageBody,
          isFirstChat,
          planMode,
          model,
          onChatRename: (label) =>
            inspectHandlersRef.current.renameChat(chatId, label),
        })
        expandPanel()
        return
      }

      if (!selectedChatId) return
      const currentChat = chatSessions.find((c) => c.id === selectedChatId)
      const agent = currentChat
        ? agents.find((a) => a.id === currentChat.branchId)
        : null
      const iframeLayer = ctx.iframeLayerId
        ? iframeLayers.find((a) => a.id === ctx.iframeLayerId)
        : undefined
      const route = iframeLayer?.route || "/"
      const elementLine = ctx.selector ? `\nElement: \`${ctx.selector}\`` : ""
      const text = `${note}\n\nRoute: \`${route}\`${elementLine}`
      if (currentChat && agent?.sandboxName && agent.ref) {
        const currentBusy =
          chatStore.getSnapshot(currentChat.id).isStreaming ||
          currentChat.isStreaming === true
        let chatId = currentChat.id
        let planMode = currentChat.planMode
        let model = currentChat.model
        if (currentBusy) {
          chatId = nanoid()
          planMode = undefined
          model = undefined
          addChatSession(chatId, {
            id: chatId,
            branchId: currentChat.branchId,
            label: "Untitled",
            createdAt: Date.now(),
          })
          setSelectedChatId(chatId)
        }
        const isFirstChat = !chatSessions.some(
          (c) => c.branchId === currentChat.branchId && c.id !== chatId
        )
        chatStore.sendMessage({
          roomId,
          chatId,
          sandboxName: agent.sandboxName,
          branch: agent.ref,
          message: text,
          isFirstChat,
          autoNamedBranch: agent.autoNamedBranch,
          planMode,
          model,
          onBranchRename: (branch) =>
            inspectHandlersRef.current.branchRename(agent.id, branch),
          onChatRename: (label) =>
            inspectHandlersRef.current.renameChat(chatId, label),
        })
      } else {
        inputStore.append(selectedChatId, text)
      }
      expandPanel()
    },
    [
      markdownLayers,
      selectedChatId,
      chatSessions,
      agents,
      iframeLayers,
      roomId,
      addChatSession,
    ]
  )

  const handleRemoveChat = useCallback(
    (chatId: string) => {
      if (isLocalTerminal(chatId)) {
        handleCloseTerminal(chatId)
        return
      }
      if (selectedChatId === chatId) {
        const chat = chatSessions.find((c) => c.id === chatId)
        if (chat) {
          const sameTarget = (c: ChatSessionData) =>
            chat.branchId
              ? c.branchId === chat.branchId
              : chat.markdownLayerId
                ? c.markdownLayerId === chat.markdownLayerId
                : false
          const siblings = chatSessions
            .filter((c) => sameTarget(c) && c.id !== chatId && !c.closedAt)
            .sort((a, b) => a.createdAt - b.createdAt)
          setSelectedChatId(siblings[0]?.id ?? null)
        } else {
          setSelectedChatId(null)
        }
      }
      chatStore.cleanup(chatId)
      removeChatSession(chatId)
    },
    [
      selectedChatId,
      chatSessions,
      removeChatSession,
      isLocalTerminal,
      handleCloseTerminal,
    ]
  )

  const handleRenameChat = useCallback(
    (chatId: string, label: string) => {
      if (isLocalTerminal(chatId)) {
        setLocalTerminals((prev) =>
          prev.map((t) => (t.id === chatId ? { ...t, label } : t))
        )
        return
      }
      updateChatSession(chatId, { label })
    },
    [updateChatSession, isLocalTerminal]
  )

  const handleSelectChat = useCallback(
    (chatId: string | null) => {
      setSelectedChatId(chatId)
      if (chatId) {
        const terminal = localTerminals.find((t) => t.id === chatId)
        if (terminal) {
          // Local terminals aren't in the Y.Doc; just track their branch so
          // the agent target stays selected. No per-target "remember" ref —
          // they don't survive a remount anyway.
          if (terminal.branchId) setSelectedAgentId(terminal.branchId)
          return
        }
        const chat = chatSessions.find((c) => c.id === chatId)
        if (!chat) return
        if (chat.branchId) {
          setSelectedAgentId(chat.branchId)
          selectedChatByAgentRef.current[chat.branchId] = chatId
        }
        if (chat.markdownLayerId) {
          setSelectedDocumentChatTargetId(chat.markdownLayerId)
          selectedChatByDocumentRef.current[chat.markdownLayerId] = chatId
        }
      }
    },
    [chatSessions, localTerminals]
  )

  // Eagerly seed a single new Branch's canvas frame at creation time, rather
  // than waiting on the deferred `running`-gated seeder: a single-member Group
  // at the viewport center, selected and zoomed once its frame mounts. The op
  // clears `pendingIframeLayerSeed`, so the reactive seeder skips this Branch.
  // Bulk creates seed their own shared Group inline (see handleCreateWorkspace).
  const seedEagerFrameForBranch = useCallback(
    (branchId: string) => {
      const { cx, cy } = getViewportCenter()
      const frameGroup = ops.createFramesForAgents([{ agentId: branchId }], {
        x: cx,
        y: cy,
      })
      if (!frameGroup) return
      setSelectedGroupIds(new Set([frameGroup.groupId]))
      setSelectedIframeLayerIds(new Set())
      const firstLayerId = frameGroup.layerIds[0]
      if (firstLayerId)
        requestAnimationFrame(() => handleSelectIframeLayer(firstLayerId))
    },
    [ops, getViewportCenter, handleSelectIframeLayer]
  )

  const handleCreateRepo = useCallback(
    (pick: RepoPickerSelection) => {
      const id = nanoid()
      const data: RepoData =
        pick.kind === "config"
          ? {
              id,
              name: pick.config.name,
              repoFullName: pick.config.repoFullName,
              repoOwner: pick.config.repoOwner,
              repoName: pick.config.repoName,
              defaultBranch: pick.config.defaultBranch,
              cloneUrl: pick.config.cloneUrl,
              setupScript: pick.config.setupScript,
              devScript: pick.config.devScript,
              devServerPort: pick.config.devServerPort,
              envVars: pick.config.envVars,
              copyPatterns: pick.config.copyPatterns,
              defaultIframeLayerSizeId: pick.config.defaultIframeLayerSizeId,
              systemPrompt: pick.config.systemPrompt,
              createdAt: Date.now(),
            }
          : pick.kind === "source"
            ? {
                // A Repo from the local build's URL / local-folder entry
                // points (PRD #428). `localPath` is the acquisition source the
                // provision path routes on; the GitHub identity fields may be
                // empty (non-GitHub repo), which just leaves API features dark.
                id,
                name: "",
                repoFullName: pick.source.repoFullName,
                repoOwner: pick.source.repoOwner,
                repoName: pick.source.repoName,
                defaultBranch: pick.source.defaultBranch,
                cloneUrl: pick.source.cloneUrl,
                localPath: pick.source.localPath,
                setupScript: "",
                devScript: "",
                devServerPort: 3000,
                envVars: "",
                // A local-folder Repo's worktrees get the checkout's env
                // files carried over by default — the common gitignored
                // config a dev server can't run without.
                copyPatterns: pick.source.localPath ? ".env*" : undefined,
                createdAt: Date.now(),
              }
            : {
                id,
                name: "",
                repoFullName: pick.repo.fullName,
                repoOwner: pick.repo.owner,
                repoName: pick.repo.name,
                defaultBranch: pick.repo.defaultBranch,
                cloneUrl: pick.repo.cloneUrl,
                setupScript: "",
                devScript: "",
                devServerPort: 3000,
                envVars: "",
                createdAt: Date.now(),
              }
      const sandboxName = `sp-${nanoid(10)}`
      const branch = uniqueNamesGenerator({
        dictionaries: [adjectives, colors, animals],
        separator: "-",
        length: 3,
      })

      // One transaction so the repo and its first agent land as a single
      // undo step. `createAgent` owns the agent record + deferred-seed flag.
      let agentId = ""
      ops.batch(() => {
        addRepoToStorage(id, data)
        agentId = ops.createBranch({
          branch: {
            repoId: id,
            sandboxName,
            gitUrl: data.cloneUrl,
            ref: branch,
            previewDomain: "",
            port: data.devServerPort ?? 3000,
            status: "creating",
            statusMessage: "Creating branch…",
            createdAt: Date.now(),
          },
        }).branchId
      })
      setPendingAgentIds((prev) =>
        prev.includes(agentId) ? prev : [...prev, agentId]
      )
      const seedChat = seedDefaultTabForNewBranch(agentId)
      seedEagerFrameForBranch(agentId)

      fetch(withBasePath("/api/branch/create"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flow: "new",
          roomId,
          branchId: agentId,
          sandboxName,
          branch,
          repoId: id,
          seedChat,
        }),
      })
    },
    [
      addRepoToStorage,
      ops,
      roomId,
      seedDefaultTabForNewBranch,
      seedEagerFrameForBranch,
    ]
  )

  // Prompts queued by the prompt-first create handler (handleCreateWorkspace)
  // that should fire as soon as the agent's sandbox transitions to `running`.
  // Held in a ref because the dispatch effect already re-runs on every `agents`
  // change.
  const pendingPromptsRef = useRef<
    Map<
      string,
      { chatId: string; prompt: string; model: string; planMode?: boolean }
    >
  >(new Map())

  // Prompt-first "New Workspace" create (PRD #314). The pure planner owns the
  // decision; this handler is thin orchestration over the existing
  // `/api/branch/create` contract. It takes one {@link ComposerSpec} per dialog
  // row — a single row is the common case; parallel mode (#327) hands several,
  // each resolved independently and created as its own Branch.
  //
  // Empty prompt (#323) -> a bare scratch Branch (random name, no Chat Session,
  // nothing queued). Non-empty prompt (#324) -> the full seeded path: a Branch
  // name derived from the prompt, a Chat Session pre-seeded with the chosen
  // model, and the prompt queued to fire as the first message exactly once the
  // Sandbox reaches `running`. The fired body is the Composer's Message-Markers
  // wire text, so model, plan-mode, `@`-Layer mentions, and `/`-Skills all ride
  // through unchanged. A non-default base derives `flow:"duplicate-branch"`
  // (#325); the chosen base rides along as the source the server forks from.
  const handleCreateWorkspace = useCallback(
    async (repoId: string, specs: ComposerSpec[]) => {
      const repo = repos.find((w) => w.id === repoId)
      if (!repo || specs.length === 0) return

      const plans = planBranchCreations(
        { defaultBranch: repo.defaultBranch },
        specs
      )

      // Mint deduped random `adjective-color-animal` names, never colliding with
      // a name already assigned in this batch.
      const taken = new Set<string>()
      const randomName = () => {
        let name = uniqueNamesGenerator({
          dictionaries: [adjectives, colors, animals],
          separator: "-",
          length: 3,
        })
        while (taken.has(name)) {
          name = uniqueNamesGenerator({
            dictionaries: [adjectives, colors, animals],
            separator: "-",
            length: 3,
          })
        }
        taken.add(name)
        return name
      }

      // Generate prompt-derived names for every seeded row up front in one
      // request, so identical prompts can't independently land on the same
      // branch and clobber each other. Bare rows (and any seeded row the
      // endpoint didn't name) fall back to a deduped random name.
      const names = new Array<{ branch: string; label: string }>(specs.length)
      const seededIdx = plans
        .map((plan, i) => (plan.nameSource === "from-prompt" ? i : -1))
        .filter((i) => i >= 0)

      if (seededIdx.length > 0) {
        let results: Array<{ branch: string; label: string }> = []
        try {
          const res = await fetch(withBasePath("/api/agent/generate-names"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              roomId,
              prompts: seededIdx.map((i) => specs[i]!.prompt.trim()),
            }),
          })
          if (res.ok) {
            const data = (await res.json()) as {
              results: Array<{ branch: string; label: string }>
            }
            results = data.results ?? []
          }
        } catch {
          // Fall through to the per-row random fallback below.
        }
        seededIdx.forEach((specIndex, k) => {
          const result = results[k]
          const label = result?.label || "Untitled"
          let branch: string
          if (result?.branch && !taken.has(result.branch)) {
            taken.add(result.branch)
            branch = result.branch
          } else {
            branch = randomName()
          }
          names[specIndex] = { branch, label }
        })
      }

      plans.forEach((_, i) => {
        if (!names[i]) names[i] = { branch: randomName(), label: "Untitled" }
      })

      const dispatched: Array<{
        id: string
        sandboxName: string
        branch: string
        flow: "new" | "duplicate-branch"
        sourceBranch: string | undefined
        seedChat: boolean
      }> = []

      // Every created Branch gets its frame eagerly (#338's waiting preview):
      // one Branch lands a single-member Group, a bulk create lands one Group
      // holding every Branch's frame. Collected here, created in the same Yjs
      // transaction below so branch + frame land as one undo step.
      const frameSpecs: Array<{ agentId: string; label?: string }> = []
      const { cx, cy } = getViewportCenter()
      let frameGroup: { groupId: string; layerIds: string[] } | undefined

      // Create all Branch records (and pre-seed each prompted row's Chat Session
      // so its queued prompt has a stable chatId) in one Yjs transaction.
      ops.batch(() => {
        plans.forEach((plan, i) => {
          const spec = specs[i]!
          const { branch, label } = names[i]!
          const sandboxName = `sp-${nanoid(10)}`
          const model = plan.model ?? spec.model

          const { branchId: id, chatId } = ops.createBranch({
            branch: {
              repoId,
              sandboxName,
              gitUrl: repo.cloneUrl,
              ref: branch,
              previewDomain: "",
              port: repo.devServerPort ?? 3000,
              status: "creating",
              statusMessage: "Creating branch…",
              createdAt: Date.now(),
              autoNamedBranch: plan.autoNamedBranch,
            },
            // Seed a Chat Session only for prompted rows; bare rows get none.
            ...(plan.seedChat ? { chat: { label, model } } : {}),
          })

          // Queue the seed prompt; the dispatch effect below fires it exactly
          // once, when the Sandbox reaches `running` (and drops it on error).
          if (plan.firePromptOnRunning && chatId) {
            pendingPromptsRef.current.set(id, {
              chatId,
              prompt: spec.prompt.trim(),
              model,
              planMode: spec.planMode,
            })
          }

          frameSpecs.push({ agentId: id, label })

          dispatched.push({
            id,
            sandboxName,
            branch,
            flow: plan.flow,
            sourceBranch:
              plan.flow === "duplicate-branch" ? spec.baseBranch : undefined,
            seedChat: plan.seedChat,
          })
        })

        // Seed the frames inside the same transaction (clears each Branch's
        // `pendingIframeLayerSeed`, so the deferred reactive seeder skips them).
        frameGroup = ops.createFramesForAgents(frameSpecs, { x: cx, y: cy })
      })

      setPendingAgentIds((prev) => {
        const additions = dispatched
          .map((d) => d.id)
          .filter((id) => !prev.includes(id))
        return additions.length > 0 ? [...prev, ...additions] : prev
      })

      // Surface the just-created frames: select the new Group and bring it into
      // view once its frames have mounted. Zooming to the first member's DOM
      // node (rather than `handleZoomToGroup`, which reads not-yet-updated React
      // state) mirrors the routes-group and deferred-seed flows.
      if (frameGroup) {
        const { groupId, layerIds } = frameGroup
        setSelectedGroupIds(new Set([groupId]))
        setSelectedIframeLayerIds(new Set())
        if (layerIds[0]) {
          const firstLayerId = layerIds[0]
          requestAnimationFrame(() => handleSelectIframeLayer(firstLayerId))
        }
      }

      // Every Branch needs a tab waiting on the dev server from the moment it's
      // created. Prompted rows already got their seeded Chat Session above;
      // bare rows (no Chat Session) get the operator's preferred default tab —
      // chat or terminal — so a scratch Branch is never tab-less while it
      // provisions. Selection is deferred until the Sandbox is running, like
      // the other branch-create flows. The server still skips its auto chat for
      // these rows (seedChat: false), since the client owns tab seeding here.
      const defaultTabKind = readLastTabKind()
      for (const d of dispatched) {
        if (!d.seedChat) {
          createDefaultTabForBranch(d.id, defaultTabKind, { select: false })
        }
      }

      for (const d of dispatched) {
        fetch(withBasePath("/api/branch/create"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            flow: d.flow,
            roomId,
            branchId: d.id,
            sandboxName: d.sandboxName,
            branch: d.branch,
            repoId,
            sourceBranch: d.sourceBranch,
            seedChat: d.seedChat,
          }),
        })
      }
    },
    [
      repos,
      ops,
      roomId,
      createDefaultTabForBranch,
      getViewportCenter,
      handleSelectIframeLayer,
    ]
  )

  const handleCreateAgentFromBranch = useCallback(
    (repoId: string, branch: string) => {
      const repo = repos.find((w) => w.id === repoId)
      if (!repo) return

      const sandboxName = `sp-${nanoid(10)}`

      const { branchId: id } = ops.createBranch({
        branch: {
          repoId,
          sandboxName,
          gitUrl: repo.cloneUrl,
          ref: branch,
          previewDomain: "",
          port: repo.devServerPort ?? 3000,
          status: "creating",
          statusMessage: "Cloning repository…",
          createdAt: Date.now(),
          autoNamedBranch: false,
        },
      })
      setPendingAgentIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
      const seedChat = seedDefaultTabForNewBranch(id)
      seedEagerFrameForBranch(id)

      fetch(withBasePath("/api/branch/create"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flow: "from-branch",
          roomId,
          branchId: id,
          sandboxName,
          branch,
          repoId,
          seedChat,
        }),
      })
    },
    [repos, ops, roomId, seedDefaultTabForNewBranch, seedEagerFrameForBranch]
  )

  const handleRestartDevServer = useCallback(
    async (id: string) => {
      const agent = agents.find((a) => a.id === id)
      if (!agent?.sandboxName) return

      const repo = repos.find((w) => w.id === agent.repoId)
      if (!repo) {
        toast.error("Couldn't restart dev server", {
          description: "Workspace not found",
        })
        return
      }

      // No VM cycle and no status flip: bouncing the dev server leaves the
      // Sandbox (and any in-flight agent turn) running, and the preview points
      // at the same proxy port as before, so there's nothing to persist — the
      // only signal is a toast. This is the one restart that stays available
      // while the agent is working.
      const result = await restartDevServer(agent.sandboxName, repo)
      if (result.success) {
        toast.success("Dev server restarted")
      } else {
        toast.error("Couldn't restart dev server", {
          description: result.error || undefined,
        })
      }
    },
    [agents, repos]
  )

  // "Restart sandbox": snapshot-restore onto a fresh VM, preserving the working
  // tree. On a snapshot miss this now fails loud (no silent reclone) — surfaced
  // as a toast — and the user can fall back to "Recreate from scratch".
  const handleRefreshAgent = useCallback(
    async (id: string) => {
      const agent = agents.find((a) => a.id === id)
      if (!agent?.sandboxName) return

      const repo = repos.find((w) => w.id === agent.repoId)
      if (!repo) {
        updateAgentInStorage(id, {
          status: "error",
          error: "Workspace not found",
        })
        toast.error("Couldn't restart sandbox", {
          description: "Workspace not found",
        })
        return
      }

      updateAgentInStorage(id, {
        status: "starting",
        statusMessage: "Restarting sandbox…",
      })

      const result = await restartSandbox(agent.sandboxName, repo)
      if (result.success) {
        updateAgentInStorage(id, {
          sandboxName: result.value.sandboxName,
          previewDomain: result.value.previewDomain || agent.previewDomain,
          status: "running",
          statusMessage: "",
          error: "",
        })
        toast.success("Sandbox restarted")
      } else {
        updateAgentInStorage(id, {
          status: "error",
          statusMessage: "",
          error: result.error || "",
        })
        toast.error("Couldn't restart sandbox", {
          description: result.error || undefined,
        })
      }
    },
    [agents, repos, updateAgentInStorage]
  )

  // "Recreate from scratch": the explicit, destructive reclone from git. Runs
  // only after the AlertDialog confirm in the sidebar, and discards the in-VM
  // working tree (uncommitted changes included).
  const handleRecreateAgent = useCallback(
    async (id: string) => {
      const agent = agents.find((a) => a.id === id)
      if (!agent?.sandboxName) return

      const repo = repos.find((w) => w.id === agent.repoId)
      if (!repo) {
        updateAgentInStorage(id, {
          status: "error",
          error: "Workspace not found",
        })
        toast.error("Couldn't recreate sandbox", {
          description: "Workspace not found",
        })
        return
      }

      updateAgentInStorage(id, {
        status: "starting",
        statusMessage: "Recreating sandbox…",
      })

      const result = await recreateSandbox(agent.sandboxName, repo, agent.ref)
      if (result.success) {
        updateAgentInStorage(id, {
          sandboxName: result.value.sandboxName,
          previewDomain: result.value.previewDomain || agent.previewDomain,
          status: "running",
          statusMessage: "",
          error: "",
        })
        toast.success("Sandbox recreated")
      } else {
        updateAgentInStorage(id, {
          status: "error",
          statusMessage: "",
          error: result.error || "",
        })
        toast.error("Couldn't recreate sandbox", {
          description: result.error || undefined,
        })
      }
    },
    [agents, repos, updateAgentInStorage]
  )

  const handleBranchRename = useCallback(
    async (agentId: string, rawBranch: string) => {
      const newBranch = rawBranch
        .toLowerCase()
        .replace(/[^a-z0-9/_-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
      const agent = agents.find((a) => a.id === agentId)
      if (
        !newBranch ||
        !agent?.sandboxName ||
        !agent.ref ||
        agent.ref === newBranch
      )
        return

      const repo = repos.find((w) => w.id === agent.repoId)
      if (!repo) return

      // Apply the rename locally before the sandbox roundtrip — the sandbox
      // resume + `git branch -m` + GitHub call can take several seconds and
      // the badge sitting on the old name in the meantime feels broken.
      // Roll back if the sandbox rejects (e.g. branch already exists).
      const previousBranch = agent.ref
      const previousAutoNamed = agent.autoNamedBranch
      updateAgentInStorage(agentId, { ref: newBranch, autoNamedBranch: false })

      const result = await renameAgentBranch(
        repo,
        agent.sandboxName,
        previousBranch,
        newBranch
      )
      if (!result.success) {
        updateAgentInStorage(agentId, {
          ref: previousBranch,
          autoNamedBranch: previousAutoNamed,
        })
      }
    },
    [agents, repos, updateAgentInStorage]
  )

  useEffect(() => {
    inspectHandlersRef.current = {
      branchRename: handleBranchRename,
      renameChat: handleRenameChat,
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

  // Dispatch prompts queued by the prompt-first create handler
  // (handleCreateWorkspace) once their agent's sandbox reaches `running`.
  // Deleting the entry before sending means the prompt fires exactly once —
  // never before `running`, and never re-sent on a later reconnect. Drop the
  // queue entry if the agent errored out so failed builds don't leak forever.
  useEffect(() => {
    if (pendingPromptsRef.current.size === 0) return
    for (const agent of agents) {
      const queued = pendingPromptsRef.current.get(agent.id)
      if (!queued) continue
      if (agent.status === "error") {
        pendingPromptsRef.current.delete(agent.id)
        continue
      }
      if (agent.status !== "running" || !agent.sandboxName || !agent.ref)
        continue
      pendingPromptsRef.current.delete(agent.id)
      chatStore.sendMessage({
        roomId,
        chatId: queued.chatId,
        sandboxName: agent.sandboxName,
        branch: agent.ref,
        message: queued.prompt,
        isFirstChat: true,
        autoNamedBranch: agent.autoNamedBranch,
        model: queued.model,
        planMode: queued.planMode,
        onBranchRename: (branch) =>
          updateAgentInStorage(agent.id, {
            ref: branch,
            autoNamedBranch: false,
          }),
        onChatRename: (label) => updateChatSession(queued.chatId, { label }),
      })
    }
  }, [agents, roomId, updateAgentInStorage, updateChatSession])

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
    // render cascade.
    /* eslint-disable react-hooks/set-state-in-effect */
    setSelectedIframeLayerIds(new Set([layerId]))
    setSelectedGroupIds(new Set())
    /* eslint-enable react-hooks/set-state-in-effect */
    // Wait for the new iframeLayer DOM node to mount before zooming.
    requestAnimationFrame(() => {
      handleSelectIframeLayer(layerId)
    })
  }, [agents, iframeLayers, ops, getViewportCenter, handleSelectIframeLayer])

  // Hydrate chatStore streaming state from Yjs storage on mount/reconnect.
  // For each chat that's marked streaming in storage, ask the server to
  // verify the underlying agent run is still actually active. If it's
  // ended, the heal endpoint broadcasts chat-stream-end to unstick the
  // spinner. The previous empty-deps form ran before Yjs initial sync
  // completed, so for slow connections the streaming flag from storage
  // was missed; now we hydrate the first time `chatSessions` actually has
  // entries, then never again.
  const hydratedStreamingRef = useRef(false)
  useEffect(() => {
    if (hydratedStreamingRef.current || chatSessions.length === 0) return
    hydratedStreamingRef.current = true
    for (const cs of chatSessions) {
      if (!cs.isStreaming) continue
      chatStore.setStreaming(cs.id, true)
      fetch(withBasePath("/api/branch/heal"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, chatId: cs.id }),
      }).catch((e) => console.error("Heal request failed:", e))
    }
  }, [chatSessions, roomId])

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

  // Reconnect agents on mount — check if they're still alive,
  // and recover any that were mid-creation when the page was reloaded.
  const reconnectedRef = useRef(false)
  useEffect(() => {
    if (reconnectedRef.current || agents.length === 0) return
    reconnectedRef.current = true

    for (const agent of agents) {
      // Agents stuck mid-creation — ask server to resume the pipeline.
      // The server uses a Redis lock so only one instance handles it.
      if (agent.status === "creating") {
        if (!agent.sandboxName) {
          // VM was never created — unrecoverable
          updateAgentInStorage(agent.id, {
            status: "error",
            statusMessage: undefined,
            error: "Sandbox creation was interrupted — delete and try again",
          })
          continue
        }
        fetch(withBasePath("/api/branch/create"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            flow: "from-branch",
            roomId,
            branchId: agent.id,
            sandboxName: agent.sandboxName,
            branch: agent.ref,
            repoId: agent.repoId,
          }),
        })
        continue
      }

      if (!agent.sandboxName) continue

      // Covers normal reloads and restarts (status === "starting") that were
      // interrupted by a page reload. reconnectSandbox probes the existing
      // sandbox first, so it won't recreate one that's already running.
      const repo = repos.find((w) => w.id === agent.repoId)
      const sandboxName = agent.sandboxName
      // The restart fallback below needs a source to provision from, so bail
      // early if the workspace is gone.
      if (!repo) {
        updateAgentInStorage(agent.id, {
          status: "stopped",
          statusMessage: "",
          error: "Workspace not found — click refresh to retry",
        })
        continue
      }
      reconnectSandbox(sandboxName, repo).then((result) => {
        if (result.success) {
          updateAgentInStorage(agent.id, {
            previewDomain: result.value.previewDomain,
            status: "running",
            statusMessage: "",
            error: "",
          })
          return
        }
        // Resume failed — likely the snapshot has fully expired (>24h) and
        // been deleted, so there's nothing left to restore from. Reclone fresh
        // from git (recreateSandbox) instead of stranding the user at "stopped":
        // a plain restart would just fail loud on the snapshot miss now that the
        // silent reclone fallback is gone.
        updateAgentInStorage(agent.id, {
          status: "starting",
          statusMessage: "Recreating expired sandbox…",
          error: "",
        })
        recreateSandbox(sandboxName, repo, agent.ref).then((restartResult) => {
          if (restartResult.success) {
            updateAgentInStorage(agent.id, {
              sandboxName: restartResult.value.sandboxName,
              previewDomain:
                restartResult.value.previewDomain || agent.previewDomain,
              status: "running",
              statusMessage: "",
              error: "",
            })
          } else {
            updateAgentInStorage(agent.id, {
              status: "stopped",
              statusMessage: "",
              error:
                restartResult.error ||
                "Sandbox could not be restarted — click refresh to retry",
            })
          }
        })
      })
    }
  }, [agents, repos, updateAgentInStorage, roomId])

  // Heartbeat: extend sandbox timeouts while the tab is visible so they
  // stay alive as long as the user is actively using the page.
  // Fires every 20 minutes (well within the 30-minute timeout) and pauses
  // when the tab is hidden so sandboxes can expire when the user leaves.
  useEffect(() => {
    const HEARTBEAT_MS = 20 * 60 * 1000

    const pingAll = () => {
      if (document.hidden) return
      for (const agent of agents) {
        if (agent.sandboxName && agent.status === "running") {
          keepAliveSandbox(agent.sandboxName).catch(() => {})
        }
      }
    }

    const interval = setInterval(pingAll, HEARTBEAT_MS)

    const onVisibilityChange = () => {
      if (!document.hidden) pingAll()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [agents])

  // Follow another user's viewport
  useEffect(() => {
    if (followingConnectionId === null) return
    const followed = others.find((o) => o.clientId === followingConnectionId)
    // If the user we're following disconnected, stop following. Reacting to
    // another client leaving (external presence data) is a legitimate effect
    // sync, not an avoidable render cascade.
    if (!followed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFollowingConnectionId(null)
      return
    }
    const { viewport } = followed.presence
    const ref = transformRef.current
    if (!ref) return

    // Only move if our viewport actually differs
    const { positionX, positionY, scale } = ref.state
    const dx = Math.abs(positionX - viewport.x)
    const dy = Math.abs(positionY - viewport.y)
    const dz = Math.abs(scale - viewport.zoom)
    if (dx < 1 && dy < 1 && dz < 0.001) return

    ref.setTransform(viewport.x, viewport.y, viewport.zoom, 200)
  }, [followingConnectionId, others])

  // Stop following when the user manually pans/zooms
  const handleFollowBreak = useCallback(() => {
    if (followingConnectionId !== null) {
      setFollowingConnectionId(null)
    }
  }, [followingConnectionId])

  // Figma-style wheel: scroll = pan, Ctrl/Cmd+scroll = zoom
  const canvasWrapperRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    const el = canvasWrapperRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      // Zoom/pan stays live during interact (focus) and Create Flow modes. We
      // intentionally do NOT bail out for those modes here: wheel events over
      // the interactive iframe are captured by the cross-origin iframe (it has
      // pointerEvents:auto) and never reach this wrapper listener, so scrolling
      // inside the iframe scrolls its content without panning the canvas. Wheel
      // over the canvas background / frame chrome still bubbles here and pans or
      // zooms as usual.
      e.preventDefault()
      const ref = transformRef.current
      if (!ref) return
      if (followingConnectionId !== null) setFollowingConnectionId(null)
      const rect = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        const cursorX = e.clientX - rect.left
        const cursorY = e.clientY - rect.top
        const { positionX, positionY, scale } = ref.state
        const delta = -e.deltaY
        const factor = 1 + delta * ZOOM_STEP
        const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale * factor))
        const ratio = newScale / scale
        const newPosX = cursorX - (cursorX - positionX) * ratio
        const newPosY = cursorY - (cursorY - positionY) * ratio
        ref.setTransform(newPosX, newPosY, newScale, 0)
      } else {
        const { positionX, positionY, scale } = ref.state
        ref.setTransform(positionX - e.deltaX, positionY - e.deltaY, scale, 0)
      }
    }

    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [followingConnectionId])

  // Convert screen coordinates to canvas coordinates
  const screenToCanvas = useCallback(
    (clientX: number, clientY: number, rect: DOMRect) => {
      const ref = transformRef.current
      if (!ref) return { x: 0, y: 0 }
      const { positionX, positionY, scale } = ref.state
      return {
        x: (clientX - rect.left - positionX) / scale,
        y: (clientY - rect.top - positionY) / scale,
      }
    },
    []
  )

  // Zoom gestures (pinch / ctrl|cmd-wheel) that land on an interactive iframe
  // can't reach the wrapper-level wheel listener — the cross-origin iframe
  // captures them. The bridge cancels the browser's native page zoom and
  // forwards them here so a pinch zooms the canvas (centered on the cursor)
  // exactly like a pinch over the canvas background would.
  const handleIframeWheel = useCallback(
    (iframeLayerId: string, w: WheelForward) => {
      const ref = transformRef.current
      const wrapper = canvasWrapperRef.current
      if (!ref || !wrapper) return
      const frameEl = document.getElementById(`iframe-layer-${iframeLayerId}`)
      if (!frameEl) return
      if (followingConnectionId !== null) setFollowingConnectionId(null)
      const wrapperRect = wrapper.getBoundingClientRect()
      const frameRect = frameEl.getBoundingClientRect()
      const { positionX, positionY, scale } = ref.state
      // Forwarded clientX/clientY are in the iframe's own (unscaled) viewport
      // pixels; the iframe paints at `scale`, so convert to screen pixels and
      // make them wrapper-relative to match the wrapper wheel handler's math.
      const cursorX = frameRect.left - wrapperRect.left + w.clientX * scale
      const cursorY = frameRect.top - wrapperRect.top + w.clientY * scale
      const delta = -w.deltaY
      const factor = 1 + delta * ZOOM_STEP
      const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale * factor))
      const ratio = newScale / scale
      const newPosX = cursorX - (cursorX - positionX) * ratio
      const newPosY = cursorY - (cursorY - positionY) * ratio
      ref.setTransform(newPosX, newPosY, newScale, 0)
    },
    [followingConnectionId]
  )

  /**
   * Gap-handle hit test runs in the *capture* phase so it fires before the
   * iframeLayer overlay's `onPointerDown` (which `stopPropagation`s and captures
   * the pointer). Without this the gap handle is unreachable once the gap
   * collapses to 0 — the cursor is then over an iframeLayer, and the iframeLayer's
   * drag hook grabs the pointer first.
   */
  const handleCanvasPointerDownCapture = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 || spaceHeld || focusedIframeLayerId !== null) return
      if (commentMode || documentMode || frameMode) return
      const target = e.target as HTMLElement
      if (!e.currentTarget.contains(target)) return
      // Top window-drag strip: defer to Tauri's native window drag.
      if (target.closest("[data-tauri-drag-region]")) return

      const rect = e.currentTarget.getBoundingClientRect()
      const canvas = screenToCanvas(e.clientX, e.clientY, rect)

      // Reorder dots take priority — they sit over the iframeLayer center, so the
      // iframeLayer's overlay would otherwise grab the pointer first.
      if (reorderHandlesRef.current.length > 0) {
        const reorderHit = hitTestReorderHandle(canvas.x, canvas.y, zoom)
        if (reorderHit) {
          const group = iframeLayerGroups.find((g) =>
            getGroupMembers(g).some((m) => m.id === reorderHit.iframeLayerId)
          )
          if (group) {
            const layout = iframeLayerLayouts.get(reorderHit.iframeLayerId)
            const grabOffset = layout
              ? { x: canvas.x - layout.x, y: canvas.y - layout.y }
              : { x: 0, y: 0 }
            reorderDragRef.current = {
              groupId: group.id,
              iframeLayerId: reorderHit.iframeLayerId,
              startCanvas: { x: canvas.x, y: canvas.y },
              grabOffset,
              startShiftKey: e.shiftKey,
              selectOnNoMove: false,
            }
            setReorderDraggingIframeLayerId(reorderHit.iframeLayerId)
            setReorderGrabOffset(grabOffset)
            e.currentTarget.setPointerCapture(e.pointerId)
            e.stopPropagation()
            e.preventDefault()
            return
          }
        }
      }

      if (gapHandlesRef.current.length === 0) return
      const hit = hitTestGapHandle(canvas.x, canvas.y, zoom)
      if (!hit) return
      const group = collections.iframeLayerGroups.get(hit.groupId)
      if (!group) return

      gapDragRef.current = {
        groupId: hit.groupId,
        gapIndex: hit.gapIndex,
        startGap: groupGap(group),
        startCanvasX: canvas.x,
      }
      e.currentTarget.setPointerCapture(e.pointerId)
      e.stopPropagation()
      e.preventDefault()
    },
    [
      spaceHeld,
      focusedIframeLayerId,
      commentMode,
      documentMode,
      frameMode,
      screenToCanvas,
      hitTestGapHandle,
      hitTestReorderHandle,
      zoom,
      collections,
      iframeLayerGroups,
      iframeLayerLayouts,
    ]
  )

  // Marquee selection / text-tool draft: pointerdown on empty canvas starts the interaction
  const handleCanvasPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 || spaceHeld || focusedIframeLayerId !== null) return
      const target = e.target as HTMLElement
      // React forwards events from portaled children (dropdowns, dialogs, popovers)
      // through the React tree even though the DOM target lives on document.body.
      // Ignore those so we don't capture the pointer and swallow the child's click.
      if (!e.currentTarget.contains(target)) return
      // Gap drag has already been claimed by `onPointerDownCapture`; nothing to
      // do here — the early-return below would have skipped it anyway.
      if (gapDragRef.current) return

      if (
        target.closest("[data-iframe-layer]") ||
        target.closest("[data-markdown-layer]") ||
        target.closest("button") ||
        target.closest("a") ||
        // Top window-drag strip: let Tauri start a native window drag instead
        // of beginning a marquee/draft here.
        target.closest("[data-tauri-drag-region]")
      )
        return

      // Document tool: start a draft rectangle (click for default size, drag for custom bounds)
      if (documentMode) {
        const rect = e.currentTarget.getBoundingClientRect()
        const canvas = screenToCanvas(e.clientX, e.clientY, rect)
        documentDraftRef.current = {
          startX: canvas.x,
          startY: canvas.y,
          currentX: canvas.x,
          currentY: canvas.y,
        }
        setDocumentDraft(documentDraftRef.current)
        e.currentTarget.setPointerCapture(e.pointerId)
        return
      }

      // Frame tool: start a draft rectangle (click for default size, drag for custom)
      if (frameMode) {
        const rect = e.currentTarget.getBoundingClientRect()
        const canvas = screenToCanvas(e.clientX, e.clientY, rect)
        frameDraftRef.current = {
          startX: canvas.x,
          startY: canvas.y,
          currentX: canvas.x,
          currentY: canvas.y,
        }
        setFrameDraft(frameDraftRef.current)
        e.currentTarget.setPointerCapture(e.pointerId)
        return
      }

      if (commentMode) return
      // Ignore clicks near the left/right edges so resize-handle grabs don't start a marquee
      const wrapperRect = e.currentTarget.getBoundingClientRect()
      if (e.clientX - wrapperRect.left < 8 || wrapperRect.right - e.clientX < 8)
        return

      const rect = e.currentTarget.getBoundingClientRect()
      const canvas = screenToCanvas(e.clientX, e.clientY, rect)
      marqueeRef.current = {
        startX: canvas.x,
        startY: canvas.y,
        shiftKey: e.shiftKey,
        baseIframeLayers: new Set(selectedIframeLayerIds),
        baseDocumentLayers: new Set(selectedDocumentLayerIds),
      }
      setMarquee({
        startX: canvas.x,
        startY: canvas.y,
        currentX: canvas.x,
        currentY: canvas.y,
      })
      setSelectedGroupIds(new Set())
      if (!e.shiftKey) {
        setSelectedIframeLayerIds(new Set())
        setSelectedDocumentLayerIds(new Set())
      }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [
      spaceHeld,
      commentMode,
      focusedIframeLayerId,
      frameMode,
      documentMode,
      screenToCanvas,
      selectedIframeLayerIds,
      selectedDocumentLayerIds,
    ]
  )

  const handleCanvasPointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Reorder drag: cursor X picks the destination index by walking the
      // current sibling centers in order. Layouts get rebuilt when we update
      // iframeLayerIds, so subsequent ticks see the new arrangement.
      if (reorderDragRef.current) {
        const rect = e.currentTarget.getBoundingClientRect()
        const canvas = screenToCanvas(e.clientX, e.clientY, rect)
        const drag = reorderDragRef.current
        const popped = e.metaKey
        setReorderDragPopped(popped)
        setReorderDragCursor({ x: canvas.x, y: canvas.y })
        // Holding meta previews popping the iframeLayer out into a new group.
        // The actual data update is deferred until pointer-up so releasing
        // without meta still leaves the source group as-is.
        if (popped) return

        const group = collections.iframeLayerGroups.get(drag.groupId)
        if (!group) return
        const members = getGroupMembers(group)
        const currentIndex = members.findIndex(
          (m) => m.id === drag.iframeLayerId
        )
        if (currentIndex < 0) return

        const gap = groupGap(group)
        let walkX = group.x
        const siblingCenters: { id: string; centerX: number }[] = []
        for (const m of members) {
          const size =
            m.kind === "iframe-layer"
              ? collections.iframeLayers.get(m.id)
              : collections.markdownLayers.get(m.id)
          if (!size) continue
          if (m.id !== drag.iframeLayerId) {
            siblingCenters.push({ id: m.id, centerX: walkX + size.width / 2 })
          }
          walkX += size.width + gap
        }

        let newIndex = siblingCenters.length
        for (let i = 0; i < siblingCenters.length; i++) {
          if (canvas.x < siblingCenters[i]!.centerX) {
            newIndex = i
            break
          }
        }
        if (newIndex !== currentIndex) {
          const dragged = members[currentIndex]!
          const without = members.filter((m) => m.id !== drag.iframeLayerId)
          without.splice(newIndex, 0, dragged)
          reorderGroupMembers(drag.groupId, without)
        }
        return
      }

      // Gap-handle drag: dragging gap j by `dx` in world space changes the
      // shared per-group gap by `dx / (j - 0.5)` so the dragged handle's
      // center tracks the cursor. Same proportional rule as in symaphore.
      if (gapDragRef.current) {
        const rect = e.currentTarget.getBoundingClientRect()
        const canvas = screenToCanvas(e.clientX, e.clientY, rect)
        const drag = gapDragRef.current
        const dx = canvas.x - drag.startCanvasX
        const newGap = Math.max(0, drag.startGap + dx / (drag.gapIndex - 0.5))
        setGroupGap(drag.groupId, newGap)
        return
      }

      // Document-tool draft tracking
      if (documentDraftRef.current) {
        const rect = e.currentTarget.getBoundingClientRect()
        const canvas = screenToCanvas(e.clientX, e.clientY, rect)
        const next = {
          ...documentDraftRef.current,
          currentX: canvas.x,
          currentY: canvas.y,
        }
        documentDraftRef.current = next
        setDocumentDraft(next)
        return
      }

      // Frame-tool draft tracking
      if (frameDraftRef.current) {
        const rect = e.currentTarget.getBoundingClientRect()
        const canvas = screenToCanvas(e.clientX, e.clientY, rect)
        const next = {
          ...frameDraftRef.current,
          currentX: canvas.x,
          currentY: canvas.y,
        }
        frameDraftRef.current = next
        setFrameDraft(next)
        return
      }

      if (!marqueeRef.current) return
      const start = marqueeRef.current
      const rect = e.currentTarget.getBoundingClientRect()
      const canvas = screenToCanvas(e.clientX, e.clientY, rect)
      setMarquee((m) =>
        m ? { ...m, currentX: canvas.x, currentY: canvas.y } : null
      )

      // Live hit-testing during drag
      const left = Math.min(start.startX, canvas.x)
      const top = Math.min(start.startY, canvas.y)
      const right = Math.max(start.startX, canvas.x)
      const bottom = Math.max(start.startY, canvas.y)

      const abHits = new Set<string>()
      for (const layout of iframeLayerLayouts.values()) {
        if (
          layout.x < right &&
          layout.x + layout.width > left &&
          layout.y < bottom &&
          layout.y + layout.height > top
        ) {
          abHits.add(layout.id)
        }
      }
      const docHits = new Set<string>()
      for (const d of markdownLayers) {
        // Documents now live inside groups, so their world rect comes from
        // the layout map rather than a self-position. Skip orphans (which the
        // schema migration shouldn't leave behind).
        const layout = iframeLayerLayouts.get(d.id)
        if (!layout) continue
        if (
          layout.x < right &&
          layout.x + layout.width > left &&
          layout.y < bottom &&
          layout.y + layout.height > top
        ) {
          docHits.add(d.id)
        }
      }

      if (start.shiftKey) {
        const nextAb = new Set(start.baseIframeLayers)
        for (const id of abHits) {
          if (nextAb.has(id)) nextAb.delete(id)
          else nextAb.add(id)
        }
        setSelectedIframeLayerIds(nextAb)
        const nextDoc = new Set(start.baseDocumentLayers)
        for (const id of docHits) {
          if (nextDoc.has(id)) nextDoc.delete(id)
          else nextDoc.add(id)
        }
        setSelectedDocumentLayerIds(nextDoc)
      } else {
        setSelectedIframeLayerIds(abHits)
        setSelectedDocumentLayerIds(docHits)
      }
    },
    [
      screenToCanvas,
      iframeLayerLayouts,
      markdownLayers,
      setGroupGap,
      collections,
      reorderGroupMembers,
    ]
  )

  const handleCanvasPointerUp = useCallback(
    (e: React.PointerEvent) => {
      // Reorder drag: end interaction. The order has already been written to
      // the group on every move tick, so nothing to commit here. Re-hit-test
      // at the release point so the dot drops back to its hollow state when
      // the cursor isn't actually over it (during the drag we locked the
      // highlight to the dragged dot).
      if (reorderDragRef.current) {
        const drag = reorderDragRef.current
        const rect = e.currentTarget.getBoundingClientRect()
        const canvas = screenToCanvas(e.clientX, e.clientY, rect)
        reorderDragRef.current = null
        setReorderDraggingIframeLayerId(null)
        setReorderDragCursor(null)
        setReorderDragPopped(false)
        setReorderGrabOffset(null)

        // Click-no-move on a drag initiated from a layer's name label →
        // forward to the regular select path for whichever kind of layer
        // started the gesture. Without this, clicking a multi-member layer's
        // name (which takes over the pointer for reorder) would swallow the
        // click instead of selecting the layer.
        const moved =
          Math.abs(canvas.x - drag.startCanvas.x) > 3 ||
          Math.abs(canvas.y - drag.startCanvas.y) > 3
        if (!moved && drag.selectOnNoMove) {
          const sourceGroup = collections.iframeLayerGroups.get(drag.groupId)
          const memberKind = sourceGroup
            ? getGroupMembers(sourceGroup).find(
                (m) => m.id === drag.iframeLayerId
              )?.kind
            : undefined
          // Inline selection — mirrors `handleIframeLayerSelect` /
          // `handleDocumentLayerSelect` below but avoids the forward reference
          // (they're declared later in this file).
          setSelectedGroupIds(new Set())
          if (memberKind === "markdown-layer") {
            if (drag.startShiftKey) {
              setSelectedDocumentLayerIds((prev) => {
                const next = new Set(prev)
                if (next.has(drag.iframeLayerId))
                  next.delete(drag.iframeLayerId)
                else next.add(drag.iframeLayerId)
                return next
              })
            } else {
              setSelectedDocumentLayerIds(new Set([drag.iframeLayerId]))
              setSelectedIframeLayerIds(new Set())
            }
          } else {
            if (drag.startShiftKey) {
              setSelectedIframeLayerIds((prev) => {
                const next = new Set(prev)
                if (next.has(drag.iframeLayerId))
                  next.delete(drag.iframeLayerId)
                else next.add(drag.iframeLayerId)
                return next
              })
            } else {
              setSelectedIframeLayerIds(new Set([drag.iframeLayerId]))
              setSelectedDocumentLayerIds(new Set())
            }
          }
          return
        }

        // Meta still held at release → commit the pop: detach from the source
        // group and create a new single-member group anchored at the cursor.
        if (e.metaKey) {
          const sourceGroup = collections.iframeLayerGroups.get(drag.groupId)
          if (!sourceGroup) {
            // continue with the rest of pointer-up
          } else {
            const sourceMembers = getGroupMembers(sourceGroup)
            const popped = sourceMembers.find(
              (m) => m.id === drag.iframeLayerId
            )
            const ab =
              popped?.kind === "iframe-layer"
                ? collections.iframeLayers.get(drag.iframeLayerId)
                : null
            const docMember =
              popped?.kind === "markdown-layer"
                ? collections.markdownLayers.get(drag.iframeLayerId)
                : null
            const size = ab ?? docMember
            if (popped && size) {
              // Split the popped member into a fresh group at the cursor; the
              // verb prunes the source if this was its last member.
              const newGroupId = ops.splitToNewGroup([drag.iframeLayerId], {
                x: canvas.x - drag.grabOffset.x,
                y: canvas.y - drag.grabOffset.y,
              })
              setSelectedGroupIds(new Set([newGroupId]))
            }
          }
        }

        const hit = hitTestReorderHandle(canvas.x, canvas.y, zoom)
        setHoveredReorderIframeLayerId(hit?.iframeLayerId ?? null)
        return
      }

      // Gap-handle drag: end interaction
      if (gapDragRef.current) {
        gapDragRef.current = null
        return
      }

      // Document-tool: release creates a new document layer with a fixed
      // container. Click-without-drag uses a sensible default size; drag
      // sets explicit bounds.
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
        setDocumentMode(false)
        setSelectedIframeLayerIds(new Set())
        setSelectedDocumentLayerIds(new Set([id]))
        setEditingDocumentLayerId(id)
        return
      }

      // Frame-tool: release creates a new empty frame
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
        setFrameMode(false)
        setSelectedDocumentLayerIds(new Set())
        setSelectedIframeLayerIds(new Set([id]))
        return
      }

      if (!marqueeRef.current) return
      const start = marqueeRef.current
      const rect = e.currentTarget.getBoundingClientRect()
      const end = screenToCanvas(e.clientX, e.clientY, rect)
      marqueeRef.current = null
      setMarquee(null)

      // Treat tiny drags as clicks — deselect
      const dx = Math.abs(end.x - start.startX)
      const dy = Math.abs(end.y - start.startY)
      if (dx < 3 && dy < 3) {
        if (!e.shiftKey) {
          setSelectedIframeLayerIds(new Set())
          setSelectedDocumentLayerIds(new Set())
        }
      }
    },
    [
      screenToCanvas,
      addDocumentLayer,
      addFrame,
      hitTestReorderHandle,
      zoom,
      collections,
      ops,
    ]
  )

  /** Id of the group containing `memberId`, or undefined for an ungrouped layer. */
  const findGroupIdForMember = useCallback(
    (memberId: string): string | undefined =>
      collections.iframeLayerGroups
        .toArray()
        .find((g) => getGroupMembers(g).some((m) => m.id === memberId))?.id,
    [collections]
  )

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
  const handleIframeLayerSelect = useCallback(
    (id: string, shiftKey: boolean) => {
      if (shiftKey) {
        const parentGroupId = findGroupIdForMember(id)
        if (parentGroupId && selectedGroupIdsRef.current.has(parentGroupId))
          return
        setSelectedIframeLayerIds((prev) => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      } else {
        setSelectedGroupIds(new Set())
        setSelectedIframeLayerIds(new Set([id]))
        setSelectedDocumentLayerIds(new Set())
      }
    },
    [findGroupIdForMember]
  )

  const handleGroupSelect = useCallback(
    (groupId: string, shiftKey: boolean) => {
      if (shiftKey) {
        const group = collections.iframeLayerGroups.get(groupId)
        const memberIds = group
          ? new Set(getGroupMembers(group).map((m) => m.id))
          : new Set<string>()
        setSelectedGroupIds((prev) => {
          const next = new Set(prev)
          if (next.has(groupId)) next.delete(groupId)
          else next.add(groupId)
          return next
        })
        // Taking the group supersedes any of its members that were selected
        // individually — drop them so the member isn't represented twice.
        const dropMembers = (prev: Set<string>) => {
          if (![...memberIds].some((mid) => prev.has(mid))) return prev
          const next = new Set(prev)
          for (const mid of memberIds) next.delete(mid)
          return next
        }
        setSelectedIframeLayerIds(dropMembers)
        setSelectedDocumentLayerIds(dropMembers)
      } else {
        setSelectedIframeLayerIds(new Set())
        setSelectedDocumentLayerIds(new Set())
        setSelectedGroupIds(new Set([groupId]))
      }
    },
    [collections]
  )

  const handleDocumentLayerSelect = useCallback(
    (id: string, shiftKey: boolean) => {
      // Mirrors handleIframeLayerSelect for documents.
      if (shiftKey) {
        const parentGroupId = findGroupIdForMember(id)
        if (parentGroupId && selectedGroupIdsRef.current.has(parentGroupId))
          return
        setSelectedDocumentLayerIds((prev) => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      } else {
        setSelectedGroupIds(new Set())
        setSelectedDocumentLayerIds(new Set([id]))
        setSelectedIframeLayerIds(new Set())
      }
    },
    [findGroupIdForMember]
  )

  /**
   * Recompute edge/center snap from the cumulative cursor delta and return the
   * adjusted incremental delta to actually apply. Updates the red guide lines
   * for the overlay. No-op when no snap state was set up (drag of a single
   * isolated group with no other rects on the canvas).
   */
  const applyMoveSnap = useCallback(
    (
      dx: number,
      dy: number,
      totalDx: number,
      totalDy: number,
      metaKey: boolean
    ): { adjDx: number; adjDy: number } => {
      const state = dragSnapStateRef.current
      if (!state) return { adjDx: dx, adjDy: dy }
      // Cmd/meta held → bypass snap and release any active lock. The "release"
      // delta (-state.appliedSnap) pops the rect back to its raw cursor
      // position so it instantly follows the cursor instead of staying stuck
      // at the previous snap target.
      if (metaKey) {
        const adjDx = dx - state.appliedSnap.x
        const adjDy = dy - state.appliedSnap.y
        state.appliedSnap = { x: 0, y: 0 }
        setSnapGuides([])
        return { adjDx, adjDy }
      }
      const zoom = transformRef.current?.state.scale ?? 1
      const rawRect: MoveSnapRect = {
        x: state.startUnion.x + totalDx,
        y: state.startUnion.y + totalDy,
        width: state.startUnion.width,
        height: state.startUnion.height,
      }
      const { snapDx, snapDy, guides } = computeMoveSnap({
        rect: rawRect,
        candidates: state.candidates,
        zoom,
      })
      const adjDx = dx + (snapDx - state.appliedSnap.x)
      const adjDy = dy + (snapDy - state.appliedSnap.y)
      state.appliedSnap = { x: snapDx, y: snapDy }
      setSnapGuides(guides)
      return { adjDx, adjDy }
    },
    []
  )

  const handleMoveSelected = useCallback(
    (
      dx: number,
      dy: number,
      totalDx: number,
      totalDy: number,
      metaKey: boolean
    ) => {
      const { adjDx, adjDy } = applyMoveSnap(dx, dy, totalDx, totalDy, metaKey)
      const abIds = Array.from(selectedIframeLayerIdsRef.current)
      const docIds = Array.from(selectedDocumentLayerIdsRef.current)
      // Documents share the move pathway with iframeLayers — they live in
      // groups, so `moveIframeLayersByDelta` finds every group referenced by
      // any of the ids and shifts its anchor.
      const groupMemberIds = [...abIds, ...docIds]
      // Selected groups move too: contribute one member id per selected group
      // so `moveIframeLayersByDelta` translates the whole group. Without this a
      // mixed selection would drag its loose frames but leave its groups behind.
      for (const g of collections.iframeLayerGroups.toArray()) {
        if (!selectedGroupIdsRef.current.has(g.id)) continue
        const firstMember = getGroupMembers(g)[0]
        if (firstMember) groupMemberIds.push(firstMember.id)
      }
      if (groupMemberIds.length > 0)
        moveIframeLayersByDelta(groupMemberIds, adjDx, adjDy)
      // Source position has moved — recompute the merge preview off-render.
      applyMergeSnap(metaKey)
    },
    [collections, moveIframeLayersByDelta, applyMoveSnap, applyMergeSnap]
  )

  /**
   * Per-layer drag (cursor on a non-selected frame). Same snap path as
   * `handleMoveSelected` — both end up translating one or more entire groups
   * via `moveIframeLayersByDelta`, so they share `dragSnapStateRef`.
   */
  const handleMoveGroupForLayer = useCallback(
    (
      layerId: string,
      dx: number,
      dy: number,
      totalDx: number,
      totalDy: number,
      metaKey: boolean
    ) => {
      const { adjDx, adjDy } = applyMoveSnap(dx, dy, totalDx, totalDy, metaKey)
      moveIframeLayersByDelta([layerId], adjDx, adjDy)
      // Source position has moved — recompute the merge preview off-render.
      applyMergeSnap(metaKey)
    },
    [moveIframeLayersByDelta, applyMoveSnap, applyMergeSnap]
  )

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
      // doesn't paint a hover outline on each one in turn.
      let hovered: string | null = null
      if (!reorderDragRef.current && !layerDraggingRef.current) {
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

      // Track which gap handle is hovered/dragged so the wrapper can show a
      // col-resize cursor. While dragging, lock to the dragged handle even if
      // the cursor briefly slips outside the gap rect.
      const drag = gapDragRef.current
      const next = drag
        ? { groupId: drag.groupId, gapIndex: drag.gapIndex }
        : (() => {
            const hit = hitTestGapHandle(canvasX, canvasY, scale)
            return hit ? { groupId: hit.groupId, gapIndex: hit.gapIndex } : null
          })()
      setActiveGapHandle((prev) => {
        if (prev === next) return prev
        if (
          prev &&
          next &&
          prev.groupId === next.groupId &&
          prev.gapIndex === next.gapIndex
        )
          return prev
        return next
      })

      // Track which reorder handle is hovered so the overlay can swap the dot
      // from a hollow ring to a filled circle. While dragging, lock the
      // highlight to the dragged dot so the cursor can stray off-center
      // without the dot flipping back to its hollow state.
      if (reorderDragRef.current) {
        setHoveredReorderIframeLayerId((prev) =>
          prev === reorderDragRef.current!.iframeLayerId
            ? prev
            : reorderDragRef.current!.iframeLayerId
        )
      } else {
        const reorderHit = hitTestReorderHandle(canvasX, canvasY, scale)
        setHoveredReorderIframeLayerId((prev) => {
          const nextId = reorderHit?.iframeLayerId ?? null
          return prev === nextId ? prev : nextId
        })
      }
    },
    [setPresence, iframeLayerLayouts, hitTestGapHandle, hitTestReorderHandle]
  )

  const handlePointerLeave = useCallback(() => {
    setPresence({ pointer: null })
    setHoveredIframeLayerId(null)
    setActiveGapHandle(null)
    setHoveredReorderIframeLayerId(null)
  }, [setPresence])

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (!commentMode) return
      const ref = transformRef.current
      if (!ref) return
      const { positionX, positionY, scale } = ref.state
      const rect = e.currentTarget.getBoundingClientRect()
      const relX = e.clientX - rect.left
      const relY = e.clientY - rect.top
      const canvasX = (relX - positionX) / scale
      const canvasY = (relY - positionY) / scale

      // Hit-test against iframeLayer bounds — store offset relative to iframeLayer.
      // The iframe fills the iframeLayer div with no transform, so iframeLayer-local
      // coordinates equal iframe-viewport coordinates and can be passed
      // directly to the bridge's elementAtPoint.
      for (const layout of iframeLayerLayouts.values()) {
        if (
          canvasX >= layout.x &&
          canvasX <= layout.x + layout.width &&
          canvasY >= layout.y &&
          canvasY <= layout.y + layout.height
        ) {
          const localX = canvasX - layout.x
          const localY = canvasY - layout.y
          // Show the composer immediately at the click point; selector
          // resolution races the user's typing and patches the state in.
          setNewCommentPos({ x: localX, y: localY, iframeLayerId: layout.id })
          const dom = getIframeLayerDom(layout.id)
          if (dom) {
            dom
              .elementAtPoint(localX, localY)
              .then((result) => {
                if (!result) return
                // Store offsets as fractions of the element's width/height so
                // the pin tracks the same relative point as the element
                // resizes with the iframeLayer / page reflow. Falls back to 0
                // for zero-sized elements (no meaningful relative position).
                const w = result.rect.width
                const h = result.rect.height
                const offsetX = w > 0 ? (localX - result.rect.x) / w : 0
                const offsetY = h > 0 ? (localY - result.rect.y) / h : 0
                setNewCommentPos((prev) => {
                  if (!prev || prev.iframeLayerId !== layout.id) return prev
                  return {
                    ...prev,
                    selector: result.selector || null,
                    offsetX,
                    offsetY,
                  }
                })
              })
              .catch(() => {})
          }
          return
        }
      }

      setNewCommentPos({ x: canvasX, y: canvasY })
    },
    [commentMode, iframeLayerLayouts, getIframeLayerDom]
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

  // Auto-select the first running agent when none is selected. Booting
  // agents aren't picked here — a LogProbe (rendered for each pending id)
  // promotes them once their sandbox is streaming logs, which avoids the
  // "switch to empty panel then hang on 'Connecting…'" flicker.
  // Skipped when the user has explicitly pointed the chat panel at a
  // document — otherwise picking a doc from the target dropdown
  // (which sets `selectedAgentId` to null) would immediately snap
  // selection back to a running agent and clobber the doc target.
  useEffect(() => {
    if (selectedDocumentChatTargetId) return
    if (selectedAgentId && agents.some((a) => a.id === selectedAgentId)) return
    const firstRunning = agents.find(
      (a) => a.status === "running" && a.sandboxName
    )
    // Picking a default once async-loaded agent data arrives is a legitimate
    // effect sync, not an avoidable render cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (firstRunning) setSelectedAgentId(firstRunning.id)
  }, [selectedAgentId, agents, selectedDocumentChatTargetId])

  const handlePendingReady = useCallback((id: string) => {
    setSelectedAgentId(id)
    setPendingAgentIds((prev) => prev.filter((p) => p !== id))
  }, [])

  const selectedAgent = agents.find((a) => a.id === selectedAgentId)
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
      {pendingAgentIds.map((id) => {
        const pending = agents.find((a) => a.id === id)
        if (!pending?.sandboxName) return null
        return (
          <LogProbe
            key={id}
            sandboxName={pending.sandboxName}
            onReady={() => handlePendingReady(id)}
          />
        )
      })}
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
            onRenameDocument={setDocumentLayerTitle}
            onRemoveDocument={(id) => removeDocumentLayers([id])}
            onSelectBranch={handleSelectAgent}
            onCreateRepo={handleCreateRepo}
            onUpdateRepo={updateRepoInStorage}
            onRemoveRepo={async (id, { deleteBranchesOnRemote }) => {
              if (deleteBranchesOnRemote) {
                const repo = repos.find((w) => w.id === id)
                if (repo) {
                  const branches = agents
                    .filter((a) => a.repoId === id && a.ref)
                    .map((a) => a.ref)
                  const results = await Promise.all(
                    branches.map((branch) =>
                      deleteBranch(repo.repoOwner, repo.repoName, branch)
                    )
                  )
                  const failed = results.filter((r) => !r.success)
                  if (failed.length > 0) {
                    throw new Error(
                      failed[0]?.error ??
                        `Failed to delete ${failed.length} branch${failed.length === 1 ? "" : "es"} on remote`
                    )
                  }
                }
              }
              // Removing a Repo removes its Branches, and a Sandbox never
              // outlives its Branch — capture the names before the doc records
              // go, then tear the Sandboxes down fire-and-forget.
              const sandboxNames = agents
                .filter((a) => a.repoId === id)
                .map((a) => a.sandboxName)
                .filter(Boolean)
              removeRepoFromStorage(id)
              if (sandboxNames.length > 0) {
                void deleteSandboxes(sandboxNames).catch(() => {})
              }
            }}
            onCreateBranchFromGitBranch={handleCreateAgentFromBranch}
            onCreateWorkspace={handleCreateWorkspace}
            onRebaseOnDefault={handleRebaseOnDefault}
            onRestartDevServer={handleRestartDevServer}
            onCreatePr={handleCreatePullRequest}
            onRefreshBranch={handleRefreshAgent}
            onRecreateBranch={handleRecreateAgent}
            onRemoveBranch={async (id, { deleteOnRemote }) => {
              const agent = agents.find((a) => a.id === id)
              if (deleteOnRemote) {
                const repo = agent
                  ? repos.find((w) => w.id === agent.repoId)
                  : undefined
                if (agent?.ref && repo) {
                  const result = await deleteBranch(
                    repo.repoOwner,
                    repo.repoName,
                    agent.ref
                  )
                  if (!result.success) {
                    throw new Error(
                      result.error ?? "Failed to delete branch on remote"
                    )
                  }
                }
              }
              if (selectedAgentId === id) {
                setSelectedAgentId(null)
                setSelectedChatId(null)
                chatPanelRef.current?.collapse()
              }
              // removeAgentFromStorage clears the chat-store mirror for the Chat
              // Sessions the verb deletes.
              removeAgentFromStorage(id)
              // A Sandbox never outlives its Branch: tear down the deleted
              // Branch's worktree/VM (dev server included) so the leak doesn't
              // keep its git ref checked out. Fire-and-forget — the Branch is
              // already gone from the doc, so cleanup must not block the UI.
              if (agent?.sandboxName) {
                void deleteSandboxes([agent.sandboxName]).catch(() => {})
              }
            }}
            onAddIframeLayer={handleAddIframeLayerForAgent}
            onPlayBranch={handlePlayAgent}
            onShowRoutes={handleShowRoutesForAgent}
            onUpdateBranch={updateAgentInStorage}
            onRenameBranch={handleBranchRename}
            onSelectIframeLayer={handleIframeLayerSelect}
            onZoomToIframeLayer={handleSelectIframeLayer}
            onRenameIframeLayer={renameIframeLayer}
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
            chatPanelBranchId={chatCollapsed ? null : selectedAgentId}
            branchPrs={branchPrs}
          />
        </ResizablePanel>
        <ResizableHandle className="focus-visible:ring-0" />

        {/* Canvas */}
        <ResizablePanel id="canvas">
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
                      : reorderDraggingIframeLayerId
                        ? "grabbing"
                        : hoveredReorderIframeLayerId
                          ? "grab"
                          : undefined,
            }}
            onPointerDownCapture={handleCanvasPointerDownCapture}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={(e) => {
              handlePointerMove(e)
              handleCanvasPointerMove(e)
            }}
            onPointerUp={handleCanvasPointerUp}
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
              anchor={resizeSnap?.anchor ?? "tl"}
              candidates={resizeSnap?.candidates ?? []}
              snappedPresetId={resizeSnap?.snappedPresetId ?? null}
            />

            <GroupMergeUnderlay
              zoom={zoom}
              viewportPos={viewportPos}
              rects={groupDragSnapRects}
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
              initialScale={1}
              initialPositionX={
                -CANVAS_SIZE / 2 +
                (typeof window !== "undefined" ? window.innerWidth / 2 : 500)
              }
              initialPositionY={
                -CANVAS_SIZE / 2 +
                (typeof window !== "undefined" ? window.innerHeight / 2 : 400)
              }
              minScale={ZOOM_MIN}
              maxScale={ZOOM_MAX}
              limitToBounds={false}
              centerOnInit={false}
              doubleClick={{ disabled: true }}
              wheel={{
                disabled: true,
              }}
              trackPadPanning={{
                disabled: true,
              }}
              panning={{
                velocityDisabled: true,
                disabled:
                  focusedIframeLayerId !== null ||
                  createFlowIframeLayerId !== null ||
                  editingDocumentLayerId !== null,
                allowLeftClickPan: spaceHeld,
                allowMiddleClickPan: true,
              }}
              onInit={(ref) => {
                if (!viewportRestoredRef.current && savedViewport) {
                  viewportRestoredRef.current = true
                  ref.setTransform(
                    savedViewport.x,
                    savedViewport.y,
                    savedViewport.zoom,
                    0
                  )
                  setZoom(savedViewport.zoom)
                  setViewportPos({ x: savedViewport.x, y: savedViewport.y })
                  setPresence({ viewport: savedViewport })
                } else {
                  const { scale, positionX, positionY } = ref.state
                  setZoom(scale)
                  setViewportPos({ x: positionX, y: positionY })
                  setPresence({
                    viewport: { x: positionX, y: positionY, zoom: scale },
                  })
                }
              }}
              onPanningStart={() => {
                handleFollowBreak()
                setIsPanning(true)
              }}
              onPanningStop={() => setIsPanning(false)}
              onWheelStart={handleFollowBreak}
              onPinchStart={handleFollowBreak}
              onTransform={(_ref, state) => {
                const vp = {
                  x: state.positionX,
                  y: state.positionY,
                  zoom: state.scale,
                }
                setZoom(state.scale)
                setViewportPos({ x: state.positionX, y: state.positionY })
                setPresence({ viewport: vp })
                saveViewportDebounced(vp)
              }}
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
                  {/* Flat member layer. Every iframe/markdown layer across all
                      groups renders as a stable, id-sorted, absolutely-positioned
                      sibling — NOT nested in a per-group element. A member keeps
                      its React identity (and its live DOM: the running iframe or
                      the TipTap editor) when it moves between groups, so pop-out
                      / drag-in no longer remount it → no reload. Group membership
                      only changes the member's computed world position. */}
                  {(() => {
                    // Flatten to [member, group] pairs, then sort by member id so
                    // React never reparents or re-orders a member node (either of
                    // which remounts the iframe / TipTap editor — see the
                    // `groupZIndex` note for why DOM order has to stay fixed).
                    const entries: Array<{
                      member: GroupMember
                      group: IframeLayerGroupData
                    }> = []
                    for (const group of iframeLayerGroups) {
                      for (const member of getGroupMembers(group)) {
                        entries.push({ member, group })
                      }
                    }
                    entries.sort((a, b) =>
                      a.member.id.localeCompare(b.member.id)
                    )

                    return entries.map(({ member, group }) => {
                      const members = getGroupMembers(group)
                      const index = members.findIndex((m) => m.id === member.id)
                      const groupSelected = selectedGroupIds.has(group.id)
                      const showGroupLabel = members.length > 1
                      const groupLabel = showGroupLabel
                        ? groupDisplayNames.get(group.id)
                        : undefined
                      // Tint this member's name (and, on the leftmost member,
                      // the group label) to match a remote user's selection
                      // rect. Skipped when we've selected it locally — our own
                      // fuchsia takes precedence.
                      const remoteSelectedColor = remoteSelectionColors.get(
                        member.id
                      )
                      const remoteGroupSelectedColor =
                        index === 0
                          ? remoteGroupSelectionColors.get(member.id)
                          : undefined
                      const layout = effectiveIframeLayerLayouts.get(member.id)
                      if (!layout) return null

                      // In-flow reorder: layer a cursor-tracking translate over
                      // the layout slot (siblings reflow via the layout map). A
                      // popped frame already sits at `cursor - grab` in
                      // effectiveIframeLayerLayouts, so it needs no transform —
                      // only the `dragPopped` flag for z-elevation / pointer
                      // pass-through / group-label anchoring.
                      let dragTranslateX: number | undefined
                      let dragTranslateY: number | undefined
                      let dragPopped = false
                      if (
                        reorderDraggingIframeLayerId === member.id &&
                        reorderDragCursor != null
                      ) {
                        const grab = reorderGrabOffset ?? {
                          x: layout.width / 2,
                          y: layout.height / 2,
                        }
                        if (reorderDragPopped) {
                          dragPopped = true
                        } else {
                          const raw = iframeLayerLayouts.get(member.id)
                          if (raw) {
                            // Lock Y so the dragged frame slides only horizontally.
                            dragTranslateX =
                              reorderDragCursor.x - grab.x - raw.x
                            dragTranslateY = 0
                          }
                        }
                      }

                      const zIndex = groupZIndex.get(group.id)

                      if (member.kind === "markdown-layer") {
                        const doc = markdownLayers.find(
                          (d) => d.id === member.id
                        )
                        if (!doc) return null
                        return (
                          <MarkdownLayer
                            key={doc.id}
                            layer={doc}
                            zoom={zoom}
                            selected={selectedDocumentLayerIds.has(doc.id)}
                            multiSelected={
                              selectedIframeLayerIds.size +
                                selectedDocumentLayerIds.size >
                              1
                            }
                            editing={editingDocumentLayerId === doc.id}
                            spaceHeld={spaceHeld}
                            userName={self?.identity.name || "Anonymous"}
                            userColor={self?.color || "#888888"}
                            worldX={layout.x}
                            worldY={layout.y}
                            zIndex={zIndex}
                            dragTranslateX={dragTranslateX}
                            dragTranslateY={dragTranslateY}
                            dragPopped={dragPopped}
                            remoteSelectedColor={remoteSelectedColor}
                            remoteGroupSelectedColor={remoteGroupSelectedColor}
                            groupLabel={index === 0 ? groupLabel : undefined}
                            groupSelected={groupSelected}
                            onSelectGroup={
                              index === 0 && showGroupLabel
                                ? (shiftKey) =>
                                    handleGroupSelect(group.id, shiftKey)
                                : undefined
                            }
                            onRenameGroup={
                              index === 0 && showGroupLabel
                                ? (name) =>
                                    renameIframeLayerGroup(group.id, name)
                                : undefined
                            }
                            onSelect={handleDocumentLayerSelect}
                            onMoveGroup={(
                              dx,
                              dy,
                              totalDx,
                              totalDy,
                              metaKey
                            ) => {
                              // Event handler (fires on drag), so the ref
                              // access inside is deferred past render; the rule
                              // can't see that through the inline closure.
                              // eslint-disable-next-line react-hooks/refs
                              handleMoveGroupForLayer(
                                doc.id,
                                dx,
                                dy,
                                totalDx,
                                totalDy,
                                metaKey
                              )
                            }}
                            onMoveSelected={handleMoveSelected}
                            onGroupDragStart={() => {
                              // eslint-disable-next-line react-hooks/refs
                              handleLayerGroupDragStart(doc.id)
                            }}
                            onGroupDragEnd={handleLayerGroupDragEnd}
                            onRequestReorderDrag={requestReorderDrag}
                            onResize={resizeDocumentLayer}
                            onTitleChange={setDocumentLayerTitleCache}
                            onRename={setDocumentLayerTitle}
                            onStartEdit={setEditingDocumentLayerId}
                            onStopEdit={() => setEditingDocumentLayerId(null)}
                            onEditorReady={handleDocumentEditorReady}
                            onStartInlineComment={handleStartInlineComment}
                            onSelectInlineThread={handleSelectInlineThread}
                          />
                        )
                      }

                      const iframeLayer = iframeLayers.find(
                        (a) => a.id === member.id
                      )
                      if (!iframeLayer) return null
                      const agentInfo = iframeLayer.branchId
                        ? agentDomains[iframeLayer.branchId]
                        : undefined
                      // Resolve the assigned branch's ref independently of
                      // preview readiness: the dropdown must reflect the
                      // selection (and the frame show a "waiting" state) as
                      // soon as a branch is picked, before its dev server —
                      // and thus its previewDomain in `agentDomains` — is up.
                      const assignedAgent = iframeLayer.branchId
                        ? agents.find((a) => a.id === iframeLayer.branchId)
                        : undefined
                      return (
                        <IframeLayer
                          key={iframeLayer.id}
                          iframeLayer={{
                            ...iframeLayer,
                            iframeUrl: agentInfo?.previewDomain,
                            branch: agentInfo?.branch ?? assignedAgent?.ref,
                          }}
                          zoom={zoom}
                          focused={focusedIframeLayerId === iframeLayer.id}
                          createFlow={
                            createFlowIframeLayerId === iframeLayer.id
                          }
                          selected={selectedIframeLayerIds.has(iframeLayer.id)}
                          onFocus={(id) => {
                            setFocusedIframeLayerId(id)
                            if (id !== null) setCreateFlowIframeLayerId(null)
                          }}
                          onToggleCreateFlow={(id) => {
                            setCreateFlowIframeLayerId(id)
                            if (id !== null) setFocusedIframeLayerId(null)
                          }}
                          onSelect={handleIframeLayerSelect}
                          onMoveGroup={(dx, dy, totalDx, totalDy, metaKey) =>
                            handleMoveGroupForLayer(
                              iframeLayer.id,
                              dx,
                              dy,
                              totalDx,
                              totalDy,
                              metaKey
                            )
                          }
                          onMoveSelected={handleMoveSelected}
                          onGroupDragStart={() =>
                            handleLayerGroupDragStart(iframeLayer.id)
                          }
                          onGroupDragEnd={handleLayerGroupDragEnd}
                          onRequestReorderDrag={requestReorderDrag}
                          onResize={resizeIframeLayerEdge}
                          onResizeStart={handleResizeStart}
                          onResizeEnd={handleResizeEnd}
                          onRemove={removeIframeLayer}
                          onRename={renameIframeLayer}
                          onStateChanged={updateIframeLayerState}
                          onRouteChange={updateIframeLayerRoute}
                          onScrollChange={updateIframeLayerScroll}
                          onKnobsDeclared={updateIframeLayerKnobs}
                          onKnobValuesChange={updateIframeLayerKnobValues}
                          onSharedStateChanged={updateIframeLayerSharedState}
                          onPlay={
                            iframeLayer.branchId
                              ? handlePlayIframeLayer
                              : undefined
                          }
                          onFitToContent={fitIframeLayerToContent}
                          onSetSize={fitIframeLayerToContent}
                          multiSelected={
                            selectedIframeLayerIds.size +
                              selectedDocumentLayerIds.size >
                            1
                          }
                          spaceHeld={spaceHeld}
                          commentMode={commentMode}
                          onHover={handleInspectHover}
                          onWheel={handleIframeWheel}
                          onDomReady={handleIframeLayerDomReady}
                          assignableBranches={agents}
                          onAssignBranch={assignAgentToIframeLayer}
                          discoveredRoutes={agentInfo?.discoveredRoutes}
                          onSelectRoute={updateIframeLayerRoute}
                          remoteSelectedColor={remoteSelectedColor}
                          remoteGroupSelectedColor={remoteGroupSelectedColor}
                          groupLabel={index === 0 ? groupLabel : undefined}
                          groupSelected={groupSelected}
                          onSelectGroup={
                            index === 0 && showGroupLabel
                              ? (shiftKey) =>
                                  handleGroupSelect(group.id, shiftKey)
                              : undefined
                          }
                          onRenameGroup={
                            index === 0 && showGroupLabel
                              ? (name) => renameIframeLayerGroup(group.id, name)
                              : undefined
                          }
                          worldX={layout.x}
                          worldY={layout.y}
                          zIndex={zIndex}
                          dragTranslateX={dragTranslateX}
                          dragTranslateY={dragTranslateY}
                          dragPopped={dragPopped}
                        />
                      )
                    })
                  })()}

                  {/* Trailing "+ frame" placeholder click targets — one per group
                      with a selected member. The visible outline is painted by
                      PlaceholderRectsUnderlay; this is just the transparent hit
                      target, positioned absolutely in world space. */}
                  {placeholderRects.map((rect) => (
                    <button
                      key={`placeholder-${rect.groupId}`}
                      type="button"
                      data-iframe-layer-placeholder
                      className="absolute cursor-pointer bg-transparent"
                      style={{
                        left: rect.x,
                        top: rect.y,
                        width: rect.width,
                        height: rect.height,
                        zIndex: groupZIndex.get(rect.groupId),
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        const newId = addIframeLayerToGroup(rect.groupId)
                        if (newId) {
                          setSelectedIframeLayerIds(new Set([newId]))
                          setSelectedGroupIds(new Set())
                          setSelectedDocumentLayerIds(new Set())
                        }
                      }}
                      aria-label="Add frame to group"
                    />
                  ))}
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
                newCommentPos={newCommentPos}
                onNewCommentPlaced={() => {
                  setNewCommentPos(null)
                  setCommentMode(false)
                }}
                onCancelComment={() => setNewCommentPos(null)}
                iframeLayers={Array.from(iframeLayerLayouts.values())}
                getIframeLayerDom={getIframeLayerDom}
                getDocumentEditor={getDocumentEditor}
                documentEditorsVersion={documentEditorsVersion}
                initialThreads={initialThreads}
                onSendToChat={handleCommentSendToChat}
                activeThreadId={activeCommentThreadId}
                onActivateThread={setActiveCommentThreadId}
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
                if (
                  !reorderDraggingIframeLayerId ||
                  !reorderDragCursor ||
                  reorderDragPopped
                )
                  return null
                const layout = iframeLayerLayouts.get(
                  reorderDraggingIframeLayerId
                )
                if (!layout) return null
                const grab = reorderGrabOffset ?? {
                  x: layout.width / 2,
                  y: layout.height / 2,
                }
                return {
                  iframeLayerId: reorderDraggingIframeLayerId,
                  dx: reorderDragCursor.x - grab.x - layout.x,
                  dy: 0,
                }
              })()}
              marquee={marquee}
              frameDraft={frameDraft}
              documentDraft={documentDraft}
              othersSelections={othersSelections}
              snapGuides={snapGuides}
              inspectRect={(() => {
                // Show the live hover overlay while in commentMode so the
                // user can see what element they're about to anchor to.
                const source = commentMode ? inspectHover : null
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
            <div
              className={`pointer-events-none absolute top-0 left-0 z-[9998] flex h-12 items-center pr-2 ${
                // When the macOS traffic lights are showing (desktop, not
                // fullscreen) and the sidebar is collapsed, the canvas fills the
                // full width — shift these pills right to clear the lights.
                trafficLightsPresent && sidebarCollapsed ? "pl-[88px]" : "pl-2"
              }`}
            >
              <div
                className="pointer-events-auto flex items-center gap-1 rounded-lg bg-background p-1 shadow-md outline outline-1 outline-foreground/5"
                onClick={(e) => e.stopPropagation()}
              >
                {sidebarCollapsed && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => sidebarPanelRef.current?.expand()}
                        >
                          <PanelLeftOpen className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        Expand sidebar <Kbd>⌘B</Kbd>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                <Breadcrumb>
                  <BreadcrumbList className="gap-0 text-xs sm:gap-0">
                    <BreadcrumbItem className="gap-0">
                      <BreadcrumbLink
                        href="/"
                        className="px-1.5 py-1 font-medium"
                        onClick={(e) => {
                          e.preventDefault()
                          stopRoomDevServers()
                          router.push("/")
                        }}
                      >
                        Canvases
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="text-muted-foreground/60">
                      /
                    </BreadcrumbSeparator>
                    <BreadcrumbItem className="gap-0.5">
                      <EditableText
                        ref={roomNameEditableRef}
                        as="span"
                        value={currentRoomName}
                        onCommit={handleRoomRename}
                        placeholder="Untitled"
                        className="min-w-0 px-1.5 py-1 text-xs font-medium text-foreground"
                        viewClassName="truncate"
                        editClassName="relative z-10 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-xs bg-white text-black shadow-sm ring-[0.5px] ring-black/15 px-0.5 py-0.5 mx-1 my-0.5"
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="h-6 w-6 text-muted-foreground"
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="start"
                          onCloseAutoFocus={onRoomMenuCloseAutoFocus}
                        >
                          <DropdownMenuItem
                            onSelect={() => {
                              pendingRoomRenameRef.current = true
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setDeleteDialogOpen(true)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
                <DeleteRoomDialog
                  open={deleteDialogOpen}
                  onOpenChange={setDeleteDialogOpen}
                  roomName={currentRoomName}
                  onConfirm={async () => {
                    await deleteRoom(roomId)
                    setDeleteDialogOpen(false)
                    router.push("/")
                  }}
                />
              </div>
            </div>
            <div className="pointer-events-none absolute bottom-0 left-1/2 z-[9998] flex h-12 -translate-x-1/2 items-center px-2">
              <div
                className="pointer-events-auto flex items-center gap-1 rounded-lg bg-background p-1 shadow-md outline outline-1 outline-foreground/5"
                onClick={(e) => e.stopPropagation()}
              >
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={
                          !commentMode && !documentMode && !frameMode
                            ? "default"
                            : "ghost"
                        }
                        size="icon-xs"
                        onClick={() => {
                          setCommentMode(false)
                          setNewCommentPos(null)
                          setInspectHover(null)
                          setDocumentMode(false)
                          setFrameMode(false)
                        }}
                      >
                        <MousePointer2 className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Select <Kbd>V</Kbd>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={frameMode ? "default" : "ghost"}
                        size="icon-xs"
                        onClick={() => {
                          setFrameMode((m) => !m)
                          setDocumentMode(false)
                          setCommentMode(false)
                          setNewCommentPos(null)
                          setInspectHover(null)
                        }}
                      >
                        <Frame className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Frame <Kbd>F</Kbd>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={documentMode ? "default" : "ghost"}
                        size="icon-xs"
                        onClick={() => {
                          setDocumentMode((m) => !m)
                          setCommentMode(false)
                          setNewCommentPos(null)
                          setInspectHover(null)
                          setFrameMode(false)
                        }}
                      >
                        <FileText className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Document <Kbd>D</Kbd>
                    </TooltipContent>
                  </Tooltip>
                  {/* Comment mode is kept in the local build: it's how you
                      anchor an element/selection to reference it to the agent
                      ("Send to Claude"). Only the *persisted* comment thread
                      is excluded there (#417). */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={commentMode ? "default" : "ghost"}
                        size="icon-xs"
                        onClick={() => {
                          setCommentMode((m) => !m)
                          setNewCommentPos(null)
                          setInspectHover(null)
                          setDocumentMode(false)
                          setFrameMode(false)
                        }}
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Comment <Kbd>C</Kbd>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
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
                      onFollow={setFollowingConnectionId}
                    />
                    <Button size="sm" onClick={() => setShareDialogOpen(true)}>
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
          {(() => {
            // Resolve the panel's current target: an agent (sandbox-backed)
            // when one is selected and ready, otherwise the doc-chat target
            // when one was picked from the dropdown. Falls through to the
            // empty-state below when neither is set.
            const docTarget = selectedDocumentChatTargetId
              ? (markdownLayers.find(
                  (d) => d.id === selectedDocumentChatTargetId
                ) ?? null)
              : null
            // Resolve the target. For layer-kind targets we pack the layer
            // into the generic `{ kind: "layer", layerKind, layer }` shape
            // — that's what the chat panel expects so it can dispatch
            // through the layer-kinds registry.
            const target: ChatPanelTarget | null = selectedAgent?.sandboxName
              ? { kind: "agent", agent: selectedAgent }
              : docTarget
                ? {
                    kind: "layer",
                    layerKind: "markdown-layer",
                    layer: docTarget as unknown as { id: string } & Record<
                      string,
                      unknown
                    >,
                  }
                : null
            if (!target) return null
            const filteredSessions = chatSessions.filter((c) => {
              if (target.kind === "agent") return c.branchId === target.agent.id
              // Layer targets: per-kind state lives on the chat session
              // under different fields.
              if (target.layerKind === "markdown-layer")
                return c.markdownLayerId === target.layer.id
              return false
            })
            // This client's local terminal tabs for an agent target. Passed as a
            // separate collection (never merged into `chatSessions`), so a
            // terminal can't structurally reach the conversation model.
            const terminalTabs =
              target.kind === "agent"
                ? localTerminals.filter((t) => t.branchId === target.agent.id)
                : []
            return (
              <ChatPanel
                target={target}
                agents={agents}
                markdownLayers={markdownLayers}
                onSelectAgent={(id) => {
                  setSelectedDocumentChatTargetId(null)
                  handleSelectAgent(id)
                }}
                onSelectLayer={(layerKind, id) => {
                  if (layerKind === "markdown-layer") {
                    setSelectedAgentId(null)
                    setSelectedDocumentChatTargetId(id)
                    const lastChat = selectedChatByDocumentRef.current[id]
                    setSelectedChatId(lastChat ?? null)
                    return
                  }
                }}
                chatSessions={filteredSessions}
                terminalTabs={terminalTabs}
                selectedChatId={selectedChatId}
                roomId={roomId}
                onSelectChat={handleSelectChat}
                onCreateChat={() => {
                  if (target.kind === "agent") handleCreateChat(target.agent.id)
                  // Event handler (fires on click), so the ref write inside
                  // handleCreateDocumentChat is deferred past render.
                  else if (target.layerKind === "markdown-layer")
                    // eslint-disable-next-line react-hooks/refs
                    handleCreateDocumentChat(target.layer.id)
                }}
                onCreateTerminal={
                  target.kind === "agent"
                    ? (harnessKey) =>
                        handleCreateTerminal(target.agent.id, harnessKey)
                    : undefined
                }
                onRenameChat={handleRenameChat}
                onRemoveChat={handleRemoveChat}
                onCloseChat={handleCloseChat}
                onReopenChat={handleReopenChat}
                onBranchRename={(branch) => {
                  if (target.kind === "agent")
                    handleBranchRename(target.agent.id, branch)
                }}
                onPlanModeChange={(chatId, pm) =>
                  updateChatSession(chatId, { planMode: pm })
                }
                onModelChange={(chatId, model) =>
                  updateChatSession(chatId, { model })
                }
                diffStats={
                  target.kind === "agent"
                    ? diffStats.get(target.agent.id)
                    : undefined
                }
                branchPr={
                  target.kind === "agent"
                    ? (branchPrs.get(target.agent.id) ?? null)
                    : null
                }
                onPrCreated={setBranchPr}
                onCollapse={() => chatPanelRef.current?.collapse()}
                onLogsReady={handleLogsReady}
              />
            )
          })() || (
            <div className="flex h-full flex-col bg-background">
              <div className="flex h-12 items-center bg-background px-3">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        className="mr-1.5 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0"
                        onClick={() => chatPanelRef.current?.collapse()}
                      >
                        <PanelRightClose className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      Collapse chat <Kbd>⌘I</Kbd>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <span className="text-xs text-muted-foreground">
                  {repos.length === 0 ? "No workspaces" : "No active agents"}
                </span>
              </div>
              <div className="border-b border-border" />
              <div className="flex flex-1 items-center justify-center px-6">
                <p className="text-sm text-muted-foreground">
                  {repos.length === 0
                    ? "Add a workspace to get started"
                    : "Waiting for an agent to start…"}
                </p>
              </div>
            </div>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </>
  )
}
