import { describe, expect, it } from "vitest"
import { openPageId, pageViewport } from "@/lib/canvas/page-views"
import type { PageData, PageViewData } from "@/lib/types"

const pages: PageData[] = [
  { id: "page-1", name: "Page 1", order: 0 },
  { id: "p2", name: "Page 2", order: 1 },
  { id: "p3", name: "Page 3", order: 2 },
]

function view(
  userId: string,
  pageId: string,
  seenAt: number,
  x = 0
): PageViewData {
  return { userId, pageId, seenAt, x, y: 0, zoom: 1 }
}

describe("openPageId", () => {
  it("opens a first visit on the first page", () => {
    expect(openPageId([view("bob", "p3", 9)], pages, "ann")).toBe("page-1")
  })

  it("opens on the page the member was on last, whoever else moved since", () => {
    const views = [
      view("ann", "page-1", 1),
      view("ann", "p2", 5),
      view("bob", "p3", 9),
    ]
    expect(openPageId(views, pages, "ann")).toBe("p2")
    expect(openPageId(views, pages, "bob")).toBe("p3")
  })

  it("skips a last page that's been deleted", () => {
    const views = [view("ann", "p2", 1), view("ann", "gone", 9)]
    expect(openPageId(views, pages, "ann")).toBe("p2")
  })

  it("opens a linked page over the last one, when it exists", () => {
    const views = [view("ann", "p2", 5)]
    expect(openPageId(views, pages, "ann", "p3")).toBe("p3")
    expect(openPageId(views, pages, "ann", "gone")).toBe("p2")
  })
})

describe("pageViewport", () => {
  const legacy = { x: 40, y: 80, zoom: 0.4 }

  it("is the member's own view, not another member's", () => {
    const views = [view("ann", "p2", 1, 10), view("bob", "p2", 2, 20)]
    expect(pageViewport(views, pages, "ann", "p2", null)?.x).toBe(10)
    expect(pageViewport(views, pages, "bob", "p2", null)?.x).toBe(20)
  })

  it("fits a page the member has never been on", () => {
    expect(pageViewport([view("bob", "p2", 1)], pages, "ann", "p2", null)).toBe(
      null
    )
  })

  it("starts everyone on the first page at the old shared view, once", () => {
    expect(pageViewport([], pages, "ann", "page-1", legacy)).toEqual(legacy)
    expect(pageViewport([], pages, "ann", "p2", legacy)).toBe(null)
    const own = [view("ann", "page-1", 1, 7)]
    expect(pageViewport(own, pages, "ann", "page-1", legacy)?.x).toBe(7)
  })

  it("starts a canvas with no page records at the old view too", () => {
    const only: PageData[] = [{ id: "page-1", name: "Page 1", order: 0 }]
    expect(pageViewport([], only, "ann", "page-1", legacy)).toEqual(legacy)
  })
})
