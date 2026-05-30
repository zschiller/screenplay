import { describe, expect, it } from "vitest"
import * as Y from "yjs"

import {
  bumpCommentsRead,
  bumpCommentsRevision,
  readCommentsRead,
  readCommentsRevision,
} from "@/lib/comments-signals"

describe("comments revision doorbell", () => {
  it("starts at zero and increments by one on a content change", () => {
    const doc = new Y.Doc()

    expect(readCommentsRevision(doc)).toBe(0)

    bumpCommentsRevision(doc)

    expect(readCommentsRevision(doc)).toBe(1)
  })
})

describe("per-user read doorbell", () => {
  it("starts at zero and increments by one for the acting user", () => {
    const doc = new Y.Doc()

    expect(readCommentsRead(doc, "user-1")).toBe(0)

    bumpCommentsRead(doc, "user-1")

    expect(readCommentsRead(doc, "user-1")).toBe(1)
  })

  it("only rings the acting user's counter, leaving other users untouched", () => {
    const doc = new Y.Doc()

    bumpCommentsRead(doc, "user-1")

    expect(readCommentsRead(doc, "user-1")).toBe(1)
    expect(readCommentsRead(doc, "user-2")).toBe(0)
  })
})

describe("the two doorbells are independent", () => {
  it("a content change never rings any user's read doorbell", () => {
    const doc = new Y.Doc()

    bumpCommentsRevision(doc)

    expect(readCommentsRead(doc, "user-1")).toBe(0)
  })

  it("a read change never rings the room-global content doorbell", () => {
    const doc = new Y.Doc()

    bumpCommentsRead(doc, "user-1")

    expect(readCommentsRevision(doc)).toBe(0)
  })
})
