// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { DeleteBranchDialog } from "./delete-branch-dialog"

// Radix's AlertDialog uses pointer-capture / scroll APIs jsdom doesn't
// implement, plus a ResizeObserver. Polyfill the bare minimum so the dialog
// can mount + open for assertions.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
}

afterEach(cleanup)

function renderDialog(
  props: Partial<React.ComponentProps<typeof DeleteBranchDialog>> = {}
) {
  const onConfirm = vi.fn().mockResolvedValue(undefined)
  const rendered = render(
    <DeleteBranchDialog
      open
      onOpenChange={vi.fn()}
      branchName="feature-a"
      canDeleteOnRemote
      onConfirm={onConfirm}
      {...props}
    />
  )
  return { ...rendered, onConfirm: props.onConfirm ?? onConfirm }
}

describe("DeleteBranchDialog remote-delete offer", () => {
  it("opens with the remote delete off, so Delete is local-only by default", () => {
    const { onConfirm } = renderDialog()

    expect(screen.getByRole("switch")).toHaveProperty(
      "dataset.state",
      "unchecked"
    )
    expect(
      screen.getByText(
        /stays in your sandbox unless you also delete it on the remote\./i
      )
    ).toBeDefined()

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    expect(onConfirm).toHaveBeenCalledWith({ deleteOnRemote: false })
  })

  it("passes the opt-in through once the toggle is switched on", () => {
    const { onConfirm } = renderDialog()

    fireEvent.click(screen.getByRole("switch"))
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    expect(onConfirm).toHaveBeenCalledWith({ deleteOnRemote: true })
  })

  it("hides the toggle entirely when the GitHub API can't serve it", () => {
    const { onConfirm } = renderDialog({ canDeleteOnRemote: false })

    expect(screen.queryByRole("switch")).toBeNull()
    expect(screen.queryByText(/delete on remote/i)).toBeNull()
    // …and the description drops the clause that dangles without the toggle,
    // ending the sentence cleanly instead.
    expect(
      screen.queryByText(/unless you also delete it on the remote/i)
    ).toBeNull()
    expect(screen.getByText(/stays in your sandbox\./i)).toBeDefined()

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    expect(onConfirm).toHaveBeenCalledWith({ deleteOnRemote: false })
  })

  it("surfaces a thrown delete failure inline and stays open to retry", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error("Sandbox busy"))
    renderDialog({ onConfirm })

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    expect(await screen.findByText("Sandbox busy")).toBeDefined()
    expect(screen.getByRole("button", { name: "Delete" })).toBeDefined()
  })
})
