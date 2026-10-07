// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { FileDropSurface } from "./file-drop-surface"
import { FILE_DRAG_TYPE, fileDrag } from "@/lib/canvas/file-drag"
import type { GroupMemberLayout } from "@/lib/canvas/layout"

// jsdom has no DragEvent, and its stand-in carries no pointer position.
globalThis.DragEvent ??= class extends MouseEvent {} as typeof DragEvent

afterEach(() => {
  act(() => fileDrag.end())
  cleanup()
})

const member = (id: string, x: number): GroupMemberLayout => ({
  id,
  kind: "markdown-layer",
  groupId: "g",
  index: 0,
  isLast: false,
  x,
  y: 0,
  width: 300,
  height: 200,
})

function surface() {
  const onDrop = vi.fn()
  render(
    <FileDropSurface
      layouts={
        new Map([
          ["d1", member("d1", 0)],
          ["d2", member("d2", 350)],
        ])
      }
      // Panned 100px right, at 50%.
      camera={() => ({ positionX: 100, positionY: 0, scale: 0.5 })}
      sizeOf={() => ({ width: 400, height: 300 })}
      onDrop={onDrop}
    />
  )
  return onDrop
}

const dataTransfer = (fileId: string) => ({
  types: [FILE_DRAG_TYPE],
  getData: (type: string) => (type === FILE_DRAG_TYPE ? fileId : ""),
  dropEffect: "",
})

describe("FileDropSurface (#1887)", () => {
  it("is there only while a tile is dragged", () => {
    surface()
    expect(screen.queryByTestId("file-drop-surface")).toBeNull()
    act(() => fileDrag.start("f1"))
    expect(screen.getByTestId("file-drop-surface")).toBeTruthy()
  })

  it("shows the gap it would take in a Group, and drops into it", () => {
    const onDrop = surface()
    act(() => fileDrag.start("f1"))
    const target = screen.getByTestId("file-drop-surface")
    // World x 300 sits past d1's middle, before d2's.
    const at = { clientX: 100 + 300 * 0.5, clientY: 50 }
    fireEvent.dragOver(target, { ...at, dataTransfer: dataTransfer("f1") })
    expect(screen.getByTestId("file-drop-bar")).toBeTruthy()
    fireEvent.drop(target, { ...at, dataTransfer: dataTransfer("f1") })
    expect(onDrop).toHaveBeenCalledWith("f1", { groupId: "g", index: 1 })
    expect(fileDrag.current()).toBeNull()
  })

  it("outlines the view on empty canvas, and drops it centred there", () => {
    const onDrop = surface()
    act(() => fileDrag.start("f1"))
    const target = screen.getByTestId("file-drop-surface")
    const at = { clientX: 100 + 2000 * 0.5, clientY: 600 * 0.5 }
    fireEvent.dragOver(target, { ...at, dataTransfer: dataTransfer("f1") })
    const outline = screen.getByTestId("file-drop-outline")
    expect(outline.style.width).toBe("200px")
    fireEvent.drop(target, { ...at, dataTransfer: dataTransfer("f1") })
    expect(onDrop).toHaveBeenCalledWith("f1", { x: 2000, y: 600 })
  })
})
