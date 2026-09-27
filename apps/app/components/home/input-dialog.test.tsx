// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { InputDialog } from "./input-dialog"

// Radix's Dialog leans on pointer-capture / scroll APIs jsdom doesn't
// implement (mirrors move-to-dialog.test.tsx).
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderDialog(onSubmit: (value: string) => Promise<void>) {
  const onOpenChange = vi.fn()
  render(
    <InputDialog
      open
      onOpenChange={onOpenChange}
      title="Rename canvas"
      initialValue="Checkout"
      submitLabel="Save"
      submittingLabel="Saving…"
      errorMessage="Couldn't rename the canvas. Try again."
      onSubmit={onSubmit}
    />
  )
  return { onOpenChange }
}

describe("InputDialog", () => {
  it("stays open with an inline error when the submit fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { onOpenChange } = renderDialog(() =>
      Promise.reject(new Error("offline"))
    )
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Couldn't rename the canvas. Try again."
    )
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole("textbox")).toHaveProperty("value", "Checkout")
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty(
      "disabled",
      false
    )
  })

  it("closes on success with no error", async () => {
    const { onOpenChange } = renderDialog(() => Promise.resolve())
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
