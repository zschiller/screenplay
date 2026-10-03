import { useEffect, useMemo, useState } from "react"

import {
  frameStreamFor,
  type FrameStreamConnection,
} from "@/lib/frame-stream/client"
import type { BranchData, IframeLayerData } from "@/lib/types"

export interface SharedFrames {
  roomId: string
  /** The Workspace's Frame Stream, when its frames are shared. */
  streamOf(branchId: string | undefined): FrameStreamConnection | undefined
  /** True until the app says whether the Workspace's frames are shared. */
  checking(branchId: string | undefined): boolean
  /** The Iframe Layers that are one shared browser. */
  sharedIds: ReadonlySet<string>
}

/**
 * Which frames on a hosted canvas are shared (#1392): every frame of a
 * Workspace whose dev server is up and whose Sandbox runs a Frame Stream.
 * Asks the app once per Workspace. The desktop app (`enabled` false) keeps
 * today's per-viewer iframes, and so does a Workspace the app says isn't
 * shared.
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

  return useMemo(() => {
    void version
    const streamOf = (branchId: string | undefined) => {
      const stream = branchId ? streams.get(branchId) : undefined
      return stream?.availability === "shared" ? stream : undefined
    }
    const checking = (branchId: string | undefined) =>
      !!branchId && streams.get(branchId)?.availability === "checking"
    const sharedIds = new Set(
      iframeLayers.filter((l) => streamOf(l.branchId)).map((l) => l.id)
    )
    return { roomId, streamOf, checking, sharedIds }
  }, [roomId, streams, iframeLayers, version])
}
