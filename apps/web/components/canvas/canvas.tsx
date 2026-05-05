"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchContentRef,
} from "react-zoom-pan-pinch"
import { nanoid } from "nanoid"
import { uniqueNamesGenerator, adjectives, colors, animals } from "unique-names-generator"
import {
  useAgents,
  useArtboardGroups,
  useArtboards,
  useChatSessions,
  useChatStreamEvents,
  useOtherPresences,
  useRoomCollections,
  useSavedViewport,
  useSelfPresence,
  useSetPresence,
  useTextLayers,
  useWorkspaces,
  useYjsHistory,
} from "@/lib/yjs/react"
import { useSession } from "@/lib/auth-client"
import { ChevronDown, Frame, MessageSquare, MousePointer2, PanelLeftOpen, PanelRightClose, PanelRightOpen, Pencil, Trash2, Type } from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@workspace/ui/components/button"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { Kbd } from "@workspace/ui/components/kbd"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { DeleteProjectDialog } from "@/components/delete-project-dialog"
import { ShareProjectDialog } from "@/components/share-project-dialog"
import { deleteProject, renameProject } from "@/lib/projects-actions"
import { Artboard } from "./artboard"
import { ArtboardGroup } from "./artboard-group"
import { TextLayer } from "./text-layer"
import { SelectionOverlay } from "./selection-overlay"
import { Comments } from "./comments"
import type { ThreadWithComments } from "@/lib/comments"
import { Cursors } from "./cursors"
import { CursorChat } from "./cursor-chat"
import { FollowingToolbar } from "./following-toolbar"
import { useThumbnailHeartbeat } from "./use-thumbnail-heartbeat"
import type { ScreenplayDom } from "@/hooks/use-screenplay-dom"
import type { DomRect } from "@/lib/postmessage-protocol"
import { inputStore } from "@/lib/input-store"
import type { JsonObject, JsonValue } from "@/lib/postmessage-protocol"
import { AgentSidebar } from "@/components/panels/agent-sidebar"
import { ChatPanel } from "@/components/agent/chat-panel"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@workspace/ui/components/resizable"
import { type PanelImperativeHandle } from "react-resizable-panels"
import {
  type PanelLayout,
  writePanelLayout,
} from "@/lib/panel-layout"
import type { AgentData, ChatSessionData, TextLayerData, ViewportData, WorkspaceData } from "@/lib/types"
import { routeToLabel } from "@/lib/route-utils"
import { chatStore, type ChatBroadcastEvent } from "@/lib/chat-store"
import type { RepoPickerSelection } from "@/components/repo-picker"
import type { ParallelAgentSpec } from "@/components/parallel-create-dialog"
import { useDiffStats } from "@/hooks/use-diff-stats"
import {
  renameAgentBranch,
  restartSandbox,
  reconnectSandbox,
  keepAliveSandbox,
} from "@/lib/sandbox-actions"
import { deleteBranch } from "@/lib/github-actions"
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
  DEFAULT_ARTBOARD_WIDTH,
  DEFAULT_ARTBOARD_HEIGHT,
  MIN_ARTBOARD_WIDTH,
  MIN_ARTBOARD_HEIGHT,
  ARTBOARD_GROUP_GAP,
  CANVAS_SIZE,
} from "@/lib/constants"
import {
  computeArtboardLayouts,
  groupGap,
  nextGroupNumber,
  placeNewArtboardGroup,
} from "@/lib/artboard-layout"
import { getArtboardSizePreset } from "@/lib/artboard-sizes"
import {
  anchorCornerForEdge,
  computeDeviceSnap,
  type AnchorCorner,
  type ResizeEdge,
  type SnapCandidate,
} from "@/lib/artboard-snap"
import { ResizeSnapUnderlay } from "./resize-snap-underlay"


// Polls /api/sandbox/:name/logs until it returns 200, then fires onReady once.
// Used to defer selection of a just-created agent until its sandbox is actually
// streaming logs — otherwise flipping selection now shows an empty chat panel.
function LogProbe({ sandboxName, onReady }: { sandboxName: string; onReady: () => void }) {
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  useEffect(() => {
    const abort = new AbortController()
    ;(async () => {
      while (!abort.signal.aborted) {
        try {
          const res = await fetch(
            `/api/sandbox/${encodeURIComponent(sandboxName)}/logs`,
            { signal: abort.signal, cache: "no-store" },
          )
          if (res.ok) {
            try { await res.body?.cancel() } catch {}
            onReadyRef.current()
            return
          }
          try { await res.body?.cancel() } catch {}
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

export function Canvas({ roomId, projectName, hasThumbnail, parentFolderName = "Drafts", initialLayout, initialThreads }: { roomId: string; projectName: string; hasThumbnail: boolean; parentFolderName?: string; initialLayout?: PanelLayout; initialThreads?: ThreadWithComments[] }) {
  const router = useRouter()
  const [currentProjectName, setCurrentProjectName] = useState(projectName)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renameDraft, setRenameDraft] = useState("")
  const [renaming, setRenaming] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [viewportPos, setViewportPos] = useState({ x: 0, y: 0 })
  const [focusedArtboardId, setFocusedArtboardId] = useState<string | null>(null)
  // Artboard currently in Create Flow mode. Mutually exclusive with
  // `focusedArtboardId` — toggling one clears the other.
  const [createFlowArtboardId, setCreateFlowArtboardId] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  // Agents created this session whose sandbox isn't streaming logs yet.
  // A LogProbe is rendered for each; on ready we flip selection and drop
  // the id. No cleanup effect — filtering in render handles deletions,
  // so agents from Liveblocks can be a new reference every render safely.
  const [pendingAgentIds, setPendingAgentIds] = useState<string[]>([])
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  // Per-workspace / per-agent memory so switching back restores prior selection
  const selectedAgentByWorkspaceRef = useRef<Record<string, string>>({})
  const selectedChatByAgentRef = useRef<Record<string, string>>({})
  const inspectHandlersRef = useRef<{
    branchRename: (agentId: string, branch: string) => void
    renameChat: (chatId: string, label: string) => void
  }>({ branchRename: () => {}, renameChat: () => {} })
  const [followingConnectionId, setFollowingConnectionId] = useState<number | null>(null)
  // Per-artboard iframe DOM accessor registry. Artboards register on mount and
  // unregister on unmount; selector-anchored comments use it to query element
  // rects in the right iframe.
  const artboardDomsRef = useRef(new Map<string, ScreenplayDom>())
  const [, setArtboardDomsVersion] = useState(0)
  const handleArtboardDomReady = useCallback(
    (id: string, dom: ScreenplayDom | null) => {
      const map = artboardDomsRef.current
      if (dom) map.set(id, dom)
      else map.delete(id)
      setArtboardDomsVersion((v) => v + 1)
    },
    [],
  )
  const getArtboardDom = useCallback(
    (id: string): ScreenplayDom | undefined => artboardDomsRef.current.get(id),
    [],
  )
  const [commentMode, setCommentMode] = useState(false)
  const [newCommentPos, setNewCommentPos] = useState<{
    x: number
    y: number
    artboardId?: string
    selector?: string | null
    offsetX?: number | null
    offsetY?: number | null
  } | null>(null)
  const [inspectHover, setInspectHover] = useState<{
    artboardId: string
    rect: DomRect
  } | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [selectedArtboardIds, setSelectedArtboardIds] = useState<Set<string>>(new Set())
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set())
  const [selectedTextLayerIds, setSelectedTextLayerIds] = useState<Set<string>>(new Set())
  const [hoveredArtboardId, setHoveredArtboardId] = useState<string | null>(null)
  const [marquee, setMarquee] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null)
  const marqueeRef = useRef<{ startX: number; startY: number; shiftKey: boolean; baseArtboards: Set<string>; baseTextLayers: Set<string> } | null>(null)
  const [textMode, setTextMode] = useState(false)
  const [editingTextLayerId, setEditingTextLayerId] = useState<string | null>(null)
  const [textDraft, setTextDraft] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null)
  const textDraftRef = useRef<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null)
  const [frameMode, setFrameMode] = useState(false)
  const [frameDraft, setFrameDraft] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null)
  const frameDraftRef = useRef<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null)
  const gapDragRef = useRef<{ groupId: string; gapIndex: number; startGap: number; startCanvasX: number } | null>(null)
  const [activeGapHandle, setActiveGapHandle] = useState<{ groupId: string; gapIndex: number } | null>(null)
  const reorderDragRef = useRef<{ groupId: string; artboardId: string } | null>(null)
  const [reorderDraggingArtboardId, setReorderDraggingArtboardId] = useState<string | null>(null)
  /** Cursor in canvas space while a reorder drag is active — drives the lifted artboard's translate. */
  const [reorderDragCursor, setReorderDragCursor] = useState<{ x: number; y: number } | null>(null)
  /** True while the user is holding the meta/cmd key during a reorder drag —
   * pops the artboard out of its source group as a preview. The pop is only
   * committed (new group created, source group updated) on pointer-up if the
   * key is still held. */
  const [reorderDragPopped, setReorderDragPopped] = useState(false)
  // Track meta-key changes during a reorder drag even when the pointer isn't
  // moving, so the popped preview kicks in the instant the user presses cmd.
  useEffect(() => {
    if (!reorderDraggingArtboardId) return
    const onKey = (ev: KeyboardEvent) => setReorderDragPopped(ev.metaKey)
    window.addEventListener("keydown", onKey)
    window.addEventListener("keyup", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("keyup", onKey)
    }
  }, [reorderDraggingArtboardId])
  const transformRef = useRef<ReactZoomPanPinchContentRef>(null)
  const viewportRestoredRef = useRef(false)
  const sidebarPanelRef = useRef<PanelImperativeHandle>(null)
  const chatPanelRef = useRef<PanelImperativeHandle>(null)
  const setPresence = useSetPresence()
  const self = useSelfPresence()
  const others = useOtherPresences()
  const { data: session } = useSession()
  const history = useYjsHistory()
  const collections = useRoomCollections()
  useThumbnailHeartbeat(roomId, hasThumbnail)

  // Publish identity + a stable color into awareness on mount and whenever the
  // session changes. Seed a placeholder viewport so `useSelfPresence` returns
  // non-null before TransformWrapper's `onInit` fires (otherwise the self
  // avatar is missing from the pile until the first transform state ticks in).
  const colorRef = useRef<string>("")
  useEffect(() => {
    if (!session?.user) return
    if (!colorRef.current) {
      const palette = ["#E57373", "#64B5F6", "#81C784", "#FFB74D", "#BA68C8", "#4DD0E1", "#FF8A65", "#A1887F"]
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
  const [chatAnchor, setChatAnchor] = useState<{ x: number; y: number } | null>(null)
  const selfPointerRef = useRef<{ x: number; y: number } | null>(null)
  selfPointerRef.current = self?.pointer ?? null
  const selfMessageRef = useRef<string | null>(null)
  selfMessageRef.current = self?.message ?? null
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
  const selectedArtboardIdsRef = useRef(selectedArtboardIds)
  selectedArtboardIdsRef.current = selectedArtboardIds
  const selectedGroupIdsRef = useRef(selectedGroupIds)
  selectedGroupIdsRef.current = selectedGroupIds
  const selectedTextLayerIdsRef = useRef(selectedTextLayerIds)
  selectedTextLayerIdsRef.current = selectedTextLayerIds
  const editingTextLayerIdRef = useRef(editingTextLayerId)
  editingTextLayerIdRef.current = editingTextLayerId
  const textModeRef = useRef(textMode)
  textModeRef.current = textMode
  const frameModeRef = useRef(frameMode)
  frameModeRef.current = frameMode
  const removeArtboardsRef = useRef<(ids: string[]) => void>(() => {})
  const removeTextLayersRef = useRef<(ids: string[]) => void>(() => {})

  // Keyboard shortcuts
  useEffect(() => {
    const isEditing = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      return tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selfMessageRef.current !== null) {
          closeCursorChat()
          return
        }
        if (editingTextLayerIdRef.current) {
          setEditingTextLayerId(null)
          return
        }
        if (textModeRef.current) {
          setTextMode(false)
          return
        }
        if (frameModeRef.current) {
          setFrameMode(false)
          return
        }
        if (commentMode || newCommentPos) {
          setCommentMode(false)
          setNewCommentPos(null)
          setInspectHover(null)
        } else if (focusedArtboardId) {
          setFocusedArtboardId(null)
        } else if (createFlowArtboardId) {
          setCreateFlowArtboardId(null)
        } else {
          setSelectedArtboardIds(new Set())
          setSelectedGroupIds(new Set())
          setSelectedTextLayerIds(new Set())
        }
      }
      if (e.key === "v" && !e.metaKey && !e.ctrlKey && !isEditing(e)) {
        setCommentMode(false)
        setNewCommentPos(null)
        setInspectHover(null)
        setTextMode(false)
        setFrameMode(false)
      }
      if (e.key === "c" && !e.metaKey && !e.ctrlKey && !isEditing(e)) {
        setCommentMode((m) => !m)
        setNewCommentPos(null)
        setInspectHover(null)
        setTextMode(false)
        setFrameMode(false)
      }
      if (e.key === "t" && !e.metaKey && !e.ctrlKey && !isEditing(e)) {
        setTextMode((m) => !m)
        setCommentMode(false)
        setNewCommentPos(null)
        setInspectHover(null)
        setFrameMode(false)
      }
      if (e.key === "f" && !e.metaKey && !e.ctrlKey && !isEditing(e)) {
        setFrameMode((m) => !m)
        setTextMode(false)
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
      if ((e.key === "i" || e.key === "I") && e.metaKey && !e.altKey && !e.ctrlKey && !isEditing(e)) {
        e.preventDefault()
        const panel = chatPanelRef.current
        if (panel) {
          if (panel.isCollapsed()) panel.expand()
          else panel.collapse()
        }
      }
      // Toggle both side panels: Cmd+.
      if (e.key === "." && e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault()
        const sidebarPanel = sidebarPanelRef.current
        const chatPanel = chatPanelRef.current
        const anyOpen =
          (sidebarPanel && !sidebarPanel.isCollapsed()) ||
          (chatPanel && !chatPanel.isCollapsed())
        if (anyOpen) {
          if (sidebarPanel && !sidebarPanel.isCollapsed()) sidebarPanel.collapse()
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
      // Delete/Backspace removes selected artboards (including all artboards
      // belonging to selected groups) and text layers.
      if ((e.key === "Delete" || e.key === "Backspace") && !isEditing(e)) {
        const abIds = selectedArtboardIdsRef.current
        const grpIds = selectedGroupIdsRef.current
        const txtIds = selectedTextLayerIdsRef.current
        if (abIds.size > 0 || grpIds.size > 0 || txtIds.size > 0) {
          e.preventDefault()
          const allArtboardIds = new Set<string>(abIds)
          if (grpIds.size > 0) {
            for (const g of collections.artboardGroups.toArray()) {
              if (grpIds.has(g.id)) {
                for (const aid of g.artboardIds) allArtboardIds.add(aid)
              }
            }
          }
          if (allArtboardIds.size > 0) {
            // Single-frame delete: keep selection on the right neighbor (or
            // left if there's nothing to the right). Multi-frame deletes
            // clear selection — no obvious "next" candidate.
            let nextSelected: string | null = null
            if (allArtboardIds.size === 1) {
              const onlyId = allArtboardIds.values().next().value as string
              for (const g of collections.artboardGroups.toArray()) {
                const idx = g.artboardIds.indexOf(onlyId)
                if (idx === -1) continue
                nextSelected = g.artboardIds[idx + 1] ?? g.artboardIds[idx - 1] ?? null
                break
              }
            }
            removeArtboardsRef.current(Array.from(allArtboardIds))
            setSelectedArtboardIds(nextSelected ? new Set([nextSelected]) : new Set())
            setSelectedGroupIds(new Set())
          }
          if (txtIds.size > 0) {
            removeTextLayersRef.current(Array.from(txtIds))
            setSelectedTextLayerIds(new Set())
          }
        }
      }
      // Undo: Cmd/Ctrl+Z
      if (e.key === "z" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !isEditing(e)) {
        e.preventDefault()
        history.undo()
      }
      // Redo: Cmd/Ctrl+Shift+Z
      if (e.key === "z" && (e.metaKey || e.ctrlKey) && e.shiftKey && !isEditing(e)) {
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
  }, [commentMode, newCommentPos, focusedArtboardId, createFlowArtboardId, history, openCursorChat, closeCursorChat])

  const artboards = useArtboards()
  const artboardGroups = useArtboardGroups()
  const artboardLayouts = useMemo(
    () => computeArtboardLayouts(artboardGroups, artboards),
    [artboardGroups, artboards],
  )
  /**
   * Layouts as the user sees them right now — diverges from `artboardLayouts`
   * only while a reorder drag has the meta key held: the dragged artboard is
   * pulled out of its source group's flex flow and floats at the cursor, so
   * its siblings close the gap. Used by the selection overlay, hit-tests, and
   * everything else that draws or interacts with on-screen positions.
   */
  const reorderDragRef_artboardId = reorderDraggingArtboardId
  const effectiveArtboardLayouts = useMemo(() => {
    if (!reorderDragPopped || !reorderDragRef_artboardId || !reorderDragCursor) {
      return artboardLayouts
    }
    const popped = artboardLayouts.get(reorderDragRef_artboardId)
    if (!popped) return artboardLayouts
    const sourceGroup = artboardGroups.find((g) => g.id === popped.groupId)
    if (!sourceGroup) return artboardLayouts
    const result = new Map(artboardLayouts)
    // Override the popped artboard so it sits centered on the cursor.
    result.set(reorderDragRef_artboardId, {
      ...popped,
      x: reorderDragCursor.x - popped.width / 2,
      y: reorderDragCursor.y - popped.height / 2,
    })
    // Reflow the source group's remaining artboards to close the gap.
    const remainingIds = sourceGroup.artboardIds.filter((id) => id !== reorderDragRef_artboardId)
    const gap = groupGap(sourceGroup)
    let cursorX = sourceGroup.x
    for (let i = 0; i < remainingIds.length; i++) {
      const id = remainingIds[i]!
      const ab = artboards.find((a) => a.id === id)
      if (!ab) continue
      result.set(id, {
        id,
        groupId: sourceGroup.id,
        index: i,
        isLast: i === remainingIds.length - 1,
        x: cursorX,
        y: sourceGroup.y,
        width: ab.width,
        height: ab.height,
      })
      cursorX += ab.width + gap
    }
    return result
  }, [artboardLayouts, reorderDragPopped, reorderDragRef_artboardId, reorderDragCursor, artboardGroups, artboards])
  const sortedArtboardGroups = useMemo(() => {
    return [...artboardGroups].sort((a, b) => {
      const ao = a.sidebarOrder ?? Number.MAX_SAFE_INTEGER
      const bo = b.sidebarOrder ?? Number.MAX_SAFE_INTEGER
      if (ao !== bo) return ao - bo
      return a.id.localeCompare(b.id)
    })
  }, [artboardGroups])

  /**
   * Display name per group. Persisted on the group itself so reordering
   * doesn't renumber existing groups; legacy groups without a stored name
   * fall back to "Group" so the UI doesn't render `undefined`.
   */
  const groupDisplayNames = useMemo(() => {
    const names = new Map<string, string>()
    for (const g of sortedArtboardGroups) {
      names.set(g.id, g.name ?? "Group")
    }
    return names
  }, [sortedArtboardGroups])

  /**
   * World-space rects for the trailing "add frame" placeholder of every group
   * that contains a currently-selected artboard. Selecting the whole group
   * hides it. Drawn by `SelectionOverlay` so the border stays 1px crisp
   * regardless of zoom; the click target itself lives inside `ArtboardGroup`.
   */
  const placeholderRects = useMemo(() => {
    const rects: Array<{ x: number; y: number; width: number; height: number }> = []
    for (const g of artboardGroups) {
      if (g.artboardIds.length === 0) continue
      if (selectedGroupIds.has(g.id)) continue
      const hasSelected = g.artboardIds.some((id) => selectedArtboardIds.has(id))
      if (!hasSelected) continue
      const lastId = g.artboardIds[g.artboardIds.length - 1]!
      const lastLayout = artboardLayouts.get(lastId)
      if (!lastLayout) continue
      rects.push({
        x: lastLayout.x + lastLayout.width + groupGap(g),
        y: lastLayout.y,
        width: lastLayout.width,
        height: lastLayout.height,
      })
    }
    return rects
  }, [artboardGroups, artboardLayouts, selectedArtboardIds, selectedGroupIds])

  /**
   * One handle per inter-artboard gap in every selected group. Stored in
   * world-space; `SelectionOverlay` projects them to screen-space so the
   * handle stays a constant pixel size at any zoom. `left`/`right` define
   * the full gap area (used for hover hit-testing); `centerX` is the visual
   * line position.
   */
  const gapHandles = useMemo(() => {
    const handles: Array<{
      groupId: string
      gapIndex: number
      centerX: number
      left: number
      right: number
      top: number
      bottom: number
    }> = []
    if (selectedGroupIds.size === 0) return handles
    for (const g of artboardGroups) {
      if (!selectedGroupIds.has(g.id)) continue
      // While the popped preview is showing, gap handles between the popped
      // artboard and its (former) neighbors don't make sense — skip them.
      const visibleIds = reorderDragPopped && reorderDragRef_artboardId
        ? g.artboardIds.filter((id) => id !== reorderDragRef_artboardId)
        : g.artboardIds
      if (visibleIds.length < 2) continue
      for (let i = 1; i < visibleIds.length; i++) {
        const prev = effectiveArtboardLayouts.get(visibleIds[i - 1]!)
        const next = effectiveArtboardLayouts.get(visibleIds[i]!)
        if (!prev || !next) continue
        const top = Math.max(prev.y, next.y)
        const bottom = Math.min(prev.y + prev.height, next.y + next.height)
        const left = prev.x + prev.width
        const right = next.x
        handles.push({
          groupId: g.id,
          gapIndex: i,
          centerX: (left + right) / 2,
          left,
          right,
          top,
          bottom,
        })
      }
    }
    return handles
  }, [artboardGroups, effectiveArtboardLayouts, selectedGroupIds, reorderDragPopped, reorderDragRef_artboardId])

  const gapHandlesRef = useRef(gapHandles)
  gapHandlesRef.current = gapHandles

  /**
   * Centers of every artboard in selected groups with 2+ artboards. Drawn at
   * constant pixel size by the selection overlay; pressing on one starts a
   * drag that reorders the artboards inside the group.
   */
  const reorderHandles = useMemo(() => {
    const handles: Array<{ artboardId: string; centerX: number; centerY: number }> = []
    if (selectedGroupIds.size === 0) return handles
    for (const g of artboardGroups) {
      if (!selectedGroupIds.has(g.id)) continue
      if (g.artboardIds.length < 2) continue
      for (const id of g.artboardIds) {
        const layout = effectiveArtboardLayouts.get(id)
        if (!layout) continue
        handles.push({
          artboardId: id,
          centerX: layout.x + layout.width / 2,
          centerY: layout.y + layout.height / 2,
        })
      }
    }
    return handles
  }, [artboardGroups, effectiveArtboardLayouts, selectedGroupIds])

  const reorderHandlesRef = useRef(reorderHandles)
  reorderHandlesRef.current = reorderHandles
  const [hoveredReorderArtboardId, setHoveredReorderArtboardId] = useState<string | null>(null)

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
    [],
  )

  /**
   * World-space hit test against the entire gap area between two artboards —
   * matches the symaphore behavior where hovering anywhere in the gap reveals
   * the handle. The 6px screen-space pad keeps the handle grabbable when the
   * gap has been collapsed to 0 (cursor is then over the touching edge of an
   * artboard, but the canvas wrapper still picks the gap drag).
   */
  const hitTestGapHandle = useCallback(
    (canvasX: number, canvasY: number, currentZoom: number) => {
      const padCanvas = 6 / currentZoom
      for (const h of gapHandlesRef.current) {
        if (canvasY < h.top || canvasY > h.bottom) continue
        if (canvasX < h.left - padCanvas || canvasX > h.right + padCanvas) continue
        return h
      }
      return null
    },
    [],
  )

  /** Set of artboard ids whose parent group is currently selected. */
  const groupSelectedArtboardIds = useMemo(() => {
    const ids = new Set<string>()
    if (selectedGroupIds.size === 0) return ids
    for (const g of artboardGroups) {
      if (!selectedGroupIds.has(g.id)) continue
      for (const aid of g.artboardIds) ids.add(aid)
    }
    return ids
  }, [artboardGroups, selectedGroupIds])
  const textLayers = useTextLayers()
  const workspaces = useWorkspaces()
  const agents = useAgents()

  const diffStats = useDiffStats(agents, workspaces)

  const runningAgents = useMemo(() => agents.filter((a) => a.status === "running"), [agents])

  const chatSessions = useChatSessions()
  const savedViewport = useSavedViewport()

  const saveViewport = useCallback(
    (vp: ViewportData) => {
      collections.savedViewport.set(vp)
    },
    [collections],
  )

  const saveViewportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveViewportDebounced = useCallback(
    (vp: ViewportData) => {
      if (saveViewportTimerRef.current) clearTimeout(saveViewportTimerRef.current)
      saveViewportTimerRef.current = setTimeout(() => saveViewport(vp), 500)
    },
    [saveViewport],
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
    const domains: Record<string, { previewDomain: string; branch: string; discoveredRoutes?: { route: string; label: string }[] }> = {}
    for (const agent of agents) {
      if (agent.previewDomain) {
        domains[agent.id] = {
          previewDomain: agent.previewDomain,
          branch: agent.branch,
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

  // --- Workspace mutations ---

  const addWorkspaceToStorage = useCallback(
    (id: string, data: WorkspaceData) => {
      collections.workspaces.set(id, data)
    },
    [collections],
  )

  const updateWorkspaceInStorage = useCallback(
    (id: string, data: Partial<WorkspaceData>) => {
      collections.workspaces.update(id, data)
    },
    [collections],
  )

  const removeWorkspaceFromStorage = useCallback(
    (id: string) => {
      collections.transact(() => {
        collections.workspaces.delete(id)
        // Cascade-delete agents and their artboards/chats for this workspace.
        const agentIds: string[] = []
        for (const agent of collections.agents.toArray()) {
          if (agent.workspaceId === id) agentIds.push(agent.id)
        }
        const removedArtboardIds = new Set<string>()
        for (const agentId of agentIds) {
          collections.agents.delete(agentId)
          for (const a of collections.artboards.toArray()) {
            if (a.sandboxId === agentId) {
              collections.artboards.delete(a.id)
              removedArtboardIds.add(a.id)
            }
          }
          for (const cs of collections.chatSessions.toArray()) {
            if (cs.agentId === agentId) collections.chatSessions.delete(cs.id)
          }
        }
        // Drop the removed artboards from any groups that referenced them; if
        // a group is left empty, delete it as well.
        for (const g of collections.artboardGroups.toArray()) {
          const remaining = g.artboardIds.filter((aid) => !removedArtboardIds.has(aid))
          if (remaining.length === g.artboardIds.length) continue
          if (remaining.length === 0) {
            collections.artboardGroups.delete(g.id)
          } else {
            collections.artboardGroups.update(g.id, { artboardIds: remaining })
          }
        }
      })
    },
    [collections],
  )

  // --- Artboard mutations ---

  /** Resolve the default artboard size for the workspace owning the given agent. */
  const getDefaultSizeForAgent = useCallback(
    (agentId: string): { width: number; height: number } => {
      const agent = collections.agents.get(agentId)
      const workspace = agent
        ? collections.workspaces.get(agent.workspaceId)
        : undefined
      const preset = getArtboardSizePreset(workspace?.defaultArtboardSizeId)
      return { width: preset.width, height: preset.height }
    },
    [collections],
  )

  /**
   * Place a fresh single-artboard group for a newly-spawned agent. Caller
   * must already be inside a `collections.transact()`. Layout is computed
   * client-side (rather than at the end of the server-side provisioning
   * pipeline) so that concurrently-created agents don't race on the Yjs doc
   * snapshot and end up with overlapping group positions.
   */
  const seedArtboardForAgent = useCallback(
    (agentId: string, viewportCenter: { x: number; y: number }, label = "Frame 1") => {
      const allGroups = collections.artboardGroups.toArray()
      const allArtboards = collections.artboards.toArray()
      const { width, height } = getDefaultSizeForAgent(agentId)
      const { x, y } = placeNewArtboardGroup(
        allGroups,
        allArtboards,
        viewportCenter,
        width,
        height,
      )
      const artboardId = nanoid()
      const groupId = nanoid()
      collections.artboards.set(artboardId, {
        id: artboardId,
        sandboxId: agentId,
        width,
        height,
        label,
        iframeState: {},
      })
      collections.artboardGroups.set(groupId, {
        id: groupId,
        name: `Group ${nextGroupNumber(allGroups)}`,
        x,
        y,
        artboardIds: [artboardId],
      })
    },
    [collections, getDefaultSizeForAgent],
  )

  /** Add an artboard — used by the manual "add screen" button. Always creates a fresh group. */
  const addArtboard = useCallback(
    (agentId: string, label: string): string | undefined => {
      const agent = collections.agents.get(agentId)
      if (!agent || agent.status !== "running") return

      const { cx, cy } = getViewportCenter()
      const artboardIdRef = { current: "" }
      collections.transact(() => {
        const allGroups = collections.artboardGroups.toArray()
        const allArtboards = collections.artboards.toArray()
        const { width, height } = getDefaultSizeForAgent(agentId)
        const { x, y } = placeNewArtboardGroup(
          allGroups,
          allArtboards,
          { x: cx, y: cy },
          width,
          height,
        )
        const artboardId = nanoid()
        const groupId = nanoid()
        artboardIdRef.current = artboardId
        collections.artboards.set(artboardId, {
          id: artboardId,
          sandboxId: agentId,
          width,
          height,
          label,
          iframeState: {},
        })
        collections.artboardGroups.set(groupId, {
          id: groupId,
          name: `Group ${nextGroupNumber(allGroups)}`,
          x,
          y,
          artboardIds: [artboardId],
        })
      })
      return artboardIdRef.current
    },
    [collections, getViewportCenter, getDefaultSizeForAgent],
  )

  /** Add an empty frame not associated with any agent/branch/route. Creates a new single-artboard group. */
  const addFrame = useCallback(
    (x: number, y: number, width: number, height: number): string => {
      const artboardId = nanoid()
      const groupId = nanoid()
      const groupName = `Group ${nextGroupNumber(collections.artboardGroups.toArray())}`
      collections.transact(() => {
        collections.artboards.set(artboardId, {
          id: artboardId,
          width: Math.max(MIN_ARTBOARD_WIDTH, width),
          height: Math.max(MIN_ARTBOARD_HEIGHT, height),
          label: "Frame",
          iframeState: {},
        })
        collections.artboardGroups.set(groupId, {
          id: groupId,
          name: groupName,
          x,
          y,
          artboardIds: [artboardId],
        })
      })
      return artboardId
    },
    [collections],
  )

  /**
   * Create a new group for an agent containing one artboard per discovered
   * route. The group is positioned to the right of all existing groups,
   * top-aligned with the topmost. Returns the new group's id and the id of
   * its first artboard (handy for zooming after the DOM updates).
   */
  const addRoutesGroupForAgent = useCallback(
    (agentId: string, routes: { route: string; label: string }[]):
      | { groupId: string; firstArtboardId: string }
      | undefined => {
      if (routes.length === 0) return
      const allGroups = collections.artboardGroups.toArray()
      const allArtboards = collections.artboards.toArray()
      const { width, height } = getDefaultSizeForAgent(agentId)

      const { cx, cy } = getViewportCenter()
      const { x, y } = placeNewArtboardGroup(
        allGroups,
        allArtboards,
        { x: cx, y: cy },
        width,
        height,
      )

      const artboardIds = routes.map(() => nanoid())
      const groupId = nanoid()
      collections.transact(() => {
        routes.forEach((r, i) => {
          collections.artboards.set(artboardIds[i]!, {
            id: artboardIds[i]!,
            sandboxId: agentId,
            width,
            height,
            label: r.label || routeToLabel(r.route),
            iframeState: {},
            route: r.route,
          })
        })
        collections.artboardGroups.set(groupId, {
          id: groupId,
          name: `Routes ${nextGroupNumber(allGroups)}`,
          x,
          y,
          artboardIds,
        })
      })
      return { groupId, firstArtboardId: artboardIds[0]! }
    },
    [collections, getViewportCenter, getDefaultSizeForAgent],
  )

  /** Append a new artboard to an existing group, mirroring the last sibling's size and agent. */
  const addArtboardToGroup = useCallback(
    (groupId: string): string | undefined => {
      const group = collections.artboardGroups.get(groupId)
      if (!group || group.artboardIds.length === 0) return
      const lastId = group.artboardIds[group.artboardIds.length - 1]!
      const last = collections.artboards.get(lastId)
      if (!last) return
      const id = nanoid()
      collections.transact(() => {
        collections.artboards.set(id, {
          id,
          ...(last.sandboxId ? { sandboxId: last.sandboxId } : {}),
          width: last.width,
          height: last.height,
          label: last.sandboxId
            ? `Frame ${group.artboardIds.length + 1}`
            : "Frame",
          iframeState: {},
          ...(last.route ? { route: last.route } : {}),
        })
        collections.artboardGroups.update(groupId, {
          artboardIds: [...group.artboardIds, id],
        })
      })
      return id
    },
    [collections],
  )

  /** Translate the groups containing any of the given artboards by (dx, dy). */
  const moveArtboardsByDelta = useCallback(
    (ids: string[], dx: number, dy: number) => {
      const idSet = new Set(ids)
      collections.transact(() => {
        for (const g of collections.artboardGroups.toArray()) {
          if (g.artboardIds.some((aid) => idSet.has(aid))) {
            collections.artboardGroups.update(g.id, {
              x: g.x + dx,
              y: g.y + dy,
            })
          }
        }
      })
    },
    [collections],
  )

  /**
   * Per-gesture resize state. The hook emits raw screen-derived deltas every
   * pointer move; we accumulate them against the artboard's size at gesture
   * start so the snap math sees the *un-snapped* proposed size, not the
   * already-snapped value we wrote on the previous frame. Without that, once
   * the artboard locked onto a preset the cumulative delta would never reach
   * the next preset.
   */
  const resizeRawRef = useRef<{
    artboardId: string
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
    artboardId: string
    edge: ResizeEdge
    anchor: AnchorCorner
    candidates: SnapCandidate[]
    snappedPresetId: string | null
  } | null>(null)

  const handleResizeStart = useCallback(
    (id: string, edge: ResizeEdge) => {
      const a = collections.artboards.get(id)
      if (!a) return
      resizeRawRef.current = {
        artboardId: id,
        edge,
        initialWidth: a.width,
        initialHeight: a.height,
        rawDw: 0,
        rawDh: 0,
      }
    },
    [collections],
  )

  const handleResizeEnd = useCallback((_id: string) => {
    resizeRawRef.current = null
    setResizeSnap(null)
  }, [])

  /**
   * Resize handler from a single artboard's edge.
   * - (dx, dy) shifts the artboard's parent group by that delta — non-zero
   *   only for top (`dy`) and left (`dx`) edges, so the group anchor follows
   *   the dragged edge while the right/bottom stays put.
   * - (dw, dh) is applied to this artboard's own width/height (clamped to
   *   the 320×200 minimum). Other artboards in the group keep their size.
   * - `edge` lets us snap to nearby device-size presets and emit the
   *   underlay state used to render their ghosts.
   */
  const resizeArtboardEdge = useCallback(
    (id: string, edge: ResizeEdge, dx: number, dy: number, dw: number, dh: number) => {
      collections.transact(() => {
        const a = collections.artboards.get(id)
        if (!a) return

        // Initialize raw state lazily if startResize didn't fire — defensive
        // against any future call sites that bypass the gesture lifecycle.
        if (!resizeRawRef.current || resizeRawRef.current.artboardId !== id) {
          resizeRawRef.current = {
            artboardId: id,
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
        const rawWidth = Math.max(MIN_ARTBOARD_WIDTH, rs.initialWidth + rs.rawDw)
        const rawHeight = Math.max(MIN_ARTBOARD_HEIGHT, rs.initialHeight + rs.rawDh)

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
        const newWidth = Math.max(MIN_ARTBOARD_WIDTH, snap.width)
        const newHeight = Math.max(MIN_ARTBOARD_HEIGHT, snap.height)
        const actualDw = newWidth - a.width
        const actualDh = newHeight - a.height
        // The resize hook only sends a non-zero `dx`/`dy` for left/top edge
        // drags (where `dx ≈ -dw` and `dy ≈ -dh`). Once the artboard hits its
        // minimum, `actualDw`/`actualDh` shrink toward 0 — mirror them with
        // the opposite sign so the group anchor stays pinned to the
        // un-dragged side instead of marching off with the cursor.
        const shiftX = dx === 0 ? 0 : -actualDw
        const shiftY = dy === 0 ? 0 : -actualDh
        if (shiftX !== 0 || shiftY !== 0) {
          for (const g of collections.artboardGroups.toArray()) {
            if (g.artboardIds.includes(id)) {
              collections.artboardGroups.update(g.id, {
                x: g.x + shiftX,
                y: g.y + shiftY,
              })
              break
            }
          }
        }
        if (actualDw !== 0 || actualDh !== 0) {
          collections.artboards.update(id, { width: newWidth, height: newHeight })
        }

        setResizeSnap({
          artboardId: id,
          edge,
          anchor: anchorCornerForEdge(edge),
          candidates: snap.candidates,
          snappedPresetId: snap.snappedPresetId,
        })
      })
    },
    [collections, zoom],
  )

  const renameArtboard = useCallback(
    (id: string, label: string) => {
      collections.artboards.update(id, { label })
    },
    [collections],
  )

  const fitArtboardToContent = useCallback(
    (id: string, width: number, height: number) => {
      // Ceil rather than round so sub-pixel content extents never shrink the
      // artboard below the actual content (which would creep smaller on each
      // repeated Fit click).
      const newWidth = Math.max(MIN_ARTBOARD_WIDTH, Math.ceil(width))
      const newHeight = Math.max(MIN_ARTBOARD_HEIGHT, Math.ceil(height))
      collections.artboards.update(id, { width: newWidth, height: newHeight })
    },
    [collections],
  )

  const removeArtboards = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return
      const idSet = new Set(ids)
      collections.transact(() => {
        for (const id of ids) collections.artboards.delete(id)
        // Iterate groups exactly once so each group's `artboardIds` stays
        // consistent — `toArray()` returns a snapshot that doesn't refresh
        // mid-transaction, so doing it per-id would re-add already-deleted
        // ids on subsequent passes.
        for (const g of collections.artboardGroups.toArray()) {
          if (!g.artboardIds.some((aid) => idSet.has(aid))) continue
          const remaining = g.artboardIds.filter((aid) => !idSet.has(aid))
          if (remaining.length === 0) {
            collections.artboardGroups.delete(g.id)
          } else {
            collections.artboardGroups.update(g.id, { artboardIds: remaining })
          }
        }
      })
    },
    [collections],
  )
  removeArtboardsRef.current = removeArtboards

  /**
   * After deleting a single artboard, prefer keeping the user near the same
   * spot in the row: pick the right-hand neighbor, falling back to the left.
   * Returns null if the group will be empty (or the artboard isn't in any).
   */
  const computeNextSelectionAfterDelete = useCallback(
    (deletedId: string): string | null => {
      for (const g of collections.artboardGroups.toArray()) {
        const idx = g.artboardIds.indexOf(deletedId)
        if (idx === -1) continue
        return g.artboardIds[idx + 1] ?? g.artboardIds[idx - 1] ?? null
      }
      return null
    },
    [collections],
  )

  const removeArtboard = useCallback(
    (id: string) => {
      const next = computeNextSelectionAfterDelete(id)
      removeArtboards([id])
      if (next) {
        setSelectedArtboardIds(new Set([next]))
        setSelectedGroupIds(new Set())
        setSelectedTextLayerIds(new Set())
      } else {
        setSelectedArtboardIds(new Set())
      }
    },
    [computeNextSelectionAfterDelete, removeArtboards],
  )

  // Use a ref so the route handler (passed as a stable callback to many
  // places) sees the latest Create Flow selection without forcing every
  // consumer to re-bind on toggle.
  const createFlowArtboardIdRef = useRef<string | null>(null)
  createFlowArtboardIdRef.current = createFlowArtboardId

  const updateArtboardRoute = useCallback(
    (id: string, route: string) => {
      let viewportShift = 0
      collections.transact(() => {
        const artboard = collections.artboards.get(id)
        const previousRoute = artboard?.route
        const inFlowMode = createFlowArtboardIdRef.current === id

        // In Create Flow mode, every meaningful navigation drops a clone of
        // the artboard's previous route into the same group, immediately to
        // the left of the navigated artboard. The group's origin stays put;
        // instead we pan the canvas viewport right by the clone's width so
        // the navigated artboard appears visually anchored while the trail
        // grows leftward.
        if (
          inFlowMode &&
          artboard &&
          previousRoute !== undefined &&
          previousRoute !== route
        ) {
          const group = collections.artboardGroups
            .toArray()
            .find((g) => g.artboardIds.includes(id))
          if (group) {
            const cloneId = nanoid()
            collections.artboards.set(cloneId, {
              id: cloneId,
              ...(artboard.sandboxId ? { sandboxId: artboard.sandboxId } : {}),
              width: artboard.width,
              height: artboard.height,
              label: artboard.label,
              iframeState: {},
              route: previousRoute,
              ...(artboard.knobs ? { knobs: artboard.knobs } : {}),
              ...(artboard.knobValues
                ? { knobValues: artboard.knobValues }
                : {}),
            })
            const idx = group.artboardIds.indexOf(id)
            const nextIds = [
              ...group.artboardIds.slice(0, idx),
              cloneId,
              ...group.artboardIds.slice(idx),
            ]
            const gap = group.gap ?? ARTBOARD_GROUP_GAP
            collections.artboardGroups.update(group.id, {
              artboardIds: nextIds,
            })
            viewportShift = artboard.width + gap
          }
        }

        collections.artboards.update(id, { route })
        const sandboxId = artboard?.sandboxId
        if (!sandboxId) return
        const agent = collections.agents.get(sandboxId)
        if (!agent) return
        const existing = agent.discoveredRoutes ?? []
        if (existing.some((r) => r.route === route)) return
        collections.agents.update(sandboxId, {
          discoveredRoutes: [...existing, { route, label: routeToLabel(route) }],
        })
      })

      if (viewportShift > 0) {
        const ref = transformRef.current
        if (ref) {
          const { positionX, positionY, scale } = ref.state
          ref.setTransform(positionX - viewportShift * scale, positionY, scale, 0)
        }
      }
    },
    [collections],
  )

  /** Reorder groups in the sidebar Frames list. */
  const reorderArtboardGroups = useCallback(
    (orderedIds: string[]) => {
      collections.transact(() => {
        orderedIds.forEach((id, index) => {
          collections.artboardGroups.update(id, { sidebarOrder: index })
        })
      })
    },
    [collections],
  )

  /** Reorder the artboards inside a group — also reflects on the canvas via flex order. */
  const reorderGroupArtboards = useCallback(
    (groupId: string, orderedArtboardIds: string[]) => {
      collections.artboardGroups.update(groupId, { artboardIds: orderedArtboardIds })
    },
    [collections],
  )

  const renameArtboardGroup = useCallback(
    (groupId: string, name: string) => {
      collections.artboardGroups.update(groupId, { name })
    },
    [collections],
  )

  const setGroupGap = useCallback(
    (groupId: string, gap: number) => {
      collections.artboardGroups.update(groupId, { gap: Math.max(0, gap) })
    },
    [collections],
  )

  /** Delete an entire group + all its artboards. */
  const removeArtboardGroup = useCallback(
    (groupId: string) => {
      const g = collections.artboardGroups.get(groupId)
      if (!g) return
      removeArtboards(g.artboardIds)
      setSelectedGroupIds((prev) => {
        if (!prev.has(groupId)) return prev
        const next = new Set(prev)
        next.delete(groupId)
        return next
      })
    },
    [collections, removeArtboards],
  )

  const assignAgentToArtboard = useCallback(
    (artboardId: string, agentId: string) => {
      collections.artboards.update(artboardId, { sandboxId: agentId })
    },
    [collections],
  )

  const updateArtboardState = useCallback(
    (id: string, state: JsonObject) => {
      collections.artboards.update(id, { iframeState: state })
    },
    [collections],
  )

  const updateArtboardScroll = useCallback(
    (id: string, scrollX: number, scrollY: number) => {
      collections.artboards.update(id, { scrollX, scrollY })
    },
    [collections],
  )

  const updateArtboardKnobs = useCallback(
    (id: string, knobs: JsonValue[]) => {
      collections.artboards.update(id, { knobs })
    },
    [collections],
  )

  const updateArtboardKnobValues = useCallback(
    (id: string, knobValues: JsonObject) => {
      collections.artboards.update(id, { knobValues })
    },
    [collections],
  )

  const updateArtboardSharedState = useCallback(
    (id: string, sharedState: JsonObject) => {
      collections.artboards.update(id, { sharedState })
    },
    [collections],
  )

  // --- Text layer mutations ---

  const addTextLayer = useCallback(
    (data: TextLayerData) => {
      collections.textLayers.set(data.id, data)
    },
    [collections],
  )

  const moveTextLayer = useCallback(
    (id: string, x: number, y: number) => {
      collections.textLayers.update(id, { x, y })
    },
    [collections],
  )

  const moveTextLayersByDelta = useCallback(
    (ids: string[], dx: number, dy: number) => {
      collections.transact(() => {
        for (const id of ids) {
          const t = collections.textLayers.get(id)
          if (t) collections.textLayers.update(id, { x: t.x + dx, y: t.y + dy })
        }
      })
    },
    [collections],
  )

  const resizeTextLayer = useCallback(
    (id: string, x: number, width: number) => {
      const t = collections.textLayers.get(id)
      if (!t) return
      collections.textLayers.update(id, {
        x,
        width: Math.max(40, width),
        ...(t.autoWidth ? { autoWidth: false } : {}),
      })
    },
    [collections],
  )

  const setTextLayerAutoWidth = useCallback(
    (id: string, autoWidth: boolean, width?: number) => {
      const t = collections.textLayers.get(id)
      if (!t) return
      collections.textLayers.update(id, {
        autoWidth,
        ...(!autoWidth && typeof width === "number"
          ? { width: Math.max(40, width) }
          : {}),
      })
    },
    [collections],
  )

  const removeTextLayers = useCallback(
    (ids: string[]) => {
      collections.transact(() => {
        for (const id of ids) collections.textLayers.delete(id)
      })
    },
    [collections],
  )
  removeTextLayersRef.current = removeTextLayers

  // --- Agent mutations ---

  const updateAgentInStorage = useCallback(
    (id: string, data: Partial<AgentData>) => {
      collections.agents.update(id, data)
    },
    [collections],
  )

  const addAgentToStorage = useCallback(
    (id: string, data: AgentData) => {
      collections.agents.set(id, data)
    },
    [collections],
  )

  const removeAgentFromStorage = useCallback(
    (id: string) => {
      collections.transact(() => {
        collections.agents.delete(id)
        const removedArtboardIds = new Set<string>()
        for (const a of collections.artboards.toArray()) {
          if (a.sandboxId === id) {
            collections.artboards.delete(a.id)
            removedArtboardIds.add(a.id)
          }
        }
        for (const cs of collections.chatSessions.toArray()) {
          if (cs.agentId === id) collections.chatSessions.delete(cs.id)
        }
        for (const g of collections.artboardGroups.toArray()) {
          const remaining = g.artboardIds.filter((aid) => !removedArtboardIds.has(aid))
          if (remaining.length === g.artboardIds.length) continue
          if (remaining.length === 0) {
            collections.artboardGroups.delete(g.id)
          } else {
            collections.artboardGroups.update(g.id, { artboardIds: remaining })
          }
        }
      })
    },
    [collections],
  )

  // --- Chat session mutations ---

  const addChatSession = useCallback(
    (id: string, data: ChatSessionData) => {
      collections.chatSessions.set(id, data)
    },
    [collections],
  )

  const updateChatSession = useCallback(
    (id: string, data: Partial<ChatSessionData>) => {
      collections.chatSessions.update(id, data)
    },
    [collections],
  )

  const removeChatSession = useCallback(
    (id: string) => {
      collections.chatSessions.delete(id)
    },
    [collections],
  )

  // --- Handlers ---

  const handleSelectArtboard = useCallback(
    (artboardId: string) => {
      const ref = transformRef.current
      if (!ref) return
      const el = document.getElementById(`artboard-${artboardId}`)
      if (!el) return
      const padding = 20
      const wrapperW = ref.instance.wrapperComponent?.clientWidth ?? window.innerWidth
      const wrapperH = ref.instance.wrapperComponent?.clientHeight ?? window.innerHeight
      const scale = Math.min(
        (wrapperW - padding * 2) / el.offsetWidth,
        (wrapperH - padding * 2) / el.offsetHeight,
        ZOOM_MAX,
      )
      ref.zoomToElement(el, scale, 300)
    },
    [],
  )

  const handleAddArtboardForAgent = useCallback(
    (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId)
      if (!agent || agent.status !== "running") return
      const existing = artboards.filter(
        (a) => a.sandboxId === agentId,
      )
      const newId = addArtboard(
        agentId,
        `Frame ${existing.length + 1}`,
      )
      if (newId) {
        // Wait for DOM to render the new artboard, then zoom to it
        requestAnimationFrame(() => {
          handleSelectArtboard(newId)
        })
      }
    },
    [agents, artboards, addArtboard, handleSelectArtboard],
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
          handleSelectArtboard(result.firstArtboardId)
        })
      }
    },
    [agents, addRoutesGroupForAgent, handleSelectArtboard],
  )

  const handlePlayAgent = useCallback(
    (agentId: string) => {
      window.open(`/play/${roomId}/${agentId}`, "_blank", "noopener,noreferrer")
    },
    [roomId],
  )

  const handlePlayArtboard = useCallback(
    (artboardId: string) => {
      const artboard = artboards.find((a) => a.id === artboardId)
      if (!artboard?.sandboxId) return
      const params = new URLSearchParams()
      params.set("artboard", artboardId)
      if (artboard.route) params.set("route", artboard.route)
      if (artboard.knobValues && Object.keys(artboard.knobValues).length > 0) {
        try {
          const json = JSON.stringify(artboard.knobValues)
          const b64 =
            typeof btoa === "function"
              ? btoa(json)
              : Buffer.from(json, "utf-8").toString("base64")
          params.set("k", encodeURIComponent(b64))
        } catch {}
      }
      const url = `/play/${roomId}/${artboard.sandboxId}?${params.toString()}`
      window.open(url, "_blank", "noopener,noreferrer")
    },
    [artboards, roomId],
  )

  const handleSelectAgent = useCallback(
    (agentId: string | null, options?: { expandPanel?: boolean }) => {
      if (!agentId) return

      // Save outgoing agent's chat selection
      if (selectedAgentId && selectedChatId) {
        selectedChatByAgentRef.current[selectedAgentId] = selectedChatId
      }

      // Save agent selection for its workspace
      const agent = agents.find((a) => a.id === agentId)
      if (agent) {
        selectedAgentByWorkspaceRef.current[agent.workspaceId] = agentId
      }

      setSelectedAgentId(agentId)

      // Restore remembered chat or fall back to first open
      const rememberedChat = selectedChatByAgentRef.current[agentId]
      const agentChats = chatSessions
        .filter((c) => c.agentId === agentId && !c.closedAt)
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
    [agents, chatSessions, selectedAgentId, selectedChatId],
  )

  const handleCreateChat = useCallback(
    (agentId: string) => {
      const existing = chatSessions.filter((c) => c.agentId === agentId)
      const id = nanoid()
      const data: ChatSessionData = {
        id,
        agentId,
        label: "Untitled",
        createdAt: Date.now(),
      }
      addChatSession(id, data)
      setSelectedAgentId(agentId)
      setSelectedChatId(id)
    },
    [chatSessions, addChatSession],
  )

  const handleSubmitAsPlan = useCallback(
    (text: string, agentId: string) => {
      const agent = agents.find((a) => a.id === agentId)
      if (!agent?.sandboxName || !agent.branch) return

      const chatId = nanoid()
      const isFirstChat = !chatSessions.some(
        (c) => c.agentId === agentId && c.sessionId,
      )

      addChatSession(chatId, {
        id: chatId,
        agentId,
        label: "Untitled",
        createdAt: Date.now(),
        planMode: true,
      })

      chatStore.sendMessage({
        roomId,
        chatId,
        sandboxName: agent.sandboxName,
        branch: agent.branch,
        message: text,
        isFirstChat,
        autoNamedBranch: agent.autoNamedBranch,
        planMode: true,
        onSessionId: (sid) => updateChatSession(chatId, { sessionId: sid || undefined }),
        onBranchRename: (branch) =>
          updateAgentInStorage(agentId, { branch, autoNamedBranch: false }),
        onChatRename: (label) => updateChatSession(chatId, { label }),
      })

      setSelectedAgentId(agentId)
      setSelectedChatId(chatId)
    },
    [agents, chatSessions, roomId, addChatSession, updateChatSession, updateAgentInStorage],
  )

  const handleRebaseOnDefault = useCallback(
    (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId)
      if (!agent?.sandboxName || !agent.branch) return
      const workspace = workspaces.find((w) => w.id === agent.workspaceId)
      if (!workspace) return

      const message = `Rebase this branch onto the latest \`origin/${workspace.defaultBranch}\`. Fetch first, then rebase. If conflicts come up, walk me through them before resolving.`

      const existingChats = chatSessions
        .filter((c) => c.agentId === agentId && !c.closedAt)
        .sort((a, b) => a.createdAt - b.createdAt)
      const remembered = selectedChatByAgentRef.current[agentId]
      const targetChat =
        existingChats.find((c) => c.id === remembered) ?? existingChats[0]

      let chatId: string
      let sessionId: string | undefined
      let planMode: boolean | undefined
      let model: string | undefined
      const targetBusy = targetChat
        ? chatStore.getSnapshot(targetChat.id).isStreaming || targetChat.isStreaming === true
        : false

      if (!targetChat || targetBusy) {
        chatId = nanoid()
        addChatSession(chatId, {
          id: chatId,
          agentId,
          label: "Untitled",
          createdAt: Date.now(),
        })
      } else {
        chatId = targetChat.id
        sessionId = targetChat.sessionId
        planMode = targetChat.planMode
        model = targetChat.model
      }

      const isFirstChat = !chatSessions.some(
        (c) => c.agentId === agentId && c.id !== chatId && c.sessionId,
      )

      chatStore.sendMessage({
        roomId,
        chatId,
        sandboxName: agent.sandboxName,
        branch: agent.branch,
        message,
        isFirstChat,
        autoNamedBranch: agent.autoNamedBranch,
        sessionId,
        planMode,
        model,
        onSessionId: (sid) => updateChatSession(chatId, { sessionId: sid || undefined }),
        onBranchRename: (branch) =>
          updateAgentInStorage(agentId, { branch, autoNamedBranch: false }),
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
    [agents, workspaces, chatSessions, roomId, addChatSession, updateChatSession, updateAgentInStorage],
  )

  const handleCloseChat = useCallback(
    (chatId: string) => {
      const chat = chatSessions.find((c) => c.id === chatId)
      const siblings = chat
        ? chatSessions
            .filter((c) => c.agentId === chat.agentId && c.id !== chatId && !c.closedAt)
            .sort((a, b) => a.createdAt - b.createdAt)
        : []
      updateChatSession(chatId, { closedAt: Date.now() })
      if (chat && siblings.length === 0) {
        const newId = nanoid()
        addChatSession(newId, {
          id: newId,
          agentId: chat.agentId,
          label: "Untitled",
          createdAt: Date.now(),
        })
        setSelectedChatId(newId)
      } else if (selectedChatId === chatId) {
        setSelectedChatId(siblings[0]?.id ?? null)
      }
    },
    [selectedChatId, chatSessions, updateChatSession, addChatSession],
  )

  const handleReopenChat = useCallback(
    (chatId: string) => {
      updateChatSession(chatId, { closedAt: 0 })
      setSelectedChatId(chatId)
    },
    [updateChatSession],
  )

  const handleInspectHover = useCallback(
    (artboardId: string, rect: DomRect | null) => {
      if (!rect) {
        setInspectHover((h) => (h?.artboardId === artboardId ? null : h))
      } else {
        setInspectHover({ artboardId, rect })
      }
    },
    [],
  )

  // Hand the comment composer's text off to the agent chat instead of
  // creating a comment thread. Mirrors what the standalone reference tool
  // used to do: tags the message with the artboard's route and the picked
  // element selector so the agent has the context to act on.
  const handleCommentSendToChat = useCallback(
    (note: string, ctx: { artboardId: string; selector: string | null }) => {
      if (!selectedChatId) return
      const currentChat = chatSessions.find((c) => c.id === selectedChatId)
      const agent = currentChat
        ? agents.find((a) => a.id === currentChat.agentId)
        : null
      const artboard = artboards.find((a) => a.id === ctx.artboardId)
      const route = artboard?.route || "/"
      const elementLine = ctx.selector ? `\nElement: \`${ctx.selector}\`` : ""
      const text = `${note}\n\nRoute: \`${route}\`${elementLine}`
      if (currentChat && agent?.sandboxName && agent.branch) {
        const currentBusy =
          chatStore.getSnapshot(currentChat.id).isStreaming ||
          currentChat.isStreaming === true
        let chatId = currentChat.id
        let sessionId = currentChat.sessionId
        let planMode = currentChat.planMode
        let model = currentChat.model
        if (currentBusy) {
          chatId = nanoid()
          sessionId = undefined
          planMode = undefined
          model = undefined
          addChatSession(chatId, {
            id: chatId,
            agentId: currentChat.agentId,
            label: "Untitled",
            createdAt: Date.now(),
          })
          setSelectedChatId(chatId)
        }
        const isFirstChat = !chatSessions.some(
          (c) => c.agentId === currentChat.agentId && c.id !== chatId && c.sessionId,
        )
        chatStore.sendMessage({
          roomId,
          chatId,
          sandboxName: agent.sandboxName,
          branch: agent.branch,
          message: text,
          isFirstChat,
          autoNamedBranch: agent.autoNamedBranch,
          sessionId,
          planMode,
          model,
          onSessionId: (sid) => updateChatSession(chatId, { sessionId: sid || undefined }),
          onBranchRename: (branch) => inspectHandlersRef.current.branchRename(agent.id, branch),
          onChatRename: (label) => inspectHandlersRef.current.renameChat(chatId, label),
        })
      } else {
        inputStore.append(selectedChatId, text)
      }
      const panel = chatPanelRef.current
      if (panel?.isCollapsed()) {
        panel.expand()
        const { inPixels } = panel.getSize()
        if (inPixels < 480) panel.resize(480)
      }
    },
    [
      selectedChatId,
      chatSessions,
      agents,
      artboards,
      roomId,
      addChatSession,
      updateChatSession,
    ],
  )

  const handleRemoveChat = useCallback(
    (chatId: string) => {
      if (selectedChatId === chatId) {
        const chat = chatSessions.find((c) => c.id === chatId)
        if (chat) {
          const siblings = chatSessions
            .filter((c) => c.agentId === chat.agentId && c.id !== chatId && !c.closedAt)
            .sort((a, b) => a.createdAt - b.createdAt)
          setSelectedChatId(siblings[0]?.id ?? null)
        } else {
          setSelectedChatId(null)
        }
      }
      chatStore.cleanup(chatId)
      removeChatSession(chatId)
    },
    [selectedChatId, chatSessions, removeChatSession],
  )

  const handleRenameChat = useCallback(
    (chatId: string, label: string) => {
      updateChatSession(chatId, { label })
    },
    [updateChatSession],
  )

  const handleSelectChat = useCallback(
    (chatId: string | null) => {
      setSelectedChatId(chatId)
      if (chatId) {
        const chat = chatSessions.find((c) => c.id === chatId)
        if (chat) {
          setSelectedAgentId(chat.agentId)
          selectedChatByAgentRef.current[chat.agentId] = chatId
        }
      }
    },
    [chatSessions],
  )

  const handleCreateWorkspace = useCallback(
    (pick: RepoPickerSelection) => {
      const id = nanoid()
      const data: WorkspaceData =
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
              defaultArtboardSizeId: pick.config.defaultArtboardSizeId,
              systemPrompt: pick.config.systemPrompt,
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
      const agentId = nanoid()
      const sandboxName = `sp-${nanoid(10)}`
      const branch = uniqueNamesGenerator({
        dictionaries: [adjectives, colors, animals],
        separator: "-",
        length: 3,
      })
      const { cx, cy } = getViewportCenter()

      collections.transact(() => {
        addWorkspaceToStorage(id, data)
        addAgentToStorage(agentId, {
          id: agentId,
          workspaceId: id,
          sandboxName,
          gitUrl: data.cloneUrl,
          branch,
          previewDomain: "",
          port: data.devServerPort ?? 3000,
          status: "creating",
          statusMessage: "Creating branch…",
          createdAt: Date.now(),
        })
        seedArtboardForAgent(agentId, { x: cx, y: cy })
      })
      setPendingAgentIds((prev) =>
        prev.includes(agentId) ? prev : [...prev, agentId],
      )

      fetch("/api/agent/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flow: "new",
          roomId,
          agentId,
          sandboxName,
          branch,
          workspaceId: id,
        }),
      })
    },
    [addWorkspaceToStorage, addAgentToStorage, collections, getViewportCenter, roomId, seedArtboardForAgent],
  )

  const handleCreateAgent = useCallback(
    (workspaceId: string) => {
      const workspace = workspaces.find((w) => w.id === workspaceId)
      if (!workspace) return

      const id = nanoid()
      const sandboxName = `sp-${nanoid(10)}`
      const branch = uniqueNamesGenerator({
        dictionaries: [adjectives, colors, animals],
        separator: "-",
        length: 3,
      })
      const { cx, cy } = getViewportCenter()

      collections.transact(() => {
        addAgentToStorage(id, {
          id,
          workspaceId,
          sandboxName,
          gitUrl: workspace.cloneUrl,
          branch,
          previewDomain: "",
          port: workspace.devServerPort ?? 3000,
          status: "creating",
          statusMessage: "Creating branch…",
          createdAt: Date.now(),
        })
        seedArtboardForAgent(id, { x: cx, y: cy })
      })
      setPendingAgentIds((prev) => (prev.includes(id) ? prev : [...prev, id]))

      fetch("/api/agent/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flow: "new",
          roomId,
          agentId: id,
          sandboxName,
          branch,
          workspaceId,
        }),
      })
    },
    [workspaces, addAgentToStorage, collections, getViewportCenter, roomId, seedArtboardForAgent],
  )

  const handleCreateAgentFromBranch = useCallback(
    (workspaceId: string, branch: string) => {
      const workspace = workspaces.find((w) => w.id === workspaceId)
      if (!workspace) return

      const id = nanoid()
      const sandboxName = `sp-${nanoid(10)}`
      const { cx, cy } = getViewportCenter()

      collections.transact(() => {
        addAgentToStorage(id, {
          id,
          workspaceId,
          sandboxName,
          gitUrl: workspace.cloneUrl,
          branch,
          previewDomain: "",
          port: workspace.devServerPort ?? 3000,
          status: "creating",
          statusMessage: "Cloning repository…",
          createdAt: Date.now(),
          autoNamedBranch: false,
        })
        seedArtboardForAgent(id, { x: cx, y: cy })
      })
      setPendingAgentIds((prev) => (prev.includes(id) ? prev : [...prev, id]))

      fetch("/api/agent/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flow: "from-branch",
          roomId,
          agentId: id,
          sandboxName,
          branch,
          workspaceId,
        }),
      })
    },
    [workspaces, addAgentToStorage, collections, getViewportCenter, roomId, seedArtboardForAgent],
  )

  const handleDuplicateBranch = useCallback(
    (workspaceId: string, branch: string) => {
      const workspace = workspaces.find((w) => w.id === workspaceId)
      if (!workspace) return

      const id = nanoid()
      const sandboxName = `sp-${nanoid(10)}`
      const newBranch = uniqueNamesGenerator({
        dictionaries: [adjectives, colors, animals],
        separator: "-",
        length: 3,
      })
      const { cx, cy } = getViewportCenter()

      collections.transact(() => {
        addAgentToStorage(id, {
          id,
          workspaceId,
          sandboxName,
          gitUrl: workspace.cloneUrl,
          branch: newBranch,
          previewDomain: "",
          port: workspace.devServerPort ?? 3000,
          status: "creating",
          statusMessage: "Creating branch…",
          createdAt: Date.now(),
        })
        seedArtboardForAgent(id, { x: cx, y: cy })
      })
      setPendingAgentIds((prev) => (prev.includes(id) ? prev : [...prev, id]))

      fetch("/api/agent/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flow: "duplicate-branch",
          roomId,
          agentId: id,
          sandboxName,
          branch: newBranch,
          sourceBranch: branch,
          workspaceId,
        }),
      })
    },
    [workspaces, addAgentToStorage, collections, getViewportCenter, roomId, seedArtboardForAgent],
  )

  const handleForkAgent = useCallback(
    (agentId: string) => {
      const sourceAgent = agents.find((a) => a.id === agentId)
      if (!sourceAgent?.branch || !sourceAgent.sandboxName) return
      handleDuplicateBranch(sourceAgent.workspaceId, sourceAgent.branch)
    },
    [agents, handleDuplicateBranch],
  )

  // Prompts queued by handleCreateParallelAgents that should fire as soon as
  // the agent's sandbox transitions to `running`. Held in a ref because the
  // dispatch effect already re-runs on every `agents` change.
  const pendingPromptsRef = useRef<
    Map<string, { chatId: string; prompt: string; model: string }>
  >(new Map())

  const handleCreateParallelAgents = useCallback(
    async (workspaceId: string, specs: ParallelAgentSpec[]) => {
      const workspace = workspaces.find((w) => w.id === workspaceId)
      if (!workspace) return

      const trimmedSpecs = specs
        .map((s) => ({ ...s, prompt: s.prompt.trim() }))
        .filter((s) => s.prompt.length > 0)
      if (trimmedSpecs.length === 0) return

      // Generate branch names + chat labels from the prompts up front so each
      // parallel agent gets a distinct, prompt-derived branch. Doing this at
      // submit time (instead of letting each agent's first chat trigger a
      // server-side rename) avoids the race where two agents with the same
      // prompt independently land on the same branch and clobber each other.
      let nameResults: Array<{ branch: string; label: string }> = []
      try {
        const res = await fetch("/api/agent/generate-names", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId, prompts: trimmedSpecs.map((s) => s.prompt) }),
        })
        if (res.ok) {
          const data = (await res.json()) as { results: Array<{ branch: string; label: string }> }
          nameResults = data.results ?? []
        }
      } catch {
        // Fall through to local fallback below.
      }
      if (nameResults.length !== trimmedSpecs.length) {
        const taken = new Set<string>()
        nameResults = trimmedSpecs.map(() => {
          let branch = uniqueNamesGenerator({
            dictionaries: [adjectives, colors, animals],
            separator: "-",
            length: 3,
          })
          while (taken.has(branch)) {
            branch = uniqueNamesGenerator({
              dictionaries: [adjectives, colors, animals],
              separator: "-",
              length: 3,
            })
          }
          taken.add(branch)
          return { branch, label: "Untitled" }
        })
      }

      const dispatched: Array<{
        id: string
        sandboxName: string
        branch: string
        flow: "new" | "duplicate-branch"
        sourceBranch: string | undefined
      }> = []

      collections.transact(() => {
        trimmedSpecs.forEach((spec, idx) => {
          const id = nanoid()
          const sandboxName = `sp-${nanoid(10)}`
          const { branch, label } = nameResults[idx]!
          const isDefault = spec.baseBranch === workspace.defaultBranch
          // The "new" flow creates a fresh branch off the workspace default.
          // For any other base, we use "duplicate-branch" so the API forks
          // the named source into our generated branch name.
          const flow: "new" | "duplicate-branch" = isDefault ? "new" : "duplicate-branch"

          collections.agents.set(id, {
            id,
            workspaceId,
            sandboxName,
            gitUrl: workspace.cloneUrl,
            branch,
            previewDomain: "",
            port: workspace.devServerPort ?? 3000,
            status: "creating",
            statusMessage: "Creating branch…",
            createdAt: Date.now(),
            // Names are already prompt-derived and deduped — block the
            // first-chat server rename so it can't override them.
            autoNamedBranch: false,
          })

          // Pre-create the chat session so the queued prompt has a stable
          // chatId before the agent finishes provisioning. The server's
          // ensureChatForAgent skips creation when a chat already exists
          // for the agent, so this won't double up.
          const chatId = nanoid()
          collections.chatSessions.set(chatId, {
            id: chatId,
            agentId: id,
            label,
            createdAt: Date.now(),
            model: spec.model,
          })

          pendingPromptsRef.current.set(id, {
            chatId,
            prompt: spec.prompt,
            model: spec.model,
          })

          dispatched.push({
            id,
            sandboxName,
            branch,
            flow,
            sourceBranch: flow === "duplicate-branch" ? spec.baseBranch : undefined,
          })
        })
      })

      for (const d of dispatched) {
        fetch("/api/agent/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            flow: d.flow,
            roomId,
            agentId: d.id,
            sandboxName: d.sandboxName,
            branch: d.branch,
            workspaceId,
            sourceBranch: d.sourceBranch,
          }),
        })
        setPendingAgentIds((prev) => (prev.includes(d.id) ? prev : [...prev, d.id]))
      }
    },
    [workspaces, collections, roomId],
  )

  const handleRefreshAgent = useCallback(
    async (id: string) => {
      const agent = agents.find((a) => a.id === id)
      if (!agent?.sandboxName) return

      const workspace = workspaces.find((w) => w.id === agent.workspaceId)
      if (!workspace) {
        updateAgentInStorage(id, { status: "error", error: "Workspace not found" })
        return
      }

      updateAgentInStorage(id, { status: "starting", statusMessage: "Restarting sandbox…" })

      const result = await restartSandbox(agent.sandboxName, workspace, agent.branch)
      updateAgentInStorage(id, {
        sandboxName: result.sandboxName,
        previewDomain: result.previewDomain || agent.previewDomain,
        status: result.status === "running" ? "running" : "error",
        statusMessage: "",
        error: result.error || "",
      })
    },
    [agents, workspaces, updateAgentInStorage],
  )

  const handleBranchRename = useCallback(
    async (agentId: string, rawBranch: string) => {
      const newBranch = rawBranch.toLowerCase().replace(/[^a-z0-9/_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
      const agent = agents.find((a) => a.id === agentId)
      if (!newBranch || !agent?.sandboxName || !agent.branch || agent.branch === newBranch) return

      const workspace = workspaces.find((w) => w.id === agent.workspaceId)
      if (!workspace) return

      const result = await renameAgentBranch(
        workspace,
        agent.sandboxName,
        agent.branch,
        newBranch,
      )
      if (result.success) {
        updateAgentInStorage(agentId, { branch: newBranch, autoNamedBranch: false })
      }
    },
    [agents, workspaces, updateAgentInStorage],
  )

  inspectHandlersRef.current = {
    branchRename: handleBranchRename,
    renameChat: handleRenameChat,
  }

  // Load history for all chat sessions that have a sessionId so other
  // clients can see past messages for chats they haven't opened yet.
  useEffect(() => {
    for (const cs of chatSessions) {
      if (cs.sessionId) {
        chatStore.loadHistory(cs.id, cs.sessionId)
      }
    }
  }, [chatSessions])

  // Dispatch prompts that were queued by handleCreateParallelAgents once
  // their agent's sandbox reaches `running`. Drop the queue entry if the
  // agent errored out so failed builds don't leak forever.
  useEffect(() => {
    if (pendingPromptsRef.current.size === 0) return
    for (const agent of agents) {
      const queued = pendingPromptsRef.current.get(agent.id)
      if (!queued) continue
      if (agent.status === "error") {
        pendingPromptsRef.current.delete(agent.id)
        continue
      }
      if (agent.status !== "running" || !agent.sandboxName || !agent.branch) continue
      pendingPromptsRef.current.delete(agent.id)
      chatStore.sendMessage({
        roomId,
        chatId: queued.chatId,
        sandboxName: agent.sandboxName,
        branch: agent.branch,
        message: queued.prompt,
        isFirstChat: true,
        autoNamedBranch: agent.autoNamedBranch,
        model: queued.model,
        onSessionId: (sid) =>
          updateChatSession(queued.chatId, { sessionId: sid || undefined }),
        onBranchRename: (branch) =>
          updateAgentInStorage(agent.id, { branch, autoNamedBranch: false }),
        onChatRename: (label) => updateChatSession(queued.chatId, { label }),
      })
    }
  }, [agents, roomId, updateAgentInStorage, updateChatSession])

  // Seed artboards for agents whose sandbox has finished provisioning but who
  // don't yet have a frame on the canvas. Parallel-create defers seeding to
  // here so frames don't appear before their previewDomain is known —
  // otherwise the artboard renders with an undefined iframeUrl/branch until
  // the pipeline finishes (`agentDomains` keys off `previewDomain`).
  // Single-agent flows seed the artboard immediately at create time, so this
  // is a no-op for them. Also recovers correctly across page reloads
  // mid-creation.
  useEffect(() => {
    const pending = agents.filter(
      (a) =>
        a.status === "running" &&
        a.previewDomain &&
        !artboards.some((ab) => ab.sandboxId === a.id),
    )
    if (pending.length === 0) return
    const { cx, cy } = getViewportCenter()
    // Seed one per tick — `seedArtboardForAgent` reads the Yjs snapshot for
    // layout, and the snapshot only refreshes after the previous mutation
    // settles. Letting React re-render between seeds avoids stacking groups.
    collections.transact(() => {
      seedArtboardForAgent(pending[0]!.id, { x: cx, y: cy })
    })
  }, [agents, artboards, collections, getViewportCenter, seedArtboardForAgent])

  // Hydrate chatStore streaming state from Liveblocks storage on mount/reconnect.
  // For each chat that's marked streaming in storage, also ask the server to
  // verify the underlying Anthropic session is still actually running. If it's
  // idle/terminated, the heal endpoint broadcasts chat-stream-end to unstick
  // the spinner — handles cases where a previous stream died before signalling.
  useEffect(() => {
    for (const cs of chatSessions) {
      if (!cs.isStreaming) continue
      chatStore.setStreaming(cs.id, true)
      if (cs.sessionId) {
        fetch("/api/agent/heal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomId,
            chatId: cs.id,
            sessionId: cs.sessionId,
          }),
        }).catch((e) => console.error("Heal request failed:", e))
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only on mount

  // Receive server-broadcast chat events via the room Y.Doc and feed into chat store.
  useChatStreamEvents((e) => {
    chatStore.handleBroadcastEvent(e)
    // Mirror streaming state into the chat session so late joiners see it.
    if (e.type === "chat-stream-start") {
      updateChatSession(e.chatId, { isStreaming: true })
    } else if (e.type === "chat-stream-end") {
      updateChatSession(e.chatId, { isStreaming: false })
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
        fetch("/api/agent/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            flow: "from-branch",
            roomId,
            agentId: agent.id,
            sandboxName: agent.sandboxName,
            branch: agent.branch,
            workspaceId: agent.workspaceId,
          }),
        })
        continue
      }

      if (!agent.sandboxName) continue

      // Covers normal reloads and restarts (status === "starting") that were
      // interrupted by a page reload. reconnectSandbox probes the existing
      // sandbox first, so it won't recreate one that's already running.
      const workspace = workspaces.find((w) => w.id === agent.workspaceId)
      const sandboxName = agent.sandboxName
      reconnectSandbox(sandboxName, agent.port, workspace?.devScript).then((result) => {
        if (result.status === "running") {
          updateAgentInStorage(agent.id, {
            previewDomain: result.previewDomain,
            status: "running",
            statusMessage: "",
            error: "",
          })
          return
        }
        // Resume failed — likely the snapshot has fully expired (>24h) and
        // been deleted. Auto-recreate from git instead of stranding the user
        // at "stopped" waiting to click refresh.
        if (!workspace) {
          updateAgentInStorage(agent.id, {
            status: "stopped",
            statusMessage: "",
            error: "Workspace not found — click refresh to retry",
          })
          return
        }
        updateAgentInStorage(agent.id, {
          status: "starting",
          statusMessage: "Recreating expired sandbox…",
          error: "",
        })
        restartSandbox(sandboxName, workspace, agent.branch).then((restartResult) => {
          updateAgentInStorage(agent.id, {
            sandboxName: restartResult.sandboxName,
            previewDomain: restartResult.previewDomain || agent.previewDomain,
            status: restartResult.status === "running" ? "running" : "stopped",
            statusMessage: "",
            error: restartResult.status === "running"
              ? ""
              : restartResult.error || "Sandbox could not be restarted — click refresh to retry",
          })
        })
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, workspaces, updateAgentInStorage, roomId])

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
    const followed = others.find(
      (o) => o.clientId === followingConnectionId,
    )
    // If the user we're following disconnected, stop following
    if (!followed) {
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

  // Cross-origin iframes inside an artboard can cause the browser to walk up
  // the ancestor chain calling `scrollIntoView` (e.g. when their content
  // autofocuses an input). `overflow: hidden` does not block programmatic
  // scrolling, so the canvas wrapper / transform wrapper silently drift from
  // (0, 0) and the rendered canvas slides off-axis from the transform state.
  // Pin both elements' scroll positions to 0 on every scroll event.
  useEffect(() => {
    const el = canvasWrapperRef.current
    if (!el) return

    const transformWrapper = el.querySelector<HTMLElement>(
      ".react-transform-wrapper",
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
      if (focusedArtboardId !== null) return
      if (createFlowArtboardId !== null) return
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
  }, [focusedArtboardId, createFlowArtboardId, followingConnectionId])

  // Convert screen coordinates to canvas coordinates
  const screenToCanvas = useCallback((clientX: number, clientY: number, rect: DOMRect) => {
    const ref = transformRef.current
    if (!ref) return { x: 0, y: 0 }
    const { positionX, positionY, scale } = ref.state
    return {
      x: (clientX - rect.left - positionX) / scale,
      y: (clientY - rect.top - positionY) / scale,
    }
  }, [])

  /**
   * Gap-handle hit test runs in the *capture* phase so it fires before the
   * artboard overlay's `onPointerDown` (which `stopPropagation`s and captures
   * the pointer). Without this the gap handle is unreachable once the gap
   * collapses to 0 — the cursor is then over an artboard, and the artboard's
   * drag hook grabs the pointer first.
   */
  const handleCanvasPointerDownCapture = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 || spaceHeld || focusedArtboardId !== null) return
      if (commentMode || textMode || frameMode) return
      const target = e.target as HTMLElement
      if (!e.currentTarget.contains(target)) return

      const rect = e.currentTarget.getBoundingClientRect()
      const canvas = screenToCanvas(e.clientX, e.clientY, rect)

      // Reorder dots take priority — they sit over the artboard center, so the
      // artboard's overlay would otherwise grab the pointer first.
      if (reorderHandlesRef.current.length > 0) {
        const reorderHit = hitTestReorderHandle(canvas.x, canvas.y, zoom)
        if (reorderHit) {
          const group = artboardGroups.find((g) => g.artboardIds.includes(reorderHit.artboardId))
          if (group) {
            reorderDragRef.current = { groupId: group.id, artboardId: reorderHit.artboardId }
            setReorderDraggingArtboardId(reorderHit.artboardId)
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
      const group = collections.artboardGroups.get(hit.groupId)
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
    [spaceHeld, focusedArtboardId, commentMode, textMode, frameMode, screenToCanvas, hitTestGapHandle, hitTestReorderHandle, zoom, collections, artboardGroups],
  )

  // Marquee selection / text-tool draft: pointerdown on empty canvas starts the interaction
  const handleCanvasPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 || spaceHeld || focusedArtboardId !== null) return
      const target = e.target as HTMLElement
      // React forwards events from portaled children (dropdowns, dialogs, popovers)
      // through the React tree even though the DOM target lives on document.body.
      // Ignore those so we don't capture the pointer and swallow the child's click.
      if (!e.currentTarget.contains(target)) return
      // Gap drag has already been claimed by `onPointerDownCapture`; nothing to
      // do here — the early-return below would have skipped it anyway.
      if (gapDragRef.current) return

      if (target.closest("[data-artboard]") || target.closest("[data-text-layer]") || target.closest("button") || target.closest("a")) return

      // Text tool: start a draft rectangle (click or click+drag)
      if (textMode) {
        const rect = e.currentTarget.getBoundingClientRect()
        const canvas = screenToCanvas(e.clientX, e.clientY, rect)
        textDraftRef.current = { startX: canvas.x, startY: canvas.y, currentX: canvas.x, currentY: canvas.y }
        setTextDraft(textDraftRef.current)
        e.currentTarget.setPointerCapture(e.pointerId)
        return
      }

      // Frame tool: start a draft rectangle (click for default size, drag for custom)
      if (frameMode) {
        const rect = e.currentTarget.getBoundingClientRect()
        const canvas = screenToCanvas(e.clientX, e.clientY, rect)
        frameDraftRef.current = { startX: canvas.x, startY: canvas.y, currentX: canvas.x, currentY: canvas.y }
        setFrameDraft(frameDraftRef.current)
        e.currentTarget.setPointerCapture(e.pointerId)
        return
      }

      if (commentMode) return
      // Ignore clicks near the left/right edges so resize-handle grabs don't start a marquee
      const wrapperRect = e.currentTarget.getBoundingClientRect()
      if (e.clientX - wrapperRect.left < 8 || wrapperRect.right - e.clientX < 8) return

      const rect = e.currentTarget.getBoundingClientRect()
      const canvas = screenToCanvas(e.clientX, e.clientY, rect)
      marqueeRef.current = {
        startX: canvas.x,
        startY: canvas.y,
        shiftKey: e.shiftKey,
        baseArtboards: new Set(selectedArtboardIds),
        baseTextLayers: new Set(selectedTextLayerIds),
      }
      setMarquee({ startX: canvas.x, startY: canvas.y, currentX: canvas.x, currentY: canvas.y })
      setSelectedGroupIds(new Set())
      if (!e.shiftKey) {
        setSelectedArtboardIds(new Set())
        setSelectedTextLayerIds(new Set())
      }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [spaceHeld, commentMode, focusedArtboardId, textMode, frameMode, screenToCanvas, selectedArtboardIds, selectedTextLayerIds, hitTestGapHandle, zoom, collections],
  )

  const handleCanvasPointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Reorder drag: cursor X picks the destination index by walking the
      // current sibling centers in order. Layouts get rebuilt when we update
      // artboardIds, so subsequent ticks see the new arrangement.
      if (reorderDragRef.current) {
        const rect = e.currentTarget.getBoundingClientRect()
        const canvas = screenToCanvas(e.clientX, e.clientY, rect)
        const drag = reorderDragRef.current
        const popped = e.metaKey
        setReorderDragPopped(popped)
        setReorderDragCursor({ x: canvas.x, y: canvas.y })
        // Holding meta previews popping the artboard out into a new group.
        // The actual data update is deferred until pointer-up so releasing
        // without meta still leaves the source group as-is.
        if (popped) return

        const group = collections.artboardGroups.get(drag.groupId)
        if (!group) return
        const ids = group.artboardIds
        const currentIndex = ids.indexOf(drag.artboardId)
        if (currentIndex < 0) return

        const gap = groupGap(group)
        let walkX = group.x
        const siblingCenters: { id: string; centerX: number }[] = []
        for (const id of ids) {
          const ab = collections.artboards.get(id)
          if (!ab) continue
          if (id !== drag.artboardId) {
            siblingCenters.push({ id, centerX: walkX + ab.width / 2 })
          }
          walkX += ab.width + gap
        }

        let newIndex = siblingCenters.length
        for (let i = 0; i < siblingCenters.length; i++) {
          if (canvas.x < siblingCenters[i]!.centerX) {
            newIndex = i
            break
          }
        }
        if (newIndex !== currentIndex) {
          const without = ids.filter((id) => id !== drag.artboardId)
          without.splice(newIndex, 0, drag.artboardId)
          reorderGroupArtboards(drag.groupId, without)
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

      // Text-tool draft tracking
      if (textDraftRef.current) {
        const rect = e.currentTarget.getBoundingClientRect()
        const canvas = screenToCanvas(e.clientX, e.clientY, rect)
        const next = { ...textDraftRef.current, currentX: canvas.x, currentY: canvas.y }
        textDraftRef.current = next
        setTextDraft(next)
        return
      }

      // Frame-tool draft tracking
      if (frameDraftRef.current) {
        const rect = e.currentTarget.getBoundingClientRect()
        const canvas = screenToCanvas(e.clientX, e.clientY, rect)
        const next = { ...frameDraftRef.current, currentX: canvas.x, currentY: canvas.y }
        frameDraftRef.current = next
        setFrameDraft(next)
        return
      }

      if (!marqueeRef.current) return
      const start = marqueeRef.current
      const rect = e.currentTarget.getBoundingClientRect()
      const canvas = screenToCanvas(e.clientX, e.clientY, rect)
      setMarquee((m) => m ? { ...m, currentX: canvas.x, currentY: canvas.y } : null)

      // Live hit-testing during drag
      const left = Math.min(start.startX, canvas.x)
      const top = Math.min(start.startY, canvas.y)
      const right = Math.max(start.startX, canvas.x)
      const bottom = Math.max(start.startY, canvas.y)

      const abHits = new Set<string>()
      for (const layout of artboardLayouts.values()) {
        if (
          layout.x < right &&
          layout.x + layout.width > left &&
          layout.y < bottom &&
          layout.y + layout.height > top
        ) {
          abHits.add(layout.id)
        }
      }
      const txtHits = new Set<string>()
      for (const t of textLayers) {
        const el = document.getElementById(`text-layer-${t.id}`)
        const w = t.autoWidth ? (el?.offsetWidth ?? t.width) : t.width
        const h = el?.offsetHeight ?? 24
        if (t.x < right && t.x + w > left && t.y < bottom && t.y + h > top) {
          txtHits.add(t.id)
        }
      }

      if (start.shiftKey) {
        const nextAb = new Set(start.baseArtboards)
        for (const id of abHits) {
          if (nextAb.has(id)) nextAb.delete(id)
          else nextAb.add(id)
        }
        setSelectedArtboardIds(nextAb)
        const nextTxt = new Set(start.baseTextLayers)
        for (const id of txtHits) {
          if (nextTxt.has(id)) nextTxt.delete(id)
          else nextTxt.add(id)
        }
        setSelectedTextLayerIds(nextTxt)
      } else {
        setSelectedArtboardIds(abHits)
        setSelectedTextLayerIds(txtHits)
      }
    },
    [screenToCanvas, artboardLayouts, textLayers, setGroupGap, collections, reorderGroupArtboards],
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
        setReorderDraggingArtboardId(null)
        setReorderDragCursor(null)
        setReorderDragPopped(false)

        // Meta still held at release → commit the pop: detach from the source
        // group and create a new single-artboard group anchored at the cursor.
        if (e.metaKey) {
          const ab = collections.artboards.get(drag.artboardId)
          const sourceGroup = collections.artboardGroups.get(drag.groupId)
          if (ab && sourceGroup && sourceGroup.artboardIds.includes(drag.artboardId)) {
            const newGroupId = nanoid()
            const newGroupName = `Group ${nextGroupNumber(collections.artboardGroups.toArray())}`
            const remaining = sourceGroup.artboardIds.filter((id) => id !== drag.artboardId)
            collections.transact(() => {
              collections.artboardGroups.update(drag.groupId, { artboardIds: remaining })
              collections.artboardGroups.set(newGroupId, {
                id: newGroupId,
                name: newGroupName,
                x: canvas.x - ab.width / 2,
                y: canvas.y - ab.height / 2,
                artboardIds: [drag.artboardId],
              })
            })
            // Move selection to the new group so the source group's reorder
            // dots disappear and the popped artboard is now the focus.
            setSelectedGroupIds(new Set([newGroupId]))
          }
        }

        const hit = hitTestReorderHandle(canvas.x, canvas.y, zoom)
        setHoveredReorderArtboardId(hit?.artboardId ?? null)
        return
      }

      // Gap-handle drag: end interaction
      if (gapDragRef.current) {
        gapDragRef.current = null
        return
      }

      // Text-tool: release creates a new text layer
      if (textDraftRef.current) {
        const d = textDraftRef.current
        textDraftRef.current = null
        setTextDraft(null)
        const dx = d.currentX - d.startX
        const dy = d.currentY - d.startY
        const id = nanoid()
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
          addTextLayer({ id, x: d.startX, y: d.startY, width: 200, autoWidth: true })
        } else {
          addTextLayer({
            id,
            x: Math.min(d.startX, d.currentX),
            y: Math.min(d.startY, d.currentY),
            width: Math.max(40, Math.abs(dx)),
            autoWidth: false,
          })
        }
        setTextMode(false)
        setSelectedArtboardIds(new Set())
        setSelectedTextLayerIds(new Set([id]))
        setEditingTextLayerId(id)
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
          w = DEFAULT_ARTBOARD_WIDTH
          h = DEFAULT_ARTBOARD_HEIGHT
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
        setSelectedTextLayerIds(new Set())
        setSelectedArtboardIds(new Set([id]))
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
          setSelectedArtboardIds(new Set())
          setSelectedTextLayerIds(new Set())
        }
      }
    },
    [screenToCanvas, addTextLayer, addFrame, hitTestReorderHandle, zoom],
  )

  // Click on artboard to select. Clicking a child frame whose parent group is
  // currently selected pierces — the click moves selection to the child. To
  // keep group drag working, callers must skip selection on pointerdown when
  // the group is selected (see Artboard.onPointerDownCapture).
  const handleArtboardSelect = useCallback(
    (id: string, shiftKey: boolean) => {
      setSelectedGroupIds(new Set())
      if (shiftKey) {
        setSelectedArtboardIds((prev) => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      } else {
        setSelectedArtboardIds(new Set([id]))
        setSelectedTextLayerIds(new Set())
      }
    },
    [],
  )

  const handleGroupSelect = useCallback(
    (groupId: string, shiftKey: boolean) => {
      setSelectedArtboardIds(new Set())
      setSelectedTextLayerIds(new Set())
      if (shiftKey) {
        setSelectedGroupIds((prev) => {
          const next = new Set(prev)
          if (next.has(groupId)) next.delete(groupId)
          else next.add(groupId)
          return next
        })
      } else {
        setSelectedGroupIds(new Set([groupId]))
      }
    },
    [],
  )

  const handleTextLayerSelect = useCallback(
    (id: string, shiftKey: boolean) => {
      if (shiftKey) {
        setSelectedTextLayerIds((prev) => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      } else {
        setSelectedTextLayerIds(new Set([id]))
        setSelectedArtboardIds(new Set())
      }
    },
    [],
  )

  const handleMoveSelected = useCallback(
    (dx: number, dy: number) => {
      const abIds = Array.from(selectedArtboardIdsRef.current)
      const txtIds = Array.from(selectedTextLayerIdsRef.current)
      if (abIds.length > 0) moveArtboardsByDelta(abIds, dx, dy)
      if (txtIds.length > 0) moveTextLayersByDelta(txtIds, dx, dy)
    },
    [moveArtboardsByDelta, moveTextLayersByDelta],
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

      // Hit-test for hover highlight. Suppressed while a reorder drag is
      // active so the dragged artboard sweeping over its siblings doesn't
      // paint a hover outline on each one in turn.
      let hovered: string | null = null
      if (!reorderDragRef.current) {
        for (const layout of artboardLayouts.values()) {
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
      setHoveredArtboardId(hovered)

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
        if (prev && next && prev.groupId === next.groupId && prev.gapIndex === next.gapIndex) return prev
        return next
      })

      // Track which reorder handle is hovered so the overlay can swap the dot
      // from a hollow ring to a filled circle. While dragging, lock the
      // highlight to the dragged dot so the cursor can stray off-center
      // without the dot flipping back to its hollow state.
      if (reorderDragRef.current) {
        setHoveredReorderArtboardId((prev) =>
          prev === reorderDragRef.current!.artboardId ? prev : reorderDragRef.current!.artboardId,
        )
      } else {
        const reorderHit = hitTestReorderHandle(canvasX, canvasY, scale)
        setHoveredReorderArtboardId((prev) => {
          const nextId = reorderHit?.artboardId ?? null
          return prev === nextId ? prev : nextId
        })
      }
    },
    [setPresence, artboardLayouts, hitTestGapHandle, hitTestReorderHandle],
  )

  const handlePointerLeave = useCallback(() => {
    setPresence({ pointer: null })
    setHoveredArtboardId(null)
    setActiveGapHandle(null)
    setHoveredReorderArtboardId(null)
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

      // Hit-test against artboard bounds — store offset relative to artboard.
      // The iframe fills the artboard div with no transform, so artboard-local
      // coordinates equal iframe-viewport coordinates and can be passed
      // directly to the bridge's elementAtPoint.
      for (const layout of artboardLayouts.values()) {
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
          setNewCommentPos({ x: localX, y: localY, artboardId: layout.id })
          const dom = getArtboardDom(layout.id)
          if (dom) {
            dom
              .elementAtPoint(localX, localY)
              .then((result) => {
                if (!result) return
                // Store offsets as fractions of the element's width/height so
                // the pin tracks the same relative point as the element
                // resizes with the artboard / page reflow. Falls back to 0
                // for zero-sized elements (no meaningful relative position).
                const w = result.rect.width
                const h = result.rect.height
                const offsetX = w > 0 ? (localX - result.rect.x) / w : 0
                const offsetY = h > 0 ? (localY - result.rect.y) / h : 0
                setNewCommentPos((prev) => {
                  if (!prev || prev.artboardId !== layout.id) return prev
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
    [commentMode, artboardLayouts, getArtboardDom],
  )

  // Broadcast selection to other users via presence
  useEffect(() => {
    setPresence({
      selectedArtboardIds: Array.from(selectedArtboardIds),
      selectedTextLayerIds: Array.from(selectedTextLayerIds),
    })
  }, [selectedArtboardIds, selectedTextLayerIds, setPresence])

  // Collect other users' selections for the overlay
  const othersSelections = others.map(({ presence }) => ({
    selectedArtboardIds: presence.selectedArtboardIds ?? [],
    selectedTextLayerIds: presence.selectedTextLayerIds ?? [],
    color: presence.color,
    name: presence.identity.name || "Anonymous",
  }))

  // Auto-select the first running agent when none is selected. Booting
  // agents aren't picked here — a LogProbe (rendered for each pending id)
  // promotes them once their sandbox is streaming logs, which avoids the
  // "switch to empty panel then hang on 'Connecting…'" flicker.
  useEffect(() => {
    if (selectedAgentId && agents.some((a) => a.id === selectedAgentId)) return
    const firstRunning = agents.find((a) => a.status === "running" && a.sandboxName)
    if (firstRunning) setSelectedAgentId(firstRunning.id)
  }, [selectedAgentId, agents])

  const handlePendingReady = useCallback((id: string) => {
    setSelectedAgentId(id)
    setPendingAgentIds((prev) => prev.filter((p) => p !== id))
  }, [])

  const selectedAgent = agents.find((a) => a.id === selectedAgentId)
  const [chatCollapsed, setChatCollapsed] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

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
    <ResizablePanelGroup orientation="horizontal" className="fixed inset-0 bg-muted/30" defaultLayout={initialLayout} onLayoutChanged={onLayoutChanged}>
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
        <AgentSidebar
          workspaces={workspaces}
          agents={agents}
          artboards={artboards}
          artboardGroups={sortedArtboardGroups}
          selectedArtboardIds={selectedArtboardIds}
          selectedGroupIds={selectedGroupIds}
          onSelectGroup={handleGroupSelect}
          onSelectAgent={handleSelectAgent}
          onCreateWorkspace={handleCreateWorkspace}
          onUpdateWorkspace={updateWorkspaceInStorage}
          onRemoveWorkspace={async (id, { deleteBranchesOnRemote }) => {
            if (deleteBranchesOnRemote) {
              const workspace = workspaces.find((w) => w.id === id)
              if (workspace) {
                const branches = agents
                  .filter((a) => a.workspaceId === id && a.branch)
                  .map((a) => a.branch)
                const results = await Promise.all(
                  branches.map((branch) =>
                    deleteBranch(workspace.repoOwner, workspace.repoName, branch),
                  ),
                )
                const failed = results.filter((r) => !r.success)
                if (failed.length > 0) {
                  throw new Error(
                    failed[0]?.error ??
                      `Failed to delete ${failed.length} branch${failed.length === 1 ? "" : "es"} on remote`,
                  )
                }
              }
            }
            removeWorkspaceFromStorage(id)
          }}
          onCreateAgent={handleCreateAgent}
          onCreateAgentFromBranch={handleCreateAgentFromBranch}
          onCreateParallelAgents={handleCreateParallelAgents}
          onDuplicateBranch={handleDuplicateBranch}
          onForkAgent={handleForkAgent}
          onRebaseOnDefault={handleRebaseOnDefault}
          onRefreshAgent={handleRefreshAgent}
          onRemoveAgent={async (id, { deleteOnRemote }) => {
            if (deleteOnRemote) {
              const agent = agents.find((a) => a.id === id)
              const workspace = agent
                ? workspaces.find((w) => w.id === agent.workspaceId)
                : undefined
              if (agent?.branch && workspace) {
                const result = await deleteBranch(
                  workspace.repoOwner,
                  workspace.repoName,
                  agent.branch,
                )
                if (!result.success) {
                  throw new Error(
                    result.error ?? "Failed to delete branch on remote",
                  )
                }
              }
            }
            if (selectedAgentId === id) {
              setSelectedAgentId(null)
              setSelectedChatId(null)
              chatPanelRef.current?.collapse()
            }
            chatSessions
              .filter((c) => c.agentId === id)
              .forEach((c) => chatStore.cleanup(c.id))
            removeAgentFromStorage(id)
          }}
          onAddArtboard={handleAddArtboardForAgent}
          onPlayAgent={handlePlayAgent}
          onShowRoutes={handleShowRoutesForAgent}
          onUpdateAgent={updateAgentInStorage}
          onRenameBranch={handleBranchRename}
          onSelectArtboard={handleArtboardSelect}
          onZoomToArtboard={handleSelectArtboard}
          onRenameArtboard={renameArtboard}
          onRouteChange={updateArtboardRoute}
          onRemoveArtboard={removeArtboard}
          onReorderArtboardGroups={reorderArtboardGroups}
          onReorderGroupArtboards={reorderGroupArtboards}
          onRenameArtboardGroup={renameArtboardGroup}
          onRemoveArtboardGroup={removeArtboardGroup}
          onCollapseSidebar={() => sidebarPanelRef.current?.collapse()}
          activeAgentIds={new Set(chatSessions.filter((c) => c.isStreaming && !c.closedAt).map((c) => c.agentId))}
          chatPanelAgentId={chatCollapsed ? null : selectedAgentId}
        />
      </ResizablePanel>
      <ResizableHandle className="focus-visible:ring-0" />

      {/* Canvas */}
      <ResizablePanel id="canvas">
            <div
              className="relative h-full w-full"
              data-canvas-wrapper
              ref={canvasWrapperRef}
              style={{ clipPath: "inset(0)", cursor: isPanning ? "grabbing" : spaceHeld ? "grab" : textMode ? "text" : frameMode || commentMode ? "crosshair" : activeGapHandle ? "col-resize" : reorderDraggingArtboardId ? "grabbing" : hoveredReorderArtboardId ? "grab" : undefined }}
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
                so the artboard iframes paint on top — the parts of each ghost
                that extend past the active artboard remain visible. Same
                screen-space canvas approach as SelectionOverlay so the 1px
                outlines stay crisp at any zoom. */}
            <ResizeSnapUnderlay
              zoom={zoom}
              viewportPos={viewportPos}
              artboardRect={(() => {
                if (!resizeSnap) return null
                const layout = effectiveArtboardLayouts.get(resizeSnap.artboardId)
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
                  focusedArtboardId !== null ||
                  createFlowArtboardId !== null ||
                  editingTextLayerId !== null,
                allowLeftClickPan: spaceHeld,
                allowMiddleClickPan: true,
              }}
              onInit={(ref) => {
                if (!viewportRestoredRef.current && savedViewport) {
                  viewportRestoredRef.current = true
                  ref.setTransform(savedViewport.x, savedViewport.y, savedViewport.zoom, 0)
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
              onPanningStart={() => { handleFollowBreak(); setIsPanning(true) }}
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

                  {artboardGroups.map((group) => {
                    const groupArtboards = group.artboardIds
                      .map((id) => artboards.find((a) => a.id === id))
                      .filter((a): a is NonNullable<typeof a> => a !== undefined)
                    const groupSelected = selectedGroupIds.has(group.id)
                    // Placeholder shows only when an artboard inside the group
                    // is selected — selecting the whole group hides it.
                    const hasSelectedFrame = groupArtboards.some((a) => selectedArtboardIds.has(a.id))
                    const showGroupLabel = groupArtboards.length > 1
                    const groupLabel = showGroupLabel
                      ? groupDisplayNames.get(group.id)
                      : undefined
                    // Render artboards in a stable DOM order (sorted by id)
                    // and use CSS `order` to place them visually. Reordering
                    // an iframe's DOM position forces it to reload, so we
                    // never want React to insertBefore an iframe element.
                    const stableArtboards = [...groupArtboards].sort((a, b) =>
                      a.id.localeCompare(b.id),
                    )
                    return (
                      <ArtboardGroup
                        key={group.id}
                        group={group}
                        artboards={groupArtboards}
                        hasSelectedArtboard={hasSelectedFrame}
                        onAddArtboard={(groupId) => {
                          const newId = addArtboardToGroup(groupId)
                          if (newId) {
                            setSelectedArtboardIds(new Set([newId]))
                            setSelectedGroupIds(new Set())
                            setSelectedTextLayerIds(new Set())
                          }
                        }}
                      >
                        {stableArtboards.map((artboard) => {
                          const flexOrder = group.artboardIds.indexOf(artboard.id)
                          const agentInfo = artboard.sandboxId ? agentDomains[artboard.sandboxId] : undefined
                          let dragTranslateX: number | undefined
                          let dragTranslateY: number | undefined
                          let dragPopped: { left: number; top: number } | undefined
                          if (
                            reorderDraggingArtboardId === artboard.id &&
                            reorderDragCursor != null
                          ) {
                            if (reorderDragPopped) {
                              // Absolutely position the artboard inside its (still-current) group
                              // so flex flow drops it and siblings close the gap visually.
                              dragPopped = {
                                left: reorderDragCursor.x - group.x - artboard.width / 2,
                                top: reorderDragCursor.y - group.y - artboard.height / 2,
                              }
                            } else {
                              const layout = artboardLayouts.get(artboard.id)
                              if (layout) {
                                dragTranslateX = reorderDragCursor.x - (layout.x + layout.width / 2)
                                dragTranslateY = reorderDragCursor.y - (layout.y + layout.height / 2)
                              }
                            }
                          }
                          return (
                            <Artboard
                              key={artboard.id}
                              artboard={{
                                ...artboard,
                                iframeUrl: agentInfo?.previewDomain,
                                branch: agentInfo?.branch,
                              }}
                              zoom={zoom}
                              focused={focusedArtboardId === artboard.id}
                              createFlow={createFlowArtboardId === artboard.id}
                              selected={selectedArtboardIds.has(artboard.id)}
                              onFocus={(id) => {
                                setFocusedArtboardId(id)
                                if (id !== null) setCreateFlowArtboardId(null)
                              }}
                              onToggleCreateFlow={(id) => {
                                setCreateFlowArtboardId(id)
                                if (id !== null) setFocusedArtboardId(null)
                              }}
                              onSelect={handleArtboardSelect}
                              onMoveGroup={(dx, dy) => moveArtboardsByDelta([artboard.id], dx, dy)}
                              onMoveSelected={handleMoveSelected}
                              onResize={resizeArtboardEdge}
                              onResizeStart={handleResizeStart}
                              onResizeEnd={handleResizeEnd}
                              onRemove={removeArtboard}
                              onStateChanged={updateArtboardState}
                              onRouteChange={updateArtboardRoute}
                              onScrollChange={updateArtboardScroll}
                              onKnobsDeclared={updateArtboardKnobs}
                              onKnobValuesChange={updateArtboardKnobValues}
                              onSharedStateChanged={updateArtboardSharedState}
                              onPlay={artboard.sandboxId ? handlePlayArtboard : undefined}
                              onFitToContent={fitArtboardToContent}
                              multiSelected={selectedArtboardIds.size + selectedTextLayerIds.size > 1}
                              spaceHeld={spaceHeld}
                              commentMode={commentMode}
                              onHover={handleInspectHover}
                              onDomReady={handleArtboardDomReady}
                              assignableAgents={runningAgents}
                              onAssignAgent={assignAgentToArtboard}
                              discoveredRoutes={agentInfo?.discoveredRoutes}
                              onSelectRoute={updateArtboardRoute}
                              groupLabel={flexOrder === 0 ? groupLabel : undefined}
                              groupSelected={groupSelected}
                              onSelectGroup={
                                flexOrder === 0 && showGroupLabel
                                  ? (shiftKey) => handleGroupSelect(group.id, shiftKey)
                                  : undefined
                              }
                              flexOrder={flexOrder}
                              dragTranslateX={dragTranslateX}
                              dragTranslateY={dragTranslateY}
                              dragPopped={dragPopped}
                            />
                          )
                        })}
                      </ArtboardGroup>
                    )
                  })}

                  {textLayers.map((layer) => (
                    <TextLayer
                      key={layer.id}
                      layer={layer}
                      zoom={zoom}
                      selected={selectedTextLayerIds.has(layer.id)}
                      multiSelected={selectedArtboardIds.size + selectedTextLayerIds.size > 1}
                      editing={editingTextLayerId === layer.id}
                      spaceHeld={spaceHeld}
                      userName={self?.identity.name || "Anonymous"}
                      userColor={self?.color || "#888888"}
                      onSelect={handleTextLayerSelect}
                      onMove={moveTextLayer}
                      onMoveSelected={handleMoveSelected}
                      onResize={resizeTextLayer}
                      onSetAutoWidth={setTextLayerAutoWidth}
                      onStartEdit={setEditingTextLayerId}
                      onStopEdit={() => setEditingTextLayerId(null)}
                      workspaces={workspaces}
                      agents={agents}
                      onSubmitAsPlan={agents.length > 0 ? handleSubmitAsPlan : undefined}
                    />
                  ))}

                </div>
              </TransformComponent>

            </TransformWrapper>

              {/* Comment pins live in their own screen-space layer above the
                  selection overlay so pins/popovers aren't painted over by it.
                  The transform mirrors what TransformComponent applies, so the
                  children still position in world coordinates. */}
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
                  artboards={Array.from(artboardLayouts.values())}
                  getArtboardDom={getArtboardDom}
                  initialThreads={initialThreads}
                  onSendToChat={handleCommentSendToChat}
                />
              </div>

              <SelectionOverlay
                zoom={zoom}
                viewportPos={viewportPos}
                selectedArtboardIds={selectedArtboardIds}
                groupSelectedArtboardIds={groupSelectedArtboardIds}
                selectedTextLayerIds={selectedTextLayerIds}
                focusedArtboardId={focusedArtboardId}
                hoveredArtboardId={hoveredArtboardId}
                artboardLayouts={effectiveArtboardLayouts}
                placeholderRects={placeholderRects}
                gapHandles={gapHandles}
                reorderHandles={reorderHandles}
                hoveredReorderArtboardId={hoveredReorderArtboardId}
                reorderDragShift={(() => {
                  // While popped, the dragged artboard's effective layout is
                  // already centered on the cursor — no extra shift needed.
                  if (!reorderDraggingArtboardId || !reorderDragCursor || reorderDragPopped) return null
                  const layout = artboardLayouts.get(reorderDraggingArtboardId)
                  if (!layout) return null
                  return {
                    artboardId: reorderDraggingArtboardId,
                    dx: reorderDragCursor.x - (layout.x + layout.width / 2),
                    dy: reorderDragCursor.y - (layout.y + layout.height / 2),
                  }
                })()}
                textLayers={textLayers}
                marquee={marquee}
                textDraft={textDraft}
                frameDraft={frameDraft}
                othersSelections={othersSelections}
                inspectRect={(() => {
                  // Show the live hover overlay while in commentMode so the
                  // user can see what element they're about to anchor to.
                  const source = commentMode ? inspectHover : null
                  if (!source) return null
                  const layout = artboardLayouts.get(source.artboardId)
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
              <div className="pointer-events-none absolute left-0 top-0 z-[9998] flex h-12 items-center px-2">
                <div className="pointer-events-auto flex items-center gap-1 rounded-lg bg-background p-1 shadow-md outline outline-1 outline-foreground/5" onClick={(e) => e.stopPropagation()}>
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
                            router.push("/")
                          }}
                        >
                          {parentFolderName}
                        </BreadcrumbLink>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator className="text-muted-foreground/60">/</BreadcrumbSeparator>
                      <BreadcrumbItem className="gap-0">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs font-medium text-foreground">
                              {currentProjectName}
                              <ChevronDown className="h-3 w-3 opacity-60" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuItem
                              onSelect={() => {
                                setRenameDraft(currentProjectName)
                                setRenameDialogOpen(true)
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Rename
                            </DropdownMenuItem>
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
                  <Dialog
                    open={renameDialogOpen}
                    onOpenChange={(next) => {
                      if (renaming) return
                      setRenameDialogOpen(next)
                    }}
                  >
                    <DialogContent className="sm:max-w-md">
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault()
                          const trimmed = renameDraft.trim() || "Untitled"
                          setRenaming(true)
                          try {
                            await renameProject(roomId, trimmed)
                            setCurrentProjectName(trimmed)
                            setRenameDialogOpen(false)
                          } finally {
                            setRenaming(false)
                          }
                        }}
                      >
                        <DialogHeader>
                          <DialogTitle>Rename project</DialogTitle>
                          <DialogDescription>
                            Give this project a new name.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="my-4">
                          <Input
                            autoFocus
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            placeholder="Untitled"
                          />
                        </div>
                        <DialogFooter>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setRenameDialogOpen(false)}
                            disabled={renaming}
                          >
                            Cancel
                          </Button>
                          <Button type="submit" disabled={renaming}>
                            {renaming ? "Saving…" : "Save"}
                          </Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
                  <DeleteProjectDialog
                    open={deleteDialogOpen}
                    onOpenChange={setDeleteDialogOpen}
                    projectName={currentProjectName}
                    onConfirm={async () => {
                      await deleteProject(roomId)
                      setDeleteDialogOpen(false)
                      router.push("/")
                    }}
                  />
                </div>
              </div>
              <div className="pointer-events-none absolute bottom-0 left-1/2 z-[9998] flex h-12 -translate-x-1/2 items-center px-2">
                <div className="pointer-events-auto flex items-center gap-1 rounded-lg bg-background p-1 shadow-md outline outline-1 outline-foreground/5" onClick={(e) => e.stopPropagation()}>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant={!commentMode && !textMode && !frameMode ? "default" : "ghost"}
                          size="icon-xs"
                          onClick={() => {
                            setCommentMode(false)
                            setNewCommentPos(null)
                            setInspectHover(null)
                            setTextMode(false)
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
                            setTextMode(false)
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
                          variant={textMode ? "default" : "ghost"}
                          size="icon-xs"
                          onClick={() => {
                            setTextMode((m) => !m)
                            setCommentMode(false)
                            setNewCommentPos(null)
                            setInspectHover(null)
                            setFrameMode(false)
                          }}
                        >
                          <Type className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        Text <Kbd>T</Kbd>
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant={commentMode ? "default" : "ghost"}
                          size="icon-xs"
                          onClick={() => {
                            setCommentMode((m) => !m)
                            setNewCommentPos(null)
                            setInspectHover(null)
                            setTextMode(false)
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
              <div className="pointer-events-none absolute right-0 top-0 z-[9998] flex h-12 items-center px-2">
                <div className="pointer-events-auto flex items-center gap-1 rounded-lg bg-background p-1 shadow-md outline outline-1 outline-foreground/5" onClick={(e) => e.stopPropagation()}>
                  <FollowingToolbar
                    followingId={followingConnectionId}
                    onFollow={setFollowingConnectionId}
                  />
                  <Button
                    size="sm"
                    onClick={() => setShareDialogOpen(true)}
                  >
                    Share
                  </Button>
                  <ShareProjectDialog
                    open={shareDialogOpen}
                    onOpenChange={setShareDialogOpen}
                    projectId={roomId}
                    projectName={currentProjectName}
                  />
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
            </div>
      </ResizablePanel>
      <ResizableHandle className={chatCollapsed ? "w-0 opacity-0" : "focus-visible:ring-0"} disabled={chatCollapsed} />

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
        {selectedAgent?.sandboxName ? (
          <ChatPanel
            agent={selectedAgent}
            agents={agents}
            onSelectAgent={handleSelectAgent}
            chatSessions={chatSessions.filter((c) => c.agentId === selectedAgentId)}
            selectedChatId={selectedChatId}
            roomId={roomId}
            onSelectChat={handleSelectChat}
            onCreateChat={() => handleCreateChat(selectedAgent.id)}
            onRenameChat={handleRenameChat}
            onRemoveChat={handleRemoveChat}
            onCloseChat={handleCloseChat}
            onReopenChat={handleReopenChat}
            onSessionId={(chatId, sid) => updateChatSession(chatId, { sessionId: sid || undefined })}
            onBranchRename={(branch) => handleBranchRename(selectedAgent.id, branch)}
            onPlanModeChange={(chatId, pm) => updateChatSession(chatId, { planMode: pm })}
            onModelChange={(chatId, model) => updateChatSession(chatId, { model })}
            diffStats={selectedAgentId ? diffStats.get(selectedAgentId) : undefined}
            onCollapse={() => chatPanelRef.current?.collapse()}
            onLogsReady={handleLogsReady}
          />
        ) : (
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
                {workspaces.length === 0 ? "No workspaces" : "No active agents"}
              </span>
            </div>
            <div className="border-b border-border" />
            <div className="flex flex-1 items-center justify-center px-6">
              <p className="text-sm text-muted-foreground">
                {workspaces.length === 0
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
