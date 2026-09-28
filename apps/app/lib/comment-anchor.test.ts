import { describe, expect, it } from "vitest"

import {
  DETACH_GRACE_MS,
  homeFrame,
  parseElementAnchor,
  placeFrameThread,
  routePath,
  sameRoute,
  snapshotLabel,
  type PlacementFrame,
  type PlacementThread,
} from "./comment-anchor"

const frame: PlacementFrame = {
  id: "f1",
  branchId: "ws1",
  width: 400,
  height: 800,
}

function thread(over: Partial<PlacementThread> = {}): PlacementThread {
  return {
    iframeLayerId: "f1",
    workspaceId: "ws1",
    route: "/checkout",
    selector: "main > button",
    anchor: { path: "main > button", tag: "button", text: "Pay" },
    x: 10,
    y: 20,
    offsetX: 0.5,
    offsetY: 0.5,
    ...over,
  }
}

const rect = { x: 100, y: 200, width: 40, height: 20 }

describe("routePath", () => {
  it("drops query, hash and trailing slash", () => {
    expect(routePath("/cart/?a=1#top")).toBe("/cart")
    expect(routePath("cart")).toBe("/cart")
    expect(routePath("")).toBe("/")
    expect(routePath(null)).toBe("/")
    expect(routePath("/")).toBe("/")
  })

  it("treats routes that differ only by query as the same page", () => {
    expect(sameRoute("/cart?step=2", "/cart")).toBe(true)
    expect(sameRoute("/cart", "/checkout")).toBe(false)
  })
})

describe("homeFrame", () => {
  const other: PlacementFrame = { ...frame, id: "f2" }

  it("prefers the frame the comment was made on", () => {
    const frames = new Map([
      ["f2", other],
      ["f1", frame],
    ])
    expect(homeFrame(thread(), frames)?.id).toBe("f1")
  })

  it("falls back to a frame showing the same Workspace", () => {
    expect(homeFrame(thread(), new Map([["f2", other]]))?.id).toBe("f2")
  })

  it("is null when neither exists", () => {
    const unrelated = { ...frame, id: "f3", branchId: "ws2" }
    expect(homeFrame(thread(), new Map([["f3", unrelated]]))).toBeNull()
  })
})

describe("placeFrameThread", () => {
  const base = { frame, missingSince: null, now: 10_000 }

  it("pins at the element's offset point on the comment's route", () => {
    expect(
      placeFrameThread({
        ...base,
        thread: thread(),
        view: { path: "/checkout", rect },
      })
    ).toEqual({
      kind: "pinned",
      frameId: "f1",
      x: 120,
      y: 210,
      element: rect,
    })
  })

  it("counts a comment made on another route as off-route", () => {
    expect(
      placeFrameThread({
        ...base,
        thread: thread(),
        view: { path: "/cart", rect },
      })
    ).toEqual({ kind: "offRoute", frameId: "f1", route: "/checkout" })
  })

  it("detaches when the frame and its Workspace are gone", () => {
    expect(
      placeFrameThread({ ...base, frame: null, thread: thread(), view: null })
    ).toEqual({ kind: "detached", reason: "frame" })
  })

  it("waits out a brief miss, then detaches", () => {
    const view = { path: "/checkout", rect: null }
    expect(
      placeFrameThread({
        ...base,
        thread: thread(),
        view,
        missingSince: base.now - 100,
      })
    ).toEqual({ kind: "pending" })
    expect(
      placeFrameThread({
        ...base,
        thread: thread(),
        view,
        missingSince: base.now - DETACH_GRACE_MS,
      })
    ).toEqual({ kind: "detached", reason: "element" })
  })

  it("shows nothing until the viewer's frame has answered", () => {
    expect(placeFrameThread({ ...base, thread: thread(), view: null })).toEqual(
      { kind: "pending" }
    )
  })

  it("hides a pin scrolled out of the frame", () => {
    expect(
      placeFrameThread({
        ...base,
        thread: thread(),
        view: { path: "/checkout", rect: { ...rect, y: -300 } },
      })
    ).toEqual({ kind: "pending" })
  })

  it("shows a comment from before routes were stored on any route", () => {
    expect(
      placeFrameThread({
        ...base,
        thread: thread({ route: null }),
        view: { path: "/anything", rect },
      }).kind
    ).toBe("pinned")
  })

  it("places a point comment with no element at its stored point", () => {
    const t = thread({ selector: null, anchor: null })
    expect(
      placeFrameThread({
        ...base,
        thread: t,
        view: { path: "/checkout", rect: null },
      })
    ).toEqual({ kind: "pinned", frameId: "f1", x: 10, y: 20 })
    expect(
      placeFrameThread({
        ...base,
        thread: t,
        view: { path: "/cart", rect: null },
      }).kind
    ).toBe("offRoute")
  })
})

describe("snapshotLabel", () => {
  it("names the element by tag and text", () => {
    expect(snapshotLabel({ path: "p", tag: "button", text: "Pay" })).toBe(
      "button “Pay”"
    )
    expect(snapshotLabel({ path: "p", tag: "img" })).toBe("img")
    expect(snapshotLabel(null)).toBeNull()
  })
})

describe("parseElementAnchor", () => {
  it("keeps known string fields and requires a path", () => {
    expect(
      parseElementAnchor({ path: "a", tag: "b", id: 3, text: "x".repeat(200) })
    ).toEqual({ path: "a", tag: "b", text: "x".repeat(80) })
    expect(parseElementAnchor({ tag: "b" })).toBeNull()
    expect(parseElementAnchor("nope")).toBeNull()
  })
})
