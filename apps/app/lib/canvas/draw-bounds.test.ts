import { describe, expect, it } from "vitest"

import { measureDraw } from "./draw-bounds"

const box = (x: number, y: number) => (ctx: CanvasRenderingContext2D) => {
  ctx.strokeStyle = "#f0f"
  ctx.lineWidth = 2
  ctx.strokeRect(x, y, 40, 20)
  ctx.beginPath()
  ctx.arc(x + 40, y + 20, 4, 0, Math.PI * 2)
  ctx.fill()
}

describe("measureDraw", () => {
  it("bounds the drawing, grown by the pad and line width", () => {
    expect(measureDraw(box(10, 10))).toMatchObject({
      x: 7,
      y: 7,
      width: 50,
      height: 30,
    })
    expect(measureDraw(() => {})).toBeNull()
  })
})
