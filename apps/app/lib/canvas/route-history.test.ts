import { describe, expect, it } from "vitest"

import {
  canGoBack,
  canGoForward,
  createRouteHistory,
  currentRoute,
  goBack,
  goForward,
  visitRoute,
} from "./route-history"

describe("route history", () => {
  it("starts on the frame's route with nowhere to go", () => {
    const h = createRouteHistory("/checkout")
    expect(currentRoute(h)).toBe("/checkout")
    expect(canGoBack(h)).toBe(false)
    expect(canGoForward(h)).toBe(false)
  })

  it("steps back and forward through visited routes", () => {
    let h = createRouteHistory("/")
    h = visitRoute(h, "/cart")
    h = visitRoute(h, "/checkout")
    h = goBack(h)
    expect(currentRoute(h)).toBe("/cart")
    h = goBack(h)
    expect(currentRoute(h)).toBe("/")
    expect(canGoBack(h)).toBe(false)
    h = goForward(h)
    expect(currentRoute(h)).toBe("/cart")
    expect(canGoForward(h)).toBe(true)
  })

  it("drops forward entries on a new visit, like a browser", () => {
    let h = createRouteHistory("/")
    h = visitRoute(h, "/cart")
    h = goBack(h)
    h = visitRoute(h, "/account")
    expect(h.entries).toEqual(["/", "/account"])
    expect(canGoForward(h)).toBe(false)
  })

  it("ignores a visit to the route it's already on", () => {
    const h = visitRoute(createRouteHistory("/"), "/cart")
    expect(visitRoute(h, "/cart")).toBe(h)
  })

  it("edits the current entry on a replace", () => {
    let h = visitRoute(createRouteHistory("/"), "/cart")
    h = visitRoute(h, "/cart?step=2", true)
    expect(h.entries).toEqual(["/", "/cart?step=2"])
    expect(currentRoute(goBack(h))).toBe("/")
  })

  it("leaves the history alone at either end", () => {
    const h = createRouteHistory("/")
    expect(goBack(h)).toBe(h)
    expect(goForward(h)).toBe(h)
  })
})
