"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchContentRef,
} from "react-zoom-pan-pinch"
import { nanoid } from "nanoid"
import { LiveObject } from "@liveblocks/client"
import {
  useMutation,
  useStorage,
  useUpdateMyPresence,
} from "@liveblocks/react/suspense"
import { Artboard } from "./artboard"
import { Cursors } from "./cursors"
import type { JsonObject } from "@/lib/postmessage-protocol"
import { Toolbar } from "@/components/panels/toolbar"
import { AgentSidebar } from "@/components/panels/agent-sidebar"
import type { AgentData, WorkspaceData } from "@/lib/liveblocks.types"
import type { GitHubRepo } from "@/lib/github-actions"
import {
  createAgentSandbox,
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

export function Canvas() {
  const [zoom, setZoom] = useState(1)
  const [viewportPos, setViewportPos] = useState({ x: 0, y: 0 })
  const [focusedArtboardId, setFocusedArtboardId] = useState<string | null>(null)
  const transformRef = useRef<ReactZoomPanPinchContentRef>(null)
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

  const addArtboard = useMutation(
    ({ storage }, agentId: string, label: string) => {
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
        `${agent.branch} — Screen ${existing.length + 1}`,
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

      // Generate names client-side so they survive page reloads
      const id = nanoid()
      const sandboxName = `sp-${nanoid(10)}`
      const branch = `screenplay/agent-${nanoid(8)}`

      const data: AgentData = {
        id,
        workspaceId,
        sandboxName,
        gitUrl: workspace.cloneUrl,
        branch,
        previewDomain: "",
        port: 3000,
        status: "creating",
        createdAt: Date.now(),
      }
      addAgentToStorage(id, data)

      const result = await createAgentSandbox(sandboxName, branch, workspace)
      updateAgentInStorage(id, {
        previewDomain: result.previewDomain,
        status: result.status === "running" ? "running" : "error",
        error: result.error,
      })

      if (result.status === "running") {
        addArtboard(id, `${branch} — Screen 1`)
      }
    },
    [workspaces, addAgentToStorage, updateAgentInStorage, addArtboard],
  )

  const handleForkAgent = useCallback(
    async (agentId: string) => {
      const sourceAgent = agents.find((a) => a.id === agentId)
      if (!sourceAgent?.branch) return

      const workspace = workspaces.find((w) => w.id === sourceAgent.workspaceId)
      if (!workspace) return

      const id = nanoid()
      const sandboxName = `sp-${nanoid(10)}`
      const branch = `screenplay/agent-${nanoid(8)}`

      const data: AgentData = {
        id,
        workspaceId: sourceAgent.workspaceId,
        sandboxName,
        gitUrl: sourceAgent.gitUrl,
        branch,
        previewDomain: "",
        port: 3000,
        status: "creating",
        createdAt: Date.now(),
      }
      addAgentToStorage(id, data)

      const result = await createAgentSandbox(
        sandboxName,
        branch,
        workspace,
        sourceAgent.branch,
      )
      updateAgentInStorage(id, {
        previewDomain: result.previewDomain,
        status: result.status === "running" ? "running" : "error",
        error: result.error,
      })

      if (result.status === "running") {
        addArtboard(id, `${branch} — Screen 1`)
      }
    },
    [agents, workspaces, addAgentToStorage, updateAgentInStorage, addArtboard],
  )

  const handleRefreshAgent = useCallback(
    async (id: string) => {
      const agent = agents.find((a) => a.id === id)
      if (!agent?.sandboxName) return

      const workspace = workspaces.find((w) => w.id === agent.workspaceId)

      updateAgentInStorage(id, { status: "starting" })

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
        error: result.error,
      })
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
          // If this was a creating agent that finished while we were away,
          // make sure it has at least one artboard
          if (agent.status === "creating") {
            const hasArtboards = artboards.some(
              (a) => a.sandboxId === agent.id,
            )
            if (!hasArtboards) {
              addArtboard(agent.id, `${agent.branch} — Screen 1`)
            }
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
  }, [agents, artboards, updateAgentInStorage, addArtboard])

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const ref = transformRef.current
      if (!ref) return
      const { positionX, positionY, scale } = ref.state
      const canvasX = (e.clientX - positionX) / scale
      const canvasY = (e.clientY - positionY) / scale
      updateMyPresence({ cursor: { x: canvasX, y: canvasY } })
    },
    [updateMyPresence],
  )

  const handlePointerLeave = useCallback(() => {
    updateMyPresence({ cursor: null })
  }, [updateMyPresence])

  return (
    <div
      className="fixed inset-0 bg-muted/30"
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
        wheel={{ step: ZOOM_STEP, disabled: focusedArtboardId !== null }}
        panning={{ velocityDisabled: true, disabled: focusedArtboardId !== null }}
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

      <AgentSidebar
        workspaces={workspaces}
        agents={agents}
        onCreateWorkspace={handleCreateWorkspace}
        onUpdateWorkspace={updateWorkspaceInStorage}
        onRemoveWorkspace={removeWorkspaceFromStorage}
        onCreateAgent={handleCreateAgent}
        onForkAgent={handleForkAgent}
        onRefreshAgent={handleRefreshAgent}
        onRemoveAgent={removeAgentFromStorage}
        onAddArtboard={handleAddArtboardForAgent}
        onUpdateAgent={updateAgentInStorage}
      />
    </div>
  )
}
