import { describe, expect, it } from "vitest"

import { presenceInk, presenceInkClass } from "./presence-ink"

describe("presenceInk", () => {
  it("puts dark ink on the light palette swatches", () => {
    for (const swatch of ["#FFB74D", "#4DD0E1", "#81C784", "#64B5F6"]) {
      expect(presenceInk(swatch)).toBe("dark")
    }
  })

  it("keeps white ink on dark colours", () => {
    expect(presenceInk("#1e3a8a")).toBe("light")
    expect(presenceInk("#000")).toBe("light")
    expect(presenceInk("rgb(88, 28, 135)")).toBe("light")
  })

  it("falls back to white ink for colours it can't parse", () => {
    expect(presenceInk("oklch(0.7 0.1 200)")).toBe("light")
    expect(presenceInk("")).toBe("light")
  })

  it("maps each ink to a text class", () => {
    expect(presenceInkClass("#FFB74D")).toBe("text-neutral-950")
    expect(presenceInkClass("#1e3a8a")).toBe("text-white")
  })
})
