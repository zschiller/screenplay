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
import { createTerminalTab } from "@/lib/canvas/tab-kind"
import {
  deleteTerminalTabAction,
  listTerminalTabsAction,
} from "@/lib/terminal-tabs-actions"
import type { TerminalTabRecord } from "@/lib/terminal-tabs"
import { partitionTerminalsByBranch } from "@/lib/terminal/orphan-tabs"
import { useAppSession } from "@/lib/auth-client"
import { isLocalBuild } from "@/lib/local-mode"
import { useTrafficLightsPresent } from "@/lib/use-traffic-lights"
import { withBasePath } from "@/lib/base-path"
import {
  Crosshair,
  FileText,
  Frame,
  LogOut,
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
import { Comments } from "./comments"
import type { ThreadWithComments } from "@/lib/comments"
import { Cursors } from "./cursors"
import { CursorChat } from "./cursor-chat"
import { FollowingToolbar } from "./following-toolbar"
import { useThumbnailHeartbeat } from "./use-thumbnail-heartbeat"
import { DirtyFrameTracker } from "@/lib/thumbnail/dirty-frames"
import type { ScreenplayDom } from "@/hooks/use-screenplay-dom"
import type { DomRect } from "@/lib/postmessage-protocol"
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
  TerminalTabData,
} from "@/lib/types"
import { chatStore } from "@/lib/chat-store"
import { isBranchBusy } from "@/lib/branch-busy"
import { useDiffStats } from "@/hooks/use-diff-stats"
import {
  recreateSandbox,
  reconnectSandbox,
  keepAliveSandbox,
  stopDevServers,
} from "@/lib/sandbox/lifecycle"
import {
  type BranchRecoveryDeps,
  recreate as recreateBranchRecovery,
  restartDevServer as restartDevServerRecovery,
  restartSandbox as restartSandboxRecovery,
} from "@/lib/branch/recovery"
import { useBranchIntake } from "@/components/canvas/use-branch-intake"
import { useTabPool } from "@/components/canvas/use-tab-pool"
import { useCanvasSelection } from "@/components/canvas/use-canvas-selection"
import { useToolMode } from "@/components/canvas/use-tool-mode"
import { useCanvasCamera } from "@/components/canvas/use-canvas-camera"
import { createPullRequestAction } from "@/lib/create-pr-action"
import { openExternal } from "@/lib/open-external"
import {
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
            toolMode: toolMode.current(),
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
            toolMode.set("select")
            break
          case "exit-frame-mode":
            toolMode.set("select")
            break
          case "exit-comment-mode":
            toolMode.set("select")
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
            selection.clear()
            break
        }
        return
      }
      // The four draw-tool shortcuts each dispatch one Tool Mode intent; the
      // union keeps the tools mutually exclusive, so there's no "clear the other
      // three" to do here. Resetting the comment-placement sub-state stays.
      if (e.key === "v" && !e.metaKey && !e.ctrlKey && !isEditing(e)) {
        toolMode.set("select")
        setNewCommentPos(null)
        setInspectHover(null)
      }
      if (e.key === "c" && !e.metaKey && !e.ctrlKey && !isEditing(e)) {
        toolMode.toggle("comment")
        setNewCommentPos(null)
        setInspectHover(null)
      }
      if (e.key === "d" && !e.metaKey && !e.ctrlKey && !isEditing(e)) {
        toolMode.toggle("document")
        setNewCommentPos(null)
        setInspectHover(null)
      }
      if (e.key === "f" && !e.metaKey && !e.ctrlKey && !isEditing(e)) {
        toolMode.toggle("frame")
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
      // Delete/Backspace removes the selection (cascading selected groups to
      // their members) and selects what's next — the decision + apply both live
      // in the Canvas Selection controller, which reads its own current
      // selection. preventDefault only when something was actually deleted.
      if ((e.key === "Delete" || e.key === "Backspace") && !isEditing(e)) {
        if (selection.deleteSelected()) e.preventDefault()
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
    toolMode,
    selection,
    newCommentPos,
    focusedIframeLayerId,
    createFlowIframeLayerId,
    history,
    openCursorChat,
    closeCursorChat,
  ])

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
          selection.selectMember(
            intent.memberId,
            intent.kind,
            intent.additive
          )
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
      const prev = collections.iframeLayers.get(id)
      ops.patch("iframeLayers", id, { width: newWidth, height: newHeight })
      // Fit-to-content and device-size presets resize the frame too, so the
      // manifest discards its now-mismatched capture — mark it dirty to
      // recapture at the new size when the size actually changed.
      if (prev && (prev.width !== newWidth || prev.height !== newHeight)) {
        captureTracker.markDirty(id)
      }
    },
    [ops, collections, captureTracker]
  )

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
        // Always open a fresh chat bound to this doc — never reuse a
        // remembered chat or a terminal.
        const chatId = nanoid()
        addChatSession(chatId, {
          id: chatId,
          markdownLayerId: docLayer.id,
          label: "Untitled",
          createdAt: Date.now(),
        })
        const isFirstChat = !chatSessions.some(
          (c) => c.markdownLayerId === docLayer.id && c.id !== chatId
        )
        setSelectedAgentId(null)
        setSelectedDocumentChatTargetId(docLayer.id)
        setSelectedChatId(chatId)
        selectedChatByDocumentRef.current[docLayer.id] = chatId
        chatStore.sendMessage({
          roomId,
          chatId,
          markdownLayerId: docLayer.id,
          message: messageBody,
          isFirstChat,
          onChatRename: (label) =>
            inspectHandlersRef.current.renameChat(chatId, label),
        })
        expandPanel()
        return
      }

      // Element/frame target: route to the agent that owns the frame the
      // target happened on (the frame's branch) — not whatever chat is
      // currently focused — and always in a brand-new chat.
      const iframeLayer = ctx.iframeLayerId
        ? iframeLayers.find((a) => a.id === ctx.iframeLayerId)
        : undefined
      const agent = iframeLayer?.branchId
        ? agents.find((a) => a.id === iframeLayer.branchId)
        : null
      if (!agent?.sandboxName || !agent.ref) return
      const route = iframeLayer?.route || "/"
      const elementLine = ctx.selector ? `\nElement: \`${ctx.selector}\`` : ""
      const text = `${note}\n\nRoute: \`${route}\`${elementLine}`
      const chatId = nanoid()
      addChatSession(chatId, {
        id: chatId,
        branchId: agent.id,
        label: "Untitled",
        createdAt: Date.now(),
      })
      const isFirstChat = !chatSessions.some(
        (c) => c.branchId === agent.id && c.id !== chatId
      )
      setSelectedAgentId(agent.id)
      setSelectedDocumentChatTargetId(null)
      setSelectedChatId(chatId)
      selectedChatByAgentRef.current[agent.id] = chatId
      chatStore.sendMessage({
        roomId,
        chatId,
        sandboxName: agent.sandboxName,
        branch: agent.ref,
        message: text,
        isFirstChat,
        autoNamedBranch: agent.autoNamedBranch,
        onBranchRename: (branch) =>
          inspectHandlersRef.current.branchRename(agent.id, branch),
        onChatRename: (label) =>
          inspectHandlersRef.current.renameChat(chatId, label),
      })
      expandPanel()
    },
    [markdownLayers, chatSessions, agents, iframeLayers, roomId, addChatSession]
  )

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
    localTerminals,
    setLocalTerminals,
    isLocalTerminal,
    selectedChatId,
    setSelectedChatId,
    setSelectedAgentId,
    setSelectedDocumentChatTargetId,
    selectedChatByAgentRef,
    selectedChatByDocumentRef,
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
    setPendingAgentIds,
    selectedAgentId,
    setSelectedAgentId,
    setSelectedChatId,
    chatPanelRef,
  })

  // The injected seams the Branch recovery verbs run over: the agent + repo
  // lookups, the agent-store patch, and a sonner toast adapter. Built once per
  // render of the inputs so each verb sees the current Branch/Repo state.
  const recoveryDeps = useMemo<BranchRecoveryDeps>(
    () => ({
      findAgent: (id) => agents.find((a) => a.id === id),
      findRepo: (repoId) => repos.find((w) => w.id === repoId),
      patchAgent: updateAgentInStorage,
      toast: {
        success: (message) => toast.success(message),
        error: (message, description) =>
          toast.error(message, description ? { description } : undefined),
      },
    }),
    [agents, repos, updateAgentInStorage]
  )

  // The three named recovery verbs, each a thin binding of the shared module to
  // the live seams. Dev Server Restart stays the thin mid-turn path; Sandbox
  // Restart and Recreate share the status-flip runner (see lib/branch/recovery).
  const handleRestartDevServer = useCallback(
    (id: string) => restartDevServerRecovery(id, recoveryDeps),
    [recoveryDeps]
  )

  const handleRefreshAgent = useCallback(
    (id: string) => restartSandboxRecovery(id, recoveryDeps),
    [recoveryDeps]
  )

  // "Recreate from scratch": runs only after the AlertDialog confirm in the
  // sidebar, and discards the in-VM working tree (uncommitted changes included).
  const handleRecreateAgent = useCallback(
    (id: string) => recreateBranchRecovery(id, recoveryDeps),
    [recoveryDeps]
  )

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
            onCreateRepo={createRepo}
            onUpdateRepo={updateRepoInStorage}
            onRemoveRepo={removeRepoIntake}
            onCreateBranchFromGitBranch={createBranchFromGitBranch}
            onCreateWorkspace={createBranch}
            onRebaseOnDefault={handleRebaseOnDefault}
            onRestartDevServer={handleRestartDevServer}
            onCreatePr={handleCreatePullRequest}
            onRefreshBranch={handleRefreshAgent}
            onRecreateBranch={handleRecreateAgent}
            onRemoveBranch={removeBranchIntake}
            onAddIframeLayer={handleAddIframeLayerForAgent}
            onPlayBranch={handlePlayAgent}
            onShowRoutes={handleShowRoutesForAgent}
            onUpdateBranch={updateAgentInStorage}
            onRenameBranch={renameBranch}
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

            <TransformWrapper ref={transformRef} {...camera.transformWrapperProps}>
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
                      const reorderPreview = gesturePreview.reorder
                      if (reorderPreview?.memberId === member.id) {
                        const grab = reorderPreview.grabOffset ?? {
                          x: layout.width / 2,
                          y: layout.height / 2,
                        }
                        if (reorderPreview.popped) {
                          dragPopped = true
                        } else {
                          const raw = iframeLayerLayouts.get(member.id)
                          if (raw) {
                            // Lock Y so the dragged frame slides only horizontally.
                            dragTranslateX =
                              reorderPreview.cursor.x - grab.x - raw.x
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
                            onMoveGroup={(_dx, _dy, totalDx, totalDy, metaKey) =>
                              gestureLayerHandlers.onMove(
                                totalDx,
                                totalDy,
                                metaKey
                              )
                            }
                            onMoveSelected={(
                              _dx,
                              _dy,
                              totalDx,
                              totalDy,
                              metaKey
                            ) =>
                              gestureLayerHandlers.onMove(
                                totalDx,
                                totalDy,
                                metaKey
                              )
                            }
                            onGroupDragStart={() =>
                              gestureLayerHandlers.onGroupDragStart(doc.id)
                            }
                            onGroupDragEnd={gestureLayerHandlers.onGroupDragEnd}
                            onRequestReorderDrag={
                              gestureLayerHandlers.onRequestReorderDrag
                            }
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
                          onMoveGroup={(_dx, _dy, totalDx, totalDy, metaKey) =>
                            gestureLayerHandlers.onMove(totalDx, totalDy, metaKey)
                          }
                          onMoveSelected={(
                            _dx,
                            _dy,
                            totalDx,
                            totalDy,
                            metaKey
                          ) =>
                            gestureLayerHandlers.onMove(totalDx, totalDy, metaKey)
                          }
                          onGroupDragStart={() =>
                            gestureLayerHandlers.onGroupDragStart(iframeLayer.id)
                          }
                          onGroupDragEnd={gestureLayerHandlers.onGroupDragEnd}
                          onRequestReorderDrag={
                            gestureLayerHandlers.onRequestReorderDrag
                          }
                          onResize={gestureLayerHandlers.onResize}
                          onResizeStart={gestureLayerHandlers.onResizeStart}
                          onResizeEnd={gestureLayerHandlers.onResizeEnd}
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
                          onWheel={camera.handleIframeWheel}
                          onDomReady={handleIframeLayerDomReady}
                          onCaptureReadyChange={handleCaptureReadyChange}
                          onCaptureDirty={handleCaptureDirty}
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
                  toolMode.set("select")
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
                        href={
                          parentFolder ? `/files/${parentFolder.id}` : "/files"
                        }
                        className="max-w-[14rem] truncate px-1.5 py-1 font-medium"
                        onClick={(e) => {
                          e.preventDefault()
                          stopRoomDevServers()
                          const target = withBasePath(
                            parentFolder
                              ? `/files/${parentFolder.id}`
                              : "/files"
                          )
                          // Full-page navigation (not router.push): a soft nav
                          // serves the home page from the client Router Cache,
                          // which is the copy captured when we ENTERED the room —
                          // so a layout edit made in here shows up stale on the
                          // grid. A hard navigation re-renders home from the
                          // server (fresh thumbnail manifest) every time.
                          //
                          // But a full-page unload skips React's unmount cleanup,
                          // so flush the pending layout edit FIRST and await it
                          // (the route rebuilds the manifest inline) — otherwise
                          // the last edit never reaches the server and the fresh
                          // render is still stale. `.finally` so a failed flush
                          // still navigates rather than trapping the user.
                          void flushLayout().finally(() =>
                            window.location.assign(target)
                          )
                        }}
                      >
                        {parentFolder ? parentFolder.name : "All files"}
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
                          {/* Only the owner can rename; a collaborator's
                              rename would be refused server-side. */}
                          {isOwner && (
                            <>
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
                            </>
                          )}
                          {/* A shared Room the user doesn't own: they leave it
                              rather than destroy it for everyone else. */}
                          {!isOwner && (
                            <DropdownMenuItem
                              onSelect={() => setDeleteDialogOpen(true)}
                            >
                              <LogOut className="h-3.5 w-3.5" />
                              Leave
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
                <DeleteRoomDialog
                  open={deleteDialogOpen}
                  onOpenChange={setDeleteDialogOpen}
                  roomName={currentRoomName}
                  isOwner={isOwner}
                  sharedWithCount={sharedWithCount}
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
                        variant={toolMode.isSelect ? "default" : "ghost"}
                        size="icon-xs"
                        onClick={() => {
                          toolMode.set("select")
                          setNewCommentPos(null)
                          setInspectHover(null)
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
                          toolMode.toggle("frame")
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
                          toolMode.toggle("document")
                          setNewCommentPos(null)
                          setInspectHover(null)
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
                      ("Send to agent"). Only the *persisted* comment thread is
                      excluded there (#417) — so on desktop this is a "target"
                      affordance (crosshair), not a comment one. */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={commentMode ? "default" : "ghost"}
                        size="icon-xs"
                        onClick={() => {
                          toolMode.toggle("comment")
                          setNewCommentPos(null)
                          setInspectHover(null)
                        }}
                      >
                        {isLocalBuild ? (
                          <Crosshair className="h-3.5 w-3.5" />
                        ) : (
                          <MessageSquare className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {isLocalBuild ? "Send to agent" : "Comment"} <Kbd>C</Kbd>
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
                onSelectChat={tabPool.select}
                onCreateChat={() => {
                  if (target.kind === "agent")
                    tabPool.open({ kind: "chat", branchId: target.agent.id })
                  else if (target.layerKind === "markdown-layer")
                    tabPool.open({
                      kind: "doc-chat",
                      markdownLayerId: target.layer.id,
                    })
                }}
                onCreateTerminal={
                  target.kind === "agent"
                    ? (harnessKey) =>
                        tabPool.open({
                          kind: "terminal",
                          branchId: target.agent.id,
                          harnessKey,
                        })
                    : undefined
                }
                onRenameChat={tabPool.rename}
                onRemoveChat={tabPool.remove}
                onCloseChat={tabPool.close}
                onReopenChat={tabPool.reopen}
                onBranchRename={(branch) => {
                  if (target.kind === "agent")
                    renameBranch(target.agent.id, branch)
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
