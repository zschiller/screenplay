import { describe, expect, it } from "vitest"
import {
  groupModelsByProvider,
  resolveDefaultModel,
} from "@/lib/model-selection"
import type { ModelInfo } from "@/lib/models-store"

function model(id: string, providerKey: string, providerLabel: string): ModelInfo {
  return {
    id,
    label: id,
    provider: { key: providerKey, label: providerLabel },
  }
}

describe("groupModelsByProvider", () => {
  it("groups models under their provider, preserving registry order", () => {
    const models = [
      model("anthropic:opus", "anthropic", "Anthropic"),
      model("openai:gpt", "openai", "OpenAI"),
      model("anthropic:sonnet", "anthropic", "Anthropic"),
    ]

    const groups = groupModelsByProvider(models)

    // Group order follows first appearance (Anthropic before OpenAI), and
    // members keep their relative order within each group.
    expect(groups.map((g) => g.key)).toEqual(["anthropic", "openai"])
    expect(groups[0]).toMatchObject({ key: "anthropic", label: "Anthropic" })
    expect(groups[0]?.models.map((m) => m.id)).toEqual([
      "anthropic:opus",
      "anthropic:sonnet",
    ])
    expect(groups[1]?.models.map((m) => m.id)).toEqual(["openai:gpt"])
  })

  it("returns an empty list for an empty catalog", () => {
    expect(groupModelsByProvider([])).toEqual([])
  })
})

describe("resolveDefaultModel", () => {
  const models = [
    model("anthropic:opus", "anthropic", "Anthropic"),
    model("openai:gpt", "openai", "OpenAI"),
  ]

  it("returns the empty string while the catalog is loading with no preference", () => {
    // Length 0 means the fetch hasn't resolved and nothing is preferred yet;
    // callers render a "Loading…" placeholder rather than commit to an id
    // from another deployment.
    expect(resolveDefaultModel({ models: [] })).toBe("")
  })

  it("keeps the preferred id while the catalog is still loading", () => {
    // A loading catalog can't validate ids, so the preferred id is held as-is
    // (no stale-id guard until the real list lands) to avoid a flash.
    expect(
      resolveDefaultModel({
        perSession: "anthropic:opus",
        stored: "openai:gpt",
        serverDefault: "openai:gpt",
        models: [],
      })
    ).toBe("anthropic:opus")
  })

  it("prefers the per-session override above all else", () => {
    expect(
      resolveDefaultModel({
        perSession: "openai:gpt",
        stored: "anthropic:opus",
        serverDefault: "anthropic:opus",
        models,
      })
    ).toBe("openai:gpt")
  })

  it("falls back to the stored last-used model when there's no override", () => {
    expect(
      resolveDefaultModel({
        stored: "openai:gpt",
        serverDefault: "anthropic:opus",
        models,
      })
    ).toBe("openai:gpt")
  })

  it("falls back to the server default when nothing is stored", () => {
    expect(
      resolveDefaultModel({
        serverDefault: "openai:gpt",
        models,
      })
    ).toBe("openai:gpt")
  })

  it("falls back to the first available model when no tier yields a valid id", () => {
    expect(
      resolveDefaultModel({
        serverDefault: null,
        models,
      })
    ).toBe("anthropic:opus")
  })

  it("drops a stale preferred id, falling through to the server default", () => {
    // The stored model was retired (no longer in the catalog), so the server
    // default takes over instead of the picker sitting on an invalid value.
    expect(
      resolveDefaultModel({
        stored: "anthropic:retired",
        serverDefault: "openai:gpt",
        models,
      })
    ).toBe("openai:gpt")
  })

  it("drops a stale preferred id and a stale server default, to the first model", () => {
    expect(
      resolveDefaultModel({
        stored: "anthropic:retired",
        serverDefault: "openai:retired",
        models,
      })
    ).toBe("anthropic:opus")
  })
})
