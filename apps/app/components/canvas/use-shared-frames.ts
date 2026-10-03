import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import {
  AGENT_PARTY,
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
  type LiveFrame,
} from "@/lib/frame-stream/live-frames"
import { seedLocalFrame } from "@/lib/frame-stream/seed"
import type { CanvasPresence } from "@/lib/yjs/react"
import type { YjsCollection } from "@/lib/yjs/schema"
import type { BranchData, IframeLayerData } from "@/lib/types"

const EMPTY: ReadonlySet<string> = new Set()
const NO_FACES: readonly LiveFace[] = []

/** One face on a live frame's Live tag (#1519): a person in their cursor
 *  colour, or the agent. */
export type LiveFace =
  | { kind: "agent" }
  | { kind: "person"; id: string; name: string; color: string; avatar?: string }

export interface SharedFrames {
  roomId: string
  /** The Workspace's Frame Stream, when its frames can go live. */
  streamOf(branchId: string | undefined): FrameStreamConnection | undefined
  /** Whether the frame is live, who is on it, and whether this viewer is. */
  liveOf(layerId: string): LiveFrame
  /** The faces on a live frame, in the rule's order: this viewer, the other
   *  people here, then the agent. Empty while the frame isn't live. */
  facesOf(layerId: string): readonly LiveFace[]
  /** The Iframe Layers this viewer sees live: one shared browser in the
   *  Sandbox, streamed. Every other frame is this viewer's own copy. */
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
 * When a frame stops being live, each viewer keeps seeing the stream until
 * their own copy holds the live page's cookies and local storage, so it opens
 * where the live frame was.
 */
export function useSharedFrames({
  roomId,
  enabled,
  agents,
  iframeLayers,
  viewerId,
  self = null,
  others,
  frameControl,
}: {
  roomId: string
  enabled: boolean
  agents: readonly Pick<BranchData, "id" | "previewDomain">[]
  iframeLayers: readonly Pick<IframeLayerData, "id" | "branchId" | "live">[]
  /** This viewer's user id; null until the session loads. */
  viewerId: string | null
  /** This viewer's own awareness state: their face on a live frame. */
  self?: CanvasPresence | null
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

  const frames = useMemo(() => {
    const eligible = iframeLayers.filter((l) => streamOf(l.branchId))
    const turned = new Set(eligible.filter((l) => l.live).map((l) => l.id))
    return liveFrames({
      frameIds: eligible.map((l) => l.id),
      turnedLive: (id) => turned.has(id),
      viewerId,
      others: others.map(({ presence }) => presence.identity.id),
      drivers: (id) =>
        controlRecords.get(frameControlKey(id, "", true))?.driver,
    })
  }, [iframeLayers, streamOf, viewerId, others, controlRecords])

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

  // Each party on a live frame as a face: a person's name, cursor colour
  // and avatar from their presence (the first, when they have two tabs open).
  const faces = useMemo(() => {
    const people = new Map<string, LiveFace>()
    for (const presence of [
      ...(self ? [self] : []),
      ...others.map((o) => o.presence),
    ]) {
      const { id, name, avatar } = presence.identity
      if (people.has(id)) continue
      people.set(id, {
        kind: "person",
        id,
        name: name || "Someone",
        color: presence.color,
        avatar,
      })
    }
    const map = new Map<string, readonly LiveFace[]>()
    for (const [id, frame] of frames) {
      if (!frame.live) continue
      map.set(
        id,
        frame.on.flatMap((party): LiveFace[] => {
          if (party === AGENT_PARTY) return [{ kind: "agent" }]
          const face = people.get(party)
          return face ? [face] : []
        })
      )
    }
    return map
  }, [frames, self, others])

  return useMemo(
    () => ({
      roomId,
      streamOf,
      liveOf: (layerId: string) => frames.get(layerId) ?? NOT_LIVE,
      facesOf: (layerId: string) => faces.get(layerId) ?? NO_FACES,
      sharedIds: shown,
    }),
    [roomId, streamOf, frames, faces, shown]
  )
}
