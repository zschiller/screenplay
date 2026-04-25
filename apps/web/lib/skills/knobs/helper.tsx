/**
 * Screenplay knobs runtime helper.
 *
 * Drop this file into your prototype (e.g. `src/screenplay-knobs.tsx`) and
 * import `useKnob` from it. Each call declares one knob to the screenplay
 * canvas: a control type, a default value, and any min/max/options needed
 * to render the right shadcn input.
 *
 * The helper:
 *  1. Tracks every knob the prototype has declared.
 *  2. Posts the merged set up to the parent canvas via
 *     `screenplay:knobs-declared` (debounced one frame).
 *  3. Listens for `screenplay:knob-values` from the canvas and re-renders
 *     consumers with the latest value.
 *  4. Optionally runs a per-knob validator before exposing the value, so
 *     you can clamp / sanitize inside the prototype.
 *
 * The canvas persists declarations + values in Yjs so other clients see
 * the same knobs and edits sync in real time.
 */

import { useEffect, useSyncExternalStore } from "react"

export type KnobSelectOption = { value: string; label?: string }

type KnobBase<TValue, TType extends string> = {
  id: string
  type: TType
  label?: string
  default: TValue
  /** Optional pure validator/clamp run on every incoming value. Return the corrected value. */
  validator?: (value: TValue) => TValue
}

export type NumberKnob = KnobBase<number, "number"> & {
  min?: number
  max?: number
  step?: number
}

export type SliderKnob = KnobBase<number, "slider"> & {
  min: number
  max: number
  step?: number
}

export type BooleanKnob = KnobBase<boolean, "boolean">

export type StringKnob = KnobBase<string, "string"> & {
  placeholder?: string
}

export type SelectKnob = KnobBase<string, "select"> & {
  options: KnobSelectOption[]
}

export type ColorKnob = KnobBase<string, "color">

export type Knob =
  | NumberKnob
  | SliderKnob
  | BooleanKnob
  | StringKnob
  | SelectKnob
  | ColorKnob

type KnobValue = string | number | boolean

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const isBrowser = typeof window !== "undefined"

const definitions = new Map<string, Knob>()
const values = new Map<string, KnobValue>()
const subscribers = new Set<() => void>()

let publishScheduled = false

function publishDeclarations() {
  if (!isBrowser) return
  if (publishScheduled) return
  publishScheduled = true
  // Coalesce within a single tick so multiple useKnob calls in one render
  // post a single declaration message.
  Promise.resolve().then(() => {
    publishScheduled = false
    if (window.parent === window) return
    const knobs = Array.from(definitions.values()).map(stripValidator)
    window.parent.postMessage(
      { type: "screenplay:knobs-declared", knobs },
      "*",
    )
  })
}

function stripValidator(def: Knob): Omit<Knob, "validator"> {
  // Functions aren't structured-cloneable. Strip before posting.
  const out: Record<string, unknown> = { ...def }
  delete out.validator
  return out as Omit<Knob, "validator">
}

function notify() {
  for (const cb of subscribers) cb()
}

function applyValue(id: string, raw: unknown) {
  const def = definitions.get(id)
  if (!def) return
  const coerced = coerce(def, raw)
  const validated = def.validator
    ? (def.validator as (v: KnobValue) => KnobValue)(coerced)
    : coerced
  if (values.get(id) === validated) return
  values.set(id, validated)
  notify()
}

function coerce(def: Knob, raw: unknown): KnobValue {
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
  }
}

if (isBrowser && window.parent !== window) {
  window.addEventListener("message", (e: MessageEvent) => {
    const data = e.data as { type?: unknown; values?: unknown } | null
    if (!data || data.type !== "screenplay:knob-values") return
    const incoming = data.values
    if (!incoming || typeof incoming !== "object") return
    for (const [id, value] of Object.entries(incoming as Record<string, unknown>)) {
      applyValue(id, value)
    }
  })
}

function register(def: Knob) {
  const existing = definitions.get(def.id)
  definitions.set(def.id, def)
  if (!values.has(def.id)) {
    const initial = def.validator
      ? (def.validator as (v: KnobValue) => KnobValue)(def.default)
      : def.default
    values.set(def.id, initial)
  }
  // Re-publish whenever a definition is added/updated so the canvas always
  // sees the live shape (e.g. when min/max changes in dev).
  if (!existing || JSON.stringify(stripValidator(existing)) !== JSON.stringify(stripValidator(def))) {
    publishDeclarations()
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Declare a knob and read its current value. Re-renders when the canvas
 * pushes a new value down. Pass a stable `id` — that's the key the canvas
 * uses to persist the value in Yjs.
 *
 * @example
 *   const padding = useKnob({
 *     id: "padding",
 *     type: "slider",
 *     label: "Padding",
 *     min: 0,
 *     max: 64,
 *     step: 2,
 *     default: 16,
 *   })
 */
export function useKnob<TKnob extends Knob>(
  def: TKnob,
): TKnob extends BooleanKnob
  ? boolean
  : TKnob extends NumberKnob | SliderKnob
    ? number
    : string {
  // Register synchronously on first render so SSR-safe pages still work.
  // We only publish from useEffect / postMessage on the client.
  if (isBrowser) register(def)

  const value = useSyncExternalStore(
    (cb) => {
      subscribers.add(cb)
      return () => subscribers.delete(cb)
    },
    () => values.get(def.id) ?? def.default,
    () => def.default,
  )

  // Eagerly publish on mount in case nothing else triggered it (e.g. the
  // Promise.resolve microtask was queued before the registry was populated).
  useEffect(() => {
    if (isBrowser) publishDeclarations()
  }, [])

  return value as never
}

/** Imperatively read the current value outside of React. */
export function getKnobValue(id: string): KnobValue | undefined {
  return values.get(id)
}

/**
 * Non-React API. Call once with a definition and a callback; the callback
 * fires every time the value changes. Returns an unsubscribe function.
 */
export function registerKnob(
  def: Knob,
  onChange: (value: KnobValue) => void,
): () => void {
  register(def)
  const cb = () => onChange(values.get(def.id) ?? def.default)
  subscribers.add(cb)
  cb()
  return () => {
    subscribers.delete(cb)
  }
}

