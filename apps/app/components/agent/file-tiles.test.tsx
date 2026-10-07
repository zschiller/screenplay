// @vitest-environment jsdom
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import * as Y from "yjs"
import { Awareness } from "y-protocols/awareness"
import { FileTileActionsContext, FileTiles } from "./file-tiles"
import { FILE_DRAG_TYPE, fileDrag } from "@/lib/canvas/file-drag"
import { FileModal } from "@/components/canvas/file-modal"
import { fileModal } from "@/lib/canvas/file-modal"
import { createCanvasOps } from "@/lib/canvas/ops"
import { YjsConnectionProvider } from "@/lib/yjs/context"
import { getRoomCollections } from "@/lib/yjs/schema"

vi.mock("@/hooks/use-mockup-runtime", () => ({ useMockupRuntime: () => null }))
vi.mock("@/hooks/use-mockup-refs", () => ({ useMockupRefs: () => null }))

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

afterEach(() => {
  act(() => fileModal.close())
  cleanup()
})

function room() {
  const doc = new Y.Doc()
  const collections = getRoomCollections(doc)
  const ops = createCanvasOps(collections)
  const wrap = (children: ReactNode) => (
    <YjsConnectionProvider
      value={{ doc, awareness: new Awareness(doc), roomId: "room" }}
    >
      {children}
    </YjsConnectionProvider>
  )
  return { doc, collections, ops, wrap }
}

describe("FileTiles (#1885)", () => {
  it("shows one tile per file, its name under its preview, and opens it on click", () => {
    const { ops, collections, wrap } = room()
    const mockup = ops.createFile({
      kind: "mockup",
      title: "Option B · Suggestions",
    })
    const document = ops.createFile({ kind: "document", title: "Brief" })
    // A placed view names the same file as its id: it shows once.
    const placed = ops.placeFile(mockup)!
    expect(collections.mockupLayers.has(placed.viewId)).toBe(true)

    render(wrap(<FileTiles ids={[mockup, document, placed.viewId, "gone"]} />))

    const tiles = screen.getAllByTestId("file-tile")
    expect(
      tiles.map(
        (t) => t.querySelector('[data-slot="file-tile-name"]')?.textContent
      )
    ).toEqual(["Option B · Suggestions", "Brief"])
    fireEvent.click(screen.getByRole("button", { name: "Brief" }))
    expect(fileModal.current()).toBe(document)
  })

  it("has no ⋯ and doesn't drag outside a canvas", () => {
    const { ops, wrap } = room()
    const fileId = ops.createFile({ kind: "document", title: "Brief" })
    render(wrap(<FileTiles ids={[fileId]} />))
    expect(screen.queryByRole("button", { name: "More" })).toBeNull()
    expect(
      screen.getByRole("button", { name: "Brief" }).getAttribute("draggable")
    ).toBe("false")
  })

  it("shows nothing outside a room", () => {
    const { container } = render(<FileTiles ids={["m-1"]} />)
    expect(container.innerHTML).toBe("")
  })
})

describe("A tile's ⋯ menu and drag (#1887)", () => {
  function withActions() {
    const r = room()
    const fileId = r.ops.createFile({ kind: "mockup", title: "Option B" })
    const actions = { addToCanvas: vi.fn(), showInFiles: vi.fn() }
    render(
      r.wrap(
        <FileTileActionsContext.Provider value={actions}>
          <FileTiles ids={[fileId]} />
        </FileTileActionsContext.Provider>
      )
    )
    return { ...r, fileId, actions }
  }

  async function openMenu() {
    fireEvent.pointerDown(screen.getByRole("button", { name: "More" }), {
      button: 0,
      pointerType: "mouse",
    })
    return screen.findAllByRole("menuitem")
  }

  it("holds Add to canvas and Show in Files, each with its icon, and no Open", async () => {
    const { fileId, actions } = withActions()
    const items = await openMenu()
    expect(items.map((i) => i.textContent)).toEqual([
      "Add to canvas",
      "Show in Files",
    ])
    for (const item of items) expect(item.querySelector("svg")).not.toBeNull()
    fireEvent.click(items[0]!)
    expect(actions.addToCanvas).toHaveBeenCalledWith(fileId)
    fireEvent.click((await openMenu())[1]!)
    expect(actions.showInFiles).toHaveBeenCalledWith(fileId)
    // The menu acts; it doesn't open the file.
    expect(fileModal.current()).toBeNull()
  })

  it("carries the file's id while it's dragged", () => {
    const { fileId } = withActions()
    const tile = screen.getByRole("button", { name: "Option B" })
    expect(tile.getAttribute("draggable")).toBe("true")
    const data = new Map<string, string>()
    const dataTransfer = {
      setData: (type: string, value: string) => data.set(type, value),
      setDragImage: () => {},
      effectAllowed: "",
    }
    fireEvent.dragStart(tile, { dataTransfer })
    expect(data.get(FILE_DRAG_TYPE)).toBe(fileId)
    expect(fileDrag.current()).toBe(fileId)
    fireEvent.dragEnd(tile)
    expect(fileDrag.current()).toBeNull()
  })
})

describe("FileModal (#1885)", () => {
  it("shows the file under its title row, and Add to canvas closes it", async () => {
    const { ops, wrap } = room()
    const fileId = ops.createFile({ kind: "document", title: "Brief" })
    const onAddToCanvas = vi.fn()
    render(wrap(<FileModal ops={ops} onAddToCanvas={onAddToCanvas} />))

    act(() => fileModal.open(fileId))

    const modal = await screen.findByTestId("file-modal")
    expect(modal.textContent).toContain("Brief")
    fireEvent.pointerDown(screen.getByRole("button", { name: "More" }), {
      button: 0,
      pointerType: "mouse",
    })
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Add to canvas" })
    )

    expect(onAddToCanvas).toHaveBeenCalledWith(fileId)
    await waitFor(() => expect(screen.queryByTestId("file-modal")).toBeNull())
  })
})
