import "server-only"

import { openai } from "@ai-sdk/openai"
import type { ModelProvider } from "./types"

/**
 * OpenAI provider. Reads `OPENAI_API_KEY` from the environment via the
 * underlying SDK.
 */
class OpenAIProvider implements ModelProvider {
  key = "openai"
  label = "OpenAI"

  isConfigured() {
    return Boolean(process.env.OPENAI_API_KEY)
  }

  listModels() {
    if (!this.isConfigured()) return []
    return [
      { id: "openai:gpt-4o", label: "GPT-4o" },
      { id: "openai:gpt-4o-mini", label: "GPT-4o mini" },
      { id: "openai:o1", label: "o1" },
      { id: "openai:o1-mini", label: "o1-mini" },
    ]
  }

  resolve(modelId: string) {
    return openai(modelId)
  }
}

export function getOpenAIProvider(): ModelProvider {
  return new OpenAIProvider()
}
