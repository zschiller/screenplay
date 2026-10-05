import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import {
  frameControlKey,
  type FrameControlRecord,
} from "@/lib/canvas/frame-control"
import {
  frameStreamFor,
  type FrameStreamConnection,
} from "@/lib/frame-stream/client"
import {
  NOT_LIVE,
  liveFrames,
  mockupLiveWorkspace,
  type LiveFrame,
} from "@/lib/frame-stream/live-frames"
import { seedLocalFrame } from "@/lib/frame-stream/seed"
import type { CanvasPresence } from "@/lib/yjs/react"
import type { YjsCollection } from "@/lib/yjs/schema"
import type { BranchData, IframeLayerData, MockupLayerData } from "@/lib/types"

const EMPTY: ReadonlySet<string> = new Set()
const NO_MOCKUPS: readonly Pick<MockupLayerData, "id">[] = []
const NO_OWNERS: ReadonlyMap<string, string> = new Map()

export interface SharedFrames {
  roomId: string
  /** The Workspace's Frame Stream, when its frames can go live. */
  streamOf(branchId: string | undefined): FrameStreamConnection | undefined
  /** Whether the frame or Mockup is live, who is on it, and whether this
   *  viewer is. */
  liveOf(layerId: string): LiveFrame
  /** The Workspace a Mockup is live in, or would go live in; undefined when
   *  no Workspace can run it (`mockupLiveWorkspace`). */
  mockupWorkspaceOf(layerId: string): string | undefined
  /**
   * Whether Mockups show Go live: not on the desktop app, nor where every
   * running Workspace says its frames can't go live (`SHARED_FRAMES=off`).
   * With no Workspace running they show it disabled.
   */
  mockupsGoLive: boolean
  /** The Iframe and Mockup Layers this viewer sees live: one shared browser
   *  in the Sandbox, streamed. Every other one is this viewer's own copy. */
  sharedIds: ReadonlySet<string>
}

/**
 * Live frames on a hosted canvas (#1516, spec #1512). Frames are each
 * viewer's own copy (a local iframe that follows the room's route, shared
 * state and Knobs) until someone turns one live: then it's one browser in the
 * Workspace's Sandbox, streamed to everyone on the canvas (#1392). Going live
 * is the frame's, like its route, so it happens to everyone; the rule in
 * `lib/frame-stream/live-frames.ts` decides. Asks the app once per Workspace
 * whether its frames can go live; the desktop app (`enabled` false) and
 * `SHARED_FRAMES=off` never can.
 *
 * Mockups go live the same way (#1523), in a Workspace they borrow
 * (`mockupLiveWorkspace`), since their static page has none of its own.
 *
 * When a frame stops being live, each viewer keeps seeing the stream until
 * their own copy holds the live page's cookies and local storage, so it opens
 * where the live frame was. A Mockup's page keeps nothing to carry over.
 */
export function useSharedFrames({
  roomId,
  enabled,
  agents,
  iframeLayers,
  mockupLayers = NO_MOCKUPS,
  mockupOwners = NO_OWNERS,
  viewerId,
  others,
  frameControl,
}: {
  roomId: string
  enabled: boolean
  agents: readonly Pick<BranchData, "id" | "previewDomain">[]
  iframeLayers: readonly Pick<IframeLayerData, "id" | "branchId" | "live">[]
  mockupLayers?: readonly Pick<
    MockupLayerData,
    "id" | "live" | "liveBranchId"
  >[]
  /** Each Mockup's Workspace: the one of the chat that last changed it. */
  mockupOwners?: ReadonlyMap<string, string>
  /** This viewer's user id; null until the session loads. */
  viewerId: string | null
  /** Other people's awareness states: who else is on a live frame. */
  others: ReadonlyArray<{ presence: CanvasPresence }>
  /** The Room's Frame Control records: the agent's control keeps a frame
   *  live. */
  frameControl: YjsCollection<FrameControlRecord>
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

  const streamOf = useCallback(
    (branchId: string | undefined) => {
      void version
      const stream = branchId ? streams.get(branchId) : undefined
      return stream?.availability === "shared" ? stream : undefined
    },
    [streams, version]
  )

  const controlRecords = useSyncExternalStore(
    useCallback((cb) => frameControl.observe(cb), [frameControl]),
    () => frameControl.toMap(),
    () => frameControl.toMap()
  )

  const mockupWorkspaces = useMemo(() => {
    const streaming = liveBranchKey
      ? liveBranchKey.split(",").filter((id) => streamOf(id))
      : []
    return new Map(
      mockupLayers.map((m) => [
        m.id,
        mockupLiveWorkspace({
          live: m.live === true,
          liveBranchId: m.liveBranchId,
          ownerBranchId: mockupOwners.get(m.id),
          streaming,
        }),
      ])
    )
  }, [mockupLayers, mockupOwners, liveBranchKey, streamOf])

  const mockupsGoLive = useMemo(() => {
    void version
    if (!enabled) return false
    const answers = [...streams.values()].map((s) => s.availability)
    return !answers.length || !answers.every((a) => a === "unshared")
  }, [enabled, streams, version])

  const frames = useMemo(() => {
    const eligible = iframeLayers.filter((l) => streamOf(l.branchId))
    const turned = new Set(eligible.filter((l) => l.live).map((l) => l.id))
    // A Mockup is live only in the Workspace it went live in.
    const mockups = mockupLayers.filter((m) => mockupWorkspaces.get(m.id))
    for (const m of mockups)
      if (m.live && m.liveBranchId === mockupWorkspaces.get(m.id))
        turned.add(m.id)
    return liveFrames({
      frameIds: [...eligible, ...mockups].map((l) => l.id),
      turnedLive: (id) => turned.has(id),
      viewerId,
      others: others.map(({ presence }) => presence.identity.id),
      drivers: (id) =>
        controlRecords.get(frameControlKey(id, "", true))?.driver,
    })
  }, [
    iframeLayers,
    mockupLayers,
    mockupWorkspaces,
    streamOf,
    viewerId,
    others,
    controlRecords,
  ])

  // The frames this viewer shows live: the live ones, plus frames that just
  // stopped being live, until this viewer's own copy is seeded from them.
  const onKey = [...frames]
    .filter(([, f]) => f.viewerOn)
    .map(([id]) => id)
    .join(",")
  const [prevOnKey, setPrevOnKey] = useState(onKey)
  const [ending, setEnding] = useState<ReadonlySet<string>>(EMPTY)
  if (onKey !== prevOnKey) {
    const on = new Set(onKey ? onKey.split(",") : [])
    const dropped = (prevOnKey ? prevOnKey.split(",") : []).filter(
      (id) => !on.has(id)
    )
    setPrevOnKey(onKey)
    if (dropped.length) setEnding(new Set([...ending, ...dropped]))
  }

  const seedingRef = useRef(new Set<string>())
  const agentsRef = useRef(agents)
  useEffect(() => {
    agentsRef.current = agents
  })
  useEffect(() => {
    for (const id of ending) {
      if (seedingRef.current.has(id)) continue
      seedingRef.current.add(id)
      const layer = iframeLayers.find((l) => l.id === id)
      const stream = streamOf(layer?.branchId)
      const previewUrl = agentsRef.current.find(
        (a) => a.id === layer?.branchId
      )?.previewDomain
      void (async () => {
        // Without the live page's state (an older Sandbox, a page that
        // isn't up), the copy still opens.
        const snapshot = stream && previewUrl ? await stream.snapshot(id) : null
        if (snapshot && previewUrl) await seedLocalFrame(previewUrl, snapshot)
        seedingRef.current.delete(id)
        setEnding((s) => {
          if (!s.has(id)) return s
          const next = new Set(s)
          next.delete(id)
          return next
        })
      })()
    }
  }, [ending, iframeLayers, streamOf])

  const shown = useMemo(
    () => new Set([...(onKey ? onKey.split(",") : []), ...ending]),
    [onKey, ending]
  )

  return useMemo(
    () => ({
      roomId,
      streamOf,
      liveOf: (layerId: string) => frames.get(layerId) ?? NOT_LIVE,
      mockupWorkspaceOf: (layerId: string) => mockupWorkspaces.get(layerId),
      mockupsGoLive,
      sharedIds: shown,
    }),
    [roomId, streamOf, frames, mockupWorkspaces, mockupsGoLive, shown]
  )
}
