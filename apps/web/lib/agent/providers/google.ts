import "server-only"

import { google } from "@ai-sdk/google"
import type { ModelProvider } from "./types"

/**
 * Google (Gemini) provider. Reads `GOOGLE_GENERATIVE_AI_API_KEY` from the
 * environment via the underlying SDK.
 */
class GoogleProvider implements ModelProvider {
  key = "google"
  label = "Google"

  isConfigured() {
    return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY)
  }

  listModels() {
    if (!this.isConfigured()) return []
    return [
      { id: "google:gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "google:gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    ]
  }

  resolve(modelId: string) {
    return google(modelId)
  }
}

export function getGoogleProvider(): ModelProvider {
  return new GoogleProvider()
}
