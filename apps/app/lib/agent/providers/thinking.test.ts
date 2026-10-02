import { describe, expect, it } from "vitest"
import { thinkingProviderOptions } from "./thinking"

const summarized = {
  anthropic: { thinking: { type: "adaptive", display: "summarized" } },
}

describe("thinkingProviderOptions", () => {
  it.each([
    "anthropic:claude-sonnet-5-5",
    "anthropic:claude-opus-5-5",
    "anthropic:claude-opus-5",
    "anthropic:claude-sonnet-5",
    "anthropic:claude-fable-5-1",
    "vercel:anthropic/claude-sonnet-5.5",
    "vercel:anthropic/claude-opus-5",
  ])("asks %s for summarized thinking", (id) => {
    expect(thinkingProviderOptions(id)).toEqual(summarized)
  })

  it.each([
    // Don't think unless asked: requesting adaptive would turn thinking on.
    "anthropic:claude-opus-4-8",
    "anthropic:claude-sonnet-4-6",
    "vercel:anthropic/claude-opus-4.7",
    // Rejects adaptive thinking.
    "anthropic:claude-haiku-4-5",
    // Not Claude.
    "openai:gpt-6-astra",
    "vercel:openai/gpt-6-astra",
  ])("leaves %s alone", (id) => {
    expect(thinkingProviderOptions(id)).toBeUndefined()
  })
})
