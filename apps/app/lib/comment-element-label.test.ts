import { describe, expect, it } from "vitest"

import { selectorLabel } from "./comment-element-label"

describe("selectorLabel", () => {
  it("names the last step by tag and id", () => {
    expect(selectorLabel("main > div:nth-of-type(2) > aside#summary")).toBe(
      "aside#summary"
    )
    expect(selectorLabel("#cta")).toBe("#cta")
  })

  it("drops classes and positions", () => {
    expect(selectorLabel("body > div.flex.gap-2 > BUTTON:nth-child(3)")).toBe(
      "button"
    )
  })

  it("returns null with nothing to name", () => {
    expect(selectorLabel(null)).toBeNull()
    expect(selectorLabel("")).toBeNull()
    expect(selectorLabel(".card")).toBeNull()
  })
})
