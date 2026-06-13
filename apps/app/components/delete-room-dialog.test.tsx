// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { DeleteRoomDialog } from "./delete-room-dialog"

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
  props: Partial<React.ComponentProps<typeof DeleteRoomDialog>> = {}
) {
  return render(
    <DeleteRoomDialog
      open
      onOpenChange={vi.fn()}
      roomName="Acme"
      isOwner
      sharedWithCount={0}
      onConfirm={vi.fn().mockResolvedValue(undefined)}
      {...props}
    />
  )
}

describe("DeleteRoomDialog framing", () => {
  it("frames a solely-owned Room as a plain permanent delete", () => {
    renderDialog({ isOwner: true, sharedWithCount: 0 })

    expect(screen.getByRole("button", { name: "Delete" })).toBeDefined()
    expect(screen.getByText(/permanently deleted/i)).toBeDefined()
    // No sharing language — nobody else is affected.
    expect(screen.queryByText(/shared with/i)).toBeNull()
  })

  it("warns the owner of a shared Room how many people lose it", () => {
    renderDialog({ isOwner: true, sharedWithCount: 3 })

    expect(screen.getByRole("button", { name: "Delete" })).toBeDefined()
    expect(screen.getByText(/shared with 3 people/i)).toBeDefined()
    expect(screen.getByText(/for everyone/i)).toBeDefined()
  })

  it("pluralizes a single collaborator as one person", () => {
    renderDialog({ isOwner: true, sharedWithCount: 1 })

    expect(screen.getByText(/shared with 1 person/i)).toBeDefined()
  })

  it("frames a non-owner's delete as leaving the shared Room", () => {
    renderDialog({ isOwner: false, sharedWithCount: 2 })

    expect(screen.getByRole("button", { name: "Leave" })).toBeDefined()
    expect(screen.getByText(/removed from this shared canvas/i)).toBeDefined()
    // Leaving destroys nothing — no permanent-delete language.
    expect(screen.queryByText(/permanently/i)).toBeNull()
  })

  it("names the Room in the title", () => {
    renderDialog({ roomName: "Quarterly plan", isOwner: true })

    expect(
      screen.getByText((_, el) => el?.textContent === "Delete “Quarterly plan”?")
    ).toBeDefined()
  })

  it("invokes onConfirm when the action is taken", () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    renderDialog({ isOwner: false, sharedWithCount: 1, onConfirm })

    fireEvent.click(screen.getByRole("button", { name: "Leave" }))

    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
