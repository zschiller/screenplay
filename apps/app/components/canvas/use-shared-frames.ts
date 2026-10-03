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
  landOnLiveFrames,
  liveFrames,
  presenceLiveFrameIds,
  type LiveFrame,
} from "@/lib/frame-stream/live-frames"
import { seedLocalFrame } from "@/lib/frame-stream/seed"
import type { CanvasPresence } from "@/lib/yjs/react"
import type { YjsCollection } from "@/lib/yjs/schema"
import type { BranchData, IframeLayerData } from "@/lib/types"

/**
 * How long after a frame can first go live, for this viewer, a frame already
 * live counts as live "when the canvas opened" and is landed on. Covers
 * others' presence and the Workspace's answer arriving after the first paint.
 */
export const LANDING_WINDOW_MS = 3000

const EMPTY: ReadonlySet<string> = new Set()

export interface SharedFrames {
  roomId: string
  /** The Workspace's Frame Stream, when its frames can go live. */
  streamOf(branchId: string | undefined): FrameStreamConnection | undefined
  /** Whether the frame is live, who is on it, and whether this viewer is. */
  liveOf(layerId: string): LiveFrame
  /** The Iframe Layers this viewer sees live: one shared browser in the
   *  Sandbox, streamed. Every other frame is this viewer's own copy. */
  sharedIds: ReadonlySet<string>
  /** Go live on a frame, or join it if it's live: this viewer switches to the
   *  shared browser, which starts at the frame's route. Nobody else moves. */
  goLive(layer: Pick<IframeLayerData, "id" | "branchId">): void
  /** Leave the live frame for this viewer's own copy, seeded with the live
   *  page's cookies and local storage. Not re-joined this session. */
  leave(layer: Pick<IframeLayerData, "id" | "branchId">): void
}

/**
 * Live frames on a hosted canvas (#1516, spec #1512). Frames are each
 * viewer's own copy (a local iframe that follows the room's route and shared
 * state) until someone goes live on one: then it's one browser in the
 * Workspace's Sandbox, streamed to the people on it (#1392). Asks the app once
 * per Workspace whether its frames can go live; the desktop app (`enabled`
 * false) and `SHARED_FRAMES=off` never can.
 *
 * Who is live is presence: this viewer's `liveFrameIds` lists the frames it's
 * on, and the rule in `lib/frame-stream/live-frames.ts` reads everyone's.
 */
export function useSharedFrames({
  roomId,
  enabled,
  agents,
  iframeLayers,
  viewerId,
  others,
  setPresence,
  frameControl,
}: {
  roomId: string
  enabled: boolean
  agents: readonly Pick<BranchData, "id" | "previewDomain">[]
  iframeLayers: readonly Pick<IframeLayerData, "id" | "branchId">[]
  /** This viewer's user id; null until the session loads. */
  viewerId: string | null
  /** Other people's awareness states. */
  others: ReadonlyArray<{ presence: CanvasPresence }>
  /** Merges into this viewer's awareness state. */
  setPresence: (partial: Partial<CanvasPresence>) => void
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

  // This viewer's choices this session: the frames it's on, and the ones it
  // left on purpose.
  const [joined, setJoined] = useState<ReadonlySet<string>>(EMPTY)
  const [left, setLeft] = useState<ReadonlySet<string>>(EMPTY)

  const eligibleIds = useMemo(
    () => iframeLayers.filter((l) => streamOf(l.branchId)).map((l) => l.id),
    [iframeLayers, streamOf]
  )

  const frames = useMemo(
    () =>
      liveFrames({
        frameIds: eligibleIds,
        viewerId,
        others: others.map(({ presence }) => ({
          id: presence.identity.id,
          liveFrameIds: presence.liveFrameIds,
        })),
        choices: { joined, left },
        drivers: (id) =>
          controlRecords.get(frameControlKey(id, "", true))?.driver,
      }),
    [eligibleIds, viewerId, others, joined, left, controlRecords]
  )

  // Landing: a frame already live when it first shows up for this viewer
  // (the canvas opening) is joined, unless this viewer left it.
  const firstEligibleAtRef = useRef(new Map<string, number>())
  useEffect(() => {
    const now = Date.now()
    const firstAt = firstEligibleAtRef.current
    for (const id of eligibleIds) if (!firstAt.has(id)) firstAt.set(id, now)
    const opening = new Map(
      [...frames].filter(
        ([id]) => now - (firstAt.get(id) ?? now) < LANDING_WINDOW_MS
      )
    )
    const land = landOnLiveFrames(opening, { joined, left })
    if (land.length === 0) return
    setJoined((s) => new Set([...s, ...land]))
  }, [eligibleIds, frames, joined, left])

  // Say in presence which frames this viewer is on.
  const presenceKey = presenceLiveFrameIds(frames).join(",")
  useEffect(() => {
    setPresence({ liveFrameIds: presenceKey ? presenceKey.split(",") : [] })
  }, [presenceKey, setPresence])

  // Bumped per switch, so a leave that's still seeding doesn't finish after
  // the viewer joined again.
  const switchSeqRef = useRef(new Map<string, number>())
  const bump = (layerId: string) => {
    const seq = (switchSeqRef.current.get(layerId) ?? 0) + 1
    switchSeqRef.current.set(layerId, seq)
    return seq
  }
  const agentsRef = useRef(agents)
  useEffect(() => {
    agentsRef.current = agents
  })

  const goLive = useCallback(
    (layer: Pick<IframeLayerData, "id" | "branchId">) => {
      if (!streamOf(layer.branchId)) return
      bump(layer.id)
      setJoined((s) => (s.has(layer.id) ? s : new Set(s).add(layer.id)))
      setLeft((s) => {
        if (!s.has(layer.id)) return s
        const next = new Set(s)
        next.delete(layer.id)
        return next
      })
    },
    [streamOf]
  )

  const leave = useCallback(
    (layer: Pick<IframeLayerData, "id" | "branchId">) => {
      const seq = bump(layer.id)
      const stream = streamOf(layer.branchId)
      const previewUrl = agentsRef.current.find(
        (a) => a.id === layer.branchId
      )?.previewDomain
      const finish = () => {
        if (switchSeqRef.current.get(layer.id) !== seq) return
        setJoined((s) => {
          if (!s.has(layer.id)) return s
          const next = new Set(s)
          next.delete(layer.id)
          return next
        })
        setLeft((s) => new Set(s).add(layer.id))
      }
      if (!stream || !previewUrl) {
        finish()
        return
      }
      // The viewer keeps seeing the live frame until their copy holds its
      // cookies and storage; without them (an older Sandbox, a page that
      // isn't up) the copy still opens.
      void (async () => {
        const snapshot = await stream.snapshot(layer.id)
        if (snapshot) await seedLocalFrame(previewUrl, snapshot)
        finish()
      })()
    },
    [streamOf]
  )

  return useMemo(() => {
    const sharedIds = new Set(
      [...frames].filter(([, f]) => f.viewerOn).map(([id]) => id)
    )
    return {
      roomId,
      streamOf,
      liveOf: (layerId: string) => frames.get(layerId) ?? NOT_LIVE,
      sharedIds,
      goLive,
      leave,
    }
  }, [roomId, streamOf, frames, goLive, leave])
}
