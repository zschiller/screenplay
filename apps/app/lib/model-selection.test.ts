import { describe, expect, it } from "vitest"
import { groupModelsByProvider, modelDisplayLabel } from "@/lib/model-selection"
import type { ModelInfo } from "@/lib/models-store"

function model(
  id: string,
  providerKey: string,
  providerLabel: string
): ModelInfo {
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

describe("modelDisplayLabel", () => {
  it("names the agent and the model", () => {
    expect(
      modelDisplayLabel({
        id: "harness:claude-code:opus",
        label: "Opus 4.8",
        provider: { key: "claude-code", label: "Claude Code" },
      })
    ).toBe("Claude Code · Opus 4.8")
  })

  it("names a Harness with no model list once", () => {
    expect(
      modelDisplayLabel({
        id: "harness:codex",
        label: "Codex",
        provider: { key: "codex", label: "Codex" },
      })
    ).toBe("Codex")
  })
})
