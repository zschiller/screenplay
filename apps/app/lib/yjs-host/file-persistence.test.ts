import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as Y from "yjs"
import type { WSSharedDoc } from "y-websocket/bin/utils"
import { FileYjsPersistence } from "@/lib/yjs-host/file-persistence"

// FileYjsPersistence operates on y-websocket's WSSharedDoc, which is a Y.Doc
// plus connection bookkeeping it never touches — a plain Y.Doc is structurally
// sufficient for these tests.
function newDoc(): WSSharedDoc {
  return new Y.Doc() as unknown as WSSharedDoc
}

describe("FileYjsPersistence", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "yjs-persist-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("round-trips a doc through disk: write, reload, same state", async () => {
    const writer = new FileYjsPersistence(dir)
    const doc = newDoc()
    writer.bindState("room-1", doc)
    await writer.whenLoaded("room-1")

    doc.getMap("canvas").set("title", "hello")
    doc.getArray("layers").push([1, 2, 3])
    await writer.flush("room-1", doc)

    // A fresh persistence + doc pointed at the same dir models a reload.
    const reader = new FileYjsPersistence(dir)
    const reloaded = newDoc()
    reader.bindState("room-1", reloaded)
    await reader.whenLoaded("room-1")

    expect(reloaded.getMap("canvas").get("title")).toBe("hello")
    expect(reloaded.getArray("layers").toArray()).toEqual([1, 2, 3])
  })

  it("a fresh room with no persisted state loads empty", async () => {
    const p = new FileYjsPersistence(dir)
    const doc = newDoc()
    p.bindState("brand-new", doc)
    await p.whenLoaded("brand-new")
    expect(doc.getMap("canvas").size).toBe(0)
  })

  it("serializes concurrent flushes of the same doc without racing on temp files", async () => {
    // Regression: flush is driven from the debounce timer, mutateDoc, and
    // writeState concurrently. Two flushes in the same millisecond used to
    // generate identical temp filenames, so one rename hit ENOENT and crashed
    // the sidecar. Firing many flushes at once must all resolve cleanly.
    const writer = new FileYjsPersistence(dir)
    const doc = newDoc()
    writer.bindState("room-race", doc)
    await writer.whenLoaded("room-race")

    doc.getMap("canvas").set("n", 42)
    await expect(
      Promise.all(
        Array.from({ length: 20 }, () => writer.flush("room-race", doc))
      )
    ).resolves.toBeDefined()

    const reader = new FileYjsPersistence(dir)
    const reloaded = newDoc()
    reader.bindState("room-race", reloaded)
    await reader.whenLoaded("room-race")
    expect(reloaded.getMap("canvas").get("n")).toBe(42)
  })

  it("deleteRoom removes persisted state", async () => {
    const p = new FileYjsPersistence(dir)
    const doc = newDoc()
    p.bindState("room-2", doc)
    await p.whenLoaded("room-2")
    doc.getMap("m").set("k", "v")
    await p.flush("room-2", doc)

    await p.deleteRoom("room-2")

    const reader = new FileYjsPersistence(dir)
    const reloaded = newDoc()
    reader.bindState("room-2", reloaded)
    await reader.whenLoaded("room-2")
    expect(reloaded.getMap("m").get("k")).toBeUndefined()
  })
})
