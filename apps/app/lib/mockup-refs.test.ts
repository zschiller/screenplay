import { describe, expect, it } from "vitest"

import { mockupRefs, parseMockupRef, swapMockupRefs } from "./mockup-refs"

describe("mockupRefs", () => {
  it("finds skill: and files: references in src and href, once each", () => {
    expect(
      mockupRefs(
        `<link rel="stylesheet" href="skill:explore/runtime.css">
         <script src='skill:explore/runtime.js'></script>
         <img src=files:shots/home.png alt="">
         <a href="files:shots/home.png">open</a>
         <svg><image xlink:href="files:logo.svg"/></svg>`
      )
    ).toEqual([
      "skill:explore/runtime.css",
      "skill:explore/runtime.js",
      "files:shots/home.png",
      "files:logo.svg",
    ])
  })

  it("leaves other attributes, URLs and text alone", () => {
    expect(
      mockupRefs(
        `<img data-src="files:a.png" src="data:image/png;base64,AA">
         <a href="https://example.com/files:b">x</a>
         <p>Saved to files:c.png</p>`
      )
    ).toEqual([])
  })
})

describe("swapMockupRefs", () => {
  it("swaps each reference's value, keeping its quotes", () => {
    expect(
      swapMockupRefs(
        `<img src="files:a.png"><img src='files:b.png'><img src=files:c.png>`,
        (ref) => ref.toUpperCase()
      )
    ).toBe(
      `<img src="FILES:A.PNG"><img src='FILES:B.PNG'><img src="FILES:C.PNG">`
    )
  })
})

describe("parseMockupRef", () => {
  it("reads a skill's file and a canvas file", () => {
    expect(parseMockupRef("skill:screenplay-explore/assets/run.js")).toEqual({
      kind: "skill",
      skill: "screenplay-explore",
      path: "assets/run.js",
    })
    expect(parseMockupRef("files:/shots/a%20b.png")).toEqual({
      kind: "files",
      path: "shots/a b.png",
    })
  })

  it("refuses a malformed one", () => {
    expect(parseMockupRef("skill:no-path")).toBeNull()
    expect(parseMockupRef("skill:Bad_Name/a.js")).toBeNull()
    expect(parseMockupRef("skill:explore/../secret")).toBeNull()
    expect(parseMockupRef("files:../up.png")).toBeNull()
    expect(parseMockupRef("files:")).toBeNull()
    expect(parseMockupRef("files:%E0")).toBeNull()
  })
})
