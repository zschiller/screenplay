// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ConfirmDialog, confirmTitle, pendingLabelFor } from "./confirm-dialog"

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

function deferred() {
  let resolve!: () => void
  let reject!: (err: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function renderDialog(
  props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}
) {
  const onOpenChange = vi.fn()
  const rendered = render(
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      verb="Delete"
      itemName="Quarterly plan"
      itemNoun="canvas"
      description="This cannot be undone."
      onConfirm={vi.fn().mockResolvedValue(undefined)}
      {...props}
    />
  )
  return { ...rendered, onOpenChange }
}

describe("ConfirmDialog", () => {
  it("quotes the item name in the title and labels the button with the verb", () => {
    renderDialog()

    expect(
      screen.getByRole("heading", { name: "Delete “Quarterly plan”?" })
    ).toBeDefined()
    expect(screen.getByRole("button", { name: "Delete" })).toBeDefined()
  })

  it("falls back to the noun when there's no name to quote", () => {
    expect(confirmTitle("Delete", undefined, "comment")).toBe("Delete comment?")
    expect(confirmTitle("Delete", "  ", "frame")).toBe("Delete frame?")
  })

  it("derives the pending label from the verb", () => {
    expect(pendingLabelFor("Delete")).toBe("Deleting…")
    expect(pendingLabelFor("Leave")).toBe("Leaving…")
    expect(pendingLabelFor("Remove")).toBe("Removing…")
    expect(pendingLabelFor("Recreate")).toBe("Recreating…")
  })

  it("styles the action as destructive unless told otherwise", () => {
    const { unmount } = renderDialog()
    expect(screen.getByRole("button", { name: "Delete" }).dataset.variant).toBe(
      "destructive"
    )
    unmount()

    renderDialog({ verb: "Leave", destructive: false })
    expect(screen.getByRole("button", { name: "Leave" }).dataset.variant).toBe(
      "default"
    )
  })

  it("shows a pending state while the confirm runs and blocks dismissal", async () => {
    const work = deferred()
    const onConfirm = vi.fn(() => work.promise)
    const { onOpenChange } = renderDialog({ onConfirm })

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    const pendingButton = screen.getByRole("button", { name: "Deleting…" })
    expect(pendingButton).toHaveProperty("disabled", true)
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty(
      "disabled",
      true
    )
    expect(onConfirm).toHaveBeenCalledOnce()

    // Escape can't dismiss an in-flight confirm.
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    })
    expect(onOpenChange).not.toHaveBeenCalled()

    await act(async () => {
      work.resolve()
      await work.promise
    })
  })

  it("shows a failure inline, re-enables the action, and clears on retry", async () => {
    const onConfirm = vi
      .fn()
      .mockRejectedValueOnce(new Error("Sandbox busy"))
      .mockImplementationOnce(() => new Promise(() => {}))
    renderDialog({ onConfirm })

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    expect((await screen.findByRole("alert")).textContent).toBe("Sandbox busy")
    const retry = screen.getByRole("button", { name: "Delete" })
    expect(retry).toHaveProperty("disabled", false)

    fireEvent.click(retry)
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDefined()
  })

  it("falls back to a generic message when the failure has none", async () => {
    renderDialog({ onConfirm: vi.fn().mockRejectedValue("nope") })

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn’t delete canvas"
    )
  })

  it("starts clean when reopened after a failure", async () => {
    const props = {
      verb: "Delete",
      itemNoun: "canvas",
      description: "x",
      onOpenChange: vi.fn(),
      onConfirm: vi.fn().mockRejectedValue(new Error("Boom")),
    }
    const { rerender } = render(<ConfirmDialog open {...props} />)
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    expect(await screen.findByText("Boom")).toBeDefined()

    rerender(<ConfirmDialog open={false} {...props} />)
    rerender(<ConfirmDialog open {...props} />)

    expect(screen.queryByText("Boom")).toBeNull()
  })

  it("passes the pending flag to the option slot", () => {
    renderDialog({
      onConfirm: () => new Promise(() => {}),
      children: ({ pending }) => (
        <input aria-label="Option" type="checkbox" disabled={pending} />
      ),
    })

    const option = screen.getByRole("checkbox", { name: "Option" })
    expect(option).toHaveProperty("disabled", false)

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    expect(option).toHaveProperty("disabled", true)
  })
})
