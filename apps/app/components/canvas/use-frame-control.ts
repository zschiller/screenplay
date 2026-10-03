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
  isOnline,
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

/** A person waiting for the driver's Give control, as the request popover
 *  draws them. */
export type FrameRequesterView = {
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
  /**
   * Take the driver's seat on a frame this viewer was handed (Give control, a
   * driver who left, a reload). Interact needs the frame selected, so the
   * canvas selects it as well. Defaults to `setFocusedId`.
   */
  takeSeat?: (layerId: string) => void
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
  /** People asking this viewer, the driver, for control, oldest first. Empty
   *  unless this viewer drives. The agent waits without asking. */
  requestsOf(layerId: string): FrameRequesterView[]
  /** Whether this viewer asked the person driving for control. */
  askedFor(layerId: string): boolean
  /** Give control: hand the frame to a person who asked. */
  grant(layerId: string, to: string): void
  /** Not now: turn a person's request down. */
  decline(layerId: string, to: string): void
  /**
   * Step away from the frame: leave Interact, stop driving it and withdraw
   * any ask to. Going local from a shared frame, or rejoining it (#1397),
   * switches which record governs the frame, so it lets go of the old one
   * first.
   */
  letGo(layerId: string): void
}

/**
 * Frame Control on the canvas (#1387): the React adapter over the pure
 * reducer in `lib/canvas/frame-control.ts`, which owns every handoff rule.
 *
 * - Interact is the driver's seat. Entering it (the button, a double-click)
 *   asks to drive; leaving it (Esc, a deselect, the button) lets go. A stale
 *   seat, from a tab that closed while interacting, is let go on load.
 * - When someone else takes the frame while this viewer interacts (the asker
 *   handing it to the agent from chat, Give control), Interact ends.
 * - When the frame is handed to this viewer (Give control, a driver who left),
 *   Interact starts. A shared frame's driver who reloads takes the seat back:
 *   the grace period kept it for them.
 * - Someone a record names who hasn't shown up in awareness yet gets the
 *   grace period from when this viewer first noticed, so a client that just
 *   loaded doesn't count the driver as gone before their presence arrives.
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
    takeSeat = setFocusedId,
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

  const askedFor = useCallback(
    (layerId: string): boolean => {
      const key = keyOf(layerId)
      const record = key ? revision.get(key) : undefined
      return !!record?.requests.some((r) => r.by === viewerId)
    },
    [keyOf, revision, viewerId]
  )

  const interact = useCallback(
    (layerId: string) => {
      if (!viewerId) return
      const driver = driverOf(layerId)
      if (driver.kind === "person") {
        // Asking again takes the ask back.
        dispatch(
          layerId,
          askedFor(layerId)
            ? { type: "cancel", by: viewerId }
            : { type: "request", by: viewerId, at: Date.now() }
        )
        return
      }
      setFocusedId(layerId)
    },
    [viewerId, driverOf, askedFor, dispatch, setFocusedId]
  )

  const requestsOf = useCallback(
    (layerId: string): FrameRequesterView[] => {
      const key = keyOf(layerId)
      const record = key ? revision.get(key) : undefined
      if (!record || record.driver !== viewerId) return []
      return [...record.requests]
        .sort((a, b) => a.at - b.at)
        .flatMap((r) => {
          // Only people who are here: someone gone within their grace may
          // come back, but there's nobody to hand the frame to meanwhile.
          const person = peopleById.get(r.by)
          if (!person) return []
          return [
            {
              id: r.by,
              name: person.name || "Someone",
              color: person.color,
              avatar: person.avatar,
            },
          ]
        })
    },
    [keyOf, revision, viewerId, peopleById]
  )

  const grant = useCallback(
    (layerId: string, to: string) => {
      if (viewerId) dispatch(layerId, { type: "grant", by: viewerId, to })
    },
    [viewerId, dispatch]
  )
  const decline = useCallback(
    (layerId: string, to: string) => {
      if (viewerId) dispatch(layerId, { type: "decline", by: viewerId, to })
    },
    [viewerId, dispatch]
  )

  const letGo = useCallback(
    (layerId: string) => {
      if (!viewerId) return
      setFocusedId((id) => (id === layerId ? null : id))
      const key = keyOf(layerId)
      const record = key ? collection.get(key) : undefined
      if (!record) return
      if (record.driver === viewerId) {
        dispatch(layerId, {
          type: "release",
          by: viewerId,
          presence: presenceNow(),
        })
      } else if (record.requests.some((r) => r.by === viewerId)) {
        dispatch(layerId, { type: "cancel", by: viewerId })
      }
    },
    [viewerId, keyOf, collection, dispatch, presenceNow, setFocusedId]
  )

  // Interact is the seat: ask to drive on entering it, let go on leaving it,
  // and take it when the frame is handed over. Any other seat this viewer
  // holds on a frame it isn't in is let go (a tab that closed mid-Interact).
  const prevFocusedRef = useRef<string | null>(null)
  // The driver each record had when this viewer last looked; absent until
  // the first look, so a seat found on load is told from one just handed over.
  const seenDriverRef = useRef(new Map<string, string | null>())
  useEffect(() => {
    if (!viewerId) return
    const entered = focusedId !== prevFocusedRef.current ? focusedId : null
    prevFocusedRef.current = focusedId
    if (entered && frameIds.includes(entered)) {
      dispatch(entered, { type: "request", by: viewerId, at: Date.now() })
    }
    for (const layerId of frameIds) {
      const key = keyOf(layerId)
      if (!key) continue
      const record = collection.get(key)
      const seen = seenDriverRef.current
      const wasSeen = seen.has(key)
      const before = seen.get(key) ?? null
      seen.set(key, record?.driver ?? null)
      if (layerId === focusedId || record?.driver !== viewerId) continue
      // Handed over just now, or a shared frame's seat kept through a reload.
      const handedOver = wasSeen ? before !== viewerId : record.live
      if (handedOver && layerId !== entered) {
        takeSeat(layerId)
        continue
      }
      dispatch(layerId, {
        type: "release",
        by: viewerId,
        presence: presenceNow(),
      })
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
    takeSeat,
    keyOf,
  ])

  // Re-run the grace rules when someone who drives or waits runs out of it.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!viewerId) return
    const now = Date.now()
    // Someone named here who hasn't shown up yet gets their grace from now:
    // their presence may simply not have arrived on a client that just loaded.
    for (const layerId of frameIds) {
      const key = keyOf(layerId)
      const record = key ? collection.get(key) : undefined
      if (!record) continue
      for (const party of [record.driver, ...record.requests.map((r) => r.by)])
        if (
          party &&
          !isOnline(presenceNow(), party) &&
          !goneAtRef.current.has(party)
        )
          goneAtRef.current.set(party, now)
    }
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

  return useMemo(
    () => ({
      driverOf,
      interact,
      requestsOf,
      askedFor,
      grant,
      decline,
      letGo,
    }),
    [driverOf, interact, requestsOf, askedFor, grant, decline, letGo]
  )
}
