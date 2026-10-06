import { describe, expect, it } from "vitest"
import * as Y from "yjs"

import { getRoomCollections } from "./schema"

function layers() {
  const doc = new Y.Doc()
  const { iframeLayers } = getRoomCollections(doc)
  for (const id of ["a", "b"])
    iframeLayers.set(id, { id, label: id, width: 100, height: 100 } as never)
  return iframeLayers
}

describe("YjsCollection snapshots", () => {
  it("keep an unchanged entry's object when another entry changes", () => {
    const collection = layers()
    const stop = collection.observe(() => {})
    const [a1, b1] = collection.toArray()
    collection.update("a", { width: 200 })
    const [a2, b2] = collection.toArray()
    expect(a2).not.toBe(a1)
    expect(a2!.width).toBe(200)
    expect(b2).toBe(b1)
    expect(collection.toMap().get("b")).toBe(b1)
    stop()
  })

  it("drop a removed entry and pick up a replaced one", () => {
    const collection = layers()
    const stop = collection.observe(() => {})
    collection.toArray()
    collection.set("b", { id: "b", label: "B", width: 1, height: 1 } as never)
    expect(collection.toMap().get("b")!.label).toBe("B")
    collection.delete("a")
    expect(collection.toArray().map((l) => l.id)).toEqual(["b"])
    stop()
  })

  it("read fresh while unobserved", () => {
    const collection = layers()
    const stop = collection.observe(() => {})
    collection.toArray()
    stop()
    collection.update("a", { width: 300 })
    expect(collection.get("a")!.width).toBe(300)
    const again = collection.observe(() => {})
    expect(collection.toMap().get("a")!.width).toBe(300)
    again()
  })
})
