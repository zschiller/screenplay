// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { HomeProvider } from "./home-provider"
import { RoomsView } from "./rooms-view"
import type { FolderSummary } from "@/lib/folders-actions"

// The server-action modules the provider/view import bind the server-only db,
// sandbox and yjs-host stacks at import. Stub them so the import graph stays
// client-only; the folder-create flow only needs `createFolder`.
const createFolder = vi.fn<(name: string) => Promise<FolderSummary>>()
vi.mock("@/lib/folders-actions", () => ({
  createFolder: (name: string) => createFolder(name),
}))
vi.mock("@/lib/rooms-actions", () => ({
  createRoom: vi.fn(),
  deleteRoom: vi.fn(),
  renameRoom: vi.fn(),
  listRooms: vi.fn().mockResolvedValue([]),
}))
vi.mock("@/lib/yjs-host/client", () => ({ prewarmRoom: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))

// Radix's dialog/dropdown reach for browser APIs jsdom doesn't implement;
// polyfill the minimum so the create dialog can mount and submit.
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
  cleanup()
  createFolder.mockReset()
})

function renderFiles() {
  return render(
    <HomeProvider initialRooms={[]} initialFolders={[]}>
      <RoomsView title="All files" showFolders />
    </HomeProvider>
  )
}

describe("RoomsView — creating a folder", () => {
  it("opens the name dialog from 'Add folder' and renders the created folder", async () => {
    createFolder.mockResolvedValue({
      id: "f1",
      name: "Designs",
      ownerId: "u1",
      parentFolderId: null,
      createdAt: 1,
      updatedAt: 1,
    })

    renderFiles()

    // No dialog until "Add folder" is chosen.
    expect(screen.queryByText("New folder")).toBeNull()

    fireEvent.click(screen.getByText("Add folder"))

    // The reused InputDialog opens with folder-specific copy.
    const dialog = await screen.findByRole("dialog")
    expect(screen.getByText("New folder")).not.toBeNull()

    const input = screen.getByPlaceholderText("Untitled folder")
    fireEvent.change(input, { target: { value: "Designs" } })
    fireEvent.submit(input.closest("form")!)

    // The create operation runs with the typed name…
    await waitFor(() => expect(createFolder).toHaveBeenCalledWith("Designs"))
    // …and the new folder shows up in its section above the files.
    expect(await screen.findByText("Designs")).not.toBeNull()
    void dialog
  })

  it("does not surface 'Add folder' when folders are disabled (Recents)", () => {
    render(
      <HomeProvider initialRooms={[]} initialFolders={[]}>
        <RoomsView title="Recents" showSort={false} />
      </HomeProvider>
    )
    expect(screen.queryByText("Add folder")).toBeNull()
  })
})
