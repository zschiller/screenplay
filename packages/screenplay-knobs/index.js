// @screenplay.space/knobs runtime helper.
//
// useKnob() registers a control declaration with the parent canvas (when a
// screenplay canvas is hosting this frame) and returns the live value the
// canvas's popover is editing. In any build with `NODE_ENV=production`, and
// when there is no parent canvas, the hook just returns the declared
// `default` and quietly no-ops — so prototypes shipped with knobs in them
// keep working everywhere.
//
// The package is dev-only by design: production builds dead-code-eliminate
// the postMessage paths entirely. That means a prototype that is iframed by
// some non-screenplay parent in production cannot have its knob values read
// or written via this protocol, because none of the listeners are attached
// and none of the publishers run.
//
// Each useKnob() call (in non-prod, when iframed):
//   1. Registers the knob's definition in an in-frame map.
//   2. Posts the merged set of declarations up to the parent canvas via
//      `screenplay:knobs-declared` (microtask-debounced).
//   3. Subscribes to `screenplay:knob-values` from the parent and re-renders
//      callers when the canvas pushes a new value down.
import { useEffect, useSyncExternalStore } from "react"

const isBrowser = typeof window !== "undefined"
// Treat anything that isn't an explicit "development" build as production —
// fail closed for plain ESM-in-browser loads where there's no bundler to
// inline NODE_ENV. Bundlers statically replace `process.env.NODE_ENV`, so a
// production build dead-code-eliminates the postMessage paths entirely.
const isDev =
  typeof process !== "undefined" &&
  !!process.env &&
  process.env.NODE_ENV === "development"
const active = isDev && isBrowser && window.parent !== window

const definitions = new Map()
const values = new Map()
const subscribers = new Set()

let publishScheduled = false

function stripValidator(def) {
  // Functions aren't structured-cloneable. Strip before posting.
  const out = { ...def }
  delete out.validator
  return out
}

function publishDeclarations() {
  if (!active) return
  if (publishScheduled) return
  publishScheduled = true
  // Coalesce within a single tick so many useKnob calls from one render
  // post a single declaration message.
  Promise.resolve().then(() => {
    publishScheduled = false
    const knobs = []
    for (const def of definitions.values()) knobs.push(stripValidator(def))
    window.parent.postMessage(
      { type: "screenplay:knobs-declared", knobs },
      "*",
    )
  })
}

function notify() {
  for (const cb of subscribers) cb()
}

function coerce(def, raw) {
  switch (def.type) {
    case "number":
    case "slider":
      return typeof raw === "number" ? raw : def.default
    case "boolean":
      return typeof raw === "boolean" ? raw : def.default
    case "string":
    case "color":
      return typeof raw === "string" ? raw : def.default
    case "select":
      return typeof raw === "string" && def.options.some((o) => o.value === raw)
        ? raw
        : def.default
    default:
      return def.default
  }
}

function applyValue(id, raw) {
  const def = definitions.get(id)
  if (!def) return
  const coerced = coerce(def, raw)
  const validated = def.validator ? def.validator(coerced) : coerced
  if (values.get(id) === validated) return
  values.set(id, validated)
  notify()
}

if (active) {
  window.addEventListener("message", (e) => {
    const data = e.data
    if (!data || data.type !== "screenplay:knob-values") return
    const incoming = data.values
    if (!incoming || typeof incoming !== "object") return
    for (const [id, value] of Object.entries(incoming)) {
      applyValue(id, value)
    }
  })
}

function register(def) {
  const existing = definitions.get(def.id)
  definitions.set(def.id, def)
  if (!values.has(def.id)) {
    const initial = def.validator ? def.validator(def.default) : def.default
    values.set(def.id, initial)
  }
  // Re-publish whenever a definition is added or shape-changed so the canvas
  // always sees the live shape (e.g. when min/max changes during dev).
  if (
    !existing ||
    JSON.stringify(stripValidator(existing)) !==
      JSON.stringify(stripValidator(def))
  ) {
    publishDeclarations()
  }
}

const subscribe = (cb) => {
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}

export function useKnob(def) {
  // Register synchronously on first render so SSR-safe pages still work.
  // Publication itself is gated on `active` inside publishDeclarations, so a
  // prototype rendered outside a screenplay frame — or in any production
  // build — is silent and returns the declared default forever.
  if (isBrowser) register(def)

  const value = useSyncExternalStore(
    subscribe,
    () => (values.has(def.id) ? values.get(def.id) : def.default),
    () => def.default,
  )

  // Eagerly publish on mount in case the registration happened in a render
  // that bailed out before the microtask flushed.
  useEffect(() => {
    publishDeclarations()
  }, [])

  return value
}

/** Imperatively read the current value outside of React. */
export function getKnobValue(id) {
  return values.get(id)
}

/**
 * Non-React API: register a knob and subscribe to value changes. Returns an
 * unsubscribe function.
 */
export function registerKnob(def, onChange) {
  register(def)
  const cb = () => onChange(values.has(def.id) ? values.get(def.id) : def.default)
  subscribers.add(cb)
  cb()
  return () => {
    subscribers.delete(cb)
  }
}
