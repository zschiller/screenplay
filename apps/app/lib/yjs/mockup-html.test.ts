import { describe, expect, it } from "vitest"

import { MOCKUP_CSP, mockupSrcDoc } from "./mockup-html"

const META = `<meta http-equiv="Content-Security-Policy" content="${MOCKUP_CSP}">`

describe("mockupSrcDoc", () => {
  it("puts the policy first in the page's head", () => {
    expect(
      mockupSrcDoc(
        '<!doctype html><html lang="en"><head><title>A</title></head><body>A</body></html>'
      )
    ).toBe(
      `<!doctype html><html lang="en"><head>${META}<title>A</title></head><body>A</body></html>`
    )
  })

  it("gives a page with no head one", () => {
    expect(mockupSrcDoc("<html><body>A</body></html>")).toBe(
      `<html><head>${META}</head><body>A</body></html>`
    )
  })

  it("keeps a bare fragment's doctype first", () => {
    expect(mockupSrcDoc("<!DOCTYPE html>\n<div>A</div>")).toBe(
      `<!DOCTYPE html>${META}\n<div>A</div>`
    )
    expect(mockupSrcDoc("<div>A</div>")).toBe(`${META}<div>A</div>`)
  })

  it("blocks every network load", () => {
    expect(MOCKUP_CSP).toContain("default-src 'none'")
    expect(MOCKUP_CSP).not.toMatch(/https?:|\*/)
  })
})
