// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MockupStatusMark, MockupStatusMenu } from "./mockup-status-menu"

afterEach(cleanup)

/** Radix opens a menu on pointerdown (button 0), not a bare click. */
function open(label: string) {
  fireEvent.pointerDown(screen.getByLabelText(label), {
    button: 0,
    ctrlKey: false,
  })
}

describe("MockupStatusMenu (#1310)", () => {
  it("shows the status and offers the three, with a check on the current one", async () => {
    render(<MockupStatusMenu status="current" onChange={() => {}} />)
    expect(screen.getByLabelText("Status: Current").textContent).toBe("Current")

    open("Status: Current")

    const items = await screen.findAllByRole("menuitemradio")
    expect(items.map((i) => i.textContent)).toEqual([
      "Set aside",
      "Current",
      "Built",
    ])
    expect(items.map((i) => i.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
    ])
  })

  it("reports the status picked", async () => {
    const onChange = vi.fn()
    render(<MockupStatusMenu status="current" onChange={onChange} />)

    open("Status: Current")
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Built" }))

    expect(onChange).toHaveBeenCalledWith("built")
  })
})

describe("MockupStatusMark", () => {
  it("is a check for Built and nothing for the others", () => {
    const { container, rerender } = render(<MockupStatusMark status="built" />)
    expect(screen.getByRole("img", { name: "Built" })).toBeTruthy()
    rerender(<MockupStatusMark status="current" />)
    expect(container.innerHTML).toBe("")
    rerender(<MockupStatusMark status="set-aside" />)
    expect(container.innerHTML).toBe("")
  })
})
