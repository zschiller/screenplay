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
const renameFolder = vi.fn<(id: string, name: string) => Promise<void>>()
vi.mock("@/lib/folders-actions", () => ({
  createFolder: (name: string) => createFolder(name),
  renameFolder: (id: string, name: string) => renameFolder(id, name),
  listRoomPlacements: vi.fn().mockResolvedValue([]),
  placeRoom: vi.fn(),
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
  renameFolder.mockReset()
})

const folder = (over: Partial<FolderSummary> = {}): FolderSummary => ({
  id: "f1",
  name: "Designs",
  ownerId: "u1",
  parentFolderId: null,
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

function renderFiles() {
  return render(
    <HomeProvider
      initialRooms={[]}
      initialFolders={[]}
      initialPlacements={[]}
      folderView
      currentFolderId={null}
    >
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

  it("renames a folder in place from its ⋮ menu", async () => {
    renameFolder.mockResolvedValue()

    render(
      <HomeProvider
        initialRooms={[]}
        initialFolders={[folder()]}
        initialPlacements={[]}
        folderView
        currentFolderId={null}
      >
        <RoomsView title="All files" showFolders />
      </HomeProvider>
    )

    // Open the folder's action menu and choose Rename. Radix opens its menu on
    // pointerdown (button 0), not a bare click, so drive it that way.
    fireEvent.pointerDown(screen.getByLabelText("Folder actions"), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByText("Rename"))

    // The reused InputDialog opens prefilled with the current name.
    const input = (await screen.findByDisplayValue(
      "Designs"
    )) as HTMLInputElement
    fireEvent.change(input, { target: { value: "Mockups" } })
    fireEvent.submit(input.closest("form")!)

    // The rename runs with the typed name…
    await waitFor(() =>
      expect(renameFolder).toHaveBeenCalledWith("f1", "Mockups")
    )
    // …and the folder reflects it in the list without a reload.
    expect(await screen.findByText("Mockups")).not.toBeNull()
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
