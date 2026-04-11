"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { PanelLeft } from "lucide-react"
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchContentRef,
} from "react-zoom-pan-pinch"
import { nanoid } from "nanoid"
import { uniqueNamesGenerator, adjectives, colors, animals } from "unique-names-generator"
import { LiveObject } from "@liveblocks/client"
import {
  useMutation,
  useStorage,
  useUpdateMyPresence,
} from "@liveblocks/react/suspense"
import { Artboard } from "./artboard"
import { Cursors } from "./cursors"
import type { JsonObject } from "@/lib/postmessage-protocol"
import { Button } from "@/components/ui/button"
import { Toolbar } from "@/components/panels/toolbar"
import { AgentSidebar } from "@/components/panels/agent-sidebar"
import { AgentChat } from "@/components/agent/agent-chat"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable"
import type { PanelImperativeHandle } from "react-resizable-panels"
import type { AgentData, WorkspaceData } from "@/lib/liveblocks.types"
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

export function Canvas() {
  const [zoom, setZoom] = useState(1)
  const [viewportPos, setViewportPos] = useState({ x: 0, y: 0 })
  const [focusedArtboardId, setFocusedArtboardId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const transformRef = useRef<ReactZoomPanPinchContentRef>(null)
  const sidebarPanelRef = useRef<PanelImperativeHandle>(null)
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
        sessionId: agent.sessionId,
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
      for (const agentId of agentIds) {
        agentsMap.delete(agentId)
        const toDelete: string[] = []
        artboardsMap.forEach((artboard, key) => {
          if (artboard.get("sandboxId") === agentId) {
            toDelete.push(key)
          }
        })
        toDelete.forEach((key) => artboardsMap.delete(key))
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
          label: "Screen 1",
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
        `Screen ${existing.length + 1}`,
      )
    },
    [agents, artboards, addArtboard],
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
    },
    [workspaces, addAgentToStorage, updateAgentInStorage, ensureFirstArtboard],
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
    },
    [agents, workspaces, addAgentToStorage, updateAgentInStorage, ensureFirstArtboard],
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

  // Reconnect agents on mount — check if they're still alive,
  // including agents that were mid-creation when the page was reloaded
  const reconnectedRef = useRef(false)
  useEffect(() => {
    if (reconnectedRef.current || agents.length === 0) return
    reconnectedRef.current = true

    for (const agent of agents) {
      if (!agent.sandboxName) continue

      reconnectSandbox(agent.sandboxName, agent.port).then((result) => {
        if (result.status === "running") {
          updateAgentInStorage(agent.id, {
            previewDomain: result.previewDomain,
            status: "running",
          })
          // If this agent finished creating while we were away, add its first artboard
          if (agent.status === "creating") {
            ensureFirstArtboard(agent.id)
          }
        } else if (agent.status === "creating") {
          // Still creating or failed — sandbox not ready yet
          updateAgentInStorage(agent.id, {
            status: "error",
            error: "Creation interrupted — remove and try again",
          })
        } else {
          updateAgentInStorage(agent.id, {
            status: "stopped",
            error: "Sandbox stopped — click refresh to restart",
          })
        }
      })
    }
  }, [agents, updateAgentInStorage, ensureFirstArtboard])

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
  const chatOpen = sidebarOpen && !!selectedAgent?.sandboxName

  // Sync sidebar panel with sidebarOpen state
  useEffect(() => {
    const panel = sidebarPanelRef.current
    if (!panel) return
    if (sidebarOpen) panel.expand()
    else panel.collapse()
  }, [sidebarOpen])

  // Sync chat panel with chatOpen state
  useEffect(() => {
    const panel = chatPanelRef.current
    if (!panel) return
    if (chatOpen) panel.resize(480)
    else panel.collapse()
  }, [chatOpen])

  return (
    <div className="fixed inset-0 bg-muted/30">
      <ResizablePanelGroup orientation="horizontal">
        {/* Sidebar — always mounted, collapsed via imperative API */}
        <ResizablePanel
          id="sidebar"
          panelRef={sidebarPanelRef}
          defaultSize={280}
          minSize={220}
          maxSize={400}
          collapsible
          collapsedSize={0}
          groupResizeBehavior="preserve-pixel-size"
        >
          <AgentSidebar
            workspaces={workspaces}
            agents={agents}
            artboards={artboards}
            selectedAgentId={selectedAgentId}
            onSelectAgent={setSelectedAgentId}
            onCreateWorkspace={handleCreateWorkspace}
            onUpdateWorkspace={updateWorkspaceInStorage}
            onRemoveWorkspace={removeWorkspaceFromStorage}
            onCreateAgent={handleCreateAgent}
            onForkAgent={handleForkAgent}
            onRefreshAgent={handleRefreshAgent}
            onRemoveAgent={(id) => {
              if (selectedAgentId === id) setSelectedAgentId(null)
              removeAgentFromStorage(id)
            }}
            onAddArtboard={handleAddArtboardForAgent}
            onUpdateAgent={updateAgentInStorage}
            onClose={() => setSidebarOpen(false)}
          />
        </ResizablePanel>
        <ResizableHandle />

        {/* Chat — always mounted, collapsed via imperative API */}
        <ResizablePanel
          id="chat"
          panelRef={chatPanelRef}
          defaultSize={chatOpen ? 480 : 0}
          minSize={280}
          collapsible
          collapsedSize={0}
          groupResizeBehavior="preserve-pixel-size"
        >
          {selectedAgent?.sandboxName && (
            <AgentChat
              key={selectedAgent.id}
              sandboxId={selectedAgent.id}
              sandboxName={selectedAgent.sandboxName}
              branch={selectedAgent.branch}
              sessionId={selectedAgent.sessionId}
              onSessionId={(sid) =>
                updateAgentInStorage(selectedAgent.id, {
                  sessionId: sid || undefined,
                })
              }
              onBranchRename={(branch) =>
                handleBranchRename(selectedAgent.id, branch)
              }
            />
          )}
        </ResizablePanel>
        <ResizableHandle disabled={!chatOpen} className={chatOpen ? "" : "!w-0"} />

        {/* Canvas */}
        <ResizablePanel id="canvas">
          <div
            className="relative h-full w-full"
            style={{ clipPath: "inset(0)" }}
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
          >
            {!sidebarOpen && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute left-4 top-4 z-50 h-8 w-8 bg-background/80 shadow-sm backdrop-blur-sm"
                onClick={() => setSidebarOpen(true)}
              >
                <PanelLeft className="h-4 w-4" />
              </Button>
            )}

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
                step: ZOOM_STEP,
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

              <Toolbar zoom={zoom} />
            </TransformWrapper>

            <Cursors viewport={{ ...viewportPos, zoom }} />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
