import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react"

import {
  EMPTY_FRAME_CONTROL,
  drivenByOther,
  frameControlKey,
  frameDriverFor,
  nextSettleAt,
  reduceFrameControl,
  type FrameControlAction,
  type FrameControlPresence,
  type FrameControlRecord,
  type FrameDriver,
} from "@/lib/canvas/frame-control"
import type { CanvasPresence } from "@/lib/yjs/react"
import type { YjsCollection } from "@/lib/yjs/schema"

/** Who drives a frame, as the canvas draws it: the driver plus their name and
 *  colour for the tag, the ring and the button's mark. */
export type FrameDriverView =
  | { kind: "none" }
  | { kind: "you" }
  | { kind: "agent" }
  | {
      kind: "person"
      id: string
      name: string
      color: string
      avatar?: string
    }

export interface FrameControlDeps {
  /** The Room's `frameControl` collection. */
  collection: YjsCollection<FrameControlRecord>
  /** This viewer's user id; null until the session loads. */
  viewerId: string | null
  /** Other people's awareness states: who is online, and their name and
   *  colour for the tag and ring. */
  others: ReadonlyArray<{ presence: CanvasPresence }>
  /** The Iframe Layers Frame Control governs. */
  frameIds: readonly string[]
  /** Frames that are one shared browser (#1392): one record for everyone,
   *  rather than one per viewer. */
  sharedIds?: ReadonlySet<string>
  /** The frame this viewer interacts with (Interact pressed), from Canvas
   *  Interaction. Entering Interact asks to drive; leaving it lets go. */
  focusedId: string | null
  setFocusedId: Dispatch<SetStateAction<string | null>>
}

export interface FrameControl {
  /** Who drives `layerId`, as this viewer sees it. */
  driverOf(layerId: string): FrameDriverView
  /**
   * The driver button: interact with the frame, taking it from the agent at
   * once. When another person drives, it asks them instead, and the frame
   * stays as it is until they let you drive.
   */
  interact(layerId: string): void
}

/**
 * Frame Control on the canvas (#1387): the React adapter over the pure
 * reducer in `lib/canvas/frame-control.ts`, which owns every handoff rule.
 *
 * - Interact is the driver's seat. Entering it (the button, a double-click)
 *   asks to drive; leaving it (Esc, a deselect, the button) lets go. A stale
 *   seat, from a tab that closed while interacting, is let go on load.
 * - When someone else takes the frame while this viewer interacts (the asker
 *   handing it to the agent from chat), Interact ends.
 * - Awareness says who is online; a timer re-runs the grace rules when
 *   someone who drives or waits has left.
 */
const NO_SHARED: ReadonlySet<string> = new Set()

export function useFrameControl(deps: FrameControlDeps): FrameControl {
  const {
    collection,
    viewerId,
    others,
    frameIds,
    sharedIds = NO_SHARED,
    focusedId,
    setFocusedId,
  } = deps

  // Re-render on any change to the collection; records are read per frame.
  const revision = useSyncExternalStore(
    useCallback((cb) => collection.observe(cb), [collection]),
    () => collection.toMap(),
    () => collection.toMap()
  )

  const peopleById = useMemo(() => {
    const byId = new Map<
      string,
      CanvasPresence["identity"] & { color: string }
    >()
    for (const { presence } of others) {
      byId.set(presence.identity.id, {
        ...presence.identity,
        color: presence.color,
      })
    }
    return byId
  }, [others])

  // Online people, and when each one we saw leave was last here. Read only
  // from effects (through `presenceNow`), which the `online` set re-runs.
  const online = useMemo(() => {
    const ids = new Set(peopleById.keys())
    if (viewerId) ids.add(viewerId)
    return ids
  }, [peopleById, viewerId])
  const goneAtRef = useRef(new Map<string, number>())
  const lastOnlineRef = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const now = Date.now()
    for (const id of lastOnlineRef.current) {
      if (!online.has(id)) goneAtRef.current.set(id, now)
    }
    for (const id of online) goneAtRef.current.delete(id)
    lastOnlineRef.current = online
  }, [online])
  const presenceNow = useCallback(
    (): FrameControlPresence => ({
      online: lastOnlineRef.current,
      goneAt: new Map(goneAtRef.current),
    }),
    []
  )

  const keyOf = useCallback(
    (layerId: string) =>
      viewerId
        ? frameControlKey(layerId, viewerId, sharedIds.has(layerId))
        : null,
    [viewerId, sharedIds]
  )

  const dispatch = useCallback(
    (layerId: string, action: FrameControlAction) => {
      const key = keyOf(layerId)
      if (!key) return
      const current = collection.get(key)
      const next = reduceFrameControl(
        current ?? { ...EMPTY_FRAME_CONTROL, live: sharedIds.has(layerId) },
        action
      )
      if (
        next === current ||
        (!current && next.driver === null && next.requests.length === 0)
      )
        return
      // A record nobody drives or waits on says nothing; don't keep it.
      if (next.driver === null && next.requests.length === 0) {
        if (current) collection.delete(key)
        return
      }
      collection.set(key, next)
    },
    [collection, keyOf, sharedIds]
  )

  const driverOf = useCallback(
    (layerId: string): FrameDriverView => {
      const key = keyOf(layerId)
      const driver: FrameDriver = frameDriverFor(
        key ? revision.get(key) : undefined,
        viewerId
      )
      if (driver.kind !== "person") return driver
      const person = peopleById.get(driver.id)
      return {
        kind: "person",
        id: driver.id,
        name: person?.name || "Someone",
        color: person?.color ?? "#888888",
        avatar: person?.avatar,
      }
    },
    [keyOf, revision, viewerId, peopleById]
  )

  const interact = useCallback(
    (layerId: string) => {
      if (!viewerId) return
      const driver = driverOf(layerId)
      if (driver.kind === "person") {
        dispatch(layerId, { type: "request", by: viewerId, at: Date.now() })
        return
      }
      setFocusedId(layerId)
    },
    [viewerId, driverOf, dispatch, setFocusedId]
  )

  // Interact is the seat: ask to drive on entering it, let go on leaving it,
  // and let go of any seat this viewer holds on a frame it isn't in.
  const prevFocusedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!viewerId) return
    const entered = focusedId !== prevFocusedRef.current ? focusedId : null
    prevFocusedRef.current = focusedId
    if (entered && frameIds.includes(entered)) {
      dispatch(entered, { type: "request", by: viewerId, at: Date.now() })
    }
    for (const layerId of frameIds) {
      if (layerId === focusedId) continue
      const key = keyOf(layerId)
      if (key && collection.get(key)?.driver === viewerId) {
        dispatch(layerId, {
          type: "release",
          by: viewerId,
          presence: presenceNow(),
        })
      }
    }
    // Someone else took the frame this viewer interacts with.
    if (focusedId && frameIds.includes(focusedId)) {
      const key = keyOf(focusedId)
      const record = key ? collection.get(key) : undefined
      if (drivenByOther(frameDriverFor(record, viewerId))) setFocusedId(null)
    }
  }, [
    focusedId,
    viewerId,
    frameIds,
    collection,
    revision,
    presenceNow,
    dispatch,
    setFocusedId,
    keyOf,
  ])

  // Re-run the grace rules when someone who drives or waits runs out of it.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!viewerId) return
    const now = Date.now()
    const presence = presenceNow()
    let due: number | null = null
    for (const layerId of frameIds) {
      const key = keyOf(layerId)
      const record = key ? collection.get(key) : undefined
      if (!record) continue
      const at = nextSettleAt(record, presence)
      if (at === null) continue
      if (at <= now) {
        dispatch(layerId, { type: "settle", now, presence })
        continue
      }
      if (due === null || at < due) due = at
    }
    if (due === null) return
    const id = setTimeout(() => setTick((n) => n + 1), due - now)
    return () => clearTimeout(id)
  }, [
    frameIds,
    viewerId,
    collection,
    revision,
    online,
    presenceNow,
    dispatch,
    tick,
    keyOf,
  ])

  return useMemo(() => ({ driverOf, interact }), [driverOf, interact])
}
