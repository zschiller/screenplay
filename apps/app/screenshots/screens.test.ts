import { describe, expect, it } from "vitest"

import {
  panelLayoutCookieName,
  parsePanelLayoutValue,
} from "@/lib/panel-layout"

import { canvasPanels, SCREENS, selectScreens } from "./screens"
import { previewDomainFor } from "./lib/preview-url"

describe("selectScreens", () => {
  it("returns the whole list when nothing is named", () => {
    expect(selectScreens([])).toEqual(SCREENS)
  })

  it("keeps the declared order, not the order they were asked for", () => {
    // Both halves of a before/after pair must shoot the same screens in the same
    // order, whatever the two command lines happened to say.
    const names = [SCREENS[2]!.name, SCREENS[0]!.name]
    expect(selectScreens(names).map((s) => s.name)).toEqual([
      SCREENS[0]!.name,
      SCREENS[2]!.name,
    ])
  })

  it("names the unknown screen, and the known ones, on a typo", () => {
    expect(() => selectScreens(["canvas", "no-such-screen"])).toThrow(
      /no-such-screen/
    )
    expect(() => selectScreens(["no-such-screen"])).toThrow(/known screens/)
  })
})

describe("canvasPanels", () => {
  it("writes a layout the app can actually parse", () => {
    const [cookie] = canvasPanels({ chatPct: 30 })
    expect(cookie!.name).toBe(panelLayoutCookieName("canvas-layout"))
    const layout = parsePanelLayoutValue(cookie!.value)
    expect(layout).toBeDefined()
    // Percentages of the group, all three panels named — anything else and
    // `react-resizable-panels` drops the layout and the chat panel stays shut.
    expect(layout).toEqual({ sidebar: 16, canvas: 54, chat: 30 })
  })

  it("leaves the chat panel collapsed by default", () => {
    expect(parsePanelLayoutValue(canvasPanels({})[0]!.value)).toMatchObject({
      chat: 0,
    })
  })
})

describe("previewDomainFor", () => {
  it("builds a path prefix the frame's route appends to", () => {
    // The canvas sets a frame's src to `previewDomain + route`, so the result
    // must have no trailing slash or every frame requests a doubled one.
    const domain = previewDomainFor("http://127.0.0.1:3948", "checkout-polish")
    expect(domain).toBe("http://127.0.0.1:3948/w/checkout-polish")
    expect(`${domain}/checkout`).toBe(
      "http://127.0.0.1:3948/w/checkout-polish/checkout"
    )
  })
})
