// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import {
  LAYER_LABEL_ATTRIBUTE,
  pressedLayerId,
  snapToDevicePixel,
} from "./label-layer"

describe("pressedLayerId", () => {
  it("reads a press on a Layer's body", () => {
    document.body.innerHTML = `<div data-layer-id="a"><span id="t"></span></div>`
    expect(pressedLayerId(document.getElementById("t")!)).toBe("a")
  })

  it("reads a press on a Layer's label, which sits outside the Layer", () => {
    document.body.innerHTML = `<div ${LAYER_LABEL_ATTRIBUTE}="b"><button id="t"></button></div>`
    expect(pressedLayerId(document.getElementById("t")!)).toBe("b")
  })

  it("is null on empty canvas", () => {
    document.body.innerHTML = `<div id="t"></div>`
    expect(pressedLayerId(document.getElementById("t")!)).toBeNull()
  })
})

describe("snapToDevicePixel", () => {
  it("rounds to whole pixels at 1x", () => {
    expect(snapToDevicePixel(10.4, 1)).toBe(10)
    expect(snapToDevicePixel(10.6, 1)).toBe(11)
  })

  it("rounds to half pixels at 2x", () => {
    expect(snapToDevicePixel(10.3, 2)).toBe(10.5)
    expect(snapToDevicePixel(10.2, 2)).toBe(10)
  })
})
