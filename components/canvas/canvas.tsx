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
  useSelf,
  useUpdateMyPresence,
} from "@liveblocks/react/suspense"
import { Artboard } from "./artboard"
import { Cursors } from "./cursors"
import type { JsonObject } from "@/lib/postmessage-protocol"
import { Toolbar } from "@/components/panels/toolbar"
import { SandboxPanel } from "@/components/panels/sandbox-panel"
import { AgentChat } from "@/components/agent/agent-chat"
import type { SandboxData } from "@/lib/liveblocks.types"
import {
  createSandbox as createSandboxAction,
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
  const [chatSandboxId, setChatSandboxId] = useState<string | null>(null)
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

  const sandboxes = useStorage((root) => {
    const result: SandboxData[] = []
    for (const [key, sandbox] of Object.entries(root.sandboxes)) {
      result.push({
        id: key,
        sandboxName: sandbox.sandboxName,
        gitUrl: sandbox.gitUrl,
        branch: sandbox.branch,
        previewDomain: sandbox.previewDomain,
        port: sandbox.port,
        status: sandbox.status,
        error: sandbox.error,
        createdAt: sandbox.createdAt,
      })
    }
    return result
  })

  const sandboxDomains = useStorage((root) => {
    const domains: Record<string, { previewDomain: string; branch: string }> =
      {}
    for (const [key, sandbox] of Object.entries(root.sandboxes)) {
      if (sandbox.previewDomain) {
        domains[key] = {
          previewDomain: sandbox.previewDomain,
          branch: sandbox.branch,
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

  const addArtboard = useMutation(
    ({ storage }, sandboxId: string, label: string) => {
      const { cx, cy } = getViewportCenter()
      const artboardsMap = storage.get("artboards")
      const existing = Array.from(artboardsMap.values()).filter(
        (a) => a.get("sandboxId") === sandboxId,
      )
      const offset = existing.length * 40
      const id = nanoid()
      artboardsMap.set(
        id,
        new LiveObject({
          id,
          sandboxId,
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

  const updateSandboxInStorage = useMutation(
    ({ storage }, id: string, data: Partial<SandboxData>) => {
      const sandbox = storage.get("sandboxes").get(id)
      if (sandbox) {
        for (const [key, value] of Object.entries(data)) {
          sandbox.set(key as keyof SandboxData, value as never)
        }
      }
    },
    [],
  )

  const addSandboxToStorage = useMutation(
    ({ storage }, id: string, data: SandboxData) => {
      storage.get("sandboxes").set(id, new LiveObject(data))
    },
    [],
  )

  const removeSandboxFromStorage = useMutation(
    ({ storage }, id: string) => {
      storage.get("sandboxes").delete(id)
      // Remove all artboards for this sandbox
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

  const handleAddArtboard = useCallback(() => {
    addArtboard("", `Screen ${artboards.length + 1}`)
  }, [addArtboard, artboards.length])

  const handleAddArtboardForSandbox = useCallback(
    (sandboxLocalId: string) => {
      const sandbox = sandboxes.find((s) => s.id === sandboxLocalId)
      if (!sandbox || sandbox.status !== "running") return
      const existing = artboards.filter(
        (a) => a.sandboxId === sandboxLocalId,
      )
      addArtboard(
        sandboxLocalId,
        `${sandbox.branch} — Screen ${existing.length + 1}`,
      )
    },
    [sandboxes, artboards, addArtboard],
  )

  const handleCreateSandbox = useCallback(
    async (gitUrl: string, branch: string, env?: Record<string, string>) => {
      const id = nanoid()
      const data: SandboxData = {
        id,
        sandboxName: "",
        gitUrl,
        branch,
        previewDomain: "",
        port: 3000,
        status: "creating",
        createdAt: Date.now(),
      }
      addSandboxToStorage(id, data)

      const result = await createSandboxAction(gitUrl, branch, 3000, env)
      updateSandboxInStorage(id, {
        sandboxName: result.sandboxName,
        previewDomain: result.previewDomain,
        status: result.status === "running" ? "running" : "error",
        error: result.error,
      })

      // Auto-create an artboard when sandbox starts running
      if (result.status === "running") {
        addArtboard(id, `${branch} — Screen 1`)
      }
    },
    [addSandboxToStorage, updateSandboxInStorage, addArtboard],
  )

  const handleRefreshSandbox = useCallback(
    async (id: string) => {
      const sandbox = sandboxes.find((s) => s.id === id)
      if (!sandbox?.sandboxName) return

      updateSandboxInStorage(id, { status: "starting" })

      const result = await restartSandbox(
        sandbox.sandboxName,
        sandbox.gitUrl,
        sandbox.branch,
        sandbox.port,
      )
      updateSandboxInStorage(id, {
        sandboxName: result.sandboxName,
        previewDomain: result.previewDomain || sandbox.previewDomain,
        status: result.status === "running" ? "running" : "error",
        error: result.error,
      })
    },
    [sandboxes, updateSandboxInStorage],
  )

  // Reconnect sandboxes on mount — check if they're still alive
  const reconnectedRef = useRef(false)
  useEffect(() => {
    if (reconnectedRef.current || sandboxes.length === 0) return
    reconnectedRef.current = true

    for (const sandbox of sandboxes) {
      if (!sandbox.sandboxName || sandbox.status === "creating") continue

      reconnectSandbox(sandbox.sandboxName, sandbox.port).then((result) => {
        if (result.status === "running") {
          updateSandboxInStorage(sandbox.id, {
            previewDomain: result.previewDomain,
            status: "running",
          })
        } else {
          updateSandboxInStorage(sandbox.id, {
            status: "stopped",
            error: "Sandbox stopped — click refresh to restart",
          })
        }
      })
    }
  }, [sandboxes, updateSandboxInStorage])

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const ref = transformRef.current
      if (!ref) return
      const { positionX, positionY, scale } = ref.state
      // Convert screen coords to canvas-space
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
              const sandboxInfo = sandboxDomains[artboard.sandboxId]
              return (
                <Artboard
                  key={artboard.id}
                  artboard={{
                    ...artboard,
                    iframeUrl: sandboxInfo?.previewDomain,
                    branch: sandboxInfo?.branch,
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

        <Toolbar zoom={zoom} onAddArtboard={handleAddArtboard} />
      </TransformWrapper>

      <Cursors viewport={{ ...viewportPos, zoom }} />

      <SandboxPanel
        sandboxes={sandboxes}
        onCreateSandbox={handleCreateSandbox}
        onRefresh={handleRefreshSandbox}
        onRemove={removeSandboxFromStorage}
        onAddArtboard={handleAddArtboardForSandbox}
        onOpenChat={setChatSandboxId}
      />

      {chatSandboxId && (() => {
        const sandbox = sandboxes.find((s) => s.id === chatSandboxId)
        if (!sandbox?.sandboxName) return null
        return (
          <AgentChat
            sandboxName={sandbox.sandboxName}
            branch={sandbox.branch}
            onClose={() => setChatSandboxId(null)}
          />
        )
      })()}
    </div>
  )
}
