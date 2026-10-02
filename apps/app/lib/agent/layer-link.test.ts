import { describe, expect, it } from "vitest"
import { layerLink, parseLayerLink } from "@/lib/agent/layer-link"

describe("layerLink", () => {
  it("links a layer by kind and id, dropping brackets from the title", () => {
    expect(layerLink("frame", "Checkout [mobile]", "f-1")).toBe(
      "[Checkout mobile](frame:f-1)"
    )
  })

  it("parses back what it writes, and nothing else", () => {
    expect(parseLayerLink("mockup:m-1")).toEqual({ kind: "mockup", id: "m-1" })
    expect(parseLayerLink("document:d-1")).toEqual({
      kind: "document",
      id: "d-1",
    })
    expect(parseLayerLink("workspace:ws-1")).toBeNull()
    expect(parseLayerLink("https://e.com")).toBeNull()
    expect(parseLayerLink("frame:")).toBeNull()
  })
})
