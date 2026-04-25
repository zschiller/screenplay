import type { JsonValue } from "@/lib/postmessage-protocol"

/**
 * Standard knob control types. Each maps to a shadcn component on the
 * screenplay side and to an input shape the prototype produces. Prototypes
 * declare knobs by calling `useKnob({...})` from the `@screenplay.space/knobs`
 * npm package (source at `packages/screenplay-knobs/`); that runtime posts
 * declarations to the canvas via `screenplay:knobs-declared` and accepts
 * value updates via `screenplay:knob-values`.
 */

export type KnobSelectOption = { value: string; label?: string }

export type KnobNumber = {
  type: "number"
  id: string
  label?: string
  default: number
  min?: number
  max?: number
  step?: number
}

export type KnobSlider = {
  type: "slider"
  id: string
  label?: string
  default: number
  min: number
  max: number
  step?: number
}

export type KnobBoolean = {
  type: "boolean"
  id: string
  label?: string
  default: boolean
}

export type KnobString = {
  type: "string"
  id: string
  label?: string
  default: string
  placeholder?: string
}

export type KnobSelect = {
  type: "select"
  id: string
  label?: string
  default: string
  options: KnobSelectOption[]
}

export type KnobColor = {
  type: "color"
  id: string
  label?: string
  default: string
}

export type KnobDef =
  | KnobNumber
  | KnobSlider
  | KnobBoolean
  | KnobString
  | KnobSelect
  | KnobColor

export type KnobValue = string | number | boolean
export type KnobValues = { [id: string]: KnobValue }

/** Defensive runtime guard for declarations that arrive over postMessage. */
export function isKnobDef(value: unknown): value is KnobDef {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  if (typeof v.id !== "string" || typeof v.type !== "string") return false
  switch (v.type) {
    case "number":
    case "slider":
      return typeof v.default === "number"
    case "boolean":
      return typeof v.default === "boolean"
    case "string":
    case "color":
      return typeof v.default === "string"
    case "select":
      return typeof v.default === "string" && Array.isArray(v.options)
    default:
      return false
  }
}

export function defaultValueFor(def: KnobDef): KnobValue {
  return def.default
}

/** Coerce a JsonValue stored in Yjs into a KnobValue, falling back to the default. */
export function coerceKnobValue(def: KnobDef, raw: JsonValue | undefined): KnobValue {
  if (raw === undefined || raw === null) return def.default
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
