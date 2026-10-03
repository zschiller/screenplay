// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeAll, describe, expect, it, vi } from "vitest"

// The knobs runtime is a plain script inlined into every Mockup page. In jsdom
// the page is its own parent, so what it posts up arrives on this window.
const RUNTIME = readFileSync(
  join(process.cwd(), "lib", "sandbox-bridge", "mockup-knobs.js"),
  "utf8"
)

type Screenplay = {
  registerKnob: (def: object, onChange?: (v: unknown) => void) => unknown
}
const screenplay = () =>
  (window as unknown as { screenplay: Screenplay }).screenplay

function nextDeclaration() {
  return new Promise<unknown[]>((resolve) => {
    function onMessage(e: MessageEvent) {
      if (e.data?.type !== "screenplay:knobs-declared") return
      window.removeEventListener("message", onMessage)
      resolve(e.data.knobs)
    }
    window.addEventListener("message", onMessage)
  })
}

function pushValues(values: Record<string, unknown>) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "screenplay:knob-values", values },
    })
  )
}

const rootVar = (id: string) =>
  document.documentElement.style.getPropertyValue(`--knob-${id}`)

beforeAll(() => {
  new Function(RUNTIME)()
})

describe("mockup knobs runtime", () => {
  it("declares knobs to the canvas in one message, without functions", async () => {
    const declared = nextDeclaration()
    screenplay().registerKnob({
      id: "pad",
      type: "slider",
      min: 0,
      max: 64,
      default: 16,
      validator: (v: number) => v,
    })
    screenplay().registerKnob({ id: "dark", type: "boolean", default: false })
    expect(await declared).toEqual([
      { id: "pad", type: "slider", min: 0, max: 64, default: 16 },
      { id: "dark", type: "boolean", default: false },
    ])
  })

  it("starts at the default, as the callback's value and a CSS variable", () => {
    const onChange = vi.fn()
    const value = screenplay().registerKnob(
      { id: "accent", type: "color", default: "#1d4ed8" },
      onChange
    )
    expect(value).toBe("#1d4ed8")
    expect(onChange).toHaveBeenCalledExactlyOnceWith("#1d4ed8")
    expect(rootVar("accent")).toBe("#1d4ed8")
  })

  it("applies the canvas's values, ignoring unknown ids and wrong types", () => {
    const onChange = vi.fn()
    screenplay().registerKnob(
      {
        id: "layout",
        type: "select",
        default: "grid",
        options: [{ value: "grid" }, { value: "list" }],
      },
      onChange
    )
    onChange.mockClear()
    pushValues({ layout: "list", nope: 1 })
    expect(onChange).toHaveBeenCalledExactlyOnceWith("list")
    expect(rootVar("layout")).toBe("list")
    pushValues({ layout: "carousel" })
    expect(onChange).toHaveBeenLastCalledWith("grid")
    pushValues({ pad: 40 })
    expect(rootVar("pad")).toBe("40")
  })

  it("keeps a tabs knob to its options, like a select", () => {
    const onChange = vi.fn()
    screenplay().registerKnob(
      {
        id: "density",
        type: "tabs",
        default: "m",
        options: [{ value: "s" }, { value: "m" }, { value: "l" }],
      },
      onChange
    )
    onChange.mockClear()
    pushValues({ density: "l" })
    expect(onChange).toHaveBeenLastCalledWith("l")
    expect(rootVar("density")).toBe("l")
    pushValues({ density: "xl" })
    expect(onChange).toHaveBeenLastCalledWith("m")
  })
})
