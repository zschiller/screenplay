import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  frameStreamFor,
  type FrameStreamConnection,
} from "@/lib/frame-stream/client"
import { seedLocalFrame } from "@/lib/frame-stream/seed"
import type { BranchData, IframeLayerData } from "@/lib/types"

/** This viewer's own copy of a shared frame (#1397). */
export interface LocalCopy {
  /** The route the copy shows. It navigates on its own, never the room's. */
  route: string
}

type LocalEntry = LocalCopy & {
  branchId: string
  /** False while the copy takes the shared page's cookies and storage; the
   *  viewer keeps seeing the shared frame until then. */
  ready: boolean
}

export interface SharedFrames {
  roomId: string
  /** The Workspace's Frame Stream, when its frames are shared. */
  streamOf(branchId: string | undefined): FrameStreamConnection | undefined
  /** True until the app says whether the Workspace's frames are shared. */
  checking(branchId: string | undefined): boolean
  /** The Iframe Layers that are one shared browser, for this viewer: a
   *  frame this viewer took a local copy of isn't. */
  sharedIds: ReadonlySet<string>
  /** This viewer's local copy of a shared frame, once it's ready. */
  localCopyOf(
    layer: Pick<IframeLayerData, "id" | "branchId">
  ): LocalCopy | undefined
  /** Switch this viewer's view of a shared frame to a local iframe, starting
   *  from the shared page's URL, cookies and local storage. */
  goLocal(layer: Pick<IframeLayerData, "id" | "branchId" | "route">): void
  /** Drop the local copy and show the shared frame as it is now. */
  rejoin(layerId: string): void
  /** Where the local copy navigated, or was sent from its address bar. */
  setLocalRoute(layerId: string, route: string): void
}

/**
 * Which frames on a hosted canvas are shared (#1392): every frame of a
 * Workspace whose dev server is up and whose Sandbox runs a Frame Stream.
 * Asks the app once per Workspace. The desktop app (`enabled` false) keeps
 * today's per-viewer iframes, and so does a Workspace the app says isn't
 * shared.
 *
 * A viewer can take a local copy of a shared frame, for devtools or a gesture
 * the stream can't carry (#1397). Only their view switches, and nothing done
 * in it reaches the shared frame; rejoining discards it.
 */
export function useSharedFrames({
  roomId,
  enabled,
  agents,
  iframeLayers,
}: {
  roomId: string
  enabled: boolean
  agents: readonly Pick<BranchData, "id" | "previewDomain">[]
  iframeLayers: readonly Pick<IframeLayerData, "id" | "branchId">[]
}): SharedFrames {
  const liveBranchKey = enabled
    ? agents
        .filter((a) => a.previewDomain)
        .map((a) => a.id)
        .sort()
        .join(",")
    : ""

  const streams = useMemo(() => {
    const map = new Map<string, FrameStreamConnection>()
    for (const id of liveBranchKey ? liveBranchKey.split(",") : []) {
      map.set(id, frameStreamFor(roomId, id))
    }
    return map
  }, [roomId, liveBranchKey])

  // Re-render when a Workspace's answer arrives.
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const unsubscribe = [...streams.values()].map((stream) => {
      stream.check()
      return stream.subscribeAvailability(() => setVersion((n) => n + 1))
    })
    return () => unsubscribe.forEach((u) => u())
  }, [streams])

  const [local, setLocal] = useState<ReadonlyMap<string, LocalEntry>>(
    () => new Map()
  )

  const streamOf = useCallback(
    (branchId: string | undefined) => {
      void version
      const stream = branchId ? streams.get(branchId) : undefined
      return stream?.availability === "shared" ? stream : undefined
    },
    [streams, version]
  )

  // A copy lasts while its frame shows the Workspace it was taken from and
  // that Workspace still shares its frames.
  const localCopyOf = useCallback(
    (layer: Pick<IframeLayerData, "id" | "branchId">) => {
      const entry = local.get(layer.id)
      if (!entry?.ready || entry.branchId !== layer.branchId) return undefined
      if (!streamOf(layer.branchId)) return undefined
      return { route: entry.route }
    },
    [local, streamOf]
  )

  // Bumped per switch, so a copy that's still taking its storage when the
  // viewer rejoins (or goes local again) doesn't open afterwards.
  const switchSeqRef = useRef(new Map<string, number>())
  const agentsRef = useRef(agents)
  useEffect(() => {
    agentsRef.current = agents
  })

  const goLocal = useCallback(
    (layer: Pick<IframeLayerData, "id" | "branchId" | "route">) => {
      const branchId = layer.branchId
      const stream = streamOf(branchId)
      const previewUrl = agentsRef.current.find(
        (a) => a.id === branchId
      )?.previewDomain
      if (!branchId || !stream || !previewUrl) return
      const seq = (switchSeqRef.current.get(layer.id) ?? 0) + 1
      switchSeqRef.current.set(layer.id, seq)
      const route = layer.route || "/"
      setLocal((m) =>
        new Map(m).set(layer.id, { branchId, route, ready: false })
      )
      void (async () => {
        // Without the shared page's state (an older Sandbox, a page that
        // isn't up), the copy still opens, at the room's route.
        const snapshot = await stream.snapshot(layer.id)
        if (snapshot) await seedLocalFrame(previewUrl, snapshot)
        if (switchSeqRef.current.get(layer.id) !== seq) return
        setLocal((m) => {
          const entry = m.get(layer.id)
          if (!entry) return m
          return new Map(m).set(layer.id, {
            ...entry,
            route: snapshot?.path || entry.route,
            ready: true,
          })
        })
      })()
    },
    [streamOf]
  )

  const rejoin = useCallback((layerId: string) => {
    switchSeqRef.current.set(
      layerId,
      (switchSeqRef.current.get(layerId) ?? 0) + 1
    )
    setLocal((m) => {
      if (!m.has(layerId)) return m
      const next = new Map(m)
      next.delete(layerId)
      return next
    })
  }, [])

  const setLocalRoute = useCallback((layerId: string, route: string) => {
    setLocal((m) => {
      const entry = m.get(layerId)
      if (!entry || entry.route === route) return m
      return new Map(m).set(layerId, { ...entry, route })
    })
  }, [])

  return useMemo(() => {
    const checking = (branchId: string | undefined) =>
      !!branchId && streams.get(branchId)?.availability === "checking"
    const sharedIds = new Set(
      iframeLayers
        .filter((l) => streamOf(l.branchId) && !localCopyOf(l))
        .map((l) => l.id)
    )
    return {
      roomId,
      streamOf,
      checking,
      sharedIds,
      localCopyOf,
      goLocal,
      rejoin,
      setLocalRoute,
    }
  }, [
    roomId,
    streams,
    iframeLayers,
    streamOf,
    localCopyOf,
    goLocal,
    rejoin,
    setLocalRoute,
  ])
}
