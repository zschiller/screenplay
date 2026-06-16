import { describe, expect, it } from "vitest"
import {
  DEFAULT_SCOPE_SORT,
  homeScopeKey,
  parseHomeViewPrefs,
  withScopeSort,
  withView,
  type HomeViewPrefs,
} from "./home-view-prefs"

// Recents and the All-files root both carry a null folder but are distinct
// surfaces, so they must key apart; any other folder keys by its id.
describe("homeScopeKey", () => {
  it("Recents (flat, no folder view) keys as 'recent'", () => {
    expect(homeScopeKey(false, null)).toBe("recent")
  })

  it("the All files root keys as 'all'", () => {
    expect(homeScopeKey(true, null)).toBe("all")
  })

  it("a folder keys by its id", () => {
    expect(homeScopeKey(true, "abc123")).toBe("abc123")
  })
})

describe("parseHomeViewPrefs", () => {
  const cookie = (prefs: unknown) => encodeURIComponent(JSON.stringify(prefs))

  it("returns the grid default with no scopes for a missing cookie", () => {
    expect(parseHomeViewPrefs(undefined)).toEqual({ view: "grid", scopes: {} })
  })

  it("round-trips a valid prefs object", () => {
    const prefs: HomeViewPrefs = {
      view: "table",
      scopes: {
        recent: { sort: "updated", order: "desc" },
        abc123: { sort: "name", order: "asc" },
      },
    }
    expect(parseHomeViewPrefs(cookie(prefs))).toEqual(prefs)
  })

  it("falls back to the grid view when the stored view is missing or invalid", () => {
    expect(parseHomeViewPrefs(cookie({ scopes: {} })).view).toBe("grid")
    expect(
      parseHomeViewPrefs(cookie({ view: "carousel", scopes: {} })).view
    ).toBe("grid")
  })

  it("drops scopes whose stored sort doesn't validate, keeping the good ones", () => {
    const raw = cookie({
      view: "grid",
      scopes: {
        all: { sort: "created", order: "asc" },
        bad: { sort: "size", order: "asc" },
        partial: { sort: "name" },
      },
    })
    expect(parseHomeViewPrefs(raw)).toEqual({
      view: "grid",
      scopes: { all: { sort: "created", order: "asc" } },
    })
  })

  it("returns the defaults for malformed / non-object JSON", () => {
    const defaults = { view: "grid", scopes: {} }
    expect(parseHomeViewPrefs("not json")).toEqual(defaults)
    expect(parseHomeViewPrefs(cookie([1, 2, 3]))).toEqual(defaults)
    expect(parseHomeViewPrefs(cookie("string"))).toEqual(defaults)
  })
})

describe("withView", () => {
  it("sets the global view without touching the per-scope sorts", () => {
    const prefs: HomeViewPrefs = {
      view: "grid",
      scopes: { recent: { sort: "name", order: "asc" } },
    }
    expect(withView(prefs, "table")).toEqual({
      view: "table",
      scopes: { recent: { sort: "name", order: "asc" } },
    })
  })

  it("does not mutate the input prefs", () => {
    const prefs: HomeViewPrefs = { view: "grid", scopes: {} }
    withView(prefs, "table")
    expect(prefs.view).toBe("grid")
  })
})

describe("withScopeSort", () => {
  it("seeds an unseen scope from the defaults, then applies the patch", () => {
    expect(
      withScopeSort({ view: "grid", scopes: {} }, "recent", { sort: "name" })
    ).toEqual({
      view: "grid",
      scopes: { recent: { ...DEFAULT_SCOPE_SORT, sort: "name" } },
    })
  })

  it("merges into an existing scope without touching the others", () => {
    const prefs: HomeViewPrefs = {
      view: "table",
      scopes: {
        recent: { sort: "updated", order: "desc" },
        all: { sort: "name", order: "asc" },
      },
    }
    expect(
      withScopeSort(prefs, "all", { sort: "created", order: "desc" })
    ).toEqual({
      view: "table",
      scopes: {
        recent: { sort: "updated", order: "desc" },
        all: { sort: "created", order: "desc" },
      },
    })
  })

  it("does not mutate the input prefs", () => {
    const prefs: HomeViewPrefs = {
      view: "grid",
      scopes: { recent: { sort: "updated", order: "desc" } },
    }
    withScopeSort(prefs, "recent", { sort: "name" })
    expect(prefs.scopes.recent.sort).toBe("updated")
  })
})
