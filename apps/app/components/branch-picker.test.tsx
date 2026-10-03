// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

vi.mock("@/lib/github-actions", () => ({
  listRepoBranches: vi
    .fn()
    .mockResolvedValue([{ name: "main" }, { name: "pricing-faq" }]),
}))

import { BranchPicker } from "./branch-picker"

// cmdk scrolls the active item into view, which jsdom doesn't implement.
Element.prototype.scrollIntoView ??= () => {}
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

afterEach(cleanup)

describe("BranchPicker", () => {
  it("lists a branch another chat has as disabled, named for that chat", async () => {
    const onSelect = vi.fn()
    render(
      <BranchPicker
        owner="acme"
        repo="storefront"
        onSelect={onSelect}
        taken={new Map([["pricing-faq", "Pricing FAQ"]])}
      />
    )
    const taken = (await screen.findByText("pricing-faq")).closest(
      "[cmdk-item]"
    )!
    expect(taken.getAttribute("aria-disabled")).toBe("true")
    expect(screen.getByText("Pricing FAQ")).toBeTruthy()
    fireEvent.click(taken)
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText("main"))
    expect(onSelect).toHaveBeenCalledWith("main")
  })
})
