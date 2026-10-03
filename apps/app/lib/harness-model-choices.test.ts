// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import type { ModelInfo } from "@/lib/models-store"
import {
  expandHarnessModelChoices,
  readHarnessModelChoices,
  writeHarnessModelChoices,
} from "./harness-model-choices"

afterEach(() => window.localStorage.clear())

const opencode = { key: "opencode-gateway", label: "OpenCode" }
const claude = { key: "claude-code", label: "Claude Code" }
const catalog: ModelInfo[] = [
  { id: "harness:claude-code:opus", label: "Opus 5.5", provider: claude },
  { id: "harness:opencode-gateway", label: "OpenCode", provider: opencode },
]

describe("expandHarnessModelChoices (#1589)", () => {
  it("keeps the Harness's one entry while nothing is chosen", () => {
    expect(expandHarnessModelChoices(catalog, {})).toBe(catalog)
    expect(
      expandHarnessModelChoices(catalog, { "opencode-gateway": [] })
    ).toEqual(catalog)
  })

  it("puts the chosen models in its place, under the same heading", () => {
    const models = expandHarnessModelChoices(catalog, {
      "opencode-gateway": [
        {
          id: "opencode/big-pickle",
          label: "Big Pickle",
          group: "OpenCode Zen",
        },
        {
          id: "github-copilot/kimi-k3",
          label: "Kimi K3",
          group: "GitHub Copilot",
        },
      ],
    })
    expect(models).toEqual([
      catalog[0],
      {
        id: "harness:opencode-gateway:opencode/big-pickle",
        label: "Big Pickle",
        provider: opencode,
      },
      {
        id: "harness:opencode-gateway:github-copilot/kimi-k3",
        label: "Kimi K3",
        provider: opencode,
      },
    ])
  })

  it("names the provider when two chosen models share a name", () => {
    const models = expandHarnessModelChoices(catalog, {
      "opencode-gateway": [
        {
          id: "github-copilot/opus",
          label: "Claude Opus",
          group: "GitHub Copilot",
        },
        {
          id: "amazon-bedrock/opus",
          label: "Claude Opus",
          group: "Amazon Bedrock",
        },
      ],
    })
    expect(models.slice(1).map((m) => m.label)).toEqual([
      "Claude Opus (GitHub Copilot)",
      "Claude Opus (Amazon Bedrock)",
    ])
  })
})

describe("the stored choice", () => {
  it("round-trips per Harness and forgets a Harness left with none", () => {
    const pickle = {
      id: "opencode/big-pickle",
      label: "Big Pickle",
      group: "OpenCode Zen",
    }
    writeHarnessModelChoices("opencode-gateway", [pickle])
    expect(readHarnessModelChoices()).toEqual({ "opencode-gateway": [pickle] })
    // The same object until it changes, as useSyncExternalStore needs.
    expect(readHarnessModelChoices()).toBe(readHarnessModelChoices())
    writeHarnessModelChoices("opencode-gateway", [])
    expect(readHarnessModelChoices()).toEqual({})
  })

  it("reads nothing from a value it didn't write", () => {
    window.localStorage.setItem("agent-harness-models", "not json")
    expect(readHarnessModelChoices()).toEqual({})
    window.localStorage.setItem(
      "agent-harness-models",
      JSON.stringify({ a: [{ id: 1 }], b: "x" })
    )
    expect(readHarnessModelChoices()).toEqual({ a: [] })
  })
})
