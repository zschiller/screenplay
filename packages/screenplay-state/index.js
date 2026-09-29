// @screenplay.space/state runtime helper.
//
// useSharedState() bridges a piece of UI state to the parent screenplay
// canvas. The canvas persists the merged state per artboard via Yjs and
// fans it back out to every connected client's iframe, so a state change in
// one viewer's prototype shows up in every other viewer's prototype within
// the same room. The canvas itself doesn't render an editor — it shows a
// tiny indicator inside the route pill with the JSON in a tooltip.
//
// The package is dev-only by design. In any build with `NODE_ENV` set to
// anything other than `"development"` — production, test, no bundler at all
// — every API on this module is a no-op. Nothing ever leaves the page, no
// inbound listener is attached, no remote setter is ever invoked. That's
// the production-safety story: a prototype that ships `useSharedState`
// calls and gets iframed by some non-screenplay parent in production cannot
// have its state read or written via this protocol, because none of the
// postMessage paths run. The gate compares against the literal the bundler
// inlines for `process.env.NODE_ENV`, so the branches are statically false
// in a production bundle; whether a given minifier also strips them is up
// to the minifier, but the inertness doesn't depend on that.
//
// Each useSharedState(key, value, setter?) call (in dev, when iframed):
//   1. Registers the (optional) setter so remote updates can write back into
//      the prototype's local state.
//   2. Diffs the new value against the last-seen one.
//   3. Posts the merged map up to the canvas via `screenplay:shared-state`
//      (microtask-debounced) iff the local value actually changed.
//
// The canvas pushes incoming state from other clients down via
// `screenplay:shared-state-apply`; the runtime applies that to all setters
// registered for the affected keys, marking the value as "remote-applied"
// so the resulting React rerender doesn't echo it back up.
//
// The room's state wins when a frame loads. On load the runtime asks the
// canvas for the room's current state (`screenplay:shared-state-request`) and
// holds its first publish until the answer (an apply with `initial: true`)
// arrives, or until ROOM_ANSWER_TIMEOUT_MS passes for a canvas that never
// answers. The frame's own values then only fill keys the room doesn't have.
import { useEffect, useRef } from "react"

const isBrowser = typeof window !== "undefined"

// Read NODE_ENV as a bare `process.env.NODE_ENV` member expression, with no
// `typeof process` guard in front of it. Bundlers statically replace that
// *expression*; only some of them (Next) also inject a browser `process`
// shim. Vite replaces the expression inside dependencies but defines no
// global `process`, so a `typeof process !== "undefined"` guard is false at
// runtime and leaves this package permanently inert in Vite apps. Reading
// the expression directly means the substituted literal is what gets
// compared. The try/catch covers the no-bundler case, where nothing replaced
// the expression and `process` is genuinely absent (ReferenceError) or has
// no `env` (TypeError): it yields `undefined` instead of throwing at module
// load.
function readNodeEnv() {
  try {
    return process.env.NODE_ENV
  } catch {
    return undefined
  }
}

// Treat anything that isn't an explicit "development" build as production —
// fail closed for plain ESM-in-browser loads where there's no bundler to
// inline NODE_ENV.
const isDev = readNodeEnv() === "development"
const active = isDev && isBrowser && window.parent !== window

// Hard cap on the published payload. Anything above this gets dropped with
// a console warning rather than being shipped over postMessage — protects
// the canvas from a runaway useSharedState call (e.g. someone passing the
// entire DOM in by accident). Yjs would otherwise replicate that to every
// connected client on every change.
const MAX_PAYLOAD_BYTES = 64 * 1024

// key -> { value: JsonValue, serialized: string }
const entries = new Map()
// key -> Set<(value) => void>
const settersByKey = new Map()
let publishScheduled = false
// The room's state as this frame last saw it: the last full map the canvas
// sent down or this frame published. A component that mounts with its own
// default for a key the room already holds adopts the room's value instead.
let roomState = {}
// Publishes wait until the room has answered the request sent on load.
const ROOM_ANSWER_TIMEOUT_MS = 500
let heardRoom = false
let publishHeld = false

function roomAnswered() {
  if (heardRoom) return
  heardRoom = true
  if (publishHeld) schedulePublish()
}

function safeStringify(value) {
  try {
    const out = JSON.stringify(value)
    return typeof out === "string" ? out : null
  } catch {
    return null
  }
}

function schedulePublish() {
  if (!active) return
  if (!heardRoom) {
    publishHeld = true
    return
  }
  if (publishScheduled) return
  publishScheduled = true
  // Microtask-coalesce so a render that calls useSharedState many times
  // results in a single postMessage to the canvas.
  Promise.resolve().then(() => {
    publishScheduled = false
    const out = {}
    for (const [k, entry] of entries) out[k] = entry.value
    const serialized = safeStringify(out)
    if (serialized === null) return
    if (serialized.length > MAX_PAYLOAD_BYTES) {
      // Don't ship oversized state — the canvas would store it in Yjs and
      // every connected client would pay for it on each update.
      // eslint-disable-next-line no-console
      console.warn(
        `[@screenplay.space/state] shared-state payload exceeds ${MAX_PAYLOAD_BYTES} bytes; dropping. Consider sharing a smaller summary.`,
      )
      return
    }
    roomState = out
    window.parent.postMessage(
      { type: "screenplay:shared-state", state: out },
      "*",
    )
  })
}

/**
 * Update the in-memory entry for `key`. Returns true if the entry's
 * serialized value changed (i.e. a publish would be meaningful).
 */
function updateEntry(key, value) {
  const serialized = safeStringify(value)
  if (serialized === null) return false
  const existing = entries.get(key)
  if (existing && existing.serialized === serialized) return false
  // Re-parse so we publish a structurally-cloneable, function-stripped copy.
  let cloned
  try {
    cloned = JSON.parse(serialized)
  } catch {
    return false
  }
  entries.set(key, { value: cloned, serialized })
  return true
}

function setEntry(key, value) {
  if (!active) return
  if (typeof key !== "string" || key.length === 0) return
  if (updateEntry(key, value)) schedulePublish()
}

function clearEntry(key) {
  if (!active) return
  if (!entries.has(key)) return
  entries.delete(key)
  schedulePublish()
}

function addSetter(key, setter) {
  let set = settersByKey.get(key)
  if (!set) {
    set = new Set()
    settersByKey.set(key, set)
  }
  set.add(setter)
  // Late mounters get the latest known value immediately so a component
  // that registered after a remote update still ends up in sync.
  const existing = entries.get(key)
  if (existing) {
    try {
      setter(existing.value)
    } catch {}
  }
}

function removeSetter(key, setter) {
  const set = settersByKey.get(key)
  if (!set) return
  set.delete(setter)
  if (set.size === 0) settersByKey.delete(key)
}

if (active) {
  window.addEventListener("message", (e) => {
    const data = e.data
    if (!data || data.type !== "screenplay:shared-state-apply") return
    const incoming = data.state
    if (!incoming || typeof incoming !== "object") return
    roomState = incoming
    // Release the held publish after this apply, so it carries the room's
    // values plus the frame's own values for keys the room doesn't have.
    if (data.initial) queueMicrotask(roomAnswered)
    for (const [key, value] of Object.entries(incoming)) {
      // Update the local entry first so the React rerender that follows
      // setter() doesn't republish the same value back to the canvas.
      const changed = updateEntry(key, value)
      if (!changed) continue
      const set = settersByKey.get(key)
      if (!set) continue
      for (const setter of set) {
        try {
          setter(value)
        } catch {}
      }
    }
  })
  window.parent.postMessage({ type: "screenplay:shared-state-request" }, "*")
  setTimeout(roomAnswered, ROOM_ANSWER_TIMEOUT_MS)
}

/**
 * On a component's first value for `key`: if the room already holds a
 * different value, take the room's (through `setter`) instead of publishing
 * the component's default over it. Returns true when it adopted.
 */
function adoptRoomValue(key, value, setter) {
  if (!Object.prototype.hasOwnProperty.call(roomState, key)) return false
  const room = roomState[key]
  const roomSerialized = safeStringify(room)
  if (roomSerialized === null || roomSerialized === safeStringify(value)) {
    return false
  }
  if (updateEntry(key, room)) schedulePublish()
  try {
    setter(room)
  } catch {}
  return true
}

/**
 * Mirror a value to the screenplay canvas under the given key, optionally
 * accepting remote updates from other clients via `setter`. Pass `setter`
 * to opt into bidirectional sync; omit it for publish-only.
 *
 * @example Bidirectional — wires existing UI state both ways
 *   const [count, setCount] = useState(0)
 *   useSharedState("count", count, setCount)
 *
 * @example Publish-only — derived snapshot, no remote write-back
 *   useSharedState("user", user)
 */
export function useSharedState(key, value, setter) {
  // Stash the latest setter in a ref so registrations are stable across
  // renders — prevents a fresh inline setter from constantly re-subscribing.
  const setterRef = useRef(setter)
  setterRef.current = setter
  // True from each mount (or key change) until the first value is handled.
  const mountingRef = useRef(true)

  useEffect(() => {
    mountingRef.current = true
    if (!active) return
    if (!setterRef.current) return
    const wrapped = (v) => setterRef.current?.(v)
    addSetter(key, wrapped)
    return () => removeSetter(key, wrapped)
  }, [key])

  useEffect(() => {
    const mounting = mountingRef.current
    mountingRef.current = false
    if (
      active &&
      mounting &&
      setterRef.current &&
      adoptRoomValue(key, value, setterRef.current)
    ) {
      return
    }
    setEntry(key, value)
  }, [key, value])

  useEffect(() => {
    return () => clearEntry(key)
  }, [key])
}

/**
 * Imperative writer for non-React code. Returns a remover that drops the
 * key. Outside a screenplay frame this is a no-op and the remover is a noop.
 */
export function setSharedState(key, value) {
  setEntry(key, value)
  return () => clearEntry(key)
}

/**
 * Subscribe to remote updates of a key (non-React API). Returns an
 * unsubscribe function. Outside a screenplay frame the callback is never
 * invoked and the unsubscribe is a no-op.
 */
export function subscribeSharedState(key, onChange) {
  if (!active) return () => {}
  addSetter(key, onChange)
  return () => removeSetter(key, onChange)
}

/** Drop a key from the published state. */
export function clearSharedState(key) {
  clearEntry(key)
}

/** Read the last value seen for a key. Mostly for tests. */
export function getSharedState(key) {
  const entry = entries.get(key)
  return entry ? entry.value : undefined
}
