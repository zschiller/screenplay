import { describe, expect, it } from "vitest"

import {
  layerArgOfPartialInput,
  workingLayerOf,
} from "@/lib/chat/working-layer"

describe("layerArgOfPartialInput", () => {
  it("names the layer once its id is written out, before the page ends", () => {
    const json = '{"mockup_id": "mock-1", "html": "<!doctype html><p>Hal'
    expect(layerArgOfPartialInput("update_mockup", json)).toEqual({
      mockup_id: "mock-1",
    })
    expect(
      layerArgOfPartialInput("mcp__screenplay__read_mockup", '{"mockup_id":"m')
    ).toBe(null)
    expect(
      layerArgOfPartialInput("append_to_document_body", '{"document_id":"d-2"')
    ).toEqual({ document_id: "d-2" })
  })

  it("waits for an id that follows the page", () => {
    const json = '{"html": "<p data-x=\\"1\\">A</p>", "mockup_id": "mock-1"'
    expect(layerArgOfPartialInput("update_mockup", json.slice(0, 30))).toBe(
      null
    )
    expect(layerArgOfPartialInput("update_mockup", json)).toEqual({
      mockup_id: "mock-1",
    })
  })

  it("never reads an id the page quotes", () => {
    const json = '{"html": "{\\"mockup_id\\": \\"fake\\"} <div>'
    expect(layerArgOfPartialInput("update_mockup", json)).toBe(null)
    expect(
      layerArgOfPartialInput("update_mockup", '{"title": {"mockup_id": "x"}')
    ).toBe(null)
  })

  it("names nothing for a tool that works on no layer", () => {
    expect(layerArgOfPartialInput("Edit", '{"mockup_id": "mock-1"')).toBe(null)
    expect(
      layerArgOfPartialInput("create_mockup", '{"mockup_id": "mock-1"')
    ).toBe(null)
  })
})

describe("workingLayerOf", () => {
  it("names the layer a harness’s start_editing names, before any page", () => {
    expect(
      workingLayerOf({
        title: "mcp__screenplay__start_editing",
        status: "pending",
        rawInput: { layer_id: "mock-1" },
      })
    ).toBe("mock-1")
    expect(
      workingLayerOf({
        title: "mcp__screenplay__start_editing",
        status: "pending",
        rawInput: {},
      })
    ).toBe(null)
  })
})
