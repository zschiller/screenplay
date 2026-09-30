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
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Checkout v2" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Couldn't rename the canvas. Try again."
    )
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole("textbox")).toHaveProperty("value", "Checkout v2")
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty(
      "disabled",
      false
    )
  })

  it("closes on success with no error", async () => {
    const { onOpenChange } = renderDialog(() => Promise.resolve())
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Checkout v2" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("keeps Save disabled while the name is empty or unchanged", () => {
    const onSubmit = vi.fn(() => Promise.resolve())
    renderDialog(onSubmit)
    const save = screen.getByRole("button", { name: "Save" })
    expect(save).toHaveProperty("disabled", true)

    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "   " } })
    expect(save).toHaveProperty("disabled", true)
    // Enter submits the form directly; it must not send a no-op either.
    fireEvent.submit(input.closest("form")!)
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: "Checkout v2" } })
    expect(save).toHaveProperty("disabled", false)
  })

  it("can't be dismissed while the submit is in flight", async () => {
    let settle: () => void = () => {}
    const { onOpenChange } = renderDialog(
      () => new Promise<void>((resolve) => (settle = resolve))
    )
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Checkout v2" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    const saving = await screen.findByRole("button", { name: "Saving…" })
    expect(saving).toHaveProperty("disabled", true)
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty(
      "disabled",
      true
    )
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    expect(onOpenChange).not.toHaveBeenCalled()

    settle()
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
