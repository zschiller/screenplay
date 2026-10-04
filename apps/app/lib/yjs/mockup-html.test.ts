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

  it("runs the runtime right after the policy, before the page's scripts", () => {
    expect(
      mockupSrcDoc(
        "<html><head><script>page()</script></head></html>",
        "bridge('</script>')"
      )
    ).toBe(
      `<html><head>${META}<script>bridge('<\\/script>')</script><script>page()</script></head></html>`
    )
  })

  it("blocks every network load", () => {
    expect(MOCKUP_CSP).toContain("default-src 'none'")
    expect(MOCKUP_CSP).not.toMatch(/https?:|\*/)
  })
})

describe("mockupSrcDoc with references (#1643)", () => {
  const PAGE =
    '<!doctype html><html lang="en"><head><script src="skill:explore/runtime.js"></script></head>' +
    "<body><img src='files:shots/a b.png'><img src=files:gone.png data-src=\"files:x.png\"></body></html>"
  const resources = {
    "skill:explore/runtime.js": {
      type: "text/javascript",
      data: "d2luZG93LlI9MQ==",
    },
    "files:shots/a b.png": { type: "image/png", data: "iVBORw==" },
    "files:gone.png": null,
  }

  it("writes the page in from a loader after the policy and the runtime", () => {
    const doc = mockupSrcDoc(PAGE, "bridge()", resources)
    expect(
      doc.startsWith(
        `<!doctype html><html><head>${META}<script>bridge()</script><script>`
      )
    ).toBe(true)
    expect(doc).toContain("document.write(")
    expect(doc).toContain("URL.createObjectURL")
  })

  it("carries each resource's bytes and swaps its reference for a token", () => {
    const doc = mockupSrcDoc(PAGE, "", resources)
    expect(doc).toContain('["text/javascript","d2luZG93LlI9MQ=="]')
    expect(doc).toContain('["image/png","iVBORw=="]')
    // The missing one is an empty resource.
    expect(doc).toContain('["",""]')
    expect(doc).toContain('src=\\"about:screenplay-ref/0\\"')
    expect(doc).toContain("src='about:screenplay-ref/1'")
    expect(doc).toContain('src=\\"about:screenplay-ref/2\\"')
    expect(doc).not.toMatch(/(?<![\w-])src=["']?(skill|files):/)
    // Only src and href count: a data attribute keeps its text.
    expect(doc).toContain('data-src=\\"files:x.png\\"')
  })

  it("keeps the page from closing the loader's script", () => {
    const doc = mockupSrcDoc(
      '<img src="files:a.png"><script>"</script><!--"</script>',
      "",
      {}
    )
    expect(doc.match(/<\/script>/g)).toHaveLength(1)
    expect(doc).not.toContain("<!--")
  })

  it("gives a reference nobody resolved an empty resource", () => {
    expect(mockupSrcDoc('<img src="files:a.png">')).toContain('["",""]')
  })

  it("leaves a page without references as it was", () => {
    expect(mockupSrcDoc("<div>A</div>", "", resources)).toBe(
      `${META}<div>A</div>`
    )
  })

  it("adds only blob: for scripts and styles", () => {
    expect(MOCKUP_CSP).toContain("script-src 'unsafe-inline' blob:;")
    expect(MOCKUP_CSP).toContain("style-src 'unsafe-inline' blob:;")
  })
})
