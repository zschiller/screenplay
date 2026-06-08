import { describe, expect, it } from "vitest"
import { contentBlocksToWire, wireToContentBlocks } from "./markers"
import {
  prependTurnMarkers,
  serializeMention,
  serializeSkill,
} from "../message-markers"
import type { ContentBlock } from "./schema"

describe("Message Markers ⟷ ACP content blocks", () => {
  it("rides `@`-mentions on native resource_link blocks", () => {
    const wire = `See ${serializeMention("Design Doc", "doc_42")} please`
    expect(wireToContentBlocks(wire)).toEqual<ContentBlock[]>([
      { type: "text", text: "See " },
      { type: "resource_link", uri: "mention:doc_42", name: "Design Doc" },
      { type: "text", text: " please" },
    ])
  })

  it("keeps plan/branch/skill markers in-band (no ACP slot)", () => {
    const body = `${serializeSkill("triage")} run it`
    const wire = prependTurnMarkers(body, {
      planMode: true,
      branch: "feat/x",
    })
    // The whole thing stays a single text block — none of these markers have an
    // ACP equivalent, so they remain an in-band screenplay convention.
    expect(wireToContentBlocks(wire)).toEqual<ContentBlock[]>([
      { type: "text", text: wire },
    ])
  })

  it("round-trips losslessly: in-band markers + native mentions", () => {
    const body = [
      serializeSkill("triage"),
      "look at",
      serializeMention("Spec", "doc_1"),
      "and",
      serializeMention("Notes", "doc_2"),
    ].join(" ")
    const wire = prependTurnMarkers(body, { planMode: true, branch: "feat/y" })

    const blocks = wireToContentBlocks(wire)
    // Mentions surfaced as native blocks…
    expect(
      blocks.filter((b) => b.type === "resource_link").map((b) => b.uri)
    ).toEqual(["mention:doc_1", "mention:doc_2"])
    // …and the wire reassembles byte-for-byte.
    expect(contentBlocksToWire(blocks)).toBe(wire)
  })

  it("a bare mention yields exactly one resource_link and round-trips", () => {
    const wire = serializeMention("Only", "doc_9")
    const blocks = wireToContentBlocks(wire)
    expect(blocks).toEqual<ContentBlock[]>([
      { type: "resource_link", uri: "mention:doc_9", name: "Only" },
    ])
    expect(contentBlocksToWire(blocks)).toBe(wire)
  })

  it("an empty message round-trips through a single empty text block", () => {
    expect(wireToContentBlocks("")).toEqual<ContentBlock[]>([
      { type: "text", text: "" },
    ])
    expect(contentBlocksToWire(wireToContentBlocks(""))).toBe("")
  })

  it("plain text with no markers is one text block and round-trips", () => {
    const wire = "just a normal message"
    expect(wireToContentBlocks(wire)).toEqual<ContentBlock[]>([
      { type: "text", text: wire },
    ])
    expect(contentBlocksToWire(wireToContentBlocks(wire))).toBe(wire)
  })
})
