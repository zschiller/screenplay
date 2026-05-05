import "server-only"

import { anthropic } from "@ai-sdk/anthropic"
import { google } from "@ai-sdk/google"
import { openai } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"

/**
 * v2's BYO-provider story. Each provider is configured purely from env vars
 * — no hardcoded keys, no UI to manage credentials. The model ids the rest
 * of the codebase passes around use a `provider:model` format
 * (e.g. `anthropic:claude-sonnet-4-6`, `openai:gpt-4o`,
 * `gateway:meta-llama/llama-3.3-70b`).
 *
 * Adding a new provider:
 * 1. install `@ai-sdk/<provider>`
 * 2. add a case in `resolveLanguageModel`
 * 3. add it to `enumerateModels` if you want it surfaced in the picker
 *
 * The OpenAI-compatible "gateway" provider lets you point at any
 * OpenAI-protocol endpoint — OpenRouter, Groq, LM Studio, vLLM, etc. —
 * by setting AI_GATEWAY_BASE_URL + AI_GATEWAY_API_KEY. Models exposed by
 * the gateway are listed in AI_GATEWAY_MODELS (comma-separated) since
 * there's no portable enumeration endpoint across compatible servers.
 */

export type ProviderKey = "anthropic" | "openai" | "google" | "gateway"

export interface ModelInfo {
  id: string
  label: string
}

export const DEFAULT_MODEL = "anthropic:claude-sonnet-4-6"

/**
 * Parse a `provider:model` string. Bare ids without a colon default to
 * Anthropic so v1 callers passing `claude-sonnet-4-6` keep working without
 * a config change.
 */
export function parseModelId(id: string): { provider: ProviderKey; model: string } {
  const idx = id.indexOf(":")
  if (idx === -1) return { provider: "anthropic", model: id }
  const provider = id.slice(0, idx) as ProviderKey
  const model = id.slice(idx + 1)
  return { provider, model }
}

let cachedGateway: ReturnType<typeof createOpenAICompatible> | null = null
function getGateway() {
  if (cachedGateway) return cachedGateway
  const baseURL = process.env.AI_GATEWAY_BASE_URL
  if (!baseURL) {
    throw new Error(
      "AI_GATEWAY_BASE_URL is not set — gateway provider isn't configured.",
    )
  }
  const apiKey = process.env.AI_GATEWAY_API_KEY
  cachedGateway = createOpenAICompatible({
    name: "gateway",
    baseURL,
    ...(apiKey ? { apiKey } : {}),
  })
  return cachedGateway
}

export function resolveLanguageModel(modelId: string): LanguageModel {
  const { provider, model } = parseModelId(modelId)
  switch (provider) {
    case "anthropic":
      return anthropic(model)
    case "openai":
      return openai(model)
    case "google":
      return google(model)
    case "gateway":
      return getGateway()(model)
    default:
      // Unknown providers shouldn't slip through — but if a stored chat
      // references one, surface a helpful error rather than silently
      // calling Anthropic with a garbage id.
      throw new Error(`Unknown provider in model id "${modelId}"`)
  }
}

function isProviderEnabled(p: ProviderKey): boolean {
  switch (p) {
    case "anthropic":
      return Boolean(process.env.ANTHROPIC_API_KEY)
    case "openai":
      return Boolean(process.env.OPENAI_API_KEY)
    case "google":
      return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY)
    case "gateway":
      return Boolean(process.env.AI_GATEWAY_BASE_URL)
  }
}

/**
 * The static set of "popular" models per provider. Servers that genuinely
 * support listing (Anthropic does) can fetch live; for parity with v1's
 * existing /api/agent/models route we keep an Anthropic live-list path and
 * use a curated list for the others.
 *
 * The picker accepts whatever id the user types, so this list is just for
 * UI convenience — not an exhaustive whitelist.
 */
const CURATED_MODELS: Record<Exclude<ProviderKey, "gateway">, ModelInfo[]> = {
  anthropic: [
    { id: "anthropic:claude-opus-4-7", label: "Claude Opus 4.7" },
    { id: "anthropic:claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "anthropic:claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
  openai: [
    { id: "openai:gpt-4o", label: "GPT-4o" },
    { id: "openai:gpt-4o-mini", label: "GPT-4o mini" },
    { id: "openai:o1", label: "o1" },
    { id: "openai:o1-mini", label: "o1-mini" },
  ],
  google: [
    { id: "google:gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "google:gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ],
}

/** AI_GATEWAY_MODELS env var format: comma-separated `id` or `id|label` items. */
function gatewayModels(): ModelInfo[] {
  const raw = process.env.AI_GATEWAY_MODELS
  if (!raw) return []
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, label] = entry.split("|").map((s) => s.trim())
      return {
        id: `gateway:${id!}`,
        label: label ?? id!,
      }
    })
}

export function enumerateModels(): ModelInfo[] {
  const out: ModelInfo[] = []
  if (isProviderEnabled("anthropic")) out.push(...CURATED_MODELS.anthropic)
  if (isProviderEnabled("openai")) out.push(...CURATED_MODELS.openai)
  if (isProviderEnabled("google")) out.push(...CURATED_MODELS.google)
  if (isProviderEnabled("gateway")) out.push(...gatewayModels())
  return out
}
