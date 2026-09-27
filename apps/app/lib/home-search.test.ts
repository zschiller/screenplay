import { describe, expect, it } from "vitest"
import { isSearching, matchesQuery, searchLibrary } from "./home-search"

const room = (id: string, name: string, isOwner = true) => ({
  id,
  name,
  isOwner,
  createdAt: 1,
  lastConnectionAt: null,
})

const folder = (id: string, name: string, parentFolderId: string | null) => ({
  id,
  name,
  parentFolderId,
  createdAt: 1,
  updatedAt: 1,
})

describe("matchesQuery", () => {
  it("matches every term anywhere in the name, ignoring case and accents", () => {
    expect(matchesQuery("Mobile checkout", "CHECK mob")).toBe(true)
    expect(matchesQuery("Café menu", "cafe")).toBe(true)
    expect(matchesQuery("Mobile checkout", "cart")).toBe(false)
  })

  it("matches everything on a blank query", () => {
    expect(matchesQuery("Anything", "   ")).toBe(true)
  })
})

describe("isSearching", () => {
  it("is on for a typed query or a narrowing filter, not for whitespace", () => {
    expect(isSearching("", "all")).toBe(false)
    expect(isSearching("  ", "all")).toBe(false)
    expect(isSearching("a", "all")).toBe(true)
    expect(isSearching("", "shared")).toBe(true)
  })
})

describe("searchLibrary", () => {
  const rooms = [
    room("r1", "Checkout"),
    room("r2", "Shared checkout", false),
    room("r3", "Onboarding"),
  ]
  const folders = [
    folder("f1", "Checkout flows", null),
    folder("f2", "Archive", "f1"),
  ]
  const run = (query: string, owner: "all" | "mine" | "shared") =>
    searchLibrary({ rooms, folders, query, owner, sort: "name", order: "asc" })

  it("finds Canvases and Folders by name, whatever folder they sit in", () => {
    const { rooms: r, folders: f } = run("checkout", "all")
    expect(r.map((x) => x.id)).toEqual(["r1", "r2"])
    expect(f.map((x) => x.id)).toEqual(["f1"])
  })

  it("keeps only Canvases shared with the user under Shared with me", () => {
    const { rooms: r, folders: f } = run("", "shared")
    expect(r.map((x) => x.id)).toEqual(["r2"])
    // Folders are always the user's own.
    expect(f).toEqual([])
  })

  it("keeps only the user's own Canvases under Owned by me", () => {
    expect(run("", "mine").rooms.map((x) => x.id)).toEqual(["r1", "r3"])
  })

  it("lists no Folders for a bare filter with no query", () => {
    expect(run("", "mine").folders).toEqual([])
  })
})
