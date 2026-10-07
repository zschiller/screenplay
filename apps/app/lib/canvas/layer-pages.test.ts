import { describe, expect, it } from "vitest"
import type { PageData } from "@/lib/types"
import { pageIdsById } from "./layer-pages"

const PAGES: PageData[] = [
  { id: "p-site", name: "Site", order: 0 },
  { id: "p-explore", name: "Explorations", order: 1 },
]

describe("pageIdsById", () => {
  it("puts each Group and its Members on the Group's page", () => {
    const pageOf = pageIdsById(
      [
        // No pageId: the first page.
        { id: "g-home", members: [{ kind: "iframe-layer", id: "f-home" }] },
        {
          id: "g-hero",
          members: [{ kind: "mockup-layer", id: "m-hero" }],
          pageId: "p-explore",
        },
        // A page that's gone: the first page too.
        {
          id: "g-lost",
          members: [{ kind: "markdown-layer", id: "d-lost" }],
          pageId: "p-gone",
        },
      ],
      PAGES
    )
    expect(pageOf.get("g-hero")).toBe("p-explore")
    expect(pageOf.get("m-hero")).toBe("p-explore")
    expect(pageOf.get("f-home")).toBe("p-site")
    expect(pageOf.get("d-lost")).toBe("p-site")
    expect(pageOf.get("nowhere")).toBeUndefined()
  })
})
