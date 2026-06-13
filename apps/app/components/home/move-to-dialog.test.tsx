// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MoveToDialog } from "./move-to-dialog"
import type { FolderSummary } from "@/lib/folders-actions"

// Radix's Dialog leans on pointer-capture / scroll APIs and a ResizeObserver
// that jsdom doesn't implement; polyfill the minimum so it can open for
// assertions (mirrors delete-room-dialog.test.tsx).
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

function folder(
  id: string,
  name: string,
  parentFolderId: string | null
): FolderSummary {
  return { id, name, ownerId: "u1", parentFolderId, createdAt: 0, updatedAt: 0 }
}

// a > b > c, plus an unrelated sibling tree at the root.
const tree = [
  folder("a", "Alpha", null),
  folder("b", "Beta", "a"),
  folder("c", "Gamma", "b"),
  folder("e", "Epsilon", null),
]

function dest(name: string): HTMLButtonElement {
  return screen.getByRole("radio", { name }) as HTMLButtonElement
}

describe("MoveToDialog", () => {
  it("lists the root and every folder as destinations", () => {
    render(
      <MoveToDialog
        open
        onOpenChange={vi.fn()}
        itemName="Sketch"
        currentParentId={null}
        folders={tree}
        onMove={vi.fn().mockResolvedValue(undefined)}
      />
    )

    for (const name of ["All files", "Alpha", "Beta", "Gamma", "Epsilon"]) {
      expect(screen.getByRole("radio", { name })).toBeDefined()
    }
  })

  it("disables the item's current location so a move always relocates", () => {
    // A Room currently filed in "Alpha" — that folder is its home, not a target.
    render(
      <MoveToDialog
        open
        onOpenChange={vi.fn()}
        itemName="Sketch"
        currentParentId="a"
        folders={tree}
        onMove={vi.fn().mockResolvedValue(undefined)}
      />
    )

    expect(dest("Alpha").disabled).toBe(true)
    expect(dest("All files").disabled).toBe(false)
  })

  it("disables a folder and its descendants when moving a folder (cycle guard)", () => {
    // Moving "Alpha" (the root of a > b > c): it and its whole subtree are
    // off-limits; the unrelated "Epsilon" stays available.
    render(
      <MoveToDialog
        open
        onOpenChange={vi.fn()}
        itemName="Alpha"
        currentParentId={null}
        movingFolderId="a"
        folders={tree}
        onMove={vi.fn().mockResolvedValue(undefined)}
      />
    )

    expect(dest("Alpha").disabled).toBe(true)
    expect(dest("Beta").disabled).toBe(true)
    expect(dest("Gamma").disabled).toBe(true)
    expect(dest("Epsilon").disabled).toBe(false)
  })

  it("keeps Move disabled until a destination is picked", () => {
    render(
      <MoveToDialog
        open
        onOpenChange={vi.fn()}
        itemName="Sketch"
        currentParentId={null}
        folders={tree}
        onMove={vi.fn().mockResolvedValue(undefined)}
      />
    )

    expect(
      (screen.getByRole("button", { name: "Move" }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
  })

  it("moves the item to the chosen folder", async () => {
    const onMove = vi.fn().mockResolvedValue(undefined)
    render(
      <MoveToDialog
        open
        onOpenChange={vi.fn()}
        itemName="Alpha"
        currentParentId={null}
        movingFolderId="a"
        folders={tree}
        onMove={onMove}
      />
    )

    fireEvent.click(dest("Epsilon"))
    fireEvent.click(screen.getByRole("button", { name: "Move" }))

    expect(onMove).toHaveBeenCalledWith("e")
  })

  it("moves an item to the root when 'All files' is picked", () => {
    const onMove = vi.fn().mockResolvedValue(undefined)
    render(
      <MoveToDialog
        open
        onOpenChange={vi.fn()}
        itemName="Sketch"
        currentParentId="a"
        folders={tree}
        onMove={onMove}
      />
    )

    fireEvent.click(dest("All files"))
    fireEvent.click(screen.getByRole("button", { name: "Move" }))

    expect(onMove).toHaveBeenCalledWith(null)
  })
})
