import { describe, expect, it } from "vitest"
import type { ModelInfo } from "@/lib/models-store"
import { modelMenu, type HarnessModelChoices } from "./harness-model-menu"

const claude = { key: "claude-code", label: "Claude Code" }
const opencode = { key: "opencode-gateway", label: "OpenCode" }

// The desktop catalog with Claude Code and OpenCode installed: Claude Code's
// curated models (Opus its default), OpenCode's one bare entry.
const catalog: ModelInfo[] = [
  { id: "harness:claude-code:fable", label: "Fable 5.1", provider: claude },
  {
    id: "harness:claude-code:opus",
    label: "Opus 5.5",
    provider: claude,
    isDefault: true,
  },
  {
    id: "harness:opencode-gateway",
    label: "OpenCode",
    provider: opencode,
    isDefault: true,
  },
]
const serverDefault = "harness:claude-code:opus"

const pickle = {
  id: "opencode/big-pickle",
  label: "Big Pickle",
  group: "OpenCode Zen",
}
const kimi = {
  id: "github-copilot/kimi-k3",
  label: "Kimi K3",
  group: "GitHub Copilot",
}
const chosen: HarnessModelChoices = { "opencode-gateway": [pickle, kimi] }

describe("the menu", () => {
  it("keeps a Harness's one entry while nothing is chosen", () => {
    expect(modelMenu({ models: catalog, choices: {} }).models).toEqual(catalog)
    expect(
      modelMenu({ models: catalog, choices: { "opencode-gateway": [] } }).models
    ).toEqual(catalog)
  })

  it("puts the chosen models in its place, under the same heading", () => {
    expect(modelMenu({ models: catalog, choices: chosen }).models).toEqual([
      catalog[0],
      catalog[1],
      {
        id: "harness:opencode-gateway:opencode/big-pickle",
        label: "Big Pickle",
        provider: opencode,
        isDefault: true,
      },
      {
        id: "harness:opencode-gateway:github-copilot/kimi-k3",
        label: "Kimi K3",
        provider: opencode,
      },
    ])
  })

  it("names the provider when two chosen models share a name", () => {
    const { models } = modelMenu({
      models: catalog,
      choices: {
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
      },
    })
    expect(models.slice(2).map((m) => m.label)).toEqual([
      "Claude Opus (GitHub Copilot)",
      "Claude Opus (Amazon Bedrock)",
    ])
  })

  it("never expands a curated Harness's entries", () => {
    const { models } = modelMenu({
      models: catalog,
      choices: { "claude-code": [pickle] },
    })
    expect(models).toEqual(catalog)
  })
})

describe("a chat keeps its Harness", () => {
  it("stays on OpenCode when models are chosen in place of its bare entry", () => {
    // The bug in #1663: the chat stored the bare id, choosing models removed
    // it from the menu, and the picker fell to Claude Code.
    const { model } = modelMenu({
      models: catalog,
      choices: chosen,
      chosen: "harness:opencode-gateway",
      serverDefault,
    })
    expect(model).toBe("harness:opencode-gateway:opencode/big-pickle")
  })

  it("stays on OpenCode when the model it uses is unchecked", () => {
    const { model } = modelMenu({
      models: catalog,
      choices: { "opencode-gateway": [kimi] },
      chosen: "harness:opencode-gateway:opencode/big-pickle",
      serverDefault,
    })
    expect(model).toBe("harness:opencode-gateway:github-copilot/kimi-k3")
  })

  it("goes back to OpenCode's own entry when every model is unchecked", () => {
    const { model } = modelMenu({
      models: catalog,
      choices: {},
      chosen: "harness:opencode-gateway:opencode/big-pickle",
      serverDefault,
    })
    expect(model).toBe("harness:opencode-gateway")
  })

  it("falls to its Harness's default when a curated model is retired", () => {
    const { model } = modelMenu({
      models: catalog,
      choices: {},
      chosen: "harness:claude-code:retired",
      serverDefault: "harness:opencode-gateway",
    })
    expect(model).toBe("harness:claude-code:opus")
  })

  it("keeps a device default set to the bare id on OpenCode", () => {
    const menu = modelMenu({
      models: catalog,
      choices: chosen,
      stored: "harness:opencode-gateway",
      serverDefault,
    })
    expect(menu.model).toBe("harness:opencode-gateway:opencode/big-pickle")
    expect(menu.defaultModel).toBe(
      "harness:opencode-gateway:opencode/big-pickle"
    )
  })

  it("takes the server default when the chat's Harness is gone", () => {
    const { model } = modelMenu({
      models: catalog,
      choices: {},
      chosen: "harness:codex:gpt-6-astra",
      serverDefault,
    })
    expect(model).toBe(serverDefault)
  })

  it("keeps a server default on its Harness once models replace it", () => {
    // OpenCode detected first: the desktop default is its bare entry.
    const { defaultModel } = modelMenu({
      models: catalog,
      choices: chosen,
      serverDefault: "harness:opencode-gateway",
    })
    expect(defaultModel).toBe("harness:opencode-gateway:opencode/big-pickle")
  })
})

describe("precedence", () => {
  const models: ModelInfo[] = [
    {
      id: "anthropic:opus",
      label: "opus",
      provider: { key: "anthropic", label: "Anthropic" },
    },
    {
      id: "openai:gpt",
      label: "gpt",
      provider: { key: "openai", label: "OpenAI" },
    },
  ]
  const resolve = (args: {
    chosen?: string | null
    stored?: string | null
    serverDefault?: string | null
    models?: ModelInfo[]
  }) => modelMenu({ models, choices: {}, ...args }).model

  it("is empty while the catalog loads with no preference", () => {
    expect(resolve({ models: [] })).toBe("")
  })

  it("holds the preferred id while the catalog loads", () => {
    expect(
      resolve({
        chosen: "anthropic:opus",
        stored: "openai:gpt",
        serverDefault: "openai:gpt",
        models: [],
      })
    ).toBe("anthropic:opus")
  })

  it("prefers the chat's own pick, then the user's default, then the server's", () => {
    expect(
      resolve({
        chosen: "openai:gpt",
        stored: "anthropic:opus",
        serverDefault: "anthropic:opus",
      })
    ).toBe("openai:gpt")
    expect(
      resolve({ stored: "openai:gpt", serverDefault: "anthropic:opus" })
    ).toBe("openai:gpt")
    expect(resolve({ serverDefault: "openai:gpt" })).toBe("openai:gpt")
  })

  it("falls to the first model when nothing else is listed", () => {
    expect(resolve({ serverDefault: null })).toBe("anthropic:opus")
    expect(
      resolve({ stored: "anthropic:retired", serverDefault: "openai:retired" })
    ).toBe("anthropic:opus")
  })

  it("drops a stale provider id to the server default", () => {
    expect(
      resolve({ stored: "anthropic:retired", serverDefault: "openai:gpt" })
    ).toBe("openai:gpt")
  })
})
