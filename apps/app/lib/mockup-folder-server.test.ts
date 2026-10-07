import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { memoryFileStore } from "@/lib/files/store"
import {
  mockupFolderOn,
  mockupPageBase,
  mockupPageToken,
  verifyMockupPageToken,
} from "@/lib/mockup-folder-server"
import type { RoomDoc, RoomReader } from "@/lib/room-access"
import { mockupHtml, writeMockupHtml } from "@/lib/yjs/mockup-html"
import { makeHarness } from "@/test/canvas/harness"

/** A canvas whose Mockup folders live in memory. */
function setup() {
  const h = makeHarness()
  const room = {
    roomId: "room-1",
    readDoc: async (fn) => fn(h.collections),
    mutateDoc: async (fn) => fn(h.collections),
  } as RoomDoc
  const store = memoryFileStore()
  return { ...h, room, store, folder: mockupFolderOn(room, store) }
}

const text = (bytes: Uint8Array | null) =>
  bytes ? new TextDecoder().decode(bytes) : null

describe("Mockup folders (#1886)", () => {
  it("moves a page from before folders into its folder’s index.html on its first read", async () => {
    const { ops, doc, collections, store, folder } = setup()
    collections.mockupLayers.set("m", {
      id: "m",
      width: 400,
      height: 300,
      title: "Old",
    })
    writeMockupHtml(mockupHtml(doc, "m"), "<h1>Old</h1>")

    expect(await folder.page("m")).toEqual({
      fileId: "m",
      html: "<h1>Old</h1>",
      revision: 1,
    })
    expect(text(await store.get("canvas/room-1/mockups/m/index.html"))).toBe(
      "<h1>Old</h1>"
    )
    // The room doc no longer holds the page.
    expect(mockupHtml(doc, "m").toString()).toBe("")
    expect(collections.mockupLayers.get("m")?.revision).toBe(1)
    expect(ops.fileOf("m")?.revision).toBe(1)
  })

  it("reads a page from before folders where it is for a reader that can’t write", async () => {
    const { doc, collections, store } = setup()
    collections.mockupLayers.set("m", {
      id: "m",
      width: 400,
      height: 300,
      title: "Old",
    })
    writeMockupHtml(mockupHtml(doc, "m"), "<h1>Old</h1>")
    const reader = {
      roomId: "room-1",
      readDoc: async (fn) => fn(collections),
    } as RoomReader

    expect(await mockupFolderOn(reader, store).page("m")).toEqual({
      fileId: "m",
      html: "<h1>Old</h1>",
      revision: 0,
    })
    expect(store.keys()).toEqual([])
  })

  it("makes a Duplicate’s folder from its source’s on the copy’s first read", async () => {
    const { ops, collections, store, folder } = setup()
    const { mockupId } = ops.createMockup({
      title: "A",
      width: 400,
      height: 300,
    })!
    await folder.write(mockupId, {
      files: [
        { path: "index.html", bytes: new TextEncoder().encode("<p>A</p>") },
        { path: "data.js", bytes: new TextEncoder().encode("1") },
      ],
    })
    collections.iframeLayerGroups.set("g", {
      id: "g",
      name: "Group 1",
      x: 0,
      y: 0,
      members: [{ kind: "mockup-layer", id: mockupId }],
    })
    const copyId = ops.duplicateMockup(mockupId)!

    expect(await folder.page(copyId)).toEqual({
      fileId: copyId,
      html: "<p>A</p>",
      revision: 1,
    })
    expect(
      text(await store.get(`canvas/room-1/mockups/${copyId}/data.js`))
    ).toBe("1")
    expect(collections.mockupLayers.get(copyId)?.copyOf).toBeUndefined()

    // The copy is its own file from here on.
    await folder.write(mockupId, {
      files: [{ path: "data.js", bytes: new TextEncoder().encode("2") }],
    })
    expect(text(await folder.read(copyId, "data.js"))).toBe("1")
  })

  it("has no page for a Mockup nobody wrote yet", async () => {
    const { ops, folder } = setup()
    const { mockupId } = ops.createMockup({
      title: "",
      width: 390,
      height: 844,
    })!

    expect(await folder.page(mockupId)).toEqual({
      fileId: mockupId,
      html: "",
      revision: 0,
    })
    expect(await folder.page("gone")).toBeNull()
  })

  it("never reads outside the folder", async () => {
    const { ops, store, folder } = setup()
    const { mockupId } = ops.createMockup({
      title: "A",
      width: 400,
      height: 300,
    })!
    await store.put("canvas/room-1/secret", new Uint8Array([1]), "")

    expect(await folder.read(mockupId, "../../secret")).toBeNull()
    expect(
      await folder.write(mockupId, {
        files: [{ path: "../x.js", bytes: new Uint8Array([1]) }],
      })
    ).toMatchObject({ ok: false })
  })

  it("removes a folder for good only once its Mockup is gone", async () => {
    const { ops, store, folder } = setup()
    const { mockupId } = ops.createMockup({
      title: "A",
      width: 400,
      height: 300,
    })!
    await folder.write(mockupId, {
      files: [{ path: "index.html", bytes: new TextEncoder().encode("<p/>") }],
    })

    expect(await folder.purge(mockupId)).toBe(false)
    expect(store.keys()).toHaveLength(1)

    ops.removeMockups([mockupId])
    expect(await folder.purge(mockupId)).toBe(true)
    expect(store.keys()).toEqual([])
  })
})

describe("pages-route tokens (#1886)", () => {
  const secret = process.env.TERMINAL_AUTH_SECRET
  beforeEach(() => {
    process.env.TERMINAL_AUTH_SECRET = "test-secret"
  })
  afterEach(() => {
    process.env.TERMINAL_AUTH_SECRET = secret
  })

  it("names one Mockup in one canvas until it expires", () => {
    const { token, expiresAt } = mockupPageToken("room-1", "m", 1000)

    expect(verifyMockupPageToken(token, 2000)).toEqual({
      roomId: "room-1",
      fileId: "m",
    })
    expect(verifyMockupPageToken(token, expiresAt + 1)).toBeNull()
  })

  it("refuses a token anyone changed", () => {
    const { token } = mockupPageToken("room-1", "m", 1000)
    const [body, sig] = token.split(".")
    const other = Buffer.from(
      JSON.stringify({ r: "room-2", f: "m", exp: 1e15 })
    ).toString("base64url")

    expect(verifyMockupPageToken(`${other}.${sig}`, 2000)).toBeNull()
    expect(verifyMockupPageToken(`${body}.x${sig}`, 2000)).toBeNull()
    expect(verifyMockupPageToken("nonsense", 2000)).toBeNull()
  })

  it("puts the revision in the base, so a write reloads the page", () => {
    const base = mockupPageBase("room-1", "m", 3, 1000)
    expect(base.path).toMatch(/^\/api\/mockup-pages\/[\w-]+\.[\w-]+\/r3\/$/)
  })
})
