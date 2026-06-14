// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { HomeProvider } from "./home-provider"
import {
  FileDndProvider,
  useFileDraggable,
  useFolderDragDrop,
  useFolderDroppable,
  useRootDroppable,
} from "./file-dnd"
import type { FolderSummary } from "@/lib/folders-actions"

// The home provider binds the server-only db/yjs stacks at import; stub them so
// the import graph stays client-only. The drag handlers route through
// `placeRoom` (canvas filing) and `moveFolder` (folder re-parenting), so those
// are the spies the assertions watch.
const placeRoom =
  vi.fn<(roomId: string, folderId: string | null) => Promise<void>>()
const moveFolder =
  vi.fn<(folderId: string, parentFolderId: string | null) => Promise<void>>()
vi.mock("@/lib/folders-actions", () => ({
  createFolder: vi.fn(),
  deleteFolder: vi.fn(),
  renameFolder: vi.fn(),
  listRoomPlacements: vi.fn().mockResolvedValue([]),
  placeRoom: (roomId: string, folderId: string | null) =>
    placeRoom(roomId, folderId),
  moveFolder: (folderId: string, parentFolderId: string | null) =>
    moveFolder(folderId, parentFolderId),
}))
vi.mock("@/lib/rooms-actions", () => ({
  createRoom: vi.fn(),
  deleteRoom: vi.fn(),
  renameRoom: vi.fn(),
  listRooms: vi.fn().mockResolvedValue([]),
}))
vi.mock("@/lib/yjs-host/client", () => ({ prewarmRoom: vi.fn() }))

// dnd-kit's PointerSensor refuses to start a drag unless the pointer event is
// the primary one, so every simulated event below sets `isPrimary` (jsdom
// defaults it to false). Pointer-capture is also unimplemented in jsdom.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}

// a > b > c — a folder tree deep enough to exercise the descendant cycle guard.
const folders: FolderSummary[] = [
  {
    id: "a",
    name: "Alpha",
    ownerId: "u1",
    parentFolderId: null,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "b",
    name: "Beta",
    ownerId: "u1",
    parentFolderId: "a",
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "c",
    name: "Gamma",
    ownerId: "u1",
    parentFolderId: "b",
    createdAt: 0,
    updatedAt: 0,
  },
]

// Give a node a real layout box so dnd-kit's collision detection has something
// to hit — jsdom returns an all-zero rect otherwise.
function stubRect(el: Element, rect: Partial<DOMRect>) {
  el.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
      ...rect,
    }) as DOMRect
}

function DraggableRoom({ parent }: { parent: string | null }) {
  const { setNodeRef, attributes, listeners } = useFileDraggable({
    kind: "room",
    id: "r1",
    name: "Sketch",
    currentParentId: parent,
  })
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} data-testid="room">
      Sketch
    </div>
  )
}

function DraggableFolder({ folder }: { folder: FolderSummary }) {
  const { setNodeRef, attributes, listeners } = useFolderDragDrop(folder)
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-testid={`drag-${folder.id}`}
    >
      {folder.name}
    </div>
  )
}

function DropFolder({
  folder,
  scope,
}: {
  folder: FolderSummary
  scope?: string
}) {
  const { setNodeRef, isOver } = useFolderDroppable(folder.id, scope)
  const testid = scope ? `drop-${scope}-${folder.id}` : `drop-${folder.id}`
  return (
    <div ref={setNodeRef} data-testid={testid} data-over={isOver}>
      {folder.name}
    </div>
  )
}

function DropRoot() {
  const { setNodeRef, isOver } = useRootDroppable()
  return (
    <div ref={setNodeRef} data-testid="drop-root" data-over={isOver}>
      All files
    </div>
  )
}

function renderHarness(children: React.ReactNode) {
  return render(
    <HomeProvider
      initialRooms={[]}
      initialFolders={folders}
      initialPlacements={[]}
      folderView
      currentFolderId={null}
    >
      <FileDndProvider>{children}</FileDndProvider>
    </HomeProvider>
  )
}

// Let dnd-kit's async droppable measuring settle between drag steps — it
// measures rects a frame after the drag starts, so collisions need that gap.
const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })

// Drive a pointer drag from `source` over `target`: press, cross the 6px
// activation threshold, settle the pointer inside the target's rect, release.
async function dragOnto(source: HTMLElement, targetX: number) {
  fireEvent.pointerDown(source, {
    isPrimary: true,
    button: 0,
    clientX: 0,
    clientY: 25,
  })
  // First move activates the sensor (well past 6px) without landing anywhere.
  fireEvent.pointerMove(document, { isPrimary: true, clientX: 40, clientY: 25 })
  await flush()
  // Second move settles the pointer inside the destination's box.
  fireEvent.pointerMove(document, {
    isPrimary: true,
    clientX: targetX,
    clientY: 25,
  })
  await flush()
  fireEvent.pointerUp(document, {
    isPrimary: true,
    clientX: targetX,
    clientY: 25,
  })
  await flush()
}

beforeEach(() => {
  placeRoom.mockResolvedValue()
  moveFolder.mockResolvedValue()
})

afterEach(() => {
  cleanup()
  placeRoom.mockReset()
  moveFolder.mockReset()
})

describe("FileDndProvider — drag-drop filing", () => {
  it("files a canvas into the folder it's dropped on", async () => {
    renderHarness(
      <>
        <DraggableRoom parent={null} />
        <DropFolder folder={folders[0]!} />
      </>
    )
    // Park the drop folder's box where the drag settles (x: 150–250).
    stubRect(screen.getByTestId("drop-a"), {
      top: 0,
      bottom: 50,
      left: 150,
      right: 250,
      width: 100,
      height: 50,
    })

    await dragOnto(screen.getByTestId("room"), 200)

    await waitFor(() => expect(placeRoom).toHaveBeenCalledWith("r1", "a"))
    expect(moveFolder).not.toHaveBeenCalled()
  })

  it("rejects dropping a folder onto one of its descendants (cycle)", async () => {
    // Drag "Alpha" (root of a > b > c) onto its descendant "Gamma": the
    // descendant is not a valid target, so nothing moves.
    renderHarness(
      <>
        <DraggableFolder folder={folders[0]!} />
        <DropFolder folder={folders[2]!} />
      </>
    )
    stubRect(screen.getByTestId("drop-c"), {
      top: 0,
      bottom: 50,
      left: 150,
      right: 250,
      width: 100,
      height: 50,
    })

    await dragOnto(screen.getByTestId("drag-a"), 200)

    // Give any (unexpected) async move a chance to fire before asserting absence.
    await Promise.resolve()
    expect(moveFolder).not.toHaveBeenCalled()
  })

  it("files onto a pinned folder row even when its grid tile is also mounted", async () => {
    // The same folder is a drop target twice — its grid tile and its pinned
    // sidebar row. They must use distinct droppable ids, or dnd-kit's id-keyed
    // registry clobbers one and it stops being hittable. Park the pinned copy
    // where the drag lands and confirm the drop still files the canvas.
    renderHarness(
      <>
        <DraggableRoom parent={null} />
        <DropFolder folder={folders[0]!} scope="grid" />
        <DropFolder folder={folders[0]!} scope="pinned" />
      </>
    )
    stubRect(screen.getByTestId("drop-pinned-a"), {
      top: 0,
      bottom: 50,
      left: 150,
      right: 250,
      width: 100,
      height: 50,
    })

    await dragOnto(screen.getByTestId("room"), 200)

    await waitFor(() => expect(placeRoom).toHaveBeenCalledWith("r1", "a"))
  })

  it("files a canvas back to the root when dropped on 'All files'", async () => {
    // The canvas lives in folder "a"; dropping it on the root drop zone files it
    // to the top level — `placeRoom` with a null folder.
    renderHarness(
      <>
        <DraggableRoom parent="a" />
        <DropRoot />
      </>
    )
    stubRect(screen.getByTestId("drop-root"), {
      top: 0,
      bottom: 50,
      left: 150,
      right: 250,
      width: 100,
      height: 50,
    })

    await dragOnto(screen.getByTestId("room"), 200)

    await waitFor(() => expect(placeRoom).toHaveBeenCalledWith("r1", null))
  })

  it("re-parents a folder dropped onto a folder outside its subtree", async () => {
    // Drag "Gamma" (leaf) onto "Alpha": a legal move up the tree's sibling line.
    renderHarness(
      <>
        <DraggableFolder folder={folders[2]!} />
        <DropFolder folder={folders[0]!} />
      </>
    )
    stubRect(screen.getByTestId("drop-a"), {
      top: 0,
      bottom: 50,
      left: 150,
      right: 250,
      width: 100,
      height: 50,
    })

    await dragOnto(screen.getByTestId("drag-c"), 200)

    await waitFor(() => expect(moveFolder).toHaveBeenCalledWith("c", "a"))
  })
})
