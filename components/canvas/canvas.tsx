"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchContentRef,
} from "react-zoom-pan-pinch"
import { nanoid } from "nanoid"
import { uniqueNamesGenerator, adjectives, colors, animals } from "unique-names-generator"
import { LiveObject } from "@liveblocks/client"
import {
  useEventListener,
  useHistory,
  useMutation,
  useOthers,
  useStorage,
  useUpdateMyPresence,
} from "@liveblocks/react/suspense"
import { MessageSquare, MousePointer2, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Kbd } from "@/components/ui/kbd"
import { Artboard } from "./artboard"
import { SelectionOverlay } from "./selection-overlay"
import { Comments } from "./comments"
import { Cursors } from "./cursors"
import { FollowingToolbar } from "./following-toolbar"
import type { JsonObject } from "@/lib/postmessage-protocol"
import { AgentSidebar } from "@/components/panels/agent-sidebar"
import { ChatPanel } from "@/components/agent/chat-panel"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable"
import { useDefaultLayout, type PanelImperativeHandle } from "react-resizable-panels"
import type { AgentData, ChatSessionData, ViewportData, WorkspaceData } from "@/lib/liveblocks.types"
import { chatStore, type ChatBroadcastEvent } from "@/lib/chat-store"
import type { GitHubRepo } from "@/lib/github-actions"
import { useDiffStats } from "@/hooks/use-diff-stats"
import {
  renameAgentBranch,
  restartSandbox,
  reconnectSandbox,
  keepAliveSandbox,
  crawlRoutes,
} from "@/lib/sandbox-actions"
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
  DEFAULT_ARTBOARD_WIDTH,
  DEFAULT_ARTBOARD_HEIGHT,
  CANVAS_SIZE,
} from "@/lib/constants"


export function Canvas({ roomId }: { roomId: string }) {
  const [zoom, setZoom] = useState(1)
  const [viewportPos, setViewportPos] = useState({ x: 0, y: 0 })
  const [focusedArtboardId, setFocusedArtboardId] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  // Per-workspace / per-agent memory so switching back restores prior selection
  const selectedAgentByWorkspaceRef = useRef<Record<string, string>>({})
  const selectedChatByAgentRef = useRef<Record<string, string>>({})
  const [followingConnectionId, setFollowingConnectionId] = useState<number | null>(null)
  const [commentMode, setCommentMode] = useState(false)
  const [newCommentPos, setNewCommentPos] = useState<{ x: number; y: number; artboardId?: string } | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [selectedArtboardIds, setSelectedArtboardIds] = useState<Set<string>>(new Set())
  const [hoveredArtboardId, setHoveredArtboardId] = useState<string | null>(null)
  const [marquee, setMarquee] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null)
  const marqueeRef = useRef<{ startX: number; startY: number; shiftKey: boolean; baseSelection: Set<string> } | null>(null)
  const transformRef = useRef<ReactZoomPanPinchContentRef>(null)
  const viewportRestoredRef = useRef(false)
  const sidebarPanelRef = useRef<PanelImperativeHandle>(null)
  const chatPanelRef = useRef<PanelImperativeHandle>(null)
  const updateMyPresence = useUpdateMyPresence()
  const others = useOthers()
  const history = useHistory()

  // Refs so keyboard handler stays current without re-binding
  const selectedArtboardIdsRef = useRef(selectedArtboardIds)
  selectedArtboardIdsRef.current = selectedArtboardIds
  const removeArtboardsRef = useRef<(ids: string[]) => void>(() => {})

  // Keyboard shortcuts
  useEffect(() => {
    const isEditing = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      return tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (commentMode || newCommentPos) {
          setCommentMode(false)
          setNewCommentPos(null)
        } else if (focusedArtboardId) {
          setFocusedArtboardId(null)
        } else {
          setSelectedArtboardIds(new Set())
        }
      }
      if (e.key === "v" && !e.metaKey && !e.ctrlKey && !isEditing(e)) {
        setCommentMode(false)
        setNewCommentPos(null)
      }
      if (e.key === "c" && !e.metaKey && !e.ctrlKey && !isEditing(e)) {
        setCommentMode((m) => !m)
        setNewCommentPos(null)
      }
      if (e.key === "b" && e.metaKey && !e.altKey) {
        e.preventDefault()
        const panel = sidebarPanelRef.current
        if (panel) {
          if (panel.isCollapsed()) panel.expand()
          else panel.collapse()
        }
      }
      if (e.key === "b" && e.metaKey && e.altKey) {
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
      // Delete/Backspace removes selected artboards
      if ((e.key === "Delete" || e.key === "Backspace") && !isEditing(e)) {
        const ids = selectedArtboardIdsRef.current
        if (ids.size > 0) {
          e.preventDefault()
          removeArtboardsRef.current(Array.from(ids))
          setSelectedArtboardIds(new Set())
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
  }, [commentMode, newCommentPos, focusedArtboardId, history])

  const artboards = useStorage((root) => {
    const result: Array<{
      id: string
      sandboxId: string
      x: number
      y: number
      width: number
      height: number
      label: string
      iframeState: JsonObject
      route?: string
    }> = []
    for (const [key, artboard] of Object.entries(root.artboards)) {
      result.push({
        id: key,
        sandboxId: artboard.sandboxId,
        x: artboard.x,
        y: artboard.y,
        width: artboard.width,
        height: artboard.height,
        label: artboard.label,
        iframeState: artboard.iframeState as JsonObject,
        route: artboard.route,
      })
    }
    return result
  })

  const workspaces = useStorage((root) => {
    const result: WorkspaceData[] = []
    for (const [key, ws] of Object.entries(root.workspaces)) {
      result.push({
        id: key,
        repoFullName: ws.repoFullName,
        repoOwner: ws.repoOwner,
        repoName: ws.repoName,
        defaultBranch: ws.defaultBranch,
        cloneUrl: ws.cloneUrl,
        setupScript: ws.setupScript ?? "",
        devScript: ws.devScript ?? "",
        envVars: ws.envVars ?? "",
        createdAt: ws.createdAt,
      })
    }
    return result
  })

  const agents = useStorage((root) => {
    const result: AgentData[] = []
    for (const [key, agent] of Object.entries(root.sandboxes)) {
      result.push({
        id: key,
        workspaceId: agent.workspaceId ?? "",
        sandboxName: agent.sandboxName,
        gitUrl: agent.gitUrl,
        branch: agent.branch,
        previewDomain: agent.previewDomain,
        port: agent.port,
        status: agent.status,
        statusMessage: agent.statusMessage,
        error: agent.error,
        createdAt: agent.createdAt,
      })
    }
    return result
  })

  const diffStats = useDiffStats(agents, workspaces)

  const chatSessions = useStorage((root) => {
    const result: ChatSessionData[] = []
    if (!root.chatSessions) return result
    for (const [key, cs] of Object.entries(root.chatSessions)) {
      result.push({
        id: key,
        agentId: cs.agentId,
        sessionId: cs.sessionId,
        label: cs.label,
        createdAt: cs.createdAt,
        isStreaming: cs.isStreaming,
        closedAt: cs.closedAt,
        planMode: cs.planMode,
      })
    }
    return result
  })

  const savedViewport = useStorage((root) => {
    if (!root.savedViewport) return null
    return {
      x: root.savedViewport.x,
      y: root.savedViewport.y,
      zoom: root.savedViewport.zoom,
    }
  })

  const saveViewport = useMutation(
    ({ storage }, vp: ViewportData) => {
      const existing = storage.get("savedViewport")
      if (existing) {
        existing.set("x", vp.x)
        existing.set("y", vp.y)
        existing.set("zoom", vp.zoom)
      } else {
        storage.set("savedViewport", new LiveObject(vp))
      }
    },
    [],
  )

  const saveViewportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveViewportDebounced = useCallback(
    (vp: ViewportData) => {
      if (saveViewportTimerRef.current) clearTimeout(saveViewportTimerRef.current)
      saveViewportTimerRef.current = setTimeout(() => saveViewport(vp), 500)
    },
    [saveViewport],
  )

  const agentDomains = useStorage((root) => {
    const domains: Record<string, { previewDomain: string; branch: string }> =
      {}
    for (const [key, agent] of Object.entries(root.sandboxes)) {
      if (agent.previewDomain) {
        domains[key] = {
          previewDomain: agent.previewDomain,
          branch: agent.branch,
        }
      }
    }
    return domains
  })

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

  const addWorkspaceToStorage = useMutation(
    ({ storage }, id: string, data: WorkspaceData) => {
      storage.get("workspaces").set(id, new LiveObject(data))
    },
    [],
  )

  const updateWorkspaceInStorage = useMutation(
    ({ storage }, id: string, data: Partial<WorkspaceData>) => {
      const ws = storage.get("workspaces").get(id)
      if (ws) {
        for (const [key, value] of Object.entries(data)) {
          ws.set(key as keyof WorkspaceData, value as never)
        }
      }
    },
    [],
  )

  const removeWorkspaceFromStorage = useMutation(
    ({ storage }, id: string) => {
      storage.get("workspaces").delete(id)
      // Remove all agents and their artboards for this workspace
      const agentsMap = storage.get("sandboxes")
      const artboardsMap = storage.get("artboards")
      const agentIds: string[] = []
      agentsMap.forEach((agent, key) => {
        if (agent.get("workspaceId") === id) {
          agentIds.push(key)
        }
      })
      const chatSessionsMap = storage.get("chatSessions")
      for (const agentId of agentIds) {
        agentsMap.delete(agentId)
        const toDelete: string[] = []
        artboardsMap.forEach((artboard, key) => {
          if (artboard.get("sandboxId") === agentId) {
            toDelete.push(key)
          }
        })
        toDelete.forEach((key) => artboardsMap.delete(key))
        // Cascade-delete chat sessions
        if (chatSessionsMap) {
          const chatToDelete: string[] = []
          chatSessionsMap.forEach((cs, key) => {
            if (cs.get("agentId") === agentId) chatToDelete.push(key)
          })
          chatToDelete.forEach((key) => chatSessionsMap.delete(key))
        }
      }
    },
    [],
  )

  // --- Artboard mutations ---

  /** Add an artboard — used by the manual "add screen" button. */
  const addArtboard = useMutation(
    ({ storage }, agentId: string, label: string): string | undefined => {
      const agent = storage.get("sandboxes").get(agentId)
      if (!agent || agent.get("status") !== "running") return

      const artboardsMap = storage.get("artboards")
      const allArtboards = Array.from(artboardsMap.values())

      let x: number
      let y: number

      if (allArtboards.length === 0) {
        const { cx, cy } = getViewportCenter()
        x = cx - DEFAULT_ARTBOARD_WIDTH / 2
        y = cy - DEFAULT_ARTBOARD_HEIGHT / 2
      } else {
        // Find the top edge (min y) and rightmost edge across all artboards
        let minY = Infinity
        let maxRight = -Infinity
        for (const a of allArtboards) {
          minY = Math.min(minY, a.get("y"))
          maxRight = Math.max(maxRight, a.get("x") + a.get("width"))
        }
        x = maxRight + 50
        y = minY
      }

      const id = nanoid()
      artboardsMap.set(
        id,
        new LiveObject({
          id,
          sandboxId: agentId,
          x,
          y,
          width: DEFAULT_ARTBOARD_WIDTH,
          height: DEFAULT_ARTBOARD_HEIGHT,
          label,
          iframeState: {},
        }),
      )
      return id
    },
    [getViewportCenter],
  )

  const addArtboardsForRoutes = useMutation(
    ({ storage }, agentId: string, routes: { route: string; label: string }[]): string[] => {
      const agent = storage.get("sandboxes").get(agentId)
      if (!agent || agent.get("status") !== "running") return []

      const artboardsMap = storage.get("artboards")
      const allArtboards = Array.from(artboardsMap.values())
      const existing = allArtboards.filter(
        (a) => a.get("sandboxId") === agentId,
      )
      const existingRoutes = new Set(
        existing.map((a) => a.get("route") || "/"),
      )
      const newRoutes = routes.filter((r) => !existingRoutes.has(r.route))
      if (newRoutes.length === 0) return []

      const gap = 50

      let startX: number
      let startY: number

      if (allArtboards.length === 0) {
        const { cx, cy } = getViewportCenter()
        startX = cx - DEFAULT_ARTBOARD_WIDTH / 2
        startY = cy - DEFAULT_ARTBOARD_HEIGHT / 2
      } else {
        let minY = Infinity
        let maxRight = -Infinity
        for (const a of allArtboards) {
          minY = Math.min(minY, a.get("y"))
          maxRight = Math.max(maxRight, a.get("x") + a.get("width"))
        }
        startX = maxRight + gap
        startY = minY
      }

      const newIds: string[] = []
      newRoutes.forEach(({ route, label }, i) => {
        const id = nanoid()
        newIds.push(id)
        artboardsMap.set(
          id,
          new LiveObject({
            id,
            sandboxId: agentId,
            x: startX + i * (DEFAULT_ARTBOARD_WIDTH + gap),
            y: startY,
            width: DEFAULT_ARTBOARD_WIDTH,
            height: DEFAULT_ARTBOARD_HEIGHT,
            label,
            route,
            iframeState: {},
          }),
        )
      })
      return newIds
    },
    [getViewportCenter],
  )

  const moveArtboard = useMutation(
    ({ storage }, id: string, x: number, y: number) => {
      const artboard = storage.get("artboards").get(id)
      if (artboard) {
        artboard.set("x", x)
        artboard.set("y", y)
      }
    },
    [],
  )

  const moveArtboardsByDelta = useMutation(
    ({ storage }, ids: string[], dx: number, dy: number) => {
      const artboardsMap = storage.get("artboards")
      for (const id of ids) {
        const artboard = artboardsMap.get(id)
        if (artboard) {
          artboard.set("x", artboard.get("x") + dx)
          artboard.set("y", artboard.get("y") + dy)
        }
      }
    },
    [],
  )

  const resizeArtboard = useMutation(
    ({ storage }, id: string, x: number, y: number, w: number, h: number) => {
      const artboard = storage.get("artboards").get(id)
      if (artboard) {
        artboard.set("x", x)
        artboard.set("y", y)
        artboard.set("width", Math.max(320, w))
        artboard.set("height", Math.max(200, h))
      }
    },
    [],
  )

  const renameArtboard = useMutation(
    ({ storage }, id: string, label: string) => {
      const artboard = storage.get("artboards").get(id)
      if (artboard) artboard.set("label", label)
    },
    [],
  )

  const removeArtboard = useMutation(({ storage }, id: string) => {
    storage.get("artboards").delete(id)
  }, [])

  const removeArtboards = useMutation(({ storage }, ids: string[]) => {
    const artboardsMap = storage.get("artboards")
    for (const id of ids) {
      artboardsMap.delete(id)
    }
  }, [])
  removeArtboardsRef.current = removeArtboards

  const updateArtboardRoute = useMutation(
    ({ storage }, id: string, route: string) => {
      const artboard = storage.get("artboards").get(id)
      if (artboard) artboard.set("route", route)
    },
    [],
  )

  const updateArtboardState = useMutation(
    ({ storage }, id: string, state: JsonObject) => {
      const artboard = storage.get("artboards").get(id)
      if (artboard) {
        artboard.set("iframeState", state)
      }
    },
    [],
  )

  // --- Agent mutations ---

  const updateAgentInStorage = useMutation(
    ({ storage }, id: string, data: Partial<AgentData>) => {
      const agent = storage.get("sandboxes").get(id)
      if (agent) {
        for (const [key, value] of Object.entries(data)) {
          agent.set(key as keyof AgentData, value as never)
        }
      }
    },
    [],
  )

  const addAgentToStorage = useMutation(
    ({ storage }, id: string, data: AgentData) => {
      storage.get("sandboxes").set(id, new LiveObject(data))
    },
    [],
  )

  const removeAgentFromStorage = useMutation(
    ({ storage }, id: string) => {
      storage.get("sandboxes").delete(id)
      const artboardsMap = storage.get("artboards")
      const toDelete: string[] = []
      artboardsMap.forEach((artboard, key) => {
        if (artboard.get("sandboxId") === id) {
          toDelete.push(key)
        }
      })
      toDelete.forEach((key) => artboardsMap.delete(key))
      // Cascade-delete chat sessions
      const chatSessionsMap = storage.get("chatSessions")
      if (chatSessionsMap) {
        const chatToDelete: string[] = []
        chatSessionsMap.forEach((cs, key) => {
          if (cs.get("agentId") === id) chatToDelete.push(key)
        })
        chatToDelete.forEach((key) => chatSessionsMap.delete(key))
      }
    },
    [],
  )

  // --- Chat session mutations ---

  const addChatSession = useMutation(
    ({ storage }, id: string, data: ChatSessionData) => {
      const map = storage.get("chatSessions")
      if (map) map.set(id, new LiveObject(data))
    },
    [],
  )

  const updateChatSession = useMutation(
    ({ storage }, id: string, data: Partial<ChatSessionData>) => {
      const map = storage.get("chatSessions")
      if (!map) return
      const cs = map.get(id)
      if (cs) {
        for (const [key, value] of Object.entries(data)) {
          cs.set(key as keyof ChatSessionData, value as never)
        }
      }
    },
    [],
  )

  const removeChatSession = useMutation(
    ({ storage }, id: string) => {
      const map = storage.get("chatSessions")
      if (map) map.delete(id)
    },
    [],
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

  const zoomToFitArtboards = useCallback(
    (artboardIds: string[]) => {
      const ref = transformRef.current
      if (!ref || artboardIds.length === 0) return

      if (artboardIds.length === 1) {
        handleSelectArtboard(artboardIds[0])
        return
      }

      // Compute bounding box across all artboard DOM elements
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const id of artboardIds) {
        const el = document.getElementById(`artboard-${id}`)
        if (!el) continue
        const x = el.offsetLeft
        const y = el.offsetTop
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x + el.offsetWidth)
        maxY = Math.max(maxY, y + el.offsetHeight)
      }
      if (minX === Infinity) return

      const padding = 60
      const bboxW = maxX - minX
      const bboxH = maxY - minY
      const wrapperW = ref.instance.wrapperComponent?.clientWidth ?? window.innerWidth
      const wrapperH = ref.instance.wrapperComponent?.clientHeight ?? window.innerHeight
      const scale = Math.min(
        (wrapperW - padding * 2) / bboxW,
        (wrapperH - padding * 2) / bboxH,
        ZOOM_MAX,
      )
      const centerX = (minX + maxX) / 2
      const centerY = (minY + maxY) / 2
      const posX = wrapperW / 2 - centerX * scale
      const posY = wrapperH / 2 - centerY * scale
      ref.setTransform(posX, posY, scale, 300)
    },
    [handleSelectArtboard],
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

  const handleCrawlRoutes = useCallback(
    async (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId)
      if (!agent || agent.status !== "running") return
      const result = await crawlRoutes(agent.sandboxName)
      if (result.success) {
        const newIds = addArtboardsForRoutes(agentId, result.routes)
        if (newIds.length > 0) {
          requestAnimationFrame(() => {
            zoomToFitArtboards(newIds)
          })
        }
      }
    },
    [agents, addArtboardsForRoutes, zoomToFitArtboards],
  )

  const handleSelectAgent = useCallback(
    (agentId: string | null) => {
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

      const panel = chatPanelRef.current
      if (panel?.isCollapsed()) {
        panel.expand()
        const { inPixels } = panel.getSize()
        if (inPixels < 480) panel.resize(480)
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

  const handleCloseChat = useCallback(
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
      updateChatSession(chatId, { closedAt: Date.now() })
    },
    [selectedChatId, chatSessions, updateChatSession],
  )

  const handleReopenChat = useCallback(
    (chatId: string) => {
      updateChatSession(chatId, { closedAt: 0 })
      setSelectedChatId(chatId)
    },
    [updateChatSession],
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
    (repo: GitHubRepo) => {
      const id = nanoid()
      const data: WorkspaceData = {
        id,
        repoFullName: repo.fullName,
        repoOwner: repo.owner,
        repoName: repo.name,
        defaultBranch: repo.defaultBranch,
        cloneUrl: repo.cloneUrl,
        setupScript: "",
        devScript: "",
        envVars: "",
        createdAt: Date.now(),
      }
      addWorkspaceToStorage(id, data)
    },
    [addWorkspaceToStorage],
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

      addAgentToStorage(id, {
        id,
        workspaceId,
        sandboxName,
        gitUrl: workspace.cloneUrl,
        branch,
        previewDomain: "",
        port: 3000,
        status: "creating",
        statusMessage: "Creating branch…",
        createdAt: Date.now(),
      })

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
          viewportCenter: { x: cx, y: cy },
        }),
      })
    },
    [workspaces, addAgentToStorage, getViewportCenter, roomId],
  )

  const handleCreateAgentFromBranch = useCallback(
    (workspaceId: string, branch: string) => {
      const workspace = workspaces.find((w) => w.id === workspaceId)
      if (!workspace) return

      const id = nanoid()
      const sandboxName = `sp-${nanoid(10)}`
      const { cx, cy } = getViewportCenter()

      addAgentToStorage(id, {
        id,
        workspaceId,
        sandboxName,
        gitUrl: workspace.cloneUrl,
        branch,
        previewDomain: "",
        port: 3000,
        status: "creating",
        statusMessage: "Cloning repository…",
        createdAt: Date.now(),
      })

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
          viewportCenter: { x: cx, y: cy },
        }),
      })
    },
    [workspaces, addAgentToStorage, getViewportCenter, roomId],
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

      addAgentToStorage(id, {
        id,
        workspaceId,
        sandboxName,
        gitUrl: workspace.cloneUrl,
        branch: newBranch,
        previewDomain: "",
        port: 3000,
        status: "creating",
        statusMessage: "Creating branch…",
        createdAt: Date.now(),
      })

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
          viewportCenter: { x: cx, y: cy },
        }),
      })
    },
    [workspaces, addAgentToStorage, getViewportCenter, roomId],
  )

  const handleForkAgent = useCallback(
    (agentId: string) => {
      const sourceAgent = agents.find((a) => a.id === agentId)
      if (!sourceAgent?.branch || !sourceAgent.sandboxName) return
      handleDuplicateBranch(sourceAgent.workspaceId, sourceAgent.branch)
    },
    [agents, handleDuplicateBranch],
  )

  const handleRefreshAgent = useCallback(
    async (id: string) => {
      const agent = agents.find((a) => a.id === id)
      if (!agent?.sandboxName) return

      const workspace = workspaces.find((w) => w.id === agent.workspaceId)

      updateAgentInStorage(id, { status: "starting", statusMessage: "Restarting sandbox…" })

      const result = await restartSandbox(
        agent.sandboxName,
        agent.gitUrl,
        agent.branch,
        agent.port,
        workspace?.setupScript,
        workspace?.devScript,
      )
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
        updateAgentInStorage(agentId, { branch: newBranch })
      }
    },
    [agents, workspaces, updateAgentInStorage],
  )

  // Load history for all chat sessions that have a sessionId so other
  // clients can see past messages for chats they haven't opened yet.
  useEffect(() => {
    for (const cs of chatSessions) {
      if (cs.sessionId) {
        chatStore.loadHistory(cs.id, cs.sessionId)
      }
    }
  }, [chatSessions])

  // Hydrate chatStore streaming state from Liveblocks storage on mount/reconnect.
  useEffect(() => {
    for (const cs of chatSessions) {
      if (cs.isStreaming) {
        chatStore.setStreaming(cs.id, true)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only on mount

  // Receive server-broadcast chat events via Liveblocks and feed into chat store.
  useEventListener(({ event }) => {
    const e = event as ChatBroadcastEvent
    if (e.type === "chat-stream" || e.type === "chat-stream-start" || e.type === "chat-stream-end") {
      chatStore.handleBroadcastEvent(e)
      // Persist streaming state to Liveblocks storage for late-joining clients
      if (e.type === "chat-stream-start") {
        updateChatSession(e.chatId, { isStreaming: true })
      } else if (e.type === "chat-stream-end") {
        updateChatSession(e.chatId, { isStreaming: false })
      }
    }
  })

  // Reconnect agents on mount — check if they're still alive,
  // and recover any that were mid-creation when the page was reloaded.
  const reconnectedRef = useRef(false)
  useEffect(() => {
    if (reconnectedRef.current || agents.length === 0) return
    reconnectedRef.current = true

    for (const agent of agents) {
      // Agents stuck in creating/starting — ask server to resume.
      // The server uses a Redis lock so only one instance handles it.
      if (agent.status === "creating" || agent.status === "starting") {
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

      const workspace = workspaces.find((w) => w.id === agent.workspaceId)
      reconnectSandbox(agent.sandboxName, agent.port, workspace?.devScript).then((result) => {
        if (result.status === "running") {
          updateAgentInStorage(agent.id, {
            previewDomain: result.previewDomain,
            status: "running",
          })
        } else {
          updateAgentInStorage(agent.id, {
            status: "stopped",
            error: result.error || "Sandbox could not be resumed — click refresh to retry",
          })
        }
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
      (o) => o.connectionId === followingConnectionId,
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

  useEffect(() => {
    const el = canvasWrapperRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      if (focusedArtboardId !== null) return
      e.preventDefault()
      const ref = transformRef.current
      if (!ref) return

      if (followingConnectionId !== null) {
        setFollowingConnectionId(null)
      }

      if (e.ctrlKey || e.metaKey) {
        // Zoom at cursor position
        const rect = el.getBoundingClientRect()
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
        // Pan
        const { positionX, positionY, scale } = ref.state
        ref.setTransform(positionX - e.deltaX, positionY - e.deltaY, scale, 0)
      }
    }

    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [focusedArtboardId, followingConnectionId])

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

  // Marquee selection: pointerdown on empty canvas starts marquee
  const handleCanvasPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only left-click, not during space-pan, comment mode, or artboard focus
      if (e.button !== 0 || spaceHeld || commentMode || focusedArtboardId !== null) return
      // Ignore if clicking on an artboard or interactive element
      const target = e.target as HTMLElement
      if (target.closest("[data-artboard]") || target.closest("button")) return
      // Ignore clicks near the left/right edges so resize-handle grabs don't start a marquee
      const wrapperRect = e.currentTarget.getBoundingClientRect()
      if (e.clientX - wrapperRect.left < 8 || wrapperRect.right - e.clientX < 8) return

      const rect = e.currentTarget.getBoundingClientRect()
      const canvas = screenToCanvas(e.clientX, e.clientY, rect)
      marqueeRef.current = { startX: canvas.x, startY: canvas.y, shiftKey: e.shiftKey, baseSelection: new Set(selectedArtboardIds) }
      setMarquee({ startX: canvas.x, startY: canvas.y, currentX: canvas.x, currentY: canvas.y })
      if (!e.shiftKey) {
        setSelectedArtboardIds(new Set())
      }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [spaceHeld, commentMode, focusedArtboardId, screenToCanvas, selectedArtboardIds],
  )

  const handleCanvasPointerMove = useCallback(
    (e: React.PointerEvent) => {
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

      const hits = new Set<string>()
      for (const ab of artboards) {
        if (
          ab.x < right &&
          ab.x + ab.width > left &&
          ab.y < bottom &&
          ab.y + ab.height > top
        ) {
          hits.add(ab.id)
        }
      }

      if (start.shiftKey) {
        const next = new Set(start.baseSelection)
        for (const id of hits) {
          if (next.has(id)) next.delete(id)
          else next.add(id)
        }
        setSelectedArtboardIds(next)
      } else {
        setSelectedArtboardIds(hits)
      }
    },
    [screenToCanvas, artboards],
  )

  const handleCanvasPointerUp = useCallback(
    (e: React.PointerEvent) => {
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
        }
      }
    },
    [screenToCanvas],
  )

  // Click on artboard to select
  const handleArtboardSelect = useCallback(
    (id: string, shiftKey: boolean) => {
      if (shiftKey) {
        setSelectedArtboardIds((prev) => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      } else {
        setSelectedArtboardIds(new Set([id]))
      }
    },
    [],
  )

  const handleMoveSelected = useCallback(
    (dx: number, dy: number) => {
      const ids = Array.from(selectedArtboardIdsRef.current)
      if (ids.length > 0) {
        moveArtboardsByDelta(ids, dx, dy)
      }
    },
    [moveArtboardsByDelta],
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
      updateMyPresence({ cursor: { x: canvasX, y: canvasY } })

      // Hit-test for hover highlight
      let hovered: string | null = null
      for (const ab of artboards) {
        if (
          canvasX >= ab.x &&
          canvasX <= ab.x + ab.width &&
          canvasY >= ab.y &&
          canvasY <= ab.y + ab.height
        ) {
          hovered = ab.id
          break
        }
      }
      setHoveredArtboardId(hovered)
    },
    [updateMyPresence, artboards],
  )

  const handlePointerLeave = useCallback(() => {
    updateMyPresence({ cursor: null })
    setHoveredArtboardId(null)
  }, [updateMyPresence])

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

      // Hit-test against artboard bounds — store offset relative to artboard
      for (const ab of artboards) {
        if (
          canvasX >= ab.x &&
          canvasX <= ab.x + ab.width &&
          canvasY >= ab.y &&
          canvasY <= ab.y + ab.height
        ) {
          setNewCommentPos({
            x: canvasX - ab.x,
            y: canvasY - ab.y,
            artboardId: ab.id,
          })
          return
        }
      }

      setNewCommentPos({ x: canvasX, y: canvasY })
    },
    [commentMode, artboards],
  )

  // Broadcast artboard selection to other users via presence
  useEffect(() => {
    updateMyPresence({ selectedArtboardIds: Array.from(selectedArtboardIds) })
  }, [selectedArtboardIds, updateMyPresence])

  // Collect other users' selections for the overlay
  const othersSelections = others.map((other) => ({
    selectedArtboardIds: other.presence.selectedArtboardIds ?? [],
    color: other.presence.color,
    name: other.info?.name || other.presence.name || "Anonymous",
  }))

  // Auto-select the first running agent when none is selected
  useEffect(() => {
    if (selectedAgentId && agents.some((a) => a.id === selectedAgentId)) return
    const firstRunning = agents.find((a) => a.status === "running" && a.sandboxName)
    if (firstRunning) {
      setSelectedAgentId(firstRunning.id)
    }
  }, [selectedAgentId, agents])

  const selectedAgent = agents.find((a) => a.id === selectedAgentId)
  const [chatCollapsed, setChatCollapsed] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: "canvas-layout", storage: localStorage })

  return (
    <ResizablePanelGroup orientation="horizontal" className="fixed inset-0 bg-muted/30" defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
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
        onResize={(size) => setSidebarCollapsed(size.inPixels === 0)}
      >
        <AgentSidebar
          workspaces={workspaces}
          agents={agents}
          artboards={artboards}
          selectedArtboardIds={selectedArtboardIds}
          onSelectAgent={handleSelectAgent}
          onCreateWorkspace={handleCreateWorkspace}
          onUpdateWorkspace={updateWorkspaceInStorage}
          onRemoveWorkspace={removeWorkspaceFromStorage}
          onCreateAgent={handleCreateAgent}
          onCreateAgentFromBranch={handleCreateAgentFromBranch}
          onDuplicateBranch={handleDuplicateBranch}
          onForkAgent={handleForkAgent}
          onRefreshAgent={handleRefreshAgent}
          onRemoveAgent={(id) => {
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
          onCrawlRoutes={handleCrawlRoutes}
          onUpdateAgent={updateAgentInStorage}
          onRenameBranch={handleBranchRename}
          onSelectArtboard={(id, shiftKey) => {
            if (shiftKey) {
              setSelectedArtboardIds((prev) => {
                const next = new Set(prev)
                if (next.has(id)) next.delete(id)
                else next.add(id)
                return next
              })
            } else {
              setSelectedArtboardIds(new Set([id]))
            }
          }}
          onRenameArtboard={renameArtboard}
          onRouteChange={updateArtboardRoute}
          onRemoveArtboard={removeArtboard}
          onCollapseSidebar={() => sidebarPanelRef.current?.collapse()}
        />
      </ResizablePanel>
      <ResizableHandle className="focus-visible:ring-0" />

      {/* Canvas */}
      <ResizablePanel id="canvas">
            <div
              className="relative h-full w-full"
              data-canvas-wrapper
              ref={canvasWrapperRef}
              style={{ clipPath: "inset(0)", cursor: commentMode ? "crosshair" : isPanning ? "grabbing" : spaceHeld ? "grab" : undefined }}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={(e) => {
                handlePointerMove(e)
                handleCanvasPointerMove(e)
              }}
              onPointerUp={handleCanvasPointerUp}
              onPointerLeave={handlePointerLeave}
              onClick={commentMode ? handleCanvasClick : undefined}
            >

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
                disabled: focusedArtboardId !== null || commentMode,
                allowLeftClickPan: spaceHeld,
                allowMiddleClickPan: true,
              }}
              onInit={(ref) => {
                if (!viewportRestoredRef.current && savedViewport) {
                  viewportRestoredRef.current = true
                  ref.setTransform(savedViewport.x, savedViewport.y, savedViewport.zoom, 0)
                  setZoom(savedViewport.zoom)
                  setViewportPos({ x: savedViewport.x, y: savedViewport.y })
                  updateMyPresence({ viewport: savedViewport })
                } else {
                  const { scale, positionX, positionY } = ref.state
                  setZoom(scale)
                  setViewportPos({ x: positionX, y: positionY })
                  updateMyPresence({
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
                updateMyPresence({ viewport: vp })
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

                  {artboards.map((artboard) => {
                    const agentInfo = agentDomains[artboard.sandboxId]
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
                        selected={selectedArtboardIds.has(artboard.id)}
                        onFocus={setFocusedArtboardId}
                        onSelect={handleArtboardSelect}
                        onMove={moveArtboard}
                        onMoveSelected={handleMoveSelected}
                        onResize={resizeArtboard}
                        onRemove={removeArtboard}
                        onStateChanged={updateArtboardState}
                        multiSelected={selectedArtboardIds.size > 1}
                        spaceHeld={spaceHeld}
                      />
                    )
                  })}

                  <Comments
                    zoom={zoom}
                    commentMode={commentMode}
                    newCommentPos={newCommentPos}
                    onNewCommentPlaced={() => {
                      setNewCommentPos(null)
                      setCommentMode(false)
                    }}
                    onCancelComment={() => setNewCommentPos(null)}
                    artboards={artboards}
                  />
                </div>
              </TransformComponent>

            </TransformWrapper>

              <SelectionOverlay
                zoom={zoom}
                viewportPos={viewportPos}
                selectedArtboardIds={selectedArtboardIds}
                focusedArtboardId={focusedArtboardId}
                hoveredArtboardId={hoveredArtboardId}
                artboards={artboards}
                marquee={marquee}
                othersSelections={othersSelections}
              />
              <Cursors viewport={{ ...viewportPos, zoom }} />
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
                  <Button
                    variant={!commentMode ? "default" : "ghost"}
                    size="icon-xs"
                    onClick={() => {
                      setCommentMode(false)
                      setNewCommentPos(null)
                    }}
                    title="Select (V)"
                  >
                    <MousePointer2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant={commentMode ? "default" : "ghost"}
                    size="icon-xs"
                    onClick={() => {
                      setCommentMode((m) => !m)
                      setNewCommentPos(null)
                    }}
                    title="Comment mode (C)"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="pointer-events-none absolute right-0 top-0 z-[9998] flex h-12 items-center px-2">
                <div className="pointer-events-auto flex items-center gap-1 rounded-lg bg-background p-1 shadow-md outline outline-1 outline-foreground/5" onClick={(e) => e.stopPropagation()}>
                  <FollowingToolbar
                    followingId={followingConnectionId}
                    onFollow={setFollowingConnectionId}
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
                          Expand chat <Kbd>⌘⌥B</Kbd>
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
        minSize="280px"
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
            diffStats={selectedAgentId ? diffStats.get(selectedAgentId) : undefined}
            onCollapse={() => chatPanelRef.current?.collapse()}
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
                    Collapse chat <Kbd>⌘⌥B</Kbd>
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
  )
}
