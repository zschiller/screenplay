import { describe, expect, it } from "vitest"

import { buildAttachmentsFooter } from "@/lib/agent/message-markers"
import { textBlock } from "@/lib/agent/acp/schema"
import {
  adoptAttachment,
  removeAttachment,
  saveAttachment,
  withAttachedImages,
} from "./attach"
import { createFiles, memoryFileIndex } from "./files"
import { memoryFileStore } from "./store"

const bytes = (s: string) => new TextEncoder().encode(s)

function scope() {
  const store = memoryFileStore()
  const files = createFiles({
    index: memoryFileIndex(),
    store,
    keyPrefix: "canvas/room-1",
  })
  return { files, store }
}

async function paths(files: ReturnType<typeof scope>["files"]) {
  const listed = await files.list()
  if (!listed.ok) throw new Error(listed.error)
  return listed.value.map((e) => `${e.path}${e.kind === "folder" ? "/" : ""}`)
}

describe("saveAttachment (#1525)", () => {
  it("saves under uploads, as the member, beside a file of the same name", async () => {
    const { files } = scope()
    const first = await saveAttachment(files, {
      name: "shot.png",
      type: "image/png",
      bytes: bytes("one"),
      userId: "user-1",
    })
    const second = await saveAttachment(files, {
      name: "shot.png",
      type: "image/png",
      bytes: bytes("two"),
      userId: "user-2",
    })
    expect(first).toEqual({
      ok: true,
      value: { path: "uploads/shot.png", mediaType: "image/png", size: 3 },
    })
    expect(second).toMatchObject({
      ok: true,
      value: { path: "uploads/shot-2.png" },
    })
    expect(await paths(files)).toEqual([
      "uploads/",
      "uploads/shot-2.png",
      "uploads/shot.png",
    ])
    const read = await files.read("uploads/shot.png")
    expect(read.ok && new TextDecoder().decode(read.value.bytes)).toBe("one")
    expect(read.ok && read.value.entry).toMatchObject({
      addedBy: "member",
      addedById: "user-1",
    })
  })

  it("refuses a type agents can’t read and saves nothing", async () => {
    const { files, store } = scope()
    const result = await saveAttachment(files, {
      name: "song.mp3",
      type: "audio/mpeg",
      bytes: bytes("x"),
      userId: "user-1",
    })
    expect(result.ok).toBe(false)
    expect(await paths(files)).toEqual([])
    expect(store.keys()).toEqual([])
  })
})

describe("adoptAttachment", () => {
  it("adds bytes the browser uploaded to the store under uploads", async () => {
    const { files, store } = scope()
    await store.put("canvas/room-1/file-abcdefghij", bytes("%PDF"), "")
    const result = await adoptAttachment(files, store, {
      name: "brief.pdf",
      type: "application/pdf",
      blobKey: "canvas/room-1/file-abcdefghij",
      userId: "user-1",
    })
    expect(result).toEqual({
      ok: true,
      value: {
        path: "uploads/brief.pdf",
        mediaType: "application/pdf",
        size: 4,
      },
    })
    const read = await files.read("uploads/brief.pdf")
    expect(read.ok && read.value.entry.blobKey).toBe(
      "canvas/room-1/file-abcdefghij"
    )
  })

  it("deletes refused bytes, and won’t take another canvas’s key", async () => {
    const { files, store } = scope()
    await store.put("canvas/room-1/file-abcdefghij", bytes("x"), "")
    const refused = await adoptAttachment(files, store, {
      name: "clip.mov",
      type: "video/quicktime",
      blobKey: "canvas/room-1/file-abcdefghij",
      userId: "user-1",
    })
    expect(refused.ok).toBe(false)
    expect(store.keys()).toEqual([])

    await store.put("canvas/room-2/file-abcdefghij", bytes("x"), "")
    const elsewhere = await adoptAttachment(files, store, {
      name: "a.md",
      type: "",
      blobKey: "canvas/room-2/file-abcdefghij",
      userId: "user-1",
    })
    expect(elsewhere.ok).toBe(false)
    expect(await paths(files)).toEqual([])
  })

  it("says so when the upload never arrived", async () => {
    const { files, store } = scope()
    const result = await adoptAttachment(files, store, {
      name: "a.md",
      type: "",
      blobKey: "canvas/room-1/file-missing123",
      userId: "user-1",
    })
    expect(result).toEqual({
      ok: false,
      error: "The upload didn’t arrive. Try again.",
    })
  })
})

describe("removeAttachment", () => {
  it("deletes only an upload this member added", async () => {
    const { files } = scope()
    await saveAttachment(files, {
      name: "mine.md",
      type: "",
      bytes: bytes("x"),
      userId: "user-1",
    })
    await files.save({
      path: "uploads/agent.md",
      bytes: bytes("x"),
      fallbackMediaType: "text/plain",
      author: { addedBy: "agent", addedById: "chat-1" },
    })
    expect(
      (await removeAttachment(files, "uploads/mine.md", "user-2")).ok
    ).toBe(false)
    expect(
      (await removeAttachment(files, "uploads/agent.md", "user-1")).ok
    ).toBe(false)
    expect(
      (await removeAttachment(files, "uploads/mine.md", "user-1")).ok
    ).toBe(true)
    expect(await paths(files)).toEqual(["uploads/", "uploads/agent.md"])
  })
})

describe("withAttachedImages", () => {
  it("adds each attached image inline, and leaves other files to be opened", async () => {
    const { files } = scope()
    const png = await saveAttachment(files, {
      name: "shot.png",
      type: "image/png",
      bytes: bytes("PNG"),
      userId: "user-1",
    })
    const md = await saveAttachment(files, {
      name: "notes.md",
      type: "",
      bytes: bytes("# hi"),
      userId: "user-1",
    })
    if (!png.ok || !md.ok) throw new Error("save failed")
    const blocks = [
      textBlock("look" + buildAttachmentsFooter([png.value, md.value])),
    ]
    expect(await withAttachedImages(files, blocks)).toEqual([
      ...blocks,
      {
        type: "image",
        mimeType: "image/png",
        data: Buffer.from("PNG").toString("base64"),
      },
    ])
  })

  it("returns a turn with no images as it was, and skips a file that’s gone", async () => {
    const { files } = scope()
    const plain = [textBlock("hello")]
    expect(await withAttachedImages(files, plain)).toBe(plain)
    const gone = [
      textBlock(
        "x" +
          buildAttachmentsFooter([
            { path: "uploads/gone.png", mediaType: "image/png", size: 3 },
          ])
      ),
    ]
    expect(await withAttachedImages(files, gone)).toEqual(gone)
  })
})
