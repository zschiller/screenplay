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
import { HomeProvider } from "./home-provider"
import { RoomsView } from "./rooms-view"
import { SidebarSearch } from "./sidebar-search"
import type { FolderSummary } from "@/lib/folders-actions"
import type { RoomSummary } from "@/lib/rooms-actions"
import { DEFAULT_VIEW_PREFS, withView, type View } from "@/lib/home-view-prefs"

// The server-action modules the provider/view import bind the server-only db,
// sandbox and yjs-host stacks at import. Stub them so the import graph stays
// client-only; the folder-create flow only needs `createFolder`.
const createFolder = vi.fn<(name: string) => Promise<FolderSummary>>()
const renameFolder = vi.fn<(id: string, name: string) => Promise<void>>()
const createRoom = vi.fn<(name: string) => Promise<RoomSummary>>()
const placeRoom =
  vi.fn<(roomId: string, folderId: string | null) => Promise<void>>()
const push = vi.fn<(href: string) => void>()
vi.mock("@/lib/folders-actions", () => ({
  createFolder: (name: string) => createFolder(name),
  renameFolder: (id: string, name: string) => renameFolder(id, name),
  listRoomPlacements: vi.fn().mockResolvedValue([]),
  placeRoom: (roomId: string, folderId: string | null) =>
    placeRoom(roomId, folderId),
}))
vi.mock("@/lib/rooms-actions", () => ({
  createRoom: (name: string) => createRoom(name),
  deleteRoom: vi.fn(),
  renameRoom: vi.fn(),
  listRooms: vi.fn().mockResolvedValue([]),
}))
vi.mock("@/lib/yjs-host/client", () => ({ prewarmRoom: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/files",
}))

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
  createRoom.mockReset()
  placeRoom.mockReset()
  push.mockReset()
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
  it("opens the name dialog from 'New folder' and renders the created folder", async () => {
    createFolder.mockResolvedValue({
      id: "f1",
      name: "Designs",
      ownerId: "u1",
      parentFolderId: null,
      createdAt: 1,
      updatedAt: 1,
    })

    renderFiles()

    // No dialog until "New folder" is chosen.
    expect(screen.queryByRole("dialog")).toBeNull()

    fireEvent.click(screen.getByText("New folder"))

    // The reused InputDialog opens with folder-specific copy.
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("New folder")).not.toBeNull()

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

  it("does not surface 'New folder' when folders are disabled (Recents)", () => {
    render(
      <HomeProvider initialRooms={[]} initialFolders={[]}>
        <RoomsView title="Recents" />
      </HomeProvider>
    )
    expect(screen.queryByText("New folder")).toBeNull()
  })
})

const room: RoomSummary = {
  id: "r1",
  name: "Checkout",
  ownerId: "u1",
  isOwner: true,
  sharedWithCount: 0,
  createdAt: 1,
  lastConnectionAt: 1,
  thumbnailUrl: null,
  thumbnailUpdatedAt: null,
  thumbnailManifest: null,
}

// Recents lists every Canvas, whatever folder it's filed in — which is where the
// grid and table used to disagree about offering "Move to…" (issue #737).
function renderRecents(view: View, folders: FolderSummary[]) {
  return render(
    <HomeProvider
      initialRooms={[room]}
      initialFolders={folders}
      initialPlacements={[]}
      initialViewPrefs={withView(DEFAULT_VIEW_PREFS, view)}
    >
      <RoomsView title="Recents" />
    </HomeProvider>
  )
}

async function canvasMenuOffersMove(): Promise<boolean> {
  fireEvent.pointerDown(screen.getByLabelText("Canvas actions"), {
    button: 0,
    ctrlKey: false,
  })
  await screen.findByText("Pin to sidebar")
  return screen.queryByText("Move to…") !== null
}

describe("RoomsView — grid and table offer the same Canvas actions", () => {
  it.each<View>(["grid", "table"])(
    "%s offers Move on Recents once a folder exists",
    async (view) => {
      renderRecents(view, [folder()])
      expect(await canvasMenuOffersMove()).toBe(true)
    }
  )

  it.each<View>(["grid", "table"])(
    "%s hides Move while there is no folder to file into",
    async (view) => {
      renderRecents(view, [])
      expect(await canvasMenuOffersMove()).toBe(false)
    }
  )
})

describe("RoomsView — New canvas opens without a dialog (#777)", () => {
  const untitled: RoomSummary = { ...room, id: "r-new", name: "Untitled" }

  function renderFolder(folderId: string | null, folders: FolderSummary[]) {
    return render(
      <HomeProvider
        initialRooms={[]}
        initialFolders={folders}
        initialPlacements={[]}
        folderView
        currentFolderId={folderId}
      >
        <RoomsView title="All files" showFolders />
      </HomeProvider>
    )
  }

  it("creates an Untitled Canvas and opens it", async () => {
    createRoom.mockResolvedValue(untitled)
    renderFolder(null, [])

    fireEvent.click(screen.getAllByRole("button", { name: "New canvas" })[0]!)

    await waitFor(() => expect(push).toHaveBeenCalledWith("/r-new"))
    expect(createRoom).toHaveBeenCalledWith("Untitled")
    expect(screen.queryByRole("dialog")).toBeNull()
    // Created at the root, so there's nothing to file.
    expect(placeRoom).not.toHaveBeenCalled()
  })

  it("files the new Canvas into the folder you're viewing", async () => {
    createRoom.mockResolvedValue(untitled)
    renderFolder("f1", [])

    fireEvent.click(screen.getAllByRole("button", { name: "New canvas" })[0]!)

    await waitFor(() => expect(placeRoom).toHaveBeenCalledWith("r-new", "f1"))
    await waitFor(() => expect(push).toHaveBeenCalledWith("/r-new"))
  })

  it("creates inside a folder from that folder's menu", async () => {
    createRoom.mockResolvedValue(untitled)
    renderFolder(null, [folder({ id: "f2", name: "Specs" })])

    fireEvent.pointerDown(screen.getByLabelText("Folder actions"), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByRole("menuitem", { name: "New canvas" }))

    await waitFor(() => expect(placeRoom).toHaveBeenCalledWith("r-new", "f2"))
    await waitFor(() => expect(push).toHaveBeenCalledWith("/r-new"))
  })

  it("creates from the N key, but not while typing", async () => {
    createRoom.mockResolvedValue(untitled)
    renderFolder(null, [])

    const input = document.createElement("input")
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: "n" })
    expect(createRoom).not.toHaveBeenCalled()
    input.remove()

    fireEvent.keyDown(document.body, { key: "n", metaKey: true })
    expect(createRoom).not.toHaveBeenCalled()

    fireEvent.keyDown(document.body, { key: "n" })
    await waitFor(() => expect(push).toHaveBeenCalledWith("/r-new"))
    expect(createRoom).toHaveBeenCalledTimes(1)
  })

  it("stays on home when the create fails", async () => {
    createRoom.mockRejectedValue(new Error("boom"))
    renderFolder(null, [])

    const button = screen.getAllByRole("button", { name: "New canvas" })[0]!
    fireEvent.click(button)

    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false))
    expect(push).not.toHaveBeenCalled()
  })
})

describe("RoomsView — search and the ownership filter (#807)", () => {
  const nested = folder({ id: "f2", name: "Archive", parentFolderId: "f1" })
  const shared: RoomSummary = {
    ...room,
    id: "r2",
    name: "Pricing page",
    isOwner: false,
  }

  function renderRoot() {
    return render(
      <HomeProvider
        initialRooms={[room, shared]}
        initialFolders={[folder(), nested]}
        initialPlacements={[{ roomId: "r1", folderId: "f2" }]}
        initialViewPrefs={withView(DEFAULT_VIEW_PREFS, "table")}
        folderView
        currentFolderId={null}
      >
        <SidebarSearch />
        <RoomsView title="All files" showFolders />
      </HomeProvider>
    )
  }

  it("finds a Canvas filed two folders deep in a popover, leaving the page", () => {
    renderRoot()
    // At the root, the Canvas filed in Designs / Archive isn't listed.
    expect(screen.queryByText("Checkout")).toBeNull()

    const field = screen.getByLabelText("Search canvases and folders")
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: "check" } })

    const results = screen.getByRole("listbox")
    expect(within(results).getByText("Checkout")).not.toBeNull()
    expect(within(results).getByText("Designs / Archive")).not.toBeNull()
    // The folder view underneath stays as it was.
    expect(screen.getByText("Designs")).not.toBeNull()
  })

  it("opens the highlighted result on Enter", () => {
    renderRoot()
    const field = screen.getByLabelText("Search canvases and folders")
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: "check" } })
    fireEvent.keyDown(field, { key: "Enter" })
    expect(push).toHaveBeenCalledWith("/r1")
  })

  it("says so when nothing matches, and Esc clears it", () => {
    renderRoot()
    const field = screen.getByLabelText("Search canvases and folders")
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: "zzz" } })
    expect(screen.getByText("No matches")).not.toBeNull()

    fireEvent.keyDown(field, { key: "Escape" })
    expect((field as HTMLInputElement).value).toBe("")
    expect(screen.queryByText("No matches")).toBeNull()
  })

  it("lists only Canvases shared with the user under Shared with me", async () => {
    renderRoot()
    fireEvent.pointerDown(screen.getByLabelText("Owner: Anyone"), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByText("Shared with me"))

    expect(screen.getByText("Pricing page")).not.toBeNull()
    expect(screen.queryByText("Checkout")).toBeNull()
    expect(screen.getByLabelText("Owner: Shared with me")).not.toBeNull()
  })

  it("focuses search on /, but not while typing elsewhere", () => {
    renderRoot()
    const search = screen.getByLabelText("Search canvases and folders")

    const other = document.createElement("input")
    document.body.appendChild(other)
    other.focus()
    fireEvent.keyDown(other, { key: "/" })
    expect(document.activeElement).toBe(other)
    other.remove()

    fireEvent.keyDown(document.body, { key: "/" })
    expect(document.activeElement).toBe(search)
  })
})
