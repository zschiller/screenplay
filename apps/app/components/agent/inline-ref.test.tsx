// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

import { InlineRef } from "./inline-ref"

afterEach(cleanup)

describe("InlineRef", () => {
  it("strikes a deleted file through and opens nothing (#1884)", () => {
    const onClick = vi.fn()
    render(
      <InlineRef kind="mockup" onClick={onClick} deleted>
        Cart · B
      </InlineRef>
    )

    expect(screen.queryByRole("button")).toBeNull()
    const ref = screen.getByText("Cart · B").parentElement!
    expect(ref.hasAttribute("data-deleted")).toBe(true)
  })

  it("stays a button while the file is there", () => {
    render(
      <InlineRef kind="mockup" onClick={vi.fn()}>
        Cart · B
      </InlineRef>
    )

    expect(screen.getByRole("button", { name: "Cart · B" })).toBeTruthy()
  })
})
