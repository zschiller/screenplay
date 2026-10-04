/** A capture: `p` the light (or only) image, `dk` an optional dark one. */
export type Shot = { p: string; dk?: string }

export type Page = {
  date: string
  /** localStorage key, unique per storybook */
  slug: string
  /** Bump for another round; notes on the page start fresh */
  round: number
  title: string
  quote: string
  /** Where the part lives and which branch the states come from; may hold inline HTML */
  where: string
}

export type Value = string | number | boolean

/** One dimension. `values`: the choices, first is the default. A `type` takes any value (live only). */
export type Control = {
  key: string
  label: string
  values?: string[]
  type?: "text" | "number" | "toggle"
}

export type State = {
  id: string
  name: string
  /** A value per control; a missing key takes the control's first value */
  set: Record<string, Value>
  shots?: Shot
  /** One line on what to look at; may hold inline HTML */
  why?: string
  /** The owner's earlier note and what changed; may hold inline HTML */
  said?: string
}

/** Live fidelity: a bundled script sets window.RENDER to render the real part into `el`. */
export type Render = (
  values: Record<string, Value>,
  el: HTMLElement,
  opts: { theme: "light" | "dark" }
) => void
