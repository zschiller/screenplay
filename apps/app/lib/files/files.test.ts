import { describe, expect, it } from "vitest"

import { makeHarness } from "@/test/canvas/harness"
import type { RoomDoc } from "@/lib/room-access"
import { canvasFilesOn, readCanvasFiles } from "./canvas-files"
import {
  createFiles,
  FILE_MAX_BYTES,
  memoryFileIndex,
  type Files,
} from "./files"
import { memoryFileStore } from "./store"

const agent = { addedBy: "agent" as const, addedById: "chat-1" }
const text = (s: string) => new TextEncoder().encode(s)
const decode = (b: Uint8Array) => new TextDecoder().decode(b)

function scope() {
  const store = memoryFileStore()
  const files = createFiles({
    index: memoryFileIndex(),
    store,
    keyPrefix: "canvas/room-1",
  })
  return { files, store }
}

async function save(files: Files, path: string, body = "x") {
  const result = await files.save({
    path,
    bytes: text(body),
    fallbackMediaType: "text/plain",
    author: agent,
  })
  if (!result.ok) throw new Error(result.error)
  return result.value
}

async function paths(files: Files, folder?: string) {
  const result = await files.list(folder)
  if (!result.ok) throw new Error(result.error)
  return result.value.map((e) => (e.kind === "folder" ? `${e.path}/` : e.path))
}

describe("files module", () => {
  it("saves a file, making the folders above it, and reads it back", async () => {
    const { files } = scope()
    const { entry } = await save(files, "research/2026/pricing.md", "# Pricing")

    expect(entry).toMatchObject({
      path: "research/2026/pricing.md",
      kind: "file",
      size: 9,
      mediaType: "text/markdown",
      addedBy: "agent",
      addedById: "chat-1",
    })
    expect(await paths(files)).toEqual([
      "research/",
      "research/2026/",
      "research/2026/pricing.md",
    ])
    const read = await files.read("/research/2026/pricing.md")
    expect(read.ok && decode(read.value.bytes)).toBe("# Pricing")
  })

  it("replaces a file saved again at the same path, keeping one entry", async () => {
    const { files, store } = scope()
    const first = await save(files, "notes.md", "one")
    const second = await save(files, "notes.md", "two!")

    expect(second.replaced).toBe(true)
    expect(second.entry.id).toBe(first.entry.id)
    expect(second.entry.size).toBe(4)
    expect(await paths(files)).toEqual(["notes.md"])
    expect(store.keys()).toHaveLength(1)
  })

  it("refuses to save into a file or over a folder", async () => {
    const { files } = scope()
    await save(files, "notes.md")
    await files.makeFolder("refs", agent)

    const into = await files.save({
      path: "notes.md/a.md",
      bytes: text("x"),
      fallbackMediaType: "text/plain",
      author: agent,
    })
    const over = await files.save({
      path: "refs",
      bytes: text("x"),
      fallbackMediaType: "text/plain",
      author: agent,
    })
    expect(into).toMatchObject({ ok: false })
    expect(over).toMatchObject({ ok: false })
  })

  it("refuses a file over the size cap without storing it", async () => {
    const { files, store } = scope()
    const result = await files.save({
      path: "big.bin",
      bytes: new Uint8Array(FILE_MAX_BYTES + 1),
      fallbackMediaType: "application/octet-stream",
      author: agent,
    })
    expect(result).toMatchObject({ ok: false })
    expect(store.keys()).toEqual([])
  })

  it("makes empty folders, and making one twice is fine", async () => {
    const { files } = scope()
    expect(await files.makeFolder("a/b", agent)).toEqual({
      ok: true,
      value: { created: true },
    })
    expect(await files.makeFolder("a/b", agent)).toEqual({
      ok: true,
      value: { created: false },
    })
    expect(await paths(files)).toEqual(["a/", "a/b/"])
  })

  it("renames a file and moves a folder with everything in it", async () => {
    const { files } = scope()
    await save(files, "drafts/a.md", "A")
    await save(files, "drafts/deep/b.md", "B")
    await save(files, "drafts-old/c.md")

    expect(await files.move("drafts/a.md", "drafts/intro.md")).toMatchObject({
      ok: true,
      value: { kind: "file", moved: 1 },
    })
    expect(await files.move("drafts", "archive/drafts")).toMatchObject({
      ok: true,
      value: { kind: "folder", moved: 4 },
    })
    expect(await paths(files)).toEqual([
      "archive/",
      "archive/drafts/",
      "archive/drafts/deep/",
      "archive/drafts/deep/b.md",
      "archive/drafts/intro.md",
      "drafts-old/",
      "drafts-old/c.md",
    ])
    // The bytes follow the entry.
    const read = await files.read("archive/drafts/deep/b.md")
    expect(read.ok && decode(read.value.bytes)).toBe("B")
  })

  it("refuses a move onto something that exists or into itself", async () => {
    const { files } = scope()
    await save(files, "a/x.md")
    await save(files, "b.md")

    expect(await files.move("b.md", "a/x.md")).toMatchObject({ ok: false })
    expect(await files.move("a", "a/inner")).toMatchObject({ ok: false })
    expect(await files.move("missing.md", "c.md")).toMatchObject({ ok: false })
  })

  it("deletes a folder with its contents and their bytes", async () => {
    const { files, store } = scope()
    await save(files, "refs/a.png")
    await save(files, "refs/sub/b.pdf")
    await save(files, "keep.md")

    expect(await files.remove("refs")).toEqual({
      ok: true,
      value: { kind: "folder", removed: 4 },
    })
    expect(await paths(files)).toEqual(["keep.md"])
    expect(store.keys()).toHaveLength(1)
  })

  it("lists one folder's contents", async () => {
    const { files } = scope()
    await save(files, "a/x.md")
    await save(files, "a/y/z.md")
    await save(files, "b.md")

    expect(await paths(files, "a")).toEqual(["a/x.md", "a/y/", "a/y/z.md"])
    expect(await files.list("b.md")).toMatchObject({ ok: false })
  })
})

describe("Canvas Files", () => {
  function room(): {
    room: RoomDoc
    collections: ReturnType<typeof makeHarness>["collections"]
  } {
    const { collections } = makeHarness()
    return {
      collections,
      room: {
        roomId: "room-1",
        readDoc: async (fn) => fn(collections),
        mutateDoc: async (fn) => fn(collections),
      },
    }
  }

  it("keeps entries in the Room's doc and bytes in the store, under the room", async () => {
    const { room: doc, collections } = room()
    const store = memoryFileStore()
    const files = canvasFilesOn(doc, store)

    await save(files, "uploads/brief.md", "hello")

    expect(
      readCanvasFiles(collections)
        .map((e) => e.path)
        .sort()
    ).toEqual(["uploads", "uploads/brief.md"])
    expect(store.keys()).toEqual([
      expect.stringMatching(/^canvas\/room-1\/file-/),
    ])
    const read = await canvasFilesOn(doc, store).read("uploads/brief.md")
    expect(read.ok && decode(read.value.bytes)).toBe("hello")
  })
})
