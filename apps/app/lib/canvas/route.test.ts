import { describe, expect, it } from "vitest"

import type { GapHandle, ReorderHandle } from "@/lib/canvas/layout"
import {
  assembleReorderStart,
  hitTestGapHandle,
  hitTestMarquee,
  hitTestReorderHandle,
  routePointerToGesture,
  screenToCanvas,
  type MarqueeLayout,
  type RouteGroup,
  type RoutePointerInput,
} from "@/lib/canvas/route"

const reorderHandle = (
  iframeLayerId: string,
  centerX: number,
  centerY: number
): ReorderHandle => ({ iframeLayerId, centerX, centerY })

const gapHandle = (over: Partial<GapHandle> = {}): GapHandle => ({
  groupId: "g1",
  gapIndex: 1,
  centerX: 100,
  left: 90,
  right: 110,
  top: 0,
  bottom: 200,
  ...over,
})

const group = (over: Partial<RouteGroup> = {}): RouteGroup => ({
  id: "g1",
  x: 0,
  gap: 24,
  members: [
    { id: "a", kind: "iframe-layer", width: 100 },
    { id: "b", kind: "iframe-layer", width: 100 },
  ],
  ...over,
})

/** A baseline routing input — empty geometry, nothing suppressed, both phases. */
const baseInput = (over: Partial<RoutePointerInput> = {}): RoutePointerInput => ({
  canvas: { x: 0, y: 0 },
  zoom: 1,
  shiftKey: false,
  metaKey: false,
  suppressed: false,
  phase: { reorderGap: true, marquee: true },
  reorderHandles: [],
  gapHandles: [],
  groups: [],
  memberLayouts: new Map(),
  baseIframeLayerIds: new Set(),
  baseDocumentLayerIds: new Set(),
  ...over,
})

describe("screenToCanvas", () => {
  it("inverts the pan/zoom transform", () => {
    const rect = { left: 10, top: 20 }
    const transform = { positionX: 5, positionY: 5, scale: 2 }
    // clientX 35 → (35 - 10 - 5) / 2 = 10 ; clientY 45 → (45 - 20 - 5) / 2 = 10
    expect(screenToCanvas(35, 45, rect, transform)).toEqual({ x: 10, y: 10 })
  })

  it("is identity at origin with scale 1", () => {
    expect(
      screenToCanvas(42, 7, { left: 0, top: 0 }, {
        positionX: 0,
        positionY: 0,
        scale: 1,
      })
    ).toEqual({ x: 42, y: 7 })
  })
})

describe("hitTestReorderHandle", () => {
  it("hits a dot within the padded radius", () => {
    const handles = [reorderHandle("a", 50, 50)]
    // 8px radius at zoom 1 — a point 5px away hits.
    expect(hitTestReorderHandle(handles, 53, 54, 1)?.iframeLayerId).toBe("a")
  })

  it("misses outside the radius", () => {
    const handles = [reorderHandle("a", 50, 50)]
    expect(hitTestReorderHandle(handles, 70, 70, 1)).toBeNull()
  })

  it("scales the radius by zoom (smaller world radius when zoomed in)", () => {
    const handles = [reorderHandle("a", 50, 50)]
    // At zoom 4 the world radius is 2px; a point 5px away misses.
    expect(hitTestReorderHandle(handles, 55, 50, 4)).toBeNull()
    // At zoom 1 the same point (5px away) hits.
    expect(hitTestReorderHandle(handles, 55, 50, 1)?.iframeLayerId).toBe("a")
  })

  it("returns the first matching handle", () => {
    const handles = [reorderHandle("a", 50, 50), reorderHandle("b", 51, 50)]
    expect(hitTestReorderHandle(handles, 50, 50, 1)?.iframeLayerId).toBe("a")
  })
})

describe("hitTestGapHandle", () => {
  it("hits within the gap rect", () => {
    const handles = [gapHandle()]
    expect(hitTestGapHandle(handles, 100, 100, 1)?.groupId).toBe("g1")
  })

  it("misses above/below the vertical bounds", () => {
    const handles = [gapHandle({ top: 0, bottom: 50 })]
    expect(hitTestGapHandle(handles, 100, 80, 1)).toBeNull()
  })

  it("applies the 6px screen pad horizontally", () => {
    const handles = [gapHandle({ left: 90, right: 110 })]
    // 95px past the right edge of 110 is within the 6px pad at zoom 1.
    expect(hitTestGapHandle(handles, 115, 100, 1)?.groupId).toBe("g1")
    // 117 is outside left-pad..right+pad (110 + 6 = 116).
    expect(hitTestGapHandle(handles, 117, 100, 1)).toBeNull()
  })
})

describe("assembleReorderStart", () => {
  it("assembles the grab offset and order snapshot for a member", () => {
    const start = assembleReorderStart({
      iframeLayerId: "b",
      canvas: { x: 150, y: 60 },
      groups: [group()],
      memberLayouts: new Map([
        ["a", { x: 0, y: 50 }],
        ["b", { x: 124, y: 50 }],
      ]),
      shiftKey: true,
      metaKey: false,
      selectOnNoMove: true,
    })
    expect(start).not.toBeNull()
    expect(start!.kind).toBe("reorder")
    expect(start!.ctx.memberId).toBe("b")
    expect(start!.ctx.memberKind).toBe("iframe-layer")
    expect(start!.ctx.groupId).toBe("g1")
    expect(start!.ctx.groupX).toBe(0)
    expect(start!.ctx.gap).toBe(24)
    // grab offset = cursor - member top-left = (150-124, 60-50)
    expect(start!.ctx.grabOffset).toEqual({ x: 26, y: 10 })
    expect(start!.ctx.startShiftKey).toBe(true)
    expect(start!.ctx.selectOnNoMove).toBe(true)
    expect(start!.order.map((m) => m.id)).toEqual(["a", "b"])
  })

  it("falls back to a zero grab offset when the layout is missing", () => {
    const start = assembleReorderStart({
      iframeLayerId: "a",
      canvas: { x: 5, y: 5 },
      groups: [group()],
      memberLayouts: new Map(),
      shiftKey: false,
      metaKey: false,
      selectOnNoMove: false,
    })
    expect(start!.ctx.grabOffset).toEqual({ x: 0, y: 0 })
  })

  it("returns null when the member is in no group", () => {
    expect(
      assembleReorderStart({
        iframeLayerId: "missing",
        canvas: { x: 0, y: 0 },
        groups: [group()],
        memberLayouts: new Map(),
        shiftKey: false,
        metaKey: false,
        selectOnNoMove: false,
      })
    ).toBeNull()
  })

  it("snapshots the order as a fresh copy (not the live members array)", () => {
    const g = group()
    const start = assembleReorderStart({
      iframeLayerId: "a",
      canvas: { x: 0, y: 0 },
      groups: [g],
      memberLayouts: new Map(),
      shiftKey: false,
      metaKey: false,
      selectOnNoMove: false,
    })
    expect(start!.order).not.toBe(g.members)
    expect(start!.order[0]).not.toBe(g.members[0])
    expect(start!.order).toEqual(g.members)
  })
})

describe("hitTestMarquee", () => {
  const layouts: MarqueeLayout[] = [
    { id: "frame", x: 0, y: 0, width: 100, height: 100 },
    { id: "doc", x: 200, y: 0, width: 100, height: 100 },
    { id: "far", x: 1000, y: 1000, width: 50, height: 50 },
  ]
  const markdownIds = new Set(["doc"])

  it("collects every covered layout as an iframe-layer hit", () => {
    const hits = hitTestMarquee(
      { left: -10, top: -10, right: 350, bottom: 350 },
      layouts,
      markdownIds
    )
    expect([...hits.iframeLayerIds].sort()).toEqual(["doc", "frame"])
  })

  it("also counts a covered markdown layer as a document hit", () => {
    const hits = hitTestMarquee(
      { left: 180, top: -10, right: 350, bottom: 350 },
      layouts,
      markdownIds
    )
    expect([...hits.iframeLayerIds]).toEqual(["doc"])
    expect([...hits.documentLayerIds]).toEqual(["doc"])
  })

  it("excludes layouts the rect does not intersect", () => {
    const hits = hitTestMarquee(
      { left: 0, top: 0, right: 50, bottom: 50 },
      layouts,
      markdownIds
    )
    expect([...hits.iframeLayerIds]).toEqual(["frame"])
    expect(hits.documentLayerIds.size).toBe(0)
  })
})

describe("routePointerToGesture", () => {
  it("suppresses every gesture when a mode is active", () => {
    expect(
      routePointerToGesture(
        baseInput({
          suppressed: true,
          reorderHandles: [reorderHandle("a", 0, 0)],
          gapHandles: [gapHandle()],
          groups: [group()],
        })
      )
    ).toBeNull()
  })

  it("starts a reorder when the dot is hit (capture phase)", () => {
    const start = routePointerToGesture(
      baseInput({
        canvas: { x: 50, y: 50 },
        phase: { reorderGap: true, marquee: false },
        reorderHandles: [reorderHandle("b", 50, 50)],
        groups: [group()],
        memberLayouts: new Map([["b", { x: 40, y: 45 }]]),
      })
    )
    expect(start?.kind).toBe("reorder")
    expect(start && start.kind === "reorder" && start.ctx.memberId).toBe("b")
  })

  it("starts a gap gesture when the gap handle is hit", () => {
    const start = routePointerToGesture(
      baseInput({
        canvas: { x: 100, y: 100 },
        phase: { reorderGap: true, marquee: false },
        gapHandles: [gapHandle({ groupId: "g1", gapIndex: 1 })],
        groups: [group({ gap: 24 })],
      })
    )
    expect(start?.kind).toBe("gap")
    expect(start && start.kind === "gap" && start.ctx.startGap).toBe(24)
    expect(start && start.kind === "gap" && start.ctx.startCanvasX).toBe(100)
  })

  it("prefers the reorder dot over a gap handle at the same point", () => {
    const start = routePointerToGesture(
      baseInput({
        canvas: { x: 100, y: 100 },
        phase: { reorderGap: true, marquee: false },
        reorderHandles: [reorderHandle("b", 100, 100)],
        gapHandles: [gapHandle({ left: 90, right: 110, top: 0, bottom: 200 })],
        groups: [group()],
        memberLayouts: new Map([["b", { x: 90, y: 90 }]]),
      })
    )
    expect(start?.kind).toBe("reorder")
  })

  it("does not start a gap when the hit group is unknown", () => {
    expect(
      routePointerToGesture(
        baseInput({
          canvas: { x: 100, y: 100 },
          phase: { reorderGap: true, marquee: false },
          gapHandles: [gapHandle({ groupId: "ghost" })],
          groups: [group({ id: "g1" })],
        })
      )
    ).toBeNull()
  })

  it("does not route reorder/gap in the bubble (marquee-only) phase", () => {
    const start = routePointerToGesture(
      baseInput({
        canvas: { x: 50, y: 50 },
        phase: { reorderGap: false, marquee: true },
        reorderHandles: [reorderHandle("b", 50, 50)],
        groups: [group()],
        memberLayouts: new Map([["b", { x: 40, y: 45 }]]),
      })
    )
    // Reaching the marquee phase means the press fell through to empty canvas.
    expect(start?.kind).toBe("marquee")
  })

  it("starts a marquee on empty canvas (bubble phase)", () => {
    const start = routePointerToGesture(
      baseInput({
        canvas: { x: 12, y: 34 },
        shiftKey: true,
        phase: { reorderGap: false, marquee: true },
        baseIframeLayerIds: new Set(["x"]),
        baseDocumentLayerIds: new Set(["d"]),
      })
    )
    expect(start?.kind).toBe("marquee")
    if (start && start.kind === "marquee") {
      expect(start.ctx.startX).toBe(12)
      expect(start.ctx.startY).toBe(34)
      expect(start.ctx.shiftKey).toBe(true)
      expect([...start.ctx.baseIframeLayerIds]).toEqual(["x"])
      expect([...start.ctx.baseDocumentLayerIds]).toEqual(["d"])
    }
  })

  it("freezes the base selection into a fresh set", () => {
    const live = new Set(["x"])
    const start = routePointerToGesture(
      baseInput({
        phase: { reorderGap: false, marquee: true },
        baseIframeLayerIds: live,
      })
    )
    if (start && start.kind === "marquee") {
      expect(start.ctx.baseIframeLayerIds).not.toBe(live)
      live.add("y")
      expect([...start.ctx.baseIframeLayerIds]).toEqual(["x"])
    }
  })

  it("returns null in the capture phase when nothing is hit", () => {
    expect(
      routePointerToGesture(
        baseInput({
          canvas: { x: 500, y: 500 },
          phase: { reorderGap: true, marquee: false },
          reorderHandles: [reorderHandle("a", 0, 0)],
          gapHandles: [gapHandle()],
          groups: [group()],
        })
      )
    ).toBeNull()
  })
})
