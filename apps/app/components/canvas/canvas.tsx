"use client"

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react"

import { nanoid } from "nanoid"

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
  useMockupLayers,
  useOtherPeers,
  usePages,
  usePageViews,
  useRoomCollections,
  useSavedViewport,
  useSelfIdentity,
  useSetPresence,
  useMemories,
  useCanvasFiles,
  useCanvasSkills,
  useRepos,
  useYjsHistory,
} from "@/lib/yjs/react"

import { createCanvasOps } from "@/lib/canvas/ops"
import {
  layerChats,
  layerHolders,
  layerWorkspaceIds,
} from "@/lib/canvas/layer-chat"
import { workingChatsOf } from "@/components/canvas/working-chat"

import type { TerminalTabRecord } from "@/lib/terminal-tabs"

import { useAppSession } from "@/lib/auth-client"

import { isLocalBuild } from "@/lib/local-mode"

import { inputStore } from "@/lib/input-store"
import { chatDraftSourceStore } from "@/lib/chat-draft-source-store"

import { workspaceChatId } from "@/lib/chat/workspace-chat"

import { useTrafficLightsPresent } from "@/lib/use-traffic-lights"

import { withBasePath } from "@/lib/base-path"

import { SidebarSimpleIcon } from "@workspace/ui/components/icons"

import { Button } from "@workspace/ui/components/button"

import { IconButton } from "@workspace/ui/components/icon-button"

import { type EditableTextHandle } from "@workspace/ui/components/editable-text"

import { ShareRoomDialog } from "@/components/share-room-dialog"

import type { RepoConfig } from "@/lib/repo-configs.types"
import { switchOnWithEnv } from "@/lib/repository-library"
import { copyInCanvasRepoEnv, migrateCanvasEnv } from "@/lib/repo-env/actions"
import { canRevealEnv } from "@/lib/repo-env/names"
import { renameRoom } from "@/lib/rooms-actions"

import { SelectionOverlay } from "./selection-overlay"
import { LayerEdgesUnderlay } from "./layer-edges-underlay"
import { PixelGridOverlay } from "./pixel-grid-overlay"
import {
  MoveToPageContext,
  type MoveToPage,
  type MoveToPageTarget,
} from "./move-to-page"

import { Comments } from "./comments"

import { CommentsButton, CommentsPanel } from "./comments-panel"

import { useCommentThreads } from "./use-comment-threads"

import { useCommentPlacements } from "./use-comment-placements"

import type { ThreadWithComments } from "@/lib/comments"

import { Cursors } from "./cursors"

import { CursorChat } from "./cursor-chat"

import { FollowingToolbar } from "./following-toolbar"

import { useThumbnailHeartbeat } from "./use-thumbnail-heartbeat"

import { DirtyFrameTracker } from "@/lib/thumbnail/dirty-frames"

import {
  RoomSidebar,
  type SidebarFrame,
  type SidebarLayerGroup,
} from "@/components/panels/room-sidebar"
import { StableProps, useStableValue } from "@/lib/canvas/stable-props"

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
import { createMockupChatLink } from "@/lib/canvas/mockup-chat-link"
import { MockupChatLinkProvider } from "@/components/canvas/mockup-chat-link"

import { useDiffStats } from "@/hooks/use-diff-stats"

import { stopDevServers } from "@/lib/sandbox/lifecycle"

import { hideDoneWorkspaceFrames } from "@/lib/canvas/done-workspaces"
import { groupsOnPage, resolvePageId } from "@/lib/canvas/pages"
import { openPageId, pageViewport } from "@/lib/canvas/page-views"

import { useBranchActions } from "@/components/canvas/use-branch-actions"

import { useCommentRequests } from "@/components/canvas/use-comment-requests"

import { useBranchIntake } from "@/components/canvas/use-branch-intake"
import { useDrawAsk } from "@/components/canvas/use-draw-ask"

import { useChatTarget } from "@/components/canvas/use-chat-target"

import { useSandboxReconnect } from "@/components/canvas/use-sandbox-reconnect"

import {
  useElementReference,
  type ElementReferenceInputs,
} from "@/components/canvas/use-element-reference"

import { useTabPool } from "@/components/canvas/use-tab-pool"

import { useTerminalTabs } from "@/components/canvas/use-terminal-tabs"
import { serverTerminalTabStore } from "@/lib/terminal/server-tab-store"

import { useCanvasSelection } from "@/components/canvas/use-canvas-selection"
import { useCanvasView } from "@/components/canvas/use-canvas-view"

import { useCanvasInteraction } from "@/components/canvas/use-canvas-interaction"
import { useFrameControl } from "@/components/canvas/use-frame-control"
import {
  FrameDriveRelay,
  FrameDriveViewRelay,
} from "@/components/canvas/frame-drive-relay"
import { useSharedFrames } from "@/components/canvas/use-shared-frames"
import { frameDriverRingColor } from "@/components/canvas/frame-driver"
import { drivenByOther } from "@/lib/canvas/frame-control"

import { useCanvasKeyboard } from "@/components/canvas/use-canvas-keyboard"

import { useElementTargeting } from "@/components/canvas/use-element-targeting"
import type { TargetLayer } from "@/lib/canvas/element-targeting"

import { useLayerMutations } from "@/components/canvas/use-layer-mutations"

import { useGroupActions } from "@/components/canvas/use-group-actions"

import { useToolMode } from "@/components/canvas/use-tool-mode"

import { useCanvasCamera } from "@/components/canvas/use-canvas-camera"

import { useChatSessionWrites } from "@/components/canvas/use-chat-session-writes"

import { CANVAS_SIZE } from "@/lib/constants"

import {
  computeIframeLayerLayouts,
  deriveCanvasLayout,
  getGroupMembers,
  groupContentHeight,
  groupContentWidth,
  groupGap,
} from "@/lib/canvas/layout"
import { memberBox, sizedLayersOf } from "@/lib/canvas/sized-layers"

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
import {
  documentAskTarget,
  FrameAskCard,
  frameAskTarget,
} from "./frame-ask-card"
import { workspaceLabel } from "@/lib/workspace-label"
import { toast } from "sonner"

import { useGestureIntent } from "./use-gesture-intent"

import { useFrameActions } from "./use-frame-actions"

import { ResizeSnapLabel } from "./resize-snap-label"
import { ResizeSnapUnderlay } from "./resize-snap-underlay"

import { GroupMergeUnderlay } from "./group-merge-underlay"

import { PlaceholderRectsUnderlay } from "./placeholder-rects-underlay"

import { CanvasMemberLayer } from "./canvas-member-layer"

import { CanvasToolbar } from "./canvas-toolbar"

import { CanvasZoomMenu } from "./canvas-zoom-menu"

import { unionRect } from "@/lib/canvas/camera"
import { viewRequests } from "@/lib/canvas/view-requests"
import { roomChatId } from "@/lib/chat/room-chat"
import { isSketchChat, sketchChatSession } from "@/lib/chat/sketch-chat"

import { ShortcutSheet } from "./shortcut-sheet"

import { CanvasEmptyState } from "./canvas-empty-state"

import { GettingStartedChecklist } from "./getting-started-checklist"

import { isFreshWorkspace } from "@/lib/fresh-workspace"

import {
  AddRepositoryDialog,
  AddRepositoryFlowProvider,
  useAddRepositoryFlow,
} from "@/components/add-repository-dialog"

import {
  clearGettingStartedCanvas,
  gettingStartedProgress,
  isGettingStartedCanvas,
  isGettingStartedWorkspaceOpened,
  markGettingStartedWorkspaceOpened,
  subscribeGettingStarted,
} from "@/lib/getting-started"

import { CanvasTopBar } from "./canvas-top-bar"

import { CanvasSettingsDialog } from "./canvas-settings-dialog"

import { addMemory, editMemory, removeMemory } from "@/lib/memory/canvas"
import { LabelLayerContext } from "./label-layer"
import { LiveZoomContext } from "./live-zoom"

import { ChatPanelHost } from "./chat-panel-host"

import { ChatsMenuProvider } from "@/components/agent/chats-menu"

import {
  useHoveredWorkspaceId,
  workspaceHoverStore,
} from "@/lib/workspace-hover-store"

/** The request the empty Knobs popover starts in the chat composer. */
/** The comments panel's width plus its 8px margin and 8px of air. */
const COMMENTS_PANEL_INSET_PX = 320 + 8 + 8

const ASK_FOR_KNOB_PROMPT = "Add a knob to this prototype that controls "

/** How long a Coordinator view request waits for the doc to catch up. */
const VIEW_REQUEST_SETTLE_MS = 250
/** How long the agent's reveal waits for a frame it just opened to lay out. */
const REVEAL_LAYOUT_WAIT_MS = 3000

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

/**
 * The pan/zoom wrapper, kept out of the Canvas's renders. react-zoom-pan-pinch
 * re-reads the wrapper's and content's size (a forced layout) whenever
 * TransformWrapper renders with new props, and its children are new props, so
 * every Canvas render (a selection, each step of a drag) forced a layout. The
 * content comes in through context instead, and only the slot re-renders.
 */
const CanvasContentContext = createContext<ReactNode>(null)

function CanvasContentSlot() {
  return useContext(CanvasContentContext)
}

const TRANSFORM_WRAPPER_STYLE = { width: "100%", height: "100%" }
const TRANSFORM_CONTENT_STYLE = { width: CANVAS_SIZE, height: CANVAS_SIZE }

const CanvasTransform = memo(function CanvasTransform({
  transformRef,
  wrapperProps,
}: {
  transformRef: RefObject<ReactZoomPanPinchContentRef | null>
  wrapperProps: ComponentProps<typeof TransformWrapper>
}) {
  return (
    <TransformWrapper ref={transformRef} {...wrapperProps}>
      <TransformComponent
        wrapperStyle={TRANSFORM_WRAPPER_STYLE}
        contentStyle={TRANSFORM_CONTENT_STYLE}
      >
        <CanvasContentSlot />
      </TransformComponent>
    </TransformWrapper>
  )
})

/**
 * The chrome around the canvas, memoized: a drag, marquee or draw re-renders
 * the Canvas on every pointer move, and these take props kept stable by
 * `chromeStable`, so they skip those renders.
 */
const ChatPanelHostMemo = memo(ChatPanelHost)
const CanvasTopBarMemo = memo(CanvasTopBar)
const ShortcutSheetMemo = memo(ShortcutSheet)
const CanvasZoomMenuMemo = memo(CanvasZoomMenu)
const CanvasToolbarMemo = memo(CanvasToolbar)

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
  const [canvasSettingsOpen, setCanvasSettingsOpen] = useState(false)
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
  // Terminal Tabs are owned by `useTerminalTabs` (#1265), created once `agents`
  // is in scope below; the Tab Pool composes it.
  // Element Reference controller (PRD #570): how the Canvas points at an
  // element or a Document passage. It owns the comment-mode placement state
  // (`newCommentPos`, `activeThreadId`, `inspectHover`) and the two registries
  // the flow reads — the per-Iframe-Layer DOM accessors and the
  // per-Markdown-Layer TipTap editors — and exposes the placement verbs plus
  // `replyInChat` (#1243). Its live inputs arrive through a ref the component
  // repopulates every render (the effect below), breaking the ordering cycle:
  // the placement state is read by the keyboard handler defined just below,
  // while `replyInChat` needs the Chat-Target controller defined far down the
  // component.
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
  const self = useSelfIdentity()
  const others = useOtherPeers()
  const { data: session } = useAppSession()
  const userId = session?.user.id
  const history = useYjsHistory()
  const collections = useRoomCollections()
  // Canvas Operations seam (#157): the single transaction entry point + the
  // generic single-field `patch`. Trivial single-field writes below go through
  // `ops.patch`; the meaning-bearing verbs land in slices 3–5.
  // The canvas's Pages (#1835) and the one this person is looking at: client
  // state, falling back to the first page when theirs is gone. Only its
  // Groups render; new Layers land on it (the ops read it through the ref).
  const pages = usePages()
  // Each member's own view of each page (#1838): the canvas opens on the
  // page they were on last, settled once their id is known.
  const pageViews = usePageViews()
  const [opened, setOpened] = useState<{ userId: string; pageId: string }>()
  if (userId && opened?.userId !== userId)
    setOpened({ userId, pageId: openPageId(pageViews, pages, userId) })
  const [pickedPageId, setPickedPageId] = useState<string>()
  const currentPageId = resolvePageId(pages, pickedPageId ?? opened?.pageId)
  const currentPageIdRef = useRef(currentPageId)
  useLayoutEffect(() => {
    currentPageIdRef.current = currentPageId
  })
  const ops = useMemo(
    () =>
      createCanvasOps(collections, {
        currentPageId: () => currentPageIdRef.current,
      }),
    [collections]
  )

  // Chat Session Writes controller (PRD #588): the single small owner of the
  // thin add / update / remove Chat Session Canvas Operation wrappers (ADR
  // 0001), which used to be root-level pass-throughs. Tab Pool, Branch Intake,
  // Branch Actions, and the Chat Sync owner all read these verbs from here
  // rather than from a facade the root redefines.
  const { addChatSession, updateChatSession, removeChatSession } =
    useChatSessionWrites(ops)

  // Synced canvas collections — read by the controllers below (selection needs
  // the live Groups; the camera reads the saved viewport).
  const agents = useBranches()
  // A Done Workspace's frames leave the Canvas (#976): everything below lays
  // out and renders this view, while their records stay in the Room doc.
  const allIframeLayers = useIframeLayers()
  const allIframeLayerGroups = useIframeLayerGroups()
  // Layers on other Pages (#1835) leave it too: only the current page's
  // Groups lay out and render, so their frames unmount (chats and previews
  // keep running).
  const { iframeLayers, groups: iframeLayerGroups } = useMemo(() => {
    const view = hideDoneWorkspaceFrames({
      groups: allIframeLayerGroups,
      iframeLayers: allIframeLayers,
      branches: agents,
    })
    return {
      iframeLayers: view.iframeLayers,
      groups: groupsOnPage(view.groups, pages, currentPageId),
    }
  }, [allIframeLayerGroups, allIframeLayers, agents, pages, currentPageId])
  const markdownLayers = useMarkdownLayers()
  const mockupLayers = useMockupLayers()
  // Every non-frame layer, as the one list the layout helpers size.
  const sizedLayers = useMemo(
    () => [...markdownLayers, ...mockupLayers],
    [markdownLayers, mockupLayers]
  )
  const savedViewport = useSavedViewport()
  const iframeLayerLayouts = useMemo(
    () =>
      computeIframeLayerLayouts(iframeLayerGroups, iframeLayers, sizedLayers),
    [iframeLayerGroups, iframeLayers, sizedLayers]
  )
  // Where the camera opens: this person's view of their page, else (the
  // first page of a canvas from before pages) the old shared one, else the
  // page fitted.
  const openView = useMemo(
    () =>
      opened
        ? {
            viewport: pageViewport(
              pageViews,
              pages,
              userId,
              currentPageId,
              savedViewport
            ),
            rect: unionRect(iframeLayerLayouts.values()),
          }
        : null,
    [
      opened,
      pageViews,
      pages,
      userId,
      currentPageId,
      savedViewport,
      iframeLayerLayouts,
    ]
  )

  // Canvas Operation wrappers the controllers apply removals / persistence
  // through (ADR 0001: mutations go through `ops`, never the Y.Doc directly).
  const removeIframeLayers = useCallback(
    (ids: string[]) => {
      ops.removeLayers(ids)
    },
    [ops]
  )
  // Documents and Mockups share one selection Set, so this removes both,
  // routing each id to its kind's verb.
  const removeDocumentLayers = useCallback(
    (ids: string[]) => {
      const mockupIds = ids.filter((id) => collections.mockupLayers.has(id))
      const docIds = ids.filter((id) => !collections.mockupLayers.has(id))
      ops.batch(() => {
        if (mockupIds.length > 0) ops.removeMockups(mockupIds)
        if (docIds.length > 0) {
          const { removedChatIds } = ops.removeDocuments(docIds)
          for (const chatId of removedChatIds) chatStore.cleanup(chatId)
        }
      })
    },
    [ops, collections]
  )
  const removeDocument = useCallback(
    (id: string) => removeDocumentLayers([id]),
    [removeDocumentLayers]
  )
  // The camera saves this person's view of the page they're on (#1838).
  const saveViewport = useCallback(
    (vp: ViewportData) => {
      if (userId) ops.savePageView(userId, currentPageIdRef.current, vp)
    },
    [ops, userId]
  )

  // Tool Mode controller (PRD #567): the four draw tools (Select / Frame /
  // Document / Comment) as one discriminated value, so "exactly one tool active"
  // holds by construction. The booleans below are read-aliases for the existing
  // call sites; mode changes dispatch `toolMode.set` / `toolMode.toggle`.
  // A frame shows a Workspace, which needs a repository: with none, the Frame
  // tool stays off and its button says why.
  const repos = useRepos()
  // A canvas from before #1416 still holds plain-text env var values in its
  // room doc: whoever opens it first moves them to the encrypted store.
  const hasLegacyEnv = repos.some((r) => r.envVars !== undefined)
  useEffect(() => {
    if (!hasLegacyEnv) return
    migrateCanvasEnv(roomId).catch((err) =>
      console.error("Couldn’t move this canvas’s env vars", err)
    )
  }, [hasLegacyEnv, roomId])
  const toolMode = useToolMode({ frameAvailable: repos.length > 0 })
  const commentMode = toolMode.commentMode
  const documentMode = toolMode.documentMode
  const frameMode = toolMode.frameMode
  const mockupMode = toolMode.mockupMode

  // Canvas Selection controller (PRD #567): owns the three selection Sets, the
  // mirror refs the keydown handler reads via `current()`, the delete decision
  // (applied through `ops`), and the overlay / group projections. The locals
  // below alias its state + setters so the existing call sites are unchanged.
  const selection = useCanvasSelection({
    groups: iframeLayerGroups,
    removeIframeLayers,
    removeDocumentLayers,
    batch: ops.batch,
    duplicateIframeLayer: ops.duplicateIframeLayer,
    duplicateMockup: ops.duplicateMockup,
  })
  const selectedIframeLayerIds = selection.iframeLayerIds
  const selectedGroupIds = selection.groupIds
  const selectedDocumentLayerIds = selection.documentLayerIds
  const setSelectedIframeLayerIds = selection.setIframeLayerIds
  const setSelectedGroupIds = selection.setGroupIds
  const setSelectedDocumentLayerIds = selection.setDocumentLayerIds
  const overlaySelectedIds = selection.overlaySelectedIds
  const groupSelectedIframeLayerIds = selection.groupSelectedIframeLayerIds

  // Canvas View: a chat message carries this member's selection and the layers
  // on their screen, so the model can tell what "this" means.
  const workspaceTitles = useMemo(
    () => new Map(agents.map((a) => [a.id, workspaceLabel(a)])),
    [agents]
  )
  useCanvasView({
    canvasWrapperRef,
    currentSelection: selection.current,
    records: {
      frames: iframeLayers,
      documents: markdownLayers,
      mockups: mockupLayers,
      groups: iframeLayerGroups,
      workspaceTitles,
    },
    sender: session?.user.name,
    // Named only once there's a choice of page: a one-page canvas's chats
    // read as before.
    page:
      pages.length > 1 ? pages.find((p) => p.id === currentPageId) : undefined,
  })

  // Awareness mirrors the Interaction controller's cursor-chat verbs read: the
  // latest self pointer (where '/' anchors the bubble) and message (null =
  // closed). The pointer is written by the pointer handlers below and the
  // message mirrored from `self` after commit, so the verbs and the Escape
  // resolver read them without re-binding (and the Canvas doesn't re-render on
  // our own cursor moves). Declared here, ahead
  // of the controller that consumes them, so no ordering cycle is introduced.
  const selfPointerRef = useRef<{ x: number; y: number } | null>(null)
  const selfMessageRef = useRef<string | null>(null)
  useEffect(() => {
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
  // Mockups take Interact too (their pages run their own scripts), and share
  // the Document selection Set.
  const interactiveLayers = useMemo(
    () => [...iframeLayers, ...mockupLayers],
    [iframeLayers, mockupLayers]
  )
  const selectedInteractiveIds = useMemo(
    () => new Set([...selectedIframeLayerIds, ...selectedDocumentLayerIds]),
    [selectedIframeLayerIds, selectedDocumentLayerIds]
  )
  const interaction = useCanvasInteraction({
    interactiveLayers,
    selectedInteractiveIds,
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

  // Frame Control (#1387): who drives each frame and mockup (#1391).
  // Interact is the driver's seat; the agent always yields it.
  const frameIds = useMemo(
    () => interactiveLayers.map((layer) => layer.id),
    [interactiveLayers]
  )
  const mockupIds = useMemo(
    () => new Set(mockupLayers.map((layer) => layer.id)),
    [mockupLayers]
  )
  const chatSessions = useChatSessions()
  // The Workspace of the chat that last changed each Document and Mockup
  // (#1724), for the Group's label and where a Mockup goes live (#1523).
  const documentWorkspaces = useMemo(
    () => layerWorkspaceIds(sizedLayers, chatSessions),
    [sizedLayers, chatSessions]
  )
  // The chat working on each Document and Mockup right now (#1726), for its
  // label.
  const workingChats = useMemo(
    () => workingChatsOf(layerHolders(chatSessions), agents),
    [chatSessions, agents]
  )
  // Live frames (#1516): on hosted, a frame someone turns live is one browser
  // in its Workspace's Sandbox, streamed to everyone on the canvas; every
  // other frame is each viewer's own iframe, as on the desktop app.
  const sharedFrames = useSharedFrames({
    roomId,
    enabled: !isLocalBuild,
    agents,
    iframeLayers,
    mockupLayers,
    mockupOwners: documentWorkspaces,
    viewerId: userId ?? null,
    others,
    frameControl: collections.frameControl,
  })
  // Handed a frame (Let drive, a reload): Interact needs it selected.
  const selectIframeLayer = selection.selectIframeLayer
  const selectDocumentLayer = selection.selectDocumentLayer
  const takeFrameSeat = useCallback(
    (id: string) => {
      // Mockups share the Document selection Set.
      if (mockupIds.has(id)) selectDocumentLayer(id, false)
      else selectIframeLayer(id, false)
      setFocusedIframeLayerId(id)
    },
    [mockupIds, selectDocumentLayer, selectIframeLayer, setFocusedIframeLayerId]
  )
  const frameControl = useFrameControl({
    collection: collections.frameControl,
    viewerId: userId ?? null,
    others,
    frameIds,
    sharedIds: sharedFrames.sharedIds,
    focusedId: focusedIframeLayerId,
    setFocusedId: setFocusedIframeLayerId,
    takeSeat: takeFrameSeat,
  })
  // A frame going live or ending live (someone else's toggle) swaps which
  // browser this viewer sees: leave Interact rather than keep a seat on the
  // view that went away.
  const focusedShared =
    focusedIframeLayerId !== null &&
    sharedFrames.sharedIds.has(focusedIframeLayerId)
  const prevFocusedSharedRef = useRef(focusedShared)
  const prevFocusedIdRef = useRef(focusedIframeLayerId)
  useEffect(() => {
    const sameFrame = prevFocusedIdRef.current === focusedIframeLayerId
    const switched = sameFrame && prevFocusedSharedRef.current !== focusedShared
    prevFocusedIdRef.current = focusedIframeLayerId
    prevFocusedSharedRef.current = focusedShared
    if (switched) setFocusedIframeLayerId(null)
  }, [focusedIframeLayerId, focusedShared, setFocusedIframeLayerId])
  const drivenFrames = useMemo(
    () =>
      frameIds.flatMap((id) => {
        const color = frameDriverRingColor(frameControl.driverOf(id))
        return color ? [{ id, color }] : []
      }),
    [frameIds, frameControl]
  )
  const closeCursorChat = interaction.closeCursorChat

  // Switching pages (#1835). Each page keeps the view this person left it at
  // (#1838, saved with the canvas); a page they haven't been on yet opens
  // fitted to its content, and an empty one at 100%. Selection doesn't carry
  // across.
  const { clear: clearSelection } = selection
  const showPage = useCallback(
    (pageId: string) => {
      const from = currentPageIdRef.current
      if (pageId === from) return
      const state = transformRef.current?.state
      if (state && userId)
        ops.savePageView(userId, from, {
          x: state.positionX,
          y: state.positionY,
          zoom: state.scale,
        })
      clearSelection()
      setPickedPageId(pageId)
    },
    [clearSelection, ops, userId]
  )
  // Following someone (#1840) takes you to their page, and along as they
  // change pages; a page that's gone reads as the first, as it does for them.
  const followPage = useCallback(
    (pageId: string | undefined) => {
      const target = resolvePageId(pages, pageId)
      if (target === currentPageIdRef.current) return false
      showPage(target)
      return true
    },
    [pages, showPage]
  )
  // Presence carries the page on screen, for page-row avatars, cursors and
  // Follow on everyone else's screen.
  useEffect(() => {
    setPresence({ pageId: currentPageId })
  }, [setPresence, currentPageId])

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
    openView,
    overlaySelectedIds,
    groupSelectedIframeLayerIds,
    focusedIframeLayerId,
    createFlowIframeLayerId,
    editingDocumentLayerId,
    spaceHeld,
    pageId: currentPageId,
    followPage,
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
  const followingConnectionId = camera.followingConnectionId

  // The screen-space layer Layer labels draw in (see `label-layer.ts`): a
  // sibling of the zoomed content inside rzpp's wrapper, so wheels, pans and
  // canvas pointer routing that start on a label behave as on the canvas.
  // rzpp attaches its wrapper in its own effect, which runs before this one.
  const [labelLayerElement, setLabelLayerElement] =
    useState<HTMLElement | null>(null)
  useEffect(() => {
    const wrapper = transformRef.current?.instance.wrapperComponent
    if (!wrapper) return
    const element = document.createElement("div")
    element.className = "canvas-label-layer"
    wrapper.appendChild(element)
    setLabelLayerElement(element)
    return () => {
      element.remove()
      setLabelLayerElement(null)
    }
  }, [])
  const labelLayer = useMemo(
    () =>
      labelLayerElement
        ? { element: labelLayerElement, camera: camera.liveCamera }
        : null,
    [labelLayerElement, camera.liveCamera]
  )

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

  // Prune capture bookkeeping for frames and Mockups removed from the canvas
  // so a deleted one's stale dirty flag never lands in a POSTed subset (#474).
  useEffect(() => {
    captureTracker.retain(
      new Set([...allIframeLayers, ...mockupLayers].map((layer) => layer.id))
    )
  }, [captureTracker, allIframeLayers, mockupLayers])
  // Workspace ↔ frame hover cross-highlighting (#793): a frame hovered on the
  // Canvas lights up its Workspace in the sidebar, and a Workspace hovered in
  // the sidebar outlines its frames here.
  const hoveredFrameBranchId = hoveredIframeLayerId
    ? iframeLayers.find((layer) => layer.id === hoveredIframeLayerId)?.branchId
    : undefined
  useEffect(() => {
    if (!hoveredFrameBranchId) return
    const hover = { branchId: hoveredFrameBranchId, source: "frame" } as const
    workspaceHoverStore.set(hover)
    return () => workspaceHoverStore.clear(hover)
  }, [hoveredFrameBranchId])
  const hoveredWorkspaceId = useHoveredWorkspaceId()
  const workspaceHighlightIds = useMemo(
    () =>
      hoveredWorkspaceId
        ? iframeLayers
            .filter((layer) => layer.branchId === hoveredWorkspaceId)
            .map((layer) => layer.id)
        : undefined,
    [hoveredWorkspaceId, iframeLayers]
  )

  // Ref mirror so callbacks that only need the current snapshot (e.g.
  // `requestReorderDrag` computing the cursor's grab offset) can read it
  // without re-binding on every layout change.
  // A page the person picks themselves is their own move: it stops
  // following, like a pan.
  const { breakFollow } = camera
  const switchPage = useCallback(
    (pageId: string) => {
      breakFollow()
      showPage(pageId)
    },
    [breakFollow, showPage]
  )
  // Move to page ▸ and a sidebar drop on a page row (#1837): what moves
  // leaves this page, so it leaves the selection too.
  const moveToPageTarget = useCallback(
    (target: MoveToPageTarget, pageId: string) => {
      if (target.kind === "group") ops.moveGroupToPage(target.id, pageId)
      else ops.moveLayersToPage([target.id], pageId)
      clearSelection()
    },
    [ops, clearSelection]
  )
  const moveToPage = useMemo<MoveToPage>(
    () => ({ pages, currentPageId, move: moveToPageTarget }),
    [pages, currentPageId, moveToPageTarget]
  )
  const addPage = useCallback(() => {
    const pageId = ops.createPage()
    switchPage(pageId)
    return pageId
  }, [ops, switchPage])
  const { jumpTo: cameraJumpTo } = camera
  const shownPageIdRef = useRef(currentPageId)
  useLayoutEffect(() => {
    if (shownPageIdRef.current === currentPageId) return
    shownPageIdRef.current = currentPageId
    const vp = cameraJumpTo(
      pageViewport(pageViews, pages, userId, currentPageId, savedViewport),
      unionRect(iframeLayerLayouts.values())
    )
    // Recorded at once, so it's the page the canvas opens on next time.
    if (vp && userId) ops.savePageView(userId, currentPageId, vp)
  }, [
    currentPageId,
    iframeLayerLayouts,
    cameraJumpTo,
    pageViews,
    pages,
    userId,
    savedViewport,
    ops,
  ])

  const iframeLayerLayoutsRef = useRef(iframeLayerLayouts)
  useEffect(() => {
    iframeLayerLayoutsRef.current = iframeLayerLayouts
  })

  // Element Targeting controller (PRD #616, #705): the Canvas fulfils a
  // Composer's one-shot crosshair pick and draws the hovered-token highlight.
  // The pick state machine, the one eligibility rule (pickable Branches and
  // dimmed frames), the hit-test and the highlight sequencing live in the
  // React-free core it wraps; Escape during a pick goes through the shared
  // precedence the keyboard controller applies.
  // What a pick can hit: frames, and Mockups as the Workspace's of the chat
  // that last changed them (#1309, #1724), so a chat can target an element in
  // a Mockup it made.
  const targetLayers = useMemo<TargetLayer[]>(
    () => [
      ...iframeLayers,
      ...mockupLayers.map((m) => ({
        id: m.id,
        branchId: documentWorkspaces.get(m.id),
        label: m.title || "Untitled",
        kind: "mockup" as const,
      })),
    ],
    [iframeLayers, mockupLayers, documentWorkspaces]
  )
  const targeting = useElementTargeting({
    targetLayers,
    iframeLayerLayouts,
    getIframeLayerDom: reference.getIframeLayerDom,
    transformRef,
  })

  // Canvas Keyboard controller (PRD #579, cut 4/4): owns the global
  // keydown/keyup listeners and the whole shortcut map, dispatching into the
  // bundled controllers (Tool Mode, Selection, Element Reference, Element
  // Targeting, Yjs history, Interaction), the panel refs, and the cursor-chat
  // verbs. Which key means what is the table in `lib/canvas/shortcuts`; the
  // Escape precedence stays in the pure `resolveEscapeAction`, and the
  // keyboard only applies the chosen exit.
  // Zoom controls + shortcut sheet (#734): the zoom pill and the ⌘= / ⌘- /
  // ⌘0 / ⇧1 keys share these verbs; fit frames every Layer on the canvas.
  const [shortcutSheetOpen, setShortcutSheetOpen] = useState(false)
  const openShortcutSheet = useCallback(() => setShortcutSheetOpen(true), [])
  const {
    zoomIn: cameraZoomIn,
    zoomOut: cameraZoomOut,
    zoomTo: cameraZoomTo,
    zoomToFit: cameraZoomToFit,
  } = camera
  const zoomControls = useMemo(
    () => ({
      zoomIn: cameraZoomIn,
      zoomOut: cameraZoomOut,
      zoomTo100: () => cameraZoomTo(1),
      zoomToFit: () =>
        cameraZoomToFit(unionRect(iframeLayerLayoutsRef.current.values())),
    }),
    [cameraZoomIn, cameraZoomOut, cameraZoomTo, cameraZoomToFit]
  )

  // The Coordinator's `show_on_canvas`, in a turn this member asked for: fit
  // the frames, documents and Groups it names, or the whole canvas. A layer
  // named in this member's own sent message is selected instead, and comes
  // into view only if it's off screen.
  const { zoomToRect: cameraZoomToRect, revealRect: cameraRevealRect } = camera
  const iframeLayerGroupsRef = useRef(iframeLayerGroups)
  const selectNamedLayerRef = useRef((_id: string) => {})
  useEffect(() => {
    iframeLayerGroupsRef.current = iframeLayerGroups
    selectNamedLayerRef.current = (id) => {
      if (iframeLayers.some((l) => l.id === id)) {
        selection.selectIframeLayer(id, false)
      } else if (
        markdownLayers.some((l) => l.id === id) ||
        mockupLayers.some((l) => l.id === id)
      ) {
        selection.selectDocumentLayer(id, false)
      }
    }
  })
  useEffect(() => {
    let timer: number | undefined
    const unsubscribe = viewRequests.subscribe(({ chatId, ids, select }) => {
      if (chatId !== undefined && chatId !== roomChatId(roomId)) return
      if (select) {
        // The member's own click: no wait for the doc, which hasn't moved.
        for (const id of ids) selectNamedLayerRef.current(id)
        const layout = iframeLayerLayoutsRef.current.get(ids[0] ?? "")
        if (layout) cameraRevealRect(layout)
        return
      }
      // The call's broadcast can land before the doc update that moved what
      // it names, so let the layout catch up first.
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (ids.length === 0) return zoomControls.zoomToFit()
        const memberIds = ids.flatMap((id) => {
          const group = iframeLayerGroupsRef.current.find((g) => g.id === id)
          return group ? getGroupMembers(group).map((m) => m.id) : [id]
        })
        const layouts = iframeLayerLayoutsRef.current
        const rect = unionRect(
          memberIds.flatMap((id) => {
            const layout = layouts.get(id)
            return layout ? [layout] : []
          })
        )
        if (rect) cameraZoomToRect(rect)
      }, VIEW_REQUEST_SETTLE_MS)
    })
    return () => {
      unsubscribe()
      window.clearTimeout(timer)
    }
  }, [roomId, zoomControls, cameraZoomToRect, cameraRevealRect])

  // The agent showing this member a frame (#1390): fit it in their view,
  // waiting briefly for a frame it just opened to be laid out.
  const revealFrame = useCallback(
    async (frameId: string) => {
      const deadline = performance.now() + REVEAL_LAYOUT_WAIT_MS
      for (;;) {
        const layout = iframeLayerLayoutsRef.current.get(frameId)
        if (layout) {
          cameraZoomToRect(layout)
          return true
        }
        if (performance.now() >= deadline) return false
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    },
    [cameraZoomToRect]
  )

  // The comments panel (#787); Escape closes it from anywhere on the canvas.
  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false)
  const commentsPanelOpenRef = useRef(commentsPanelOpen)
  useEffect(() => {
    commentsPanelOpenRef.current = commentsPanelOpen
  }, [commentsPanelOpen])
  const commentsPanelKeys = useMemo(
    () => ({
      isOpen: () => commentsPanelOpenRef.current,
      close: () => setCommentsPanelOpen(false),
    }),
    []
  )

  useCanvasKeyboard({
    toolMode,
    selection,
    reference,
    targeting,
    history,
    interaction,
    sidebarPanelRef,
    chatPanelRef,
    zoom: zoomControls,
    openShortcutSheet,
    commentsPanel: commentsPanelKeys,
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
    layerGestureActive,
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
        sizedLayers,
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
      sizedLayers,
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
  // The device-snap ghosts (beneath the frames) and the snapped device's label
  // (above them) both read the resizing frame's rect, its anchor corner and
  // the candidate sizes.
  const resizeSnap = gesturePreview.resizeSnap
  const resizeSnapLayout = resizeSnap
    ? effectiveIframeLayerLayouts.get(resizeSnap.iframeLayerId)
    : undefined
  const resizeSnapProps = {
    zoom,
    viewportPos,
    iframeLayerRect: resizeSnapLayout
      ? {
          x: resizeSnapLayout.x,
          y: resizeSnapLayout.y,
          width: resizeSnapLayout.width,
          height: resizeSnapLayout.height,
        }
      : null,
    anchor: resizeSnap?.anchor ?? "tl",
    candidates: resizeSnap?.candidates ?? [],
    snappedPresetId: resizeSnap?.snappedPresetId ?? null,
  }
  // While popped, `effectiveIframeLayerLayouts` already places the dragged
  // frame at `cursor - grab`, so no extra shift is needed for the selection
  // overlay or the edge underlay (which read from that same map). Only the
  // in-flow reorder case needs a translation delta layered on top of the raw
  // flex slot.
  const reorderDragShift = useMemo(() => {
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
  }, [gesturePreview.reorder, iframeLayerLayouts])
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
  // Canvas memory (#902), oldest first, edited in Canvas settings › Memory.
  const memoryEntries = useMemories()
  // Canvas Skills (#1555), listed in Canvas settings › Skills (#1557).
  const canvasSkills = useCanvasSkills()
  const memories = useMemo(
    () => [...memoryEntries].sort((a, b) => a.createdAt - b.createdAt),
    [memoryEntries]
  )
  // Canvas Files (#1517), browsed in Canvas settings › Files.
  const canvasFiles = useCanvasFiles()

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

  // Terminal Tabs (#1265): the one owner of this client's Terminal Tab list —
  // open, close, rename, restore and prune, with the rows and sessions behind
  // the server-action store. The Tab Pool composes it for the apply-side; the
  // Chat-Target controller reads `tabs` to resolve a selected tab's target.
  const terminalTabs = useTerminalTabs({
    roomId,
    agents,
    initialTerminalTabs,
    store: serverTerminalTabStore,
  })

  const diffStats = useDiffStats(agents, repos)
  const { branchPrs, setBranchPr } = useBranchPrs(agents, repos)

  // Where Quote in chat and Send to agent on a Document go: the Sketch Chat
  // that last changed it, or that chat's Workspace's chat (#1724).
  const documentChats = useMemo(
    () => layerChats(markdownLayers, chatSessions),
    [markdownLayers, chatSessions]
  )
  const documentChat = useCallback(
    (documentId: string) => documentChats.get(documentId) ?? null,
    [documentChats]
  )
  // Every chat with no repository, newest first.
  const sketchChats = useMemo(
    () =>
      chatSessions
        .filter(isSketchChat)
        .sort((a, b) => b.createdAt - a.createdAt),
    [chatSessions]
  )

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

  const commentThreads = useCommentThreads(roomId, initialThreads)
  // Where each comment shows for this viewer (#785): pinned on its route,
  // hidden while its frame is on another route, or detached.
  const commentPlacements = useCommentPlacements({
    threads: commentThreads.threads,
    iframeLayers,
    layouts: iframeLayerLayouts,
    zoom,
    getIframeLayerDom: reference.getIframeLayerDom,
    getDocumentEditor: reference.getDocumentEditor,
    documentEditorsVersion: reference.documentEditorsVersion,
    activeThreadId: reference.activeThreadId,
  })
  const commentFrameInfo = useMemo(
    () =>
      new Map(
        iframeLayers.map((l) => [
          l.id,
          { branchId: l.branchId, route: l.route },
        ])
      ),
    [iframeLayers]
  )
  // The thread card's chip names the frame's route or the document's title.
  const describeCommentLayer = useCallback(
    (id: string) => {
      const frame = iframeLayers.find((l) => l.id === id)
      if (frame) return { title: frame.label, route: frame.route }
      const doc = markdownLayers.find((l) => l.id === id)
      return doc ? { title: doc.title } : undefined
    },
    [iframeLayers, markdownLayers]
  )

  // Chat-Target selection controller (PRD #569): owns which Chat Target the
  // panel shows — the selected agent/chat, the per-target memory, and the
  // pending-agent readiness — and resolves the `ChatPanelTarget`. The symmetric
  // sibling of the Tab Pool controller (which owns the tabs *within* a target);
  // both `useTabPool` and `useBranchIntake` compose with it for selection.
  const chatTarget = useChatTarget({
    agents,
    chatSessions,
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
        const size = memberBox(collections, m)
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

  // Non-frame layer ids (documents and mockups, which share a selection Set),
  // so the marquee hit-test can classify a covered layer (it lives in the
  // shared layout map alongside frames).
  const markdownLayerIdSet = useMemo(
    () => new Set(sizedLayers.map((d) => d.id)),
    [sizedLayers]
  )

  // Project the live collections into the plain snapshots the Layer-initiated
  // group-move assembly (`assembleMoveStart`, called inside the gesture
  // controller) reads: each group's anchor, gap, members, content-bbox size, and
  // member sizes, plus every layer's world rect. Built lazily at drag start (not
  // per render) so the per-group content/member sizes are computed once per drag,
  // matching the cost profile of the old inline `handleLayerGroupDragStart`.
  const buildMoveAssembly = useCallback(() => {
    // Only this page's Groups: one on another page is never a merge target.
    const allGroups = ops.groupsOnPage()
    const abArr = collections.iframeLayers.toArray()
    const docArr = sizedLayersOf(collections)
    const groups: MoveAssemblyGroup[] = allGroups.map((g) => {
      const members = getGroupMembers(g)
      const memberSizes: Array<{ width: number; height: number }> = []
      for (const m of members) {
        const size = memberBox(collections, m)
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
  }, [collections, ops])

  // `removeIframeLayers` / `removeDocumentLayers` are defined up top (the Canvas
  // Operation wrappers the controllers apply removals through). The single
  // sidebar "remove frame" path — remove + keep selection on the neighbor —
  // lives on the Canvas Selection controller as `removeIframeLayerAndReselect`.
  const removeIframeLayer = selection.removeIframeLayerAndReselect
  // A single Mockup (the mockup bar's ⋯ or its sidebar row), dropped from the
  // selection with it.
  const { setDocumentLayerIds } = selection
  const removeMockup = useCallback(
    (id: string) => {
      removeDocumentLayers([id])
      setDocumentLayerIds((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    },
    [removeDocumentLayers, setDocumentLayerIds]
  )

  // The route handler reads the latest Create Flow selection through the
  // Interaction controller's mirror ref, so it stays a stable callback across
  // toggles without every consumer re-binding.
  const createFlowIframeLayerIdRef = interaction.createFlowIframeLayerIdRef

  // Layer Mutation controller (PRD #579, cut 1/4): the thin per-Layer Canvas
  // Operation wrappers — Iframe Layer field writers (rename / assignAgent /
  // updateState / updateScroll / updateKnobs / updateKnobValues /
  // updateSharedState / updateRoute / setFrameSize) and Markdown Layer writers
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

  // The top bar's thread list: open the thread and bring its pin to the
  // middle of the viewport, at the current zoom. A thread on another route
  // navigates its frame there first; its pin is centred once it shows.
  const pendingCenterThreadRef = useRef<string | null>(null)
  // The comments panel (#787) floats over the canvas's right edge, so a pin
  // it brings into view centres in the space beside it.
  const [commentPinsHidden, setCommentPinsHidden] = useState(false)
  const centerOnCommentPin = useCallback(
    (pin: HTMLElement) =>
      camera.centerOnElement(pin, {
        right: commentsPanelOpen ? COMMENTS_PANEL_INSET_PX : 0,
      }),
    [camera, commentsPanelOpen]
  )
  const selectCommentThread = useCallback(
    (threadId: string) => {
      reference.setActiveThread(threadId)
      commentThreads.markRead(threadId)
      const placement = commentPlacements.placements.get(threadId)
      if (placement?.kind === "offRoute") {
        pendingCenterThreadRef.current = threadId
        layerMutations.updateRoute(placement.frameId, placement.route)
        return
      }
      const pin = document.querySelector<HTMLElement>(
        `[data-comment-thread-id="${CSS.escape(threadId)}"]`
      )
      if (pin) centerOnCommentPin(pin)
      // A resolved thread is only placed once it's active: centre its pin
      // when it shows.
      else pendingCenterThreadRef.current = threadId
    },
    [
      reference,
      commentThreads,
      commentPlacements,
      layerMutations,
      centerOnCommentPin,
    ]
  )
  useEffect(() => {
    const threadId = pendingCenterThreadRef.current
    if (!threadId) return
    if (commentPlacements.placements.get(threadId)?.kind !== "pinned") return
    pendingCenterThreadRef.current = null
    // The pin mounts in this commit; find it on the next frame.
    const raf = requestAnimationFrame(() => {
      const pin = document.querySelector<HTMLElement>(
        `[data-comment-thread-id="${CSS.escape(threadId)}"]`
      )
      if (pin) centerOnCommentPin(pin)
    })
    return () => cancelAnimationFrame(raf)
  }, [commentPlacements, centerOnCommentPin])

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
  const handleZoomToMockup = frameActions.zoomToMockup
  const handleZoomToGroup = frameActions.zoomToGroup
  const handleShowRoutesForAgent = frameActions.showRoutesForAgent
  const handlePlayAgent = frameActions.playAgent
  const handlePlayIframeLayer = frameActions.playIframeLayer

  // The empty Knobs popover's "Ask the agent to add a knob": open the frame's
  // Workspace chat (its one chat, #1315, or a fresh one when it has none) and
  // start the request in its composer for the user to finish. Nothing is sent.
  const openWorkspaceChat = useCallback(
    (branchId: string): string => {
      let chatId = workspaceChatId(chatSessions, branchId)
      if (!chatId) {
        chatId = nanoid()
        addChatSession(chatId, {
          id: chatId,
          branchId,
          label: "Untitled",
          createdAt: Date.now(),
        })
      }
      chatTarget.selectAgentChat(branchId, chatId, {
        expandPanel: true,
        remember: true,
      })
      return chatId
    },
    [chatSessions, chatTarget, addChatSession]
  )
  const handleAskForKnob = useCallback(
    (branchId: string) =>
      inputStore.prefill(openWorkspaceChat(branchId), ASK_FOR_KNOB_PROMPT),
    [openWorkspaceChat]
  )

  // Each Mockup's link to its chat (#1662): the Knobs Ask, a page's draft,
  // question and answer. The panel's verbs are read at call time, so the link
  // changes only with the Mockups and chats.
  const mockupPanelRef = useRef({
    chatTarget,
    openWorkspaceChat,
    addChatSession,
  })
  useEffect(() => {
    mockupPanelRef.current = { chatTarget, openWorkspaceChat, addChatSession }
  })
  const answeredFromPages = useRef(new Set<string>())
  // Only what the link reads of each Mockup, so a Mockup resizing, scrolling
  // or turning a knob doesn't rebuild the link and re-render every Mockup.
  const mockupLinkMockups = useStableValue(
    mockupLayers.map(({ id, title, lastChangedByChatId, ownerChatId }) => ({
      id,
      title,
      lastChangedByChatId,
      ownerChatId,
    }))
  )
  const mockupChatLink = useMemo(
    () =>
      createMockupChatLink({
        mockups: mockupLinkMockups,
        chats: chatSessions,
        transcripts: {
          messages: (chatId) => chatStore.getSnapshot(chatId).messages,
          subscribe: (chatId, cb) => chatStore.subscribe(chatId, cb),
        },
        panel: {
          shown: () => {
            const shown = mockupPanelRef.current.chatTarget.target
            if (shown?.kind === "agent") {
              return { kind: "agent", branchId: shown.agent.id }
            }
            if (shown?.kind === "sketch") {
              return { kind: "sketch", chatId: shown.chat.id }
            }
            return shown
          },
          showSketchChat: (chatId) =>
            mockupPanelRef.current.chatTarget.selectSketchChat(chatId),
          showWorkspaceChat: (branchId, chatId) =>
            mockupPanelRef.current.chatTarget.selectAgentChat(
              branchId,
              chatId,
              { expandPanel: true, remember: true }
            ),
          showRoomChat: () => mockupPanelRef.current.chatTarget.showRoomChat(),
          openWorkspaceChat: (branchId) =>
            mockupPanelRef.current.openWorkspaceChat(branchId),
          newSketchChat: () => {
            const { chatTarget, addChatSession } = mockupPanelRef.current
            const chatId = nanoid()
            addChatSession(chatId, sketchChatSession(chatId, Date.now()))
            chatTarget.selectSketchChat(chatId)
            return chatId
          },
        },
        input: inputStore,
        draftSource: chatDraftSourceStore,
        answered: answeredFromPages.current,
      }),
    [mockupLinkMockups, chatSessions]
  )

  // Deleting a chat with no repository: the panel goes home if it showed it,
  // and what it made stays on the canvas, owned by no one.
  const deleteSketchChat = useCallback(
    (chatId: string) => {
      if (chatTarget.selectedChatId === chatId) chatTarget.showRoomChat()
      removeChatSession(chatId)
      chatStore.cleanup(chatId)
    },
    [chatTarget, removeChatSession]
  )

  // Repopulate the Element Reference controller's live inputs every render so
  // its placement verbs and `replyInChat` read the current layouts and the
  // Chat-Target controller — without re-binding the controller on each change
  // (mirrors `iframeLayerLayoutsRef` / `gestureInputsRef`).
  useEffect(() => {
    referenceInputsRef.current = {
      iframeLayerLayouts,
      chatTarget,
      documentChat,
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
    chatSessions,
    terminalTabs,
    chatTarget,
  })

  // Branch Intake controller (PRD #562): the Repo -> Branch -> Sandbox
  // create/teardown orchestration and the seed-tab / seed-frame
  // handoff, lifted into `useBranchIntake`. The component calls the verbs; the
  // controller owns the ordering invariants and the Sandbox Provider calls.
  const {
    createBranch,
    removeRepo: removeRepoIntake,
    removeBranch: removeBranchIntake,
    retryBranch,
    updateRepoInStorage,
    updateAgentInStorage,
  } = useBranchIntake({
    ops,
    repos,
    agents,
    iframeLayers,
    roomId,
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
    iframeLayers: allIframeLayers,
    iframeLayerGroups: allIframeLayerGroups,
    roomId,
    chatTarget,
    addChatSession,
    updateAgentInStorage,
    setBranchPr,
  })
  // The Terminal Pane's Run and Stop (#1342).
  const devServerControls = useMemo(
    () => ({
      stop: branchActions.stopDevServer,
      run: branchActions.runDevServer,
    }),
    [branchActions]
  )

  // Sending comments to a Workspace's agent (#788), from the comments panel
  // or a thread card.
  const commentFrameWorkspace = useCallback(
    (frameId: string) => commentFrameInfo.get(frameId)?.branchId,
    [commentFrameInfo]
  )
  // A Document's threads go to the chat that last changed it, else to the
  // Workspace chat the panel shows (#1314, #1724).
  const commentDocumentChat = useCallback(
    (documentId: string) => {
      const found = documentChat(documentId)
      if (found?.kind === "workspace") {
        return { chatId: found.chatId, branchId: found.branchId }
      }
      if (chatTarget.target?.kind !== "agent") return null
      const branchId = chatTarget.target.agent.id
      const shown = chatSessions.find(
        (c) => c.id === chatTarget.selectedChatId && c.branchId === branchId
      )
      return { branchId, chatId: shown?.id }
    },
    [documentChat, chatTarget, chatSessions]
  )
  const commentDocumentTitle = useCallback(
    (documentId: string) =>
      markdownLayers.find((d) => d.id === documentId)?.title,
    [markdownLayers]
  )
  const commentRequests = useCommentRequests({
    threads: commentThreads.threads,
    frameWorkspace: commentFrameWorkspace,
    documentChat: commentDocumentChat,
    documentTitle: commentDocumentTitle,
    agents,
    sendComments: branchActions.sendComments,
  })

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

  // Chat Sync (history load, streaming-heal hydration, broadcast handling) runs
  // inside `useTabPool`, through the `useChatTabs` hook the player shares.

  // Following another user's viewport, the manual follow-break, the Figma-style
  // wheel pan/zoom, and the forwarded-from-iframe wheel all live in the Canvas
  // Camera controller now (`camera.follow` / `camera.breakFollow` /
  // `camera.handleIframeWheel`, plus the wheel listener it attaches to
  // `canvasWrapperRef`).

  // The scroll-pin effect that keeps the canvas wrapper / transform wrapper from
  // drifting off-axis lives on the Canvas Camera controller now (PRD #588),
  // beside the viewport transform it guards.

  // The Frame, Mockup and Document tools' ask (#1356, #1359): the Draw-and-ask
  // module holds the open ask and routes the send; this root only renders its
  // card.
  const drawAsk = useDrawAsk({
    ops,
    repos,
    agents,
    iframeLayers,
    ownedLayers: sizedLayers,
    chatSessions,
    selection,
    setSelectedGroupIds,
    setSelectedIframeLayerIds,
    setSelectedDocumentLayerIds,
    setEditingDocumentLayerId,
    sendPrompt: branchActions.sendPrompt,
    createBranch,
    addChatSession,
    chatTarget,
    sendMessage: (opts) => chatStore.sendMessage(opts),
    roomId,
  })
  const askFrameId =
    drawAsk.open?.kind === "frame" ? drawAsk.open.frameId : null
  const askMockupBox = drawAsk.open?.kind === "mockup" ? drawAsk.open.box : null
  const askDocumentId =
    drawAsk.open?.kind === "document" ? drawAsk.open.documentId : null

  // Draw tools (Document / Frame / Mockup) — the Tool Mode sibling that turns a released
  // draft into a new Layer. Owns the in-flight draft rects the SelectionOverlay
  // draws; the gesture seam shares its pointer stream with `drawTool`.
  const { drawTool, documentDraft, frameDraft, mockupDraft, addAtPlaceholder } =
    useDrawTool({
      documentMode,
      frameMode,
      mockupMode,
      addDocumentLayer,
      addFrame,
      addIframeLayerToGroup: groupActions.addIframeLayerToGroup,
      addDocumentLayerToGroup: groupActions.addDocumentLayerToGroup,
      toolMode,
      setSelectedIframeLayerIds,
      setSelectedDocumentLayerIds,
      setSelectedGroupIds,
      setEditingDocumentLayerId,
      onFrameDrawn: drawAsk.startFromFrame,
      onMockupDrawn: drawAsk.startFromMockupBox,
      onDocumentDrawn: drawAsk.startFromDocument,
    })

  // The drawn Mockup box's screen rect, from the live camera.
  const locateMockupBox = useCallback(() => {
    const t = transformRef.current?.state
    if (!t || !askMockupBox) return null
    return {
      left: askMockupBox.x * t.scale + t.positionX,
      top: askMockupBox.y * t.scale + t.positionY,
      width: askMockupBox.width * t.scale,
      height: askMockupBox.height * t.scale,
    }
  }, [askMockupBox])

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
      mockupMode,
      interactingLayerId: focusedIframeLayerId ?? createFlowIframeLayerId,
      leaveInteraction: () => {
        setFocusedIframeLayerId(null)
        setCreateFlowIframeLayerId(null)
      },
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
      getResizeLayerSize: (id) => {
        // Frames and Mockups both resize through the device snap.
        const a =
          collections.iframeLayers.get(id) ?? collections.mockupLayers.get(id)
        return a ? { width: a.width, height: a.height } : null
      },
      markFrameDirty: (id) => {
        // Only frames have captures to retake.
        if (collections.iframeLayers.get(id)) captureTracker.markDirty(id)
      },
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
      selfPointerRef.current = { x: canvasX, y: canvasY }
      setPresence({ pointer: selfPointerRef.current })

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
    selfPointerRef.current = null
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
  // but leaves the peer set untouched (see `useOtherPeers`) — doesn't
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
  // Every Add repository outside Canvas settings (the empty canvas, the chat
  // panel, the getting-started checklist, the Chats menu) goes straight to
  // the picker and closes when the repository is added (#1182). Adding saves
  // it to your Repositories and switches it on here (#1423).
  const addRepository = useAddRepositoryFlow()
  const switchOnHere = useCallback(
    (repository: RepoConfig) => {
      // The Repository's values go to this canvas's encrypted store, never
      // its room doc (#1416), and are stored before the Repo switches on
      // (#1476).
      switchOnWithEnv(
        collections,
        repository,
        {
          id: nanoid(),
          createdAt: Date.now(),
          addedBy: userId ?? "anonymous",
        },
        (id, text) => copyInCanvasRepoEnv(roomId, id, text)
      ).catch(() => toast.error("Couldn’t copy the environment variables."))
    },
    [collections, userId, roomId]
  )
  // A new canvas opens on the chat panel (#1182): while no Workspace has had a
  // turn, the Coordinator, or where to add a repository, is the first thing
  // you meet. The panel's size is shared by every canvas, so this runs once
  // per mount.
  const expandChatPanel = chatTarget.expandPanel
  const opensOnPanelRef = useRef(agents.every(isFreshWorkspace))
  useEffect(() => {
    if (!opensOnPanelRef.current) return
    opensOnPanelRef.current = false
    expandChatPanel()
  }, [expandChatPanel])
  // Per page (#1835): a new page shows a new canvas's empty state.
  const isCanvasEmpty = iframeLayerGroups.length === 0
  // The first Canvas after setup shows the getting-started checklist (#780)
  // until it's dismissed. Read from this browser's storage after hydration.
  const showGettingStarted = useSyncExternalStore(
    subscribeGettingStarted,
    () => isGettingStartedCanvas(roomId),
    () => false
  )
  const gettingStartedWorkspaceOpened = useSyncExternalStore(
    subscribeGettingStarted,
    () => isGettingStartedWorkspaceOpened(roomId),
    () => false
  )
  // Step 3 ticks once the panel shows a Workspace here.
  const panelOnWorkspace = chatTarget.target?.kind === "agent"
  useEffect(() => {
    if (showGettingStarted && panelOnWorkspace)
      markGettingStartedWorkspaceOpened(roomId)
  }, [showGettingStarted, panelOnWorkspace, roomId])
  const gettingStarted = useMemo(
    () =>
      gettingStartedProgress({
        repos,
        branches: agents,
        workspaceOpened: gettingStartedWorkspaceOpened,
      }),
    [repos, agents, gettingStartedWorkspaceOpened]
  )
  // Desktop + non-fullscreen: the macOS traffic lights overlay the top-left,
  // so the collapsed-sidebar pills must shift right to clear them.
  const trafficLightsPresent = useTrafficLightsPresent()

  // A frame's "Open logs" (issue #731): point the chat panel at the frame's
  // Workspace, open it, and ask it for the sandbox logs tab.
  const [logsRequest, setLogsRequest] = useState<{
    agentId: string
    nonce: number
  } | null>(null)
  const selectAgentForLogs = chatTarget.selectAgent
  const openBranchLogs = useCallback(
    (branchId: string) => {
      selectAgentForLogs(branchId)
      setLogsRequest((prev) => ({
        agentId: branchId,
        nonce: (prev?.nonce ?? 0) + 1,
      }))
    },
    [selectAgentForLogs]
  )
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  // A collapsed panel is inert (H1): nothing in it takes Tab or typing, and
  // ⌘B / ⌘I still reopen it from the window key handler. Read from the layout
  // as it changes, not the panel's later resize, so a chat expanded and
  // focused in one go isn't still inert when its composer takes focus.
  const onLayoutChange = useCallback((layout: PanelLayout) => {
    if ("sidebar" in layout) setSidebarCollapsed(layout.sidebar === 0)
    if ("chat" in layout) setChatCollapsed(layout.chat === 0)
  }, [])
  const onLayoutChanged = useCallback((layout: PanelLayout) => {
    writePanelLayout("canvas-layout", layout)
  }, [])

  // The sidebar's props, identical across renders that don't change them, so
  // the memoized sidebar skips the canvas's re-render on every pointer move of
  // a drag, marquee or draw.
  const [sidebarStable] = useState(() => new StableProps())
  const [chromeStable] = useState(() => new StableProps())
  // The layers' Workspace verbs, which are rebuilt whenever the Workspaces or
  // layers change (on every step of a drag).
  const memberCallbacks = chromeStable.value("member", {
    onRestartWorkspace: branchActions.startWorkspace,
    onAskForKnob: handleAskForKnob,
  })
  const sidebarFooterActions = sidebarStable.value("footer", {
    onShowCoordinator: () => {
      chatTarget.showRoomChat()
      chatTarget.expandPanel()
    },
    onOpenWorkspace: (id: string) => chatTarget.selectAgent(id),
    onDismiss: clearGettingStartedCanvas,
  })
  const sidebarFooter = useMemo(
    () =>
      showGettingStarted ? (
        <GettingStartedChecklist
          progress={gettingStarted}
          {...sidebarFooterActions}
        />
      ) : null,
    [showGettingStarted, gettingStarted, sidebarFooterActions]
  )
  const sidebarGroups = useMemo(
    () =>
      sortedIframeLayerGroups.map(
        ({ x: _x, y: _y, ...group }): SidebarLayerGroup => group
      ),
    [sortedIframeLayerGroups]
  )
  // Only what the rows show, so the sidebar skips a resize or scroll too.
  const sidebarFrames = useMemo(
    () =>
      iframeLayers.map(({ id, branchId, label, route }): SidebarFrame => ({
        id,
        branchId,
        label,
        route,
      })),
    [iframeLayers]
  )
  const sidebarDocuments = useMemo(
    () => markdownLayers.map(({ id, title }) => ({ id, title })),
    [markdownLayers]
  )
  const sidebarMockups = useMemo(
    () => mockupLayers.map(({ id, title }) => ({ id, title })),
    [mockupLayers]
  )
  const sidebarProps = sidebarStable.value("sidebar", {
    branches: agents,
    iframeLayers: sidebarFrames,
    markdownLayers: sidebarDocuments,
    mockupLayers: sidebarMockups,
    iframeLayerGroups: sidebarGroups,
    selectedIframeLayerIds,
    selectedGroupIds,
    selectedDocumentLayerIds,
    onSelectGroup: handleGroupSelect,
    onZoomToGroup: handleZoomToGroup,
    onSelectDocument: handleDocumentLayerSelect,
    onZoomToDocument: handleZoomToDocument,
    onRenameDocument: layerMutations.setTitle,
    onRemoveDocument: removeDocument,
    onZoomToMockup: handleZoomToMockup,
    onRenameMockup: layerMutations.renameMockup,
    onRemoveMockup: removeMockup,
    onSelectIframeLayer: handleIframeLayerSelect,
    onZoomToIframeLayer: handleSelectIframeLayer,
    onRenameIframeLayer: layerMutations.rename,
    onRemoveIframeLayer: removeIframeLayer,
    onReorderIframeLayerGroups: reorderIframeLayerGroups,
    onMoveMember: moveMember,
    onRenameIframeLayerGroup: renameIframeLayerGroup,
    onRemoveIframeLayerGroup: removeIframeLayerGroup,
    onCollapseSidebar: () => sidebarPanelRef.current?.collapse(),
    pages,
    currentPageId,
    onSelectPage: switchPage,
    onAddPage: addPage,
    onRenamePage: ops.renamePage,
    footer: sidebarFooter,
  } satisfies ComponentProps<typeof RoomSidebar>)
  return (
    <MoveToPageContext.Provider value={moveToPage}>
      {/* The agent drives this canvas's frames and mockups on the Mac
        (#1389), and its mockups on hosted (#1391). */}
      {isLocalBuild ? (
        <FrameDriveRelay
          roomId={roomId}
          viewerId={userId ?? null}
          frameControl={collections.frameControl}
          reveal={revealFrame}
        />
      ) : (
        <FrameDriveViewRelay
          roomId={roomId}
          viewerId={userId ?? null}
          frameControl={collections.frameControl}
          asks={collections.frameDriveAsks}
          reveal={revealFrame}
        />
      )}
      {chatTarget.pendingProbes.map(({ agentId, sandboxName }) => (
        <LogProbe
          key={agentId}
          sandboxName={sandboxName}
          onReady={() => {
            // Expand the collapsed chat panel once the new Workspace's
            // sandbox streams logs, as it's selected — not earlier, when
            // there's nothing to show yet.
            chatTarget.handlePendingReady(agentId)
            chatTarget.expandPanel()
          }}
        />
      ))}
      <AddRepositoryFlowProvider value={addRepository}>
        <ChatsMenuProvider
          userId={userId ?? "anonymous"}
          roomId={roomId}
          repos={repos}
          branches={agents}
          iframeLayers={iframeLayers}
          diffStats={diffStats}
          branchPrs={branchPrs}
          onSelectWorkspace={chatTarget.selectAgent}
          onSelectSketchChat={chatTarget.selectSketchChat}
          onRenameSketchChat={(chatId, label) =>
            updateChatSession(chatId, { label })
          }
          onDeleteSketchChat={deleteSketchChat}
          onRestartDevServer={branchActions.restartDevServer}
          onCreatePr={branchActions.createPullRequest}
          onRecreateBranch={branchActions.recreate}
          onRetryBranch={retryBranch}
          onMarkBranchDone={branchActions.markDone}
          onReopenBranch={branchActions.reopen}
          onRemoveBranch={removeBranchIntake}
          onPlayBranch={handlePlayAgent}
          onShowRoutes={handleShowRoutesForAgent}
          onUpdateBranch={updateAgentInStorage}
        >
          <ResizablePanelGroup
            orientation="horizontal"
            className="fixed inset-0 bg-canvas-plane"
            defaultLayout={initialLayout}
            onLayoutChange={onLayoutChange}
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
              inert={sidebarCollapsed}
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
              <RoomSidebar {...sidebarProps} />
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
                className="relative isolate h-full w-full"
                data-canvas-wrapper
                ref={canvasWrapperRef}
                style={{
                  clipPath: "inset(0)",
                  cursor: isDragPanning
                    ? "grabbing"
                    : spaceHeld
                      ? "grab"
                      : documentMode ||
                          frameMode ||
                          mockupMode ||
                          commentMode ||
                          targeting.pickActive
                        ? "crosshair"
                        : activeGapHandle
                          ? "col-resize"
                          : gesturePreview.reorder
                            ? "grabbing"
                            : hoveredReorderIframeLayerId
                              ? "grab"
                              : undefined,
                }}
                onPointerDownCapture={
                  canvasGestureHandlers.onPointerDownCapture
                }
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
                    : targeting.pickActive
                      ? targeting.handleClick
                      : undefined
                }
              >
                {/* Device-snap ghosts render BEFORE TransformWrapper in DOM order
                so the iframeLayer iframes paint on top — the parts of each ghost
                that extend past the active iframeLayer remain visible. Same
                screen-space canvas approach as SelectionOverlay so the 1px
                outlines stay crisp at any zoom. The snapped device's label is
                ResizeSnapLabel, above the frames. */}
                <ResizeSnapUnderlay {...resizeSnapProps} />

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

                {/* Every Layer's resting hairline, beneath the content. */}
                <LayerEdgesUnderlay
                  layouts={effectiveIframeLayerLayouts}
                  dragShift={reorderDragShift}
                  camera={camera.liveCamera}
                />

                <CanvasContentContext.Provider
                  value={
                    <LiveZoomContext.Provider value={camera.liveZoom}>
                      <LabelLayerContext.Provider value={labelLayer}>
                        <div
                          className="relative"
                          style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}
                        >
                          <MockupChatLinkProvider value={mockupChatLink}>
                            <CanvasMemberLayer
                              iframeLayerGroups={iframeLayerGroups}
                              iframeLayers={iframeLayers}
                              markdownLayers={markdownLayers}
                              workingChats={workingChats}
                              mockupLayers={mockupLayers}
                              selection={selection}
                              onIframeWheel={camera.handleIframeWheel}
                              reference={reference}
                              reorderPreview={gesturePreview.reorder}
                              gestureLayerHandlers={gestureLayerHandlers}
                              effectiveIframeLayerLayouts={
                                effectiveIframeLayerLayouts
                              }
                              iframeLayerLayouts={iframeLayerLayouts}
                              groupZIndex={groupZIndex}
                              groupDisplayNames={groupDisplayNames}
                              placeholderRects={placeholderRects}
                              placeholderTool={
                                frameMode
                                  ? "frame"
                                  : documentMode
                                    ? "document"
                                    : null
                              }
                              onPlaceholderAdd={addAtPlaceholder}
                              remoteSelectionColors={remoteSelectionColors}
                              remoteGroupSelectionColors={
                                remoteGroupSelectionColors
                              }
                              agentDomains={agentDomains}
                              agents={agents}
                              onRestartWorkspace={
                                memberCallbacks.onRestartWorkspace
                              }
                              onOpenLogs={openBranchLogs}
                              onStartChat={drawAsk.startFrameChat}
                              askingIframeLayerId={askFrameId}
                              repos={repos}
                              zoom={zoom}
                              spaceHeld={spaceHeld}
                              commentMode={commentMode}
                              pickActive={targeting.pickActive}
                              dimmedIframeLayerIds={targeting.dimmedIds}
                              selfName={self?.name || "Anonymous"}
                              selfColor={self?.color || "#888888"}
                              editingDocumentLayerId={editingDocumentLayerId}
                              setEditingDocumentLayerId={
                                setEditingDocumentLayerId
                              }
                              focusedIframeLayerId={focusedIframeLayerId}
                              setFocusedIframeLayerId={setFocusedIframeLayerId}
                              frameControl={frameControl}
                              sharedFrames={sharedFrames}
                              createFlowIframeLayerId={createFlowIframeLayerId}
                              setCreateFlowIframeLayerId={
                                setCreateFlowIframeLayerId
                              }
                              removeIframeLayer={removeIframeLayer}
                              removeMockup={removeMockup}
                              removeDocument={removeDocument}
                              handlePlayIframeLayer={handlePlayIframeLayer}
                              onAskForKnob={memberCallbacks.onAskForKnob}
                              handleCaptureReadyChange={
                                handleCaptureReadyChange
                              }
                              handleCaptureDirty={handleCaptureDirty}
                              layerMutations={layerMutations}
                              groupActions={groupActions}
                            />
                          </MockupChatLinkProvider>
                        </div>
                      </LabelLayerContext.Provider>
                    </LiveZoomContext.Provider>
                  }
                >
                  <CanvasTransform
                    transformRef={transformRef}
                    wrapperProps={camera.transformWrapperProps}
                  />
                </CanvasContentContext.Provider>

                {/* The pixel grid when zoomed far in: over the content, under
                the labels and the selection. */}
                <PixelGridOverlay camera={camera.liveCamera} />

                {/* Comment pins live in their own screen-space layer above the
                  selection overlay so pins/popovers aren't painted over by it.
                  The transform mirrors what TransformComponent applies, so the
                  children still position in world coordinates. In the local
                  build there are no persisted threads (so no pins); this still
                  renders the composer that anchors an element/selection and
                  sends it to the agent (#417). */}
                <div
                  className="pointer-events-none absolute inset-0 z-(--z-canvas-annotations)"
                  data-camera-overlay=""
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
                    frameInfo={commentFrameInfo}
                    placements={commentPlacements.placements}
                    getDocumentEditor={reference.getDocumentEditor}
                    documentEditorsVersion={reference.documentEditorsVersion}
                    commentThreads={commentThreads}
                    activeThreadId={reference.activeThreadId}
                    onActivateThread={reference.setActiveThread}
                    describeLayer={describeCommentLayer}
                    hidePins={commentPinsHidden}
                    requests={commentRequests}
                  />
                </div>

                {/* Portal target for floating frame toolbars. Lives above the
                  SelectionOverlay so the toolbar isn't painted over by hover
                  rings or resize handles. Children (rendered via createPortal
                  from iframe-layer) position themselves in canvas-wrapper
                  coords via a rAF loop. Faded out while a layer is being
                  moved, reordered or resized so nothing covers what's being
                  dragged; opacity (not display) keeps the loop measuring, so
                  the toolbar comes back already in place. */}
                <div
                  id="frame-toolbar-portal"
                  className={`pointer-events-none absolute inset-0 z-(--z-canvas-popovers) ${layerGestureActive ? "opacity-0" : ""}`}
                />

                {/* Portal target for the inline "Comment" bubble that appears
                  above text selections inside a document layer. Same reason
                  as the toolbar portal: the bubble lives inside the world
                  transform's stacking context, so an internal z-index can't
                  lift it above the SelectionOverlay sibling. Portaled out
                  and positioned via rAF from markdown-layer. */}
                <div
                  id="inline-comment-bubble-portal"
                  className="pointer-events-none absolute inset-0 z-(--z-canvas-popovers)"
                />

                {/* Follows the live camera, so it stays on its Layers through
                a pan or zoom. */}
                <SelectionOverlay
                  camera={camera.liveCamera}
                  zoom={zoom}
                  viewportPos={viewportPos}
                  selectedIframeLayerIds={overlaySelectedIds}
                  groupSelectedIframeLayerIds={groupSelectedIframeLayerIds}
                  // An edited Document wears an interacting frame's 2px ring.
                  focusedIframeLayerId={
                    focusedIframeLayerId ?? editingDocumentLayerId
                  }
                  hoveredIframeLayerId={hoveredIframeLayerId}
                  workspaceHighlightIds={workspaceHighlightIds}
                  iframeLayerLayouts={effectiveIframeLayerLayouts}
                  drivenFrames={drivenFrames}
                  hideResizeHandles={
                    editingDocumentLayerId !== null ||
                    selectedGroupIds.size > 0 ||
                    // An interacting frame is for using the preview, not
                    // resizing it: its edges belong to the page.
                    focusedIframeLayerId !== null ||
                    // Nor is one someone else drives (#1387).
                    [...selectedInteractiveIds].some((id) =>
                      drivenByOther(frameControl.driverOf(id))
                    )
                  }
                  gapHandles={gapHandles}
                  reorderHandles={reorderHandles}
                  hoveredReorderIframeLayerId={hoveredReorderIframeLayerId}
                  reorderDragShift={reorderDragShift}
                  marquee={gesturePreview.marqueeRect}
                  frameDraft={
                    frameDraft ??
                    mockupDraft ??
                    (askMockupBox && {
                      startX: askMockupBox.x,
                      startY: askMockupBox.y,
                      currentX: askMockupBox.x + askMockupBox.width,
                      currentY: askMockupBox.y + askMockupBox.height,
                      pending: true,
                    })
                  }
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
                      commentMode || targeting.pickActive
                        ? reference.inspectHover
                        : null
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
                  highlightRect={targeting.highlightRect}
                />
                {/* The snapped device's name, beside the red selection rect and
                above every frame, so a neighbouring frame can't cover it. */}
                <ResizeSnapLabel {...resizeSnapProps} />
                <Cursors
                  viewport={{ ...viewportPos, zoom }}
                  pages={pages}
                  pageId={currentPageId}
                />
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
                {/* A drawn Mockup box asking what to show already took the click. */}
                {isCanvasEmpty && !askMockupBox && (
                  <CanvasEmptyState toolMode={toolMode} repos={repos} />
                )}
                {/* Window-drag strip: spans the full toolbar height across the top
                of the canvas, in the chrome layer but BEHIND the floating pills
                (same layer, earlier in DOM order) so the pills stay clickable
                while the empty toolbar area drags the native window. */}
                <div
                  data-tauri-drag-region
                  className="absolute top-0 right-0 left-0 z-(--z-canvas-chrome) h-12"
                />
                <CanvasTopBarMemo
                  {...chromeStable.value("topBar", {
                    roomId,
                    isOwner,
                    sharedWithCount,
                    parentFolder,
                    currentRoomName,
                    onRoomRename: handleRoomRename,
                    sidebarCollapsed,
                    trafficLightsPresent,
                    sidebarPanelRef,
                    roomNameEditableRef,
                    pendingRoomRenameRef,
                    onRoomMenuCloseAutoFocus,
                    deleteDialogOpen,
                    onDeleteDialogOpenChange: setDeleteDialogOpen,
                    onOpenSettings: () => setCanvasSettingsOpen(true),
                    onOpenShortcuts: openShortcutSheet,
                    stopRoomDevServers,
                    flushLayout,
                    pages,
                    currentPageId,
                    onSelectPage: switchPage,
                    onAddPage: addPage,
                  })}
                />
                <AddRepositoryDialog
                  flow={addRepository}
                  onAdded={switchOnHere}
                />
                <CanvasSettingsDialog
                  roomId={roomId}
                  canRevealEnv={(repo) =>
                    canRevealEnv(repo, {
                      userId: userId ?? "",
                      isOwner,
                      localBuild: isLocalBuild,
                    })
                  }
                  open={canvasSettingsOpen}
                  onOpenChange={setCanvasSettingsOpen}
                  userId={userId}
                  repos={repos}
                  branches={agents}
                  onUpdateRepo={updateRepoInStorage}
                  onRemoveRepo={removeRepoIntake}
                  onSwitchOn={switchOnHere}
                  memories={memories}
                  onAddMemory={(text) =>
                    addMemory(collections, { text, source: "member" })
                  }
                  onEditMemory={(id, text) =>
                    editMemory(collections, id, { text })
                  }
                  onRemoveMemory={(id) => removeMemory(collections, id)}
                  files={canvasFiles}
                  skills={canvasSkills}
                />
                <CanvasToolbarMemo
                  {...chromeStable.value("toolbar", {
                    toolMode,
                    onClearMode: reference.clearMode,
                  })}
                />
                {askFrameId ? (
                  <FrameAskCard
                    key={askFrameId}
                    locate={() => frameAskTarget(askFrameId)}
                    markdownLayers={markdownLayers}
                    workspaces={agents}
                    defaultAnswerer={drawAsk.answerer}
                    previews={drawAsk.previews}
                    onShow={drawAsk.show}
                    onSubmit={drawAsk.send}
                    onClose={drawAsk.close}
                  />
                ) : askMockupBox ? (
                  <FrameAskCard
                    kind="mockup"
                    locate={locateMockupBox}
                    markdownLayers={markdownLayers}
                    workspaces={agents}
                    sketchChats={sketchChats}
                    defaultAnswerer={drawAsk.answerer}
                    onSubmit={drawAsk.send}
                    onClose={drawAsk.close}
                  />
                ) : askDocumentId ? (
                  <FrameAskCard
                    key={askDocumentId}
                    kind="document"
                    locate={() => documentAskTarget(askDocumentId)}
                    markdownLayers={markdownLayers}
                    workspaces={agents}
                    sketchChats={sketchChats}
                    defaultAnswerer={drawAsk.answerer}
                    onSubmit={drawAsk.send}
                    onWriteMyself={drawAsk.writeDocument}
                    onClose={drawAsk.close}
                  />
                ) : null}
                <ShortcutSheetMemo
                  {...chromeStable.value("shortcuts", {
                    open: shortcutSheetOpen,
                    onOpenChange: setShortcutSheetOpen,
                  })}
                />
                {/* The top-right pill, mirroring the breadcrumb pill (32px, 24px
                controls): the zoom menu (always), then the people controls
                (comments, facepile; web only), then Share as the one filled
                action, then the expand-chat button at the edge (when the right
                sidebar is collapsed). */}
                <div className="pointer-events-none absolute top-0 right-0 z-(--z-canvas-chrome) flex h-12 items-center px-2">
                  <div
                    className="pointer-events-auto flex items-center gap-1 rounded-lg bg-background p-1 shadow-md outline outline-1 outline-foreground/10 [&>*]:animate-in [&>*]:duration-200 [&>*]:fade-in-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <CanvasZoomMenuMemo
                      {...chromeStable.value("zoomMenu", {
                        liveZoomPercent: camera.liveZoomPercent,
                        onZoomIn: zoomControls.zoomIn,
                        onZoomOut: zoomControls.zoomOut,
                        onZoomTo: cameraZoomTo,
                        onZoomToFit: zoomControls.zoomToFit,
                      })}
                    />
                    {/* Following other users' viewports and sharing are part of
                    the multi-user surface, excluded from the local build
                    (PRD #404, issue #417). */}
                    {!isLocalBuild && (
                      <>
                        <CommentsButton
                          threads={commentThreads.threads}
                          open={commentsPanelOpen}
                          pinsHidden={commentPinsHidden}
                          onToggle={() => setCommentsPanelOpen((open) => !open)}
                        />
                        <FollowingToolbar
                          followingId={followingConnectionId}
                          onFollow={camera.follow}
                        />
                        {/* Only the owner can invite; a collaborator's
                            invite would be refused server-side. */}
                        {isOwner && (
                          <>
                            <Button
                              size="sm"
                              className="ml-1"
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
                      </>
                    )}
                    {chatCollapsed && (
                      <IconButton
                        label="Show chat"
                        shortcut="⌘I"
                        tooltipSide="bottom"
                        onClick={() => chatPanelRef.current?.expand()}
                      >
                        <SidebarSimpleIcon mirrored />
                      </IconButton>
                    )}
                  </div>
                </div>
                {!isLocalBuild && commentsPanelOpen && (
                  <CommentsPanel
                    roomId={roomId}
                    commentThreads={commentThreads}
                    placements={commentPlacements.placements}
                    activeThreadId={reference.activeThreadId}
                    onSelectThread={selectCommentThread}
                    pinsHidden={commentPinsHidden}
                    onPinsHiddenChange={setCommentPinsHidden}
                    onClose={() => setCommentsPanelOpen(false)}
                    describeLayer={describeCommentLayer}
                    getDocumentEditor={reference.getDocumentEditor}
                    requests={commentRequests}
                  />
                )}
              </div>
            </ResizablePanel>
            <ResizableHandle
              className={
                chatCollapsed ? "w-0 opacity-0" : "focus-visible:ring-0"
              }
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
              inert={chatCollapsed}
              onResize={(size) => setChatCollapsed(size.inPixels === 0)}
            >
              <ChatPanelHostMemo
                {...chromeStable.value("chat", {
                  chatTarget,
                  tabPool,
                  chatSessions,
                  localTerminals: terminalTabs.tabs,
                  roomId,
                  diffStats,
                  branchPrs,
                  chatPanelRef,
                  onUpdateChatSession: updateChatSession,
                  onSetBranchPr: setBranchPr,
                  logsRequest,
                  devServerControls,
                })}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ChatsMenuProvider>
      </AddRepositoryFlowProvider>
    </MoveToPageContext.Provider>
  )
}
