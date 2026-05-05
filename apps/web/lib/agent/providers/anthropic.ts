import "server-only"

import { anthropic } from "@ai-sdk/anthropic"
import type { ModelProvider } from "./types"

/**
 * Anthropic provider. Reads `ANTHROPIC_API_KEY` from the environment via
 * the underlying SDK. Curated model list — the picker accepts whatever id
 * the user types, this is just for UI convenience.
 */
class AnthropicProvider implements ModelProvider {
  key = "anthropic"
  label = "Anthropic"

  isConfigured() {
    return Boolean(process.env.ANTHROPIC_API_KEY)
  }

  listModels() {
    if (!this.isConfigured()) return []
    return [
      { id: "anthropic:claude-opus-4-7", label: "Claude Opus 4.7" },
      { id: "anthropic:claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "anthropic:claude-haiku-4-5", label: "Claude Haiku 4.5" },
    ]
  }

  resolve(modelId: string) {
    return anthropic(modelId)
  }
}

export function getAnthropicProvider(): ModelProvider {
  return new AnthropicProvider()
}
