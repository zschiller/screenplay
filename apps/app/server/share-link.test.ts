import { describe, expect, it } from "vitest"

import {
  isShareKey,
  parseSharePath,
  shareKey,
  sharePath,
} from "./share-link.mjs"

const SECRET = "b".repeat(64)

describe("a canvas link", () => {
  it("is the same every time for a canvas: one link, no reset", () => {
    expect(shareKey("room-1", SECRET)).toBe(shareKey("room-1", SECRET))
    expect(sharePath("room-1", SECRET)).toBe(
      `/s/room-1/${shareKey("room-1", SECRET)}`
    )
  })

  it("differs between canvases and between installs", () => {
    expect(shareKey("room-1", SECRET)).not.toBe(shareKey("room-2", SECRET))
    expect(shareKey("room-1", SECRET)).not.toBe(
      shareKey("room-1", "c".repeat(64))
    )
  })

  it("can't be minted or checked without the install's secret", () => {
    expect(shareKey("room-1", "")).toBeNull()
    expect(sharePath("room-1", "")).toBeNull()
    expect(isShareKey("room-1", "anything", "")).toBe(false)
  })

  it("checks a key against its own canvas only", () => {
    const key = shareKey("room-1", SECRET)
    expect(isShareKey("room-1", key, SECRET)).toBe(true)
    expect(isShareKey("room-2", key, SECRET)).toBe(false)
    expect(isShareKey("room-1", `${key}x`, SECRET)).toBe(false)
    expect(isShareKey("room-1", null, SECRET)).toBe(false)
  })

  it("parses /s/<canvas>/<key> and what's below it", () => {
    expect(parseSharePath("/s/room-1/abc")).toEqual({
      roomId: "room-1",
      key: "abc",
      rest: "",
    })
    expect(parseSharePath("/s/room-1/abc/mockups/m-1")?.rest).toBe(
      "mockups/m-1"
    )
    for (const path of ["/s/room-1", "/s//abc", "/room-1", "/s/%E0/abc"])
      expect(parseSharePath(path), path).toBeNull()
  })
})
