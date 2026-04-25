export interface KnobSelectOption {
  value: string
  label?: string
}

interface KnobBase<TValue, TType extends string> {
  id: string
  type: TType
  label?: string
  default: TValue
  /** Optional clamp/sanitize function applied locally to every incoming value. */
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

export type KnobValue = string | number | boolean

/**
 * Declare a knob and read its current value. The canvas's popover edits this
 * value; your component re-renders whenever it changes. Pass a stable `id` —
 * that's the key the canvas uses to persist the value in Yjs.
 *
 * @example
 *   const padding = useKnob({
 *     id: "card-padding",
 *     type: "slider",
 *     min: 0,
 *     max: 64,
 *     step: 2,
 *     default: 16,
 *   })
 */
export function useKnob<T extends Knob>(
  def: T,
): T extends BooleanKnob
  ? boolean
  : T extends NumberKnob | SliderKnob
    ? number
    : string

export function getKnobValue(id: string): KnobValue | undefined

export function registerKnob(
  def: Knob,
  onChange: (value: KnobValue) => void,
): () => void
