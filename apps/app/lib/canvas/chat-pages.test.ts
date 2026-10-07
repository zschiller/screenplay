import { describe, expect, it } from "vitest"
import type { ChatSessionData, PageData } from "@/lib/types"
import { chatPlaces, pageIdsById, placeOfLayers } from "./chat-pages"

const PAGES: PageData[] = [
  { id: "p-site", name: "Site", order: 0 },
  { id: "p-explore", name: "Explorations", order: 1 },
  { id: "p-archive", name: "Archive", order: 2 },
]

const frame = (id: string) => ({ kind: "iframe-layer" as const, id })
const doc = (id: string) => ({ kind: "markdown-layer" as const, id })

const GROUPS = [
  // No pageId: the first page.
  { id: "g-home", members: [frame("f-home"), doc("d-notes")] },
  { id: "g-hero", members: [frame("f-hero")], pageId: "p-explore" },
  { id: "g-old", members: [frame("f-old")], pageId: "p-archive" },
  // A page that's gone: the first page too.
  { id: "g-lost", members: [doc("d-lost")], pageId: "p-gone" },
]

const chat = (over: Partial<ChatSessionData>): ChatSessionData => ({
  id: "c",
  label: "",
  createdAt: 1,
  ...over,
})

describe("pageIdsById", () => {
  it("puts each Group and its Members on the Group's page", () => {
    const pageOf = pageIdsById(GROUPS, PAGES)
    expect(pageOf.get("g-hero")).toBe("p-explore")
    expect(pageOf.get("f-hero")).toBe("p-explore")
    expect(pageOf.get("d-notes")).toBe("p-site")
    expect(pageOf.get("d-lost")).toBe("p-site")
    expect(pageOf.get("nowhere")).toBeUndefined()
  })
})

describe("placeOfLayers", () => {
  it("lists the pages in page order, whatever order the Layers come in", () => {
    const place = placeOfLayers(
      ["f-old", "f-hero", "f-home", "gone"],
      pageIdsById(GROUPS, PAGES),
      PAGES
    )
    expect(place.pages.map((p) => p.name)).toEqual([
      "Site",
      "Explorations",
      "Archive",
    ])
    expect(place.layerIdsByPage.get("p-site")).toEqual(["f-home"])
  })
})

describe("chatPlaces", () => {
  const frames = [
    { id: "f-home", branchId: "b-site" },
    { id: "f-hero", branchId: "b-hero" },
    { id: "f-old", branchId: "b-site" },
  ]
  const chats = [
    chat({ id: "c-site", branchId: "b-site" }),
    chat({ id: "c-sketch", target: "sketch" }),
  ]

  it("places a Workspace's chat by its frames and a sketch chat by its Documents", () => {
    const places = chatPlaces({
      groups: GROUPS,
      pages: PAGES,
      frames,
      documents: [
        { id: "d-notes", lastChangedByChatId: "c-sketch" },
        { id: "d-lost" },
      ],
      chats,
    })
    expect(places.get("b-site")?.pages.map((p) => p.name)).toEqual([
      "Site",
      "Archive",
    ])
    expect(places.get("b-site")?.layerIdsByPage.get("p-archive")).toEqual([
      "f-old",
    ])
    expect(places.get("b-hero")?.pages.map((p) => p.name)).toEqual([
      "Explorations",
    ])
    expect(places.get("c-sketch")?.pages.map((p) => p.name)).toEqual(["Site"])
  })

  it("counts a Document a Workspace's chat changed as that Workspace's", () => {
    const places = chatPlaces({
      groups: [{ id: "g", members: [doc("d")], pageId: "p-archive" }],
      pages: PAGES,
      frames: [],
      documents: [{ id: "d", lastChangedByChatId: "c-site" }],
      chats,
    })
    expect(places.get("b-site")?.pages.map((p) => p.name)).toEqual(["Archive"])
  })

  it("leaves out a chat with no Layers on any page", () => {
    const places = chatPlaces({
      groups: [],
      pages: PAGES,
      frames,
      documents: [],
      chats,
    })
    expect(places.size).toBe(0)
  })
})
