import { describe, expect, it } from "vitest"

import {
  accountFilesOn,
  listFileIndex,
  memoryFileListStore,
  type FileListStore,
} from "./account-files"
import { memoryFileStore } from "./store"

const author = { addedBy: "agent" as const, addedById: "chat-1" }
const bytes = (text: string) => new TextEncoder().encode(text)

describe("Account Files", () => {
  it("keeps each person's files apart, under their own store keys", async () => {
    const store = memoryFileStore()
    const ana = accountFilesOn(
      "ana",
      listFileIndex(memoryFileListStore()),
      store
    )
    const ben = accountFilesOn(
      "ben",
      listFileIndex(memoryFileListStore()),
      store
    )

    const saved = await ana.save({
      path: "notes/voice.md",
      bytes: bytes("Plain."),
      fallbackMediaType: "text/plain",
      author,
    })
    expect(saved.ok && saved.value.entry.blobKey).toMatch(
      /^account\/ana\/file-/
    )
    const benList = await ben.list()
    expect(benList.ok && benList.value).toEqual([])
    const read = await ana.read("notes/voice.md")
    expect(read.ok && new TextDecoder().decode(read.value.bytes)).toBe("Plain.")
  })

  it("escapes a user id in its store keys", async () => {
    const files = accountFilesOn(
      "../canvas/room-1",
      listFileIndex(memoryFileListStore()),
      memoryFileStore()
    )
    const saved = await files.save({
      path: "a.md",
      bytes: bytes("x"),
      fallbackMediaType: "text/plain",
      author,
    })
    expect(saved.ok && saved.value.entry.blobKey).toMatch(
      /^account\/\.\.%2Fcanvas%2Froom-1\/file-/
    )
  })

  it("reads the list back after each write, so a fresh index sees it", async () => {
    const list = memoryFileListStore()
    const store = memoryFileStore()
    await accountFilesOn("ana", listFileIndex(list), store).makeFolder(
      "a/b",
      author
    )
    const listed = await accountFilesOn(
      "ana",
      listFileIndex(list),
      store
    ).list()
    expect(listed.ok && listed.value.map((e) => e.path)).toEqual(["a", "a/b"])
  })

  it("writes under the store's exclusive, so saves at once keep each other", async () => {
    const inner = memoryFileListStore()
    let queue: Promise<unknown> = Promise.resolve()
    let held = 0
    const list: FileListStore = {
      // A slow store, so unguarded writes would interleave.
      load: async () => {
        await new Promise((r) => setTimeout(r, 5))
        return inner.load()
      },
      save: inner.save,
      exclusive(fn) {
        const run = queue.then(async () => {
          held++
          try {
            expect(held).toBe(1)
            return await fn()
          } finally {
            held--
          }
        })
        queue = run.catch(() => {})
        return run
      },
    }
    const files = accountFilesOn("ana", listFileIndex(list), memoryFileStore())
    await Promise.all(
      ["a.md", "b.md", "c.md"].map((path) =>
        files.save({
          path,
          bytes: bytes(path),
          fallbackMediaType: "text/plain",
          author,
        })
      )
    )
    const listed = await files.list()
    expect(listed.ok && listed.value.map((e) => e.path)).toEqual([
      "a.md",
      "b.md",
      "c.md",
    ])
  })
})
