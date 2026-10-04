// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import type { FileEntryData } from "@/lib/types"
import { DocumentImagePicker } from "./document-image-picker"

// cmdk and Radix's Dialog use APIs jsdom doesn't implement.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= () => {}

afterEach(cleanup)

const entry = (
  path: string,
  over: Partial<FileEntryData> = {}
): FileEntryData => ({
  id: path,
  path,
  kind: "file",
  size: 10,
  mediaType: "image/png",
  addedBy: "member",
  addedById: "user-1",
  blobKey: `key-${path}`,
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

function renderPicker({
  canvas = [] as FileEntryData[],
  account = [] as FileEntryData[],
} = {}) {
  const onPick = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <DocumentImagePicker
      open
      onOpenChange={onOpenChange}
      roomId="room-1"
      canvasFiles={canvas}
      listAccountFiles={() => Promise.resolve(account)}
      onPick={onPick}
    />
  )
  return { onPick, onOpenChange }
}

describe("DocumentImagePicker", () => {
  it("lists the canvas’s and your account’s images, and nothing else", async () => {
    renderPicker({
      canvas: [
        entry("uploads/sketch.png"),
        entry("notes.md", { mediaType: "text/markdown" }),
        entry("uploads", { kind: "folder", mediaType: "" }),
      ],
      account: [entry("logo.webp", { mediaType: "image/webp" })],
    })

    const canvas = await screen.findByRole("group", { name: "Canvas" })
    expect(within(canvas).getByText("sketch.png")).toBeTruthy()
    expect(within(canvas).getByText("uploads")).toBeTruthy()
    const account = await screen.findByRole("group", { name: "Account" })
    expect(within(account).getByText("logo.webp")).toBeTruthy()
    expect(screen.queryByText("notes.md")).toBeNull()
  })

  it("hands back the picked image and closes", async () => {
    const { onPick, onOpenChange } = renderPicker({
      account: [entry("logo.png")],
    })

    fireEvent.click(await screen.findByText("logo.png"))

    expect(onPick).toHaveBeenCalledWith({ scope: "account", path: "logo.png" })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("says so when there are no images yet", async () => {
    renderPicker()

    expect(await screen.findByText(/No images in files yet/)).toBeTruthy()
  })
})
