// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import type { FileEntryData } from "@/lib/types"

vi.mock("@/lib/files/account-actions", () => ({ listAccountFiles: vi.fn() }))
vi.mock("@/lib/files/desktop-actions", () => ({
  openAccountFileOnDesktop: vi.fn(),
}))

import { AccountFilesPanel } from "./account-files-panel"

// Radix's Dialog and menus use pointer-capture / scroll APIs jsdom doesn't
// implement, plus a ResizeObserver. Polyfill the bare minimum.
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
// The shadcn Sidebar asks whether it's on a phone.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
})) as unknown as typeof window.matchMedia

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const entry = (
  path: string,
  over: Partial<FileEntryData> = {}
): FileEntryData => ({
  id: path,
  path,
  kind: "file",
  size: 2150,
  mediaType: "text/markdown",
  addedBy: "agent",
  addedById: "chat-1",
  blobKey: `account/ana/${path}`,
  createdAt: 1,
  updatedAt: 1,
  ...over,
})
const FILES = [
  entry("style", { kind: "folder", size: 0, mediaType: "", blobKey: "" }),
  entry("style/voice.md"),
  entry("cv.pdf", { mediaType: "application/pdf", size: 880 * 1024 }),
]

function renderPanel(
  opts: { files?: FileEntryData[]; desktop?: boolean; fail?: boolean } = {}
) {
  const list = opts.fail
    ? vi.fn().mockRejectedValue(new Error("kv down"))
    : vi.fn().mockResolvedValue(opts.files ?? FILES)
  const deleteFile = vi.fn().mockResolvedValue(undefined)
  const openFileOnDesktop = opts.desktop
    ? vi.fn().mockResolvedValue(undefined)
    : undefined
  render(
    <AccountFilesPanel
      header={() => <h2>Files</h2>}
      list={list}
      deleteFile={deleteFile}
      openFileOnDesktop={openFileOnDesktop}
    />
  )
  return { list, deleteFile, openFileOnDesktop }
}

const menu = async (name: string) => {
  fireEvent.pointerDown(
    await screen.findByRole("button", { name: `More actions for ${name}` }),
    { button: 0, ctrlKey: false }
  )
  return screen.findByRole("menu")
}

describe("Settings › Files (#1521)", () => {
  it("shows your files as the tree, folders first", async () => {
    renderPanel()

    expect(await screen.findByText("1 item")).toBeTruthy()
    expect(screen.getByText("880.0 KB · Saved by agent")).toBeTruthy()
    const rows = screen
      .getAllByRole("button", { name: /^More actions for / })
      .map((b) => b.getAttribute("aria-label"))
    expect(rows).toEqual(["More actions for style", "More actions for cv.pdf"])
  })

  it("opens a file in a dialog read from your own files", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Plain.")))
    renderPanel()
    fireEvent.click(await screen.findByRole("button", { name: /^style/ }))

    fireEvent.click(
      within(await menu("voice.md")).getByRole("menuitem", { name: "Open" })
    )

    const file = await screen.findByRole("dialog", { name: "voice.md" })
    expect(await within(file).findByText("Plain.")).toBeTruthy()
    expect(fetch).toHaveBeenCalledWith("/api/account-files/style/voice.md")
  })

  it("on the desktop, opens in the Mac's app and reveals in Finder", async () => {
    const { openFileOnDesktop } = renderPanel({ desktop: true })

    fireEvent.click(
      within(await menu("cv.pdf")).getByRole("menuitem", { name: "Open" })
    )
    await waitFor(() =>
      expect(openFileOnDesktop).toHaveBeenCalledWith("cv.pdf", "open")
    )
    fireEvent.click(
      within(await menu("style")).getByRole("menuitem", {
        name: "Reveal in Finder",
      })
    )
    await waitFor(() =>
      expect(openFileOnDesktop).toHaveBeenCalledWith("style", "reveal")
    )
  })

  it("deletes a folder after a confirm, and drops it from the tree", async () => {
    const { deleteFile } = renderPanel()

    fireEvent.click(
      within(await menu("style")).getByRole("menuitem", { name: "Delete" })
    )
    const confirm = await screen.findByRole("alertdialog")
    expect(
      within(confirm).getByText(
        "The 1 item in it goes too, and your chats can no longer open it. You can’t undo this."
      )
    ).toBeTruthy()
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }))

    await waitFor(() => expect(deleteFile).toHaveBeenCalledWith("style"))
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "More actions for style" })
      ).toBeNull()
    )
    expect(
      screen.getByRole("button", { name: "More actions for cv.pdf" })
    ).toBeTruthy()
  })

  it("says so when you have no files", async () => {
    renderPanel({ files: [] })

    expect(await screen.findByText("No files yet")).toBeTruthy()
    expect(
      screen.getByText(
        "Ask a chat to save a file to your account, and every chat you message can open it."
      )
    ).toBeTruthy()
  })

  it("offers a retry when the files can't load", async () => {
    renderPanel({ fail: true })

    expect(await screen.findByText("Couldn't load files")).toBeTruthy()
  })
})
