import { describe, expect, it } from "vitest"

import { FIRST_PAGE, pageOfIds } from "@/lib/canvas/pages"
import type { IframeLayerGroupData, PageData } from "@/lib/types"

const pages: PageData[] = [FIRST_PAGE, { id: "p2", name: "Archive", order: 1 }]

const group = (
  id: string,
  pageId: string | undefined,
  memberIds: string[]
): IframeLayerGroupData =>
  ({
    id,
    x: 0,
    y: 0,
    pageId,
    members: memberIds.map((m) => ({ kind: "iframe-layer", id: m })),
  }) as IframeLayerGroupData

describe("pageOfIds: the page show_on_canvas switches to (#1843)", () => {
  const groups = [group("g1", undefined, ["f1"]), group("g2", "p2", ["f2"])]

  it("is a page one of the ids names", () => {
    expect(pageOfIds(["f1", "p2"], groups, pages)).toBe("p2")
  })

  it("is the page of the first Group named, or holding a Layer named", () => {
    expect(pageOfIds(["g2"], groups, pages)).toBe("p2")
    expect(pageOfIds(["f2", "f1"], groups, pages)).toBe("p2")
    // A Group with no page of its own is on the first page.
    expect(pageOfIds(["f1"], groups, pages)).toBe("page-1")
  })

  it("is undefined for ids on no page", () => {
    expect(pageOfIds([], groups, pages)).toBeUndefined()
    expect(pageOfIds(["nope"], groups, pages)).toBeUndefined()
  })
})
