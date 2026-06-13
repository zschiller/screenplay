// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { DeleteFolderDialog } from "./delete-folder-dialog"

// Radix's AlertDialog uses pointer-capture / scroll APIs jsdom doesn't
// implement, plus a ResizeObserver. Polyfill the bare minimum so the dialog can
// mount + open for assertions (mirrors delete-room-dialog.test).
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
  props: Partial<React.ComponentProps<typeof DeleteFolderDialog>> = {}
) {
  return render(
    <DeleteFolderDialog
      open
      onOpenChange={vi.fn()}
      folderName="Designs"
      deletedCount={0}
      sharedOwnedCount={0}
      sharedWithCount={0}
      onConfirm={vi.fn().mockResolvedValue(undefined)}
      {...props}
    />
  )
}

describe("DeleteFolderDialog framing", () => {
  it("names the folder in the title", () => {
    renderDialog({ folderName: "Designs" })
    expect(screen.getByText(/Delete .Designs.\?/)).toBeDefined()
  })

  it("frames an empty branch as a plain folder delete", () => {
    renderDialog({ deletedCount: 0 })
    expect(screen.getByText(/sub-folders will be deleted/i)).toBeDefined()
    // No canvas count and no sharing language when there's nothing to delete.
    expect(screen.queryByText(/canvas/i)).toBeNull()
    expect(screen.queryByText(/shared/i)).toBeNull()
  })

  it("names the count of canvases permanently deleted", () => {
    renderDialog({ deletedCount: 3 })
    expect(screen.getByText(/permanently deletes 3 canvases/i)).toBeDefined()
  })

  it("singularizes a one-canvas branch", () => {
    renderDialog({ deletedCount: 1 })
    expect(screen.getByText(/permanently deletes 1 canvas/i)).toBeDefined()
  })

  it("states owned shared canvases are deleted for everyone they're shared with", () => {
    renderDialog({
      deletedCount: 4,
      sharedOwnedCount: 2,
      sharedWithCount: 5,
    })
    expect(screen.getByText(/2 canvases are shared/i)).toBeDefined()
    expect(
      screen.getByText(/deleted for everyone they're shared with \(5 people\)/i)
    ).toBeDefined()
  })

  it("singularizes a single shared canvas and a single collaborator", () => {
    renderDialog({
      deletedCount: 1,
      sharedOwnedCount: 1,
      sharedWithCount: 1,
    })
    expect(screen.getByText(/1 canvas is shared/i)).toBeDefined()
    expect(
      screen.getByText(/everyone it's shared with \(1 person\)/i)
    ).toBeDefined()
  })

  it("omits sharing language when no canvas in the branch is shared", () => {
    // The local build path: clean recursive delete, no sharing.
    renderDialog({ deletedCount: 2, sharedOwnedCount: 0, sharedWithCount: 0 })
    expect(screen.getByText(/permanently deletes 2 canvases/i)).toBeDefined()
    expect(screen.queryByText(/shared with/i)).toBeNull()
  })
})
