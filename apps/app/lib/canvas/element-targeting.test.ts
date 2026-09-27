import { describe, expect, it, vi } from "vitest"

import {
  type ElementAtPointResult,
  ElementTargeting,
  type GetTargetingFrameDom,
  hitTestTargetFrame,
  partitionTargetFrames,
  projectHighlight,
  targetableBranchIds,
  type TargetingFrameDom,
} from "@/lib/canvas/element-targeting"
import type {
  IframeLayerLayout,
  IframeLayerLayoutMap,
} from "@/lib/canvas/layout"
import type { DomRect } from "@/lib/postmessage-protocol"
import type { PickedElement } from "@/lib/targeting-store"
import type { IframeLayerData } from "@/lib/types"

// Plain fixtures — no React, no DOM. The core is asserted against fake layouts
// and a fake element-at-point resolver: bare frames + layouts + a click point
// in, the settled pick out.

function frame(id: string, branchId?: string): IframeLayerData {
  return {
    id,
    branchId,
    width: 390,
    height: 844,
    label: `Frame ${id}`,
    route: `/${id}`,
    iframeState: {},
  }
}

function layout(id: string, x: number, y = 0): IframeLayerLayout {
  return {
    id,
    kind: "iframe-layer",
    groupId: "g",
    index: 0,
    isLast: true,
    x,
    y,
    width: 100,
    height: 100,
  }
}

function layoutsOf(...entries: IframeLayerLayout[]): IframeLayerLayoutMap {
  return new Map(entries.map((l) => [l.id, l]))
}

/** A promise the test settles by hand, to hold a round-trip mid-flight. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** A fake frame bridge whose `elementAtPoint` answers from a deferred. */
function fakeDom() {
  const element = deferred<ElementAtPointResult | null>()
  const rects = deferred<(DomRect | null)[]>()
  const dom: TargetingFrameDom = {
    elementAtPoint: vi.fn(() => element.promise),
    getRectsForSelectors: vi.fn(() => rects.promise),
  }
  return { dom, element, rects }
}

/** Arm a pick for `branchId` and capture what it settles with. */
function arm(core: ElementTargeting, branchId: string) {
  const resolve = vi.fn<(picked: PickedElement | null) => void>()
  core.request({ branchId, resolve })
  return resolve
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe("eligibility — one rule for pickable and dimmed", () => {
  it("partitions frames into the pick's Branch (eligible) and the rest (dimmed)", () => {
    const frames = [frame("a", "b1"), frame("b", "b2"), frame("c", "b1")]
    const { eligible, dimmedIds } = partitionTargetFrames("b1", frames)
    expect(eligible).toEqual([frames[0], frames[2]])
    expect([...dimmedIds]).toEqual(["b"])
  })

  it("dims nothing and makes nothing eligible when no pick is armed", () => {
    const { eligible, dimmedIds } = partitionTargetFrames(null, [
      frame("a", "b1"),
    ])
    expect(eligible).toEqual([])
    expect(dimmedIds.size).toBe(0)
  })

  it("never treats a frame with no branchId as eligible", () => {
    const frames = [frame("a"), frame("b", "b1")]
    const { eligible, dimmedIds } = partitionTargetFrames("b1", frames)
    expect(eligible).toEqual([frames[1]])
    expect([...dimmedIds]).toEqual(["a"])
  })

  it("publishes exactly the Branches that own a frame", () => {
    const ids = targetableBranchIds([
      frame("a", "b1"),
      frame("b", "b1"),
      frame("c", "b2"),
      frame("d"),
    ])
    expect([...ids].sort()).toEqual(["b1", "b2"])
  })
})

describe("hitTestTargetFrame", () => {
  const frames = [frame("a", "b1"), frame("b", "b2")]
  const layouts = layoutsOf(layout("a", 0), layout("b", 200))

  it("returns the eligible frame under the point, in frame-local coords", () => {
    expect(hitTestTargetFrame({ x: 30, y: 40 }, [frames[0]!], layouts)).toEqual(
      { layer: frames[0], localX: 30, localY: 40 }
    )
  })

  it("ignores a frame that isn't eligible even when the point is over it", () => {
    expect(hitTestTargetFrame({ x: 250, y: 40 }, [frames[0]!], layouts)).toBe(
      null
    )
  })

  it("misses outside every frame", () => {
    expect(hitTestTargetFrame({ x: 150, y: 40 }, frames, layouts)).toBe(null)
  })
})

describe("ElementTargeting — pick lifecycle", () => {
  const frames = [frame("a", "b1"), frame("b", "b2")]
  const layouts = layoutsOf(layout("a", 0), layout("b", 200))

  function clickAt(
    core: ElementTargeting,
    x: number,
    getDom: GetTargetingFrameDom
  ) {
    core.click({ point: { x, y: 10 }, iframeLayers: frames, layouts, getDom })
  }

  it("arms on request and resolves with the picked element", async () => {
    const core = new ElementTargeting()
    const resolve = arm(core, "b1")
    expect(core.getSnapshot()).toMatchObject({
      phase: "armed",
      armedBranchId: "b1",
    })

    const { dom, element } = fakeDom()
    clickAt(core, 20, () => dom)
    expect(dom.elementAtPoint).toHaveBeenCalledWith(20, 10)
    // Pick mode ends as soon as the click lands; the round-trip is async.
    expect(core.getSnapshot().phase).toBe("resolving")
    expect(core.isArmed()).toBe(false)

    element.resolve({ tagName: "button", id: "go", selector: "#go" })
    await flush()
    expect(resolve).toHaveBeenCalledExactlyOnceWith({
      tagName: "button",
      id: "go",
      selector: "#go",
      route: "/a",
      iframeLayerId: "a",
      frameLabel: "Frame a",
    })
    expect(core.getSnapshot().phase).toBe("idle")
  })

  it("supersede: a new request resolves the armed pick to null", () => {
    const core = new ElementTargeting()
    const first = arm(core, "b1")
    const second = arm(core, "b2")
    expect(first).toHaveBeenCalledExactlyOnceWith(null)
    expect(second).not.toHaveBeenCalled()
    expect(core.getSnapshot().armedBranchId).toBe("b2")
  })

  it("supersede mid-resolve: the prior pick resolves null and its late answer is dropped", async () => {
    const core = new ElementTargeting()
    const first = arm(core, "b1")
    const { dom, element } = fakeDom()
    clickAt(core, 20, () => dom)

    const second = arm(core, "b2")
    expect(first).toHaveBeenCalledExactlyOnceWith(null)

    element.resolve({ tagName: "button", selector: "#go" })
    await flush()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
    expect(core.getSnapshot()).toMatchObject({
      phase: "armed",
      armedBranchId: "b2",
    })
  })

  it("miss: a click outside every eligible frame cancels", () => {
    const core = new ElementTargeting()
    const resolve = arm(core, "b1")
    const getDom = vi.fn(() => fakeDom().dom)
    // Over frame "b" — it belongs to another Branch, so it's a miss too.
    clickAt(core, 250, getDom)
    expect(resolve).toHaveBeenCalledExactlyOnceWith(null)
    expect(getDom).not.toHaveBeenCalled()
    expect(core.getSnapshot().phase).toBe("idle")
  })

  it("closed frame: a hit on a frame with no DOM bridge cancels", () => {
    const core = new ElementTargeting()
    const resolve = arm(core, "b1")
    clickAt(core, 20, () => undefined)
    expect(resolve).toHaveBeenCalledExactlyOnceWith(null)
    expect(core.getSnapshot().phase).toBe("idle")
  })

  it("resolves null when the bridge finds no element or fails", async () => {
    const core = new ElementTargeting()
    const empty = arm(core, "b1")
    const a = fakeDom()
    clickAt(core, 20, () => a.dom)
    a.element.resolve(null)
    await flush()
    expect(empty).toHaveBeenCalledExactlyOnceWith(null)

    const failed = arm(core, "b1")
    const b = fakeDom()
    clickAt(core, 20, () => b.dom)
    b.element.reject(new Error("timeout"))
    await flush()
    expect(failed).toHaveBeenCalledExactlyOnceWith(null)
    expect(core.getSnapshot().phase).toBe("idle")
  })

  it("unmount mid-resolve: reset resolves null and drops the late answer", async () => {
    const core = new ElementTargeting()
    const resolve = arm(core, "b1")
    const { dom, element } = fakeDom()
    clickAt(core, 20, () => dom)

    core.reset()
    expect(resolve).toHaveBeenCalledExactlyOnceWith(null)

    element.resolve({ tagName: "button", selector: "#go" })
    await flush()
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(core.getSnapshot().phase).toBe("idle")
  })

  it("resolve after cancel: a late answer for a cancelled pick is dropped", async () => {
    const core = new ElementTargeting()
    const resolve = arm(core, "b1")
    const { dom, element } = fakeDom()
    clickAt(core, 20, () => dom)

    core.cancel()
    expect(resolve).toHaveBeenCalledExactlyOnceWith(null)

    element.resolve({ tagName: "button", selector: "#go" })
    await flush()
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it("ignores clicks and cancels when no pick is armed", () => {
    const core = new ElementTargeting()
    const listener = vi.fn()
    core.subscribe(listener)
    const getDom = vi.fn()
    clickAt(core, 20, getDom)
    core.cancel()
    expect(getDom).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
  })
})

describe("ElementTargeting — highlight sequencing", () => {
  const rect = (x: number): DomRect => ({ x, y: 5, width: 10, height: 10 })

  it("resolves a token's selector to a frame-local rect", async () => {
    const core = new ElementTargeting()
    const { dom, rects } = fakeDom()
    core.highlight(
      { iframeLayerId: "a", selector: "#go", ref: "t1" },
      () => dom
    )
    expect(dom.getRectsForSelectors).toHaveBeenCalledWith(["#go"])
    rects.resolve([rect(1)])
    await flush()
    expect(core.getSnapshot().highlight).toEqual({
      iframeLayerId: "a",
      rect: rect(1),
    })
  })

  it("a newer hover supersedes an in-flight resolve", async () => {
    const core = new ElementTargeting()
    const older = fakeDom()
    const newer = fakeDom()
    core.highlight(
      { iframeLayerId: "a", selector: "#1", ref: "t1" },
      () => older.dom
    )
    core.highlight(
      { iframeLayerId: "a", selector: "#2", ref: "t2" },
      () => newer.dom
    )
    newer.rects.resolve([rect(2)])
    older.rects.resolve([rect(1)])
    await flush()
    expect(core.getSnapshot().highlight?.rect).toEqual(rect(2))
  })

  it("clears for a closed frame, a stale selector, or a null target", async () => {
    const core = new ElementTargeting()
    const { dom, rects } = fakeDom()
    core.highlight({ iframeLayerId: "a", selector: "#go", ref: "t" }, () => dom)
    rects.resolve([rect(1)])
    await flush()

    core.highlight(
      { iframeLayerId: "a", selector: "#go", ref: "t" },
      () => undefined
    )
    expect(core.getSnapshot().highlight).toBe(null)

    const stale = fakeDom()
    core.highlight(
      { iframeLayerId: "a", selector: "#x", ref: "t" },
      () => stale.dom
    )
    stale.rects.resolve([null])
    await flush()
    expect(core.getSnapshot().highlight).toBe(null)

    core.highlight(null, () => dom)
    expect(core.getSnapshot().highlight).toBe(null)
  })

  it("reset drops an in-flight highlight", async () => {
    const core = new ElementTargeting()
    const { dom, rects } = fakeDom()
    core.highlight({ iframeLayerId: "a", selector: "#go", ref: "t" }, () => dom)
    core.reset()
    rects.resolve([rect(1)])
    await flush()
    expect(core.getSnapshot().highlight).toBe(null)
  })

  it("projects a frame-local highlight into world space", () => {
    const layouts = layoutsOf(layout("a", 200, 50))
    expect(
      projectHighlight({ iframeLayerId: "a", rect: rect(3) }, layouts)
    ).toEqual({ x: 203, y: 55, width: 10, height: 10 })
    expect(
      projectHighlight({ iframeLayerId: "z", rect: rect(3) }, layouts)
    ).toBe(null)
  })
})
