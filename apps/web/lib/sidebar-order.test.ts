import { describe, expect, it } from "vitest"
import { reorderedIds, sortForSidebar } from "@/lib/sidebar-order"

type Item = { id: string; sidebarOrder?: number }

describe("sortForSidebar", () => {
  it("orders items by their sidebarOrder, lowest first", () => {
    const items: Item[] = [
      { id: "b", sidebarOrder: 2 },
      { id: "a", sidebarOrder: 0 },
      { id: "c", sidebarOrder: 1 },
    ]

    const ordered = sortForSidebar(items, () => 0).map((i) => i.id)

    expect(ordered).toEqual(["a", "c", "b"])
  })

  it("falls back to the comparator for items with no sidebarOrder", () => {
    // A list never dragged: no item carries a sidebarOrder, so the comparator
    // (here: alphabetical by id) fully decides the order.
    const items: Item[] = [{ id: "charlie" }, { id: "alpha" }, { id: "bravo" }]

    const ordered = sortForSidebar(items, (a, b) =>
      a.id.localeCompare(b.id),
    ).map((i) => i.id)

    expect(ordered).toEqual(["alpha", "bravo", "charlie"])
  })

  it("sorts items with a sidebarOrder ahead of those without", () => {
    // Mixed list (e.g. one item just dragged, the rest untouched): the
    // manually-ordered items come first in their stored order; the rest keep
    // their automatic order behind them.
    const items: Item[] = [
      { id: "untouched-b" },
      { id: "manual", sidebarOrder: 5 },
      { id: "untouched-a" },
    ]

    const ordered = sortForSidebar(items, (a, b) =>
      a.id.localeCompare(b.id),
    ).map((i) => i.id)

    expect(ordered).toEqual(["manual", "untouched-a", "untouched-b"])
  })
})

describe("reorderedIds", () => {
  it("moves a dragged id down to the position of the id it was dropped on", () => {
    const result = reorderedIds(["a", "b", "c", "d"], "a", "c")

    expect(result).toEqual(["b", "c", "a", "d"])
  })

  it("moves a dragged id up to the position of the id it was dropped on", () => {
    const result = reorderedIds(["a", "b", "c", "d"], "d", "b")

    expect(result).toEqual(["a", "d", "b", "c"])
  })

  it("returns the order unchanged when active and over are the same", () => {
    const result = reorderedIds(["a", "b", "c"], "b", "b")

    expect(result).toEqual(["a", "b", "c"])
  })

  it("returns the order unchanged when an id is not in the list", () => {
    const result = reorderedIds(["a", "b", "c"], "missing", "b")

    expect(result).toEqual(["a", "b", "c"])
  })
})
