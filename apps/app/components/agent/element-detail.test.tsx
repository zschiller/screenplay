// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { ElementDetail, splitSelector } from "./element-detail"

// The element token's hover card (#923): the selector wraps only between its
// parts, and Route/Frame read as a label/value list.

afterEach(cleanup)

describe("splitSelector", () => {
  it("splits on child combinators, however they're spaced", () => {
    expect(splitSelector("#root > div>main >  a:nth-of-type(1)")).toEqual([
      "#root",
      "div",
      "main",
      "a:nth-of-type(1)",
    ])
  })

  it("keeps a selector with no combinator whole", () => {
    expect(splitSelector("button.primary")).toEqual(["button.primary"])
  })
})

describe("ElementDetail", () => {
  it("renders each selector part as one unbreakable unit ending in its combinator", () => {
    const { container } = render(
      <ElementDetail
        selector="#root > section:nth-of-type(1) > a"
        route="/"
        frameLabel="Home"
      />
    )
    const parts = [...container.querySelectorAll(".inline-block")].map(
      (el) => el.textContent
    )
    expect(parts).toEqual(["#root >", "section:nth-of-type(1) >", "a"])
  })

  it("lists Route and Frame as label/value pairs", () => {
    const { container } = render(
      <ElementDetail selector="#a" route="/pricing" frameLabel="Pricing" />
    )
    const pairs = [...container.querySelectorAll("dt")].map((dt) => [
      dt.textContent,
      dt.nextElementSibling?.textContent,
    ])
    expect(pairs).toEqual([
      ["Route", "/pricing"],
      ["Frame", "Pricing"],
    ])
  })

  it("leaves out Frame when there is none, and says when there's no selector", () => {
    const { container } = render(<ElementDetail selector="" route="/" />)
    expect(
      [...container.querySelectorAll("dt")].map((d) => d.textContent)
    ).toEqual(["Route"])
    expect(container.textContent).toContain("(no selector)")
  })
})
