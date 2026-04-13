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
  useMutation,
  useStorage,
  useUpdateMyPresence,
} from "@liveblocks/react/suspense"
import { Artboard } from "./artboard"
import { Cursors } from "./cursors"
import type { JsonObject } from "@/lib/postmessage-protocol"
import { AgentSidebar } from "@/components/panels/agent-sidebar"
import { ChatPanel } from "@/components/agent/chat-panel"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable"
import type { PanelImperativeHandle } from "react-resizable-panels"
import type { AgentData, ChatSessionData, WorkspaceData } from "@/lib/liveblocks.types"
import { chatStore, type ChatBroadcastEvent } from "@/lib/chat-store"
import type { GitHubRepo } from "@/lib/github-actions"
import {
  createAgentBranch,
  renameAgentBranch,
  cloneSandbox,
  installDependencies,
  startDevServer,
  configureAgentGit,
  forkSandbox,
  restartSandbox,
  reconnectSandbox,
  keepAliveSandbox,
} from "@/lib/sandbox-actions"
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
  DEFAULT_ARTBOARD_WIDTH,
  DEFAULT_ARTBOARD_HEIGHT,
  CANVAS_SIZE,
} from "@/lib/constants"

function parseWorkspaceEnv(text: string): Record<string, string> | undefined {
  const env: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key) env[key] = value
  }
  return Object.keys(env).length > 0 ? env : undefined
}

export function Canvas({ roomId }: { roomId: string }) {
  const [zoom, setZoom] = useState(1)
  const [viewportPos, setViewportPos] = useState({ x: 0, y: 0 })
  const [focusedArtboardId, setFocusedArtboardId] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const transformRef = useRef<ReactZoomPanPinchContentRef>(null)
  const chatPanelRef = useRef<PanelImperativeHandle>(null)
  const updateMyPresence = useUpdateMyPresence()

  // Escape key unfocuses
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocusedArtboardId(null)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

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
      })
    }
    return result
  })

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
    ({ storage }, agentId: string, label: string) => {
      const agent = storage.get("sandboxes").get(agentId)
      if (!agent || agent.get("status") !== "running") return

      const { cx, cy } = getViewportCenter()
      const artboardsMap = storage.get("artboards")
      const existing = Array.from(artboardsMap.values()).filter(
        (a) => a.get("sandboxId") === agentId,
      )
      const offset = existing.length * 40
      const id = nanoid()
      artboardsMap.set(
        id,
        new LiveObject({
          id,
          sandboxId: agentId,
          x: cx - DEFAULT_ARTBOARD_WIDTH / 2 + offset,
          y: cy - DEFAULT_ARTBOARD_HEIGHT / 2 + offset,
          width: DEFAULT_ARTBOARD_WIDTH,
          height: DEFAULT_ARTBOARD_HEIGHT,
          label,
          iframeState: {},
        }),
      )
    },
    [getViewportCenter],
  )

  /**
   * Auto-create the first artboard for an agent.
   * Guarded: skips if the agent is gone, not running, or already has artboards.
   */
  const ensureFirstArtboard = useMutation(
    ({ storage }, agentId: string) => {
      const agent = storage.get("sandboxes").get(agentId)
      if (!agent || agent.get("status") !== "running") return

      const artboardsMap = storage.get("artboards")
      const hasArtboard = Array.from(artboardsMap.values()).some(
        (a) => a.get("sandboxId") === agentId,
      )
      if (hasArtboard) return

      const { cx, cy } = getViewportCenter()
      const id = nanoid()
      artboardsMap.set(
        id,
        new LiveObject({
          id,
          sandboxId: agentId,
          x: cx - DEFAULT_ARTBOARD_WIDTH / 2,
          y: cy - DEFAULT_ARTBOARD_HEIGHT / 2,
          width: DEFAULT_ARTBOARD_WIDTH,
          height: DEFAULT_ARTBOARD_HEIGHT,
          label: "Frame 1",
          iframeState: {},
        }),
      )
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

  const handleAddArtboardForAgent = useCallback(
    (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId)
      if (!agent || agent.status !== "running") return
      const existing = artboards.filter(
        (a) => a.sandboxId === agentId,
      )
      addArtboard(
        agentId,
        `Frame ${existing.length + 1}`,
      )
    },
    [agents, artboards, addArtboard],
  )

  const handleSelectAgent = useCallback(
    (agentId: string | null) => {
      // If re-selecting the same agent and chat was dragged closed, re-expand
      if (agentId && agentId === selectedAgentId) {
        const panel = chatPanelRef.current
        if (panel?.isCollapsed()) panel.expand()
        return
      }
      setSelectedAgentId(agentId)
      if (agentId) {
        const agentChats = chatSessions
          .filter((c) => c.agentId === agentId)
          .sort((a, b) => a.createdAt - b.createdAt)
        setSelectedChatId(agentChats[0]?.id ?? null)
      } else {
        setSelectedChatId(null)
      }
    },
    [chatSessions, selectedAgentId],
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

  const handleRemoveChat = useCallback(
    (chatId: string) => {
      if (selectedChatId === chatId) {
        const chat = chatSessions.find((c) => c.id === chatId)
        if (chat) {
          const siblings = chatSessions
            .filter((c) => c.agentId === chat.agentId && c.id !== chatId)
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
        if (chat) setSelectedAgentId(chat.agentId)
      }
    },
    [chatSessions],
  )

  const handleSelectArtboard = useCallback(
    (artboardId: string) => {
      const ref = transformRef.current
      if (!ref) return
      const el = document.getElementById(`artboard-${artboardId}`)
      if (!el) return
      const padding = 20
      const rect = el.getBoundingClientRect()
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
    async (workspaceId: string) => {
      const workspace = workspaces.find((w) => w.id === workspaceId)
      if (!workspace) return

      const id = nanoid()
      const sandboxName = `sp-${nanoid(10)}`
      const branch = uniqueNamesGenerator({
        dictionaries: [adjectives, colors, animals],
        separator: "-",
        length: 3,
      })

      const data: AgentData = {
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
      }
      addAgentToStorage(id, data)

      // Step 1: Create branch
      const branchResult = await createAgentBranch(workspace, branch)
      if (!branchResult.success) {
        updateAgentInStorage(id, {
          status: "error",
          statusMessage: undefined,
          error: branchResult.error || "Failed to create branch",
        })
        return
      }

      // Step 2: Clone repo into sandbox
      updateAgentInStorage(id, { statusMessage: "Cloning repository…" })
      const env = parseWorkspaceEnv(workspace.envVars)
      const cloneResult = await cloneSandbox(sandboxName, workspace.cloneUrl, branch, 3000, env)
      if (!cloneResult.success) {
        updateAgentInStorage(id, {
          status: "error",
          statusMessage: undefined,
          error: cloneResult.error,
        })
        return
      }

      // Step 3: Install dependencies
      updateAgentInStorage(id, { statusMessage: "Installing dependencies…" })
      const installResult = await installDependencies(cloneResult.sandboxName, workspace.setupScript)
      if (!installResult.success) {
        updateAgentInStorage(id, {
          status: "error",
          statusMessage: undefined,
          error: installResult.error,
        })
        return
      }

      // Step 4: Start dev server
      updateAgentInStorage(id, { statusMessage: "Starting dev server…" })
      const serverResult = await startDevServer(cloneResult.sandboxName, 3000, workspace.devScript)
      if (serverResult.status !== "running") {
        updateAgentInStorage(id, {
          status: "error",
          statusMessage: undefined,
          error: serverResult.error,
        })
        return
      }

      // Step 5: Configure git
      updateAgentInStorage(id, { statusMessage: "Configuring git…" })
      const gitResult = await configureAgentGit(cloneResult.sandboxName, workspace, branch)
      if (!gitResult.success) {
        updateAgentInStorage(id, {
          status: "error",
          statusMessage: undefined,
          error: gitResult.error,
        })
        return
      }

      updateAgentInStorage(id, {
        previewDomain: serverResult.previewDomain,
        status: "running",
        statusMessage: undefined,
      })
      ensureFirstArtboard(id)

      // Auto-create first chat session
      const chatId = nanoid()
      addChatSession(chatId, { id: chatId, agentId: id, label: "Untitled", createdAt: Date.now() })
    },
    [workspaces, addAgentToStorage, updateAgentInStorage, ensureFirstArtboard, addChatSession],
  )

  const handleForkAgent = useCallback(
    async (agentId: string) => {
      const sourceAgent = agents.find((a) => a.id === agentId)
      if (!sourceAgent?.branch || !sourceAgent.sandboxName) return

      const workspace = workspaces.find((w) => w.id === sourceAgent.workspaceId)
      if (!workspace) return

      const id = nanoid()
      const sandboxName = `sp-${nanoid(10)}`
      const branch = uniqueNamesGenerator({
        dictionaries: [adjectives, colors, animals],
        separator: "-",
        length: 3,
      })

      const data: AgentData = {
        id,
        workspaceId: sourceAgent.workspaceId,
        sandboxName,
        gitUrl: sourceAgent.gitUrl,
        branch,
        previewDomain: "",
        port: 3000,
        status: "creating",
        statusMessage: "Snapshotting sandbox…",
        createdAt: Date.now(),
      }
      addAgentToStorage(id, data)

      // Step 1: Create branch on GitHub
      const branchResult = await createAgentBranch(workspace, branch, sourceAgent.branch)
      if (!branchResult.success) {
        updateAgentInStorage(id, {
          status: "error",
          statusMessage: undefined,
          error: branchResult.error || "Failed to create branch",
        })
        return
      }

      // Step 2: Fork sandbox via snapshot (preserves uncommitted changes + deps)
      updateAgentInStorage(id, { statusMessage: "Forking sandbox…" })
      const env = parseWorkspaceEnv(workspace.envVars)
      const forkResult = await forkSandbox(
        sourceAgent.sandboxName,
        sandboxName,
        branch,
        3000,
        workspace.devScript,
        env,
      )
      if (forkResult.status !== "running") {
        updateAgentInStorage(id, {
          status: "error",
          statusMessage: undefined,
          error: forkResult.error,
        })
        return
      }

      // Step 3: Start dev server
      updateAgentInStorage(id, { statusMessage: "Starting dev server…" })
      const serverResult = await startDevServer(forkResult.sandboxName, 3000, workspace.devScript)
      if (serverResult.status !== "running") {
        updateAgentInStorage(id, {
          status: "error",
          statusMessage: undefined,
          error: serverResult.error,
        })
        return
      }

      // Step 4: Configure git
      updateAgentInStorage(id, { statusMessage: "Configuring git…" })
      const gitResult = await configureAgentGit(forkResult.sandboxName, workspace, branch)
      if (!gitResult.success) {
        updateAgentInStorage(id, {
          status: "error",
          statusMessage: undefined,
          error: gitResult.error,
        })
        return
      }

      updateAgentInStorage(id, {
        previewDomain: serverResult.previewDomain,
        status: "running",
        statusMessage: undefined,
      })
      ensureFirstArtboard(id)

      // Auto-create first chat session
      const chatId = nanoid()
      addChatSession(chatId, { id: chatId, agentId: id, label: "Untitled", createdAt: Date.now() })
    },
    [agents, workspaces, addAgentToStorage, updateAgentInStorage, ensureFirstArtboard, addChatSession],
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
    async (agentId: string, newBranch: string) => {
      const agent = agents.find((a) => a.id === agentId)
      if (!agent?.sandboxName || !agent.branch || agent.branch === newBranch) return

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
  // including agents that were mid-creation when the page was reloaded
  const reconnectedRef = useRef(false)
  useEffect(() => {
    if (reconnectedRef.current || agents.length === 0) return
    reconnectedRef.current = true

    for (const agent of agents) {
      if (!agent.sandboxName) continue
      // Skip agents actively being provisioned — handleCreateAgent manages their lifecycle
      if (agent.status === "creating" || agent.status === "starting") continue

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
  }, [agents, workspaces, updateAgentInStorage])

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
    },
    [updateMyPresence],
  )

  const handlePointerLeave = useCallback(() => {
    updateMyPresence({ cursor: null })
  }, [updateMyPresence])

  const selectedAgent = agents.find((a) => a.id === selectedAgentId)
  const chatVisible = !!selectedAgent?.sandboxName
  const [chatCollapsed, setChatCollapsed] = useState(true)

  // Expand/collapse chat panel when agent selection changes
  useEffect(() => {
    const panel = chatPanelRef.current
    if (!panel) return
    if (chatVisible) {
      if (panel.isCollapsed()) {
        panel.expand()
        // If no prior size, set a comfortable default
        const { inPixels } = panel.getSize()
        if (inPixels < 480) panel.resize(480)
      }
    } else {
      if (!panel.isCollapsed()) panel.collapse()
    }
  }, [chatVisible, selectedAgentId])

  return (
    <ResizablePanelGroup orientation="horizontal" className="fixed inset-0 bg-muted/30">
      {/* Sidebar */}
      <ResizablePanel
        id="sidebar"
        defaultSize="240px"
        minSize="180px"
        maxSize="480px"
        groupResizeBehavior="preserve-pixel-size"
      >
        <AgentSidebar
          workspaces={workspaces}
          agents={agents}
          artboards={artboards}
          selectedAgentId={selectedAgentId}
          onSelectAgent={handleSelectAgent}
          onCreateWorkspace={handleCreateWorkspace}
          onUpdateWorkspace={updateWorkspaceInStorage}
          onRemoveWorkspace={removeWorkspaceFromStorage}
          onCreateAgent={handleCreateAgent}
          onForkAgent={handleForkAgent}
          onRefreshAgent={handleRefreshAgent}
          onRemoveAgent={(id) => {
            if (selectedAgentId === id) {
              setSelectedAgentId(null)
              setSelectedChatId(null)
            }
            chatSessions
              .filter((c) => c.agentId === id)
              .forEach((c) => chatStore.cleanup(c.id))
            removeAgentFromStorage(id)
          }}
          onAddArtboard={handleAddArtboardForAgent}
          onUpdateAgent={updateAgentInStorage}
          onSelectArtboard={handleSelectArtboard}
          onRenameArtboard={renameArtboard}
          onRemoveArtboard={removeArtboard}
        />
      </ResizablePanel>
      <ResizableHandle className="focus-visible:ring-0" />

      {/* Chat — always mounted, toggled via collapse/expand */}
      <ResizablePanel
        id="chat"
        defaultSize="0px"
        minSize="280px"
        collapsible
        collapsedSize="0px"
        groupResizeBehavior="preserve-pixel-size"
        panelRef={chatPanelRef}
        onResize={(size) => {
          setChatCollapsed(size.inPixels === 0)
          // Prevent the panel from opening when no agent is selected (e.g. via sidebar resize)
          if (size.inPixels > 0 && !chatVisible) {
            chatPanelRef.current?.collapse()
          }
        }}
      >
        {selectedAgent?.sandboxName && (
          <ChatPanel
            agent={selectedAgent}
            chatSessions={chatSessions.filter((c) => c.agentId === selectedAgentId)}
            selectedChatId={selectedChatId}
            roomId={roomId}
            onSelectChat={setSelectedChatId}
            onCreateChat={() => handleCreateChat(selectedAgent.id)}
            onRenameChat={handleRenameChat}
            onRemoveChat={handleRemoveChat}
            onSessionId={(chatId, sid) => updateChatSession(chatId, { sessionId: sid || undefined })}
            onBranchRename={(branch) => handleBranchRename(selectedAgent.id, branch)}
          />
        )}
      </ResizablePanel>
      <ResizableHandle className={chatCollapsed ? "w-0 opacity-0" : "focus-visible:ring-0"} disabled={chatCollapsed} />

      {/* Canvas */}
      <ResizablePanel id="canvas">
            <div
              className="relative h-full w-full"
              style={{ clipPath: "inset(0)" }}
              onPointerMove={handlePointerMove}
              onPointerLeave={handlePointerLeave}
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
                wheelDisabled: true,
                step: ZOOM_STEP,
                disabled: focusedArtboardId !== null,
              }}
              trackPadPanning={{
                disabled: focusedArtboardId !== null,
              }}
              panning={{
                velocityDisabled: true,
                disabled: focusedArtboardId !== null,
              }}
              onInit={(ref) => {
                const { scale, positionX, positionY } = ref.state
                setZoom(scale)
                setViewportPos({ x: positionX, y: positionY })
                updateMyPresence({
                  viewport: { x: positionX, y: positionY, zoom: scale },
                })
              }}
              onTransform={(_ref, state) => {
                setZoom(state.scale)
                setViewportPos({ x: state.positionX, y: state.positionY })
                updateMyPresence({
                  viewport: {
                    x: state.positionX,
                    y: state.positionY,
                    zoom: state.scale,
                  },
                })
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
                  <svg className="pointer-events-none absolute inset-0 h-full w-full">
                    <defs>
                      <pattern
                        id="dot-grid"
                        x="0"
                        y="0"
                        width="40"
                        height="40"
                        patternUnits="userSpaceOnUse"
                      >
                        <circle
                          cx="1"
                          cy="1"
                          r="1"
                          className="fill-foreground/10"
                        />
                      </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#dot-grid)" />
                  </svg>

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
                        onFocus={setFocusedArtboardId}
                        onMove={moveArtboard}
                        onRename={renameArtboard}
                        onRemove={removeArtboard}
                        onStateChanged={updateArtboardState}
                      />
                    )
                  })}
                </div>
              </TransformComponent>

            </TransformWrapper>

              <Cursors viewport={{ ...viewportPos, zoom }} />
            </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
