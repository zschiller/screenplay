import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// `egress()` is a pure env read and never touches model discovery. Stub the
// cache module so importing the providers doesn't drag in its kv/db chain
// (which needs DATABASE_URL) — the suite is about egress descriptors only.
vi.mock("@/lib/agent/providers/cache", () => ({ discover: vi.fn() }))

import { getAnthropicProvider } from "@/lib/agent/providers/anthropic"
import { getGoogleProvider } from "@/lib/agent/providers/google"
import { getOpenAIProvider } from "@/lib/agent/providers/openai"
import { getOpenAICompatibleProvider } from "@/lib/agent/providers/openai-compatible"
import { getVercelGatewayProvider } from "@/lib/agent/providers/vercel"

// Each provider's egress descriptor is a pure read of its own env vars, so the
// tests drive it by toggling those vars. Snapshot/restore the ones in play so
// the suite leaves the ambient environment untouched.
const KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "AI_GATEWAY_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENAI_COMPATIBLE_BASE_URL",
  "OPENAI_COMPATIBLE_API_KEY",
] as const

let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  for (const k of KEYS) delete process.env[k]
})

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe("Anthropic egress", () => {
  it("brokers x-api-key against api.anthropic.com when configured", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-real"

    expect(getAnthropicProvider().egress()).toEqual({
      host: "api.anthropic.com",
      headers: { "x-api-key": "sk-ant-real" },
    })
  })

  it("returns null when no key is configured", () => {
    expect(getAnthropicProvider().egress()).toBeNull()
  })
})

describe("OpenAI egress", () => {
  it("brokers a Bearer token against api.openai.com when configured", () => {
    process.env.OPENAI_API_KEY = "sk-openai-real"

    expect(getOpenAIProvider().egress()).toEqual({
      host: "api.openai.com",
      headers: { authorization: "Bearer sk-openai-real" },
    })
  })

  it("returns null when no key is configured", () => {
    expect(getOpenAIProvider().egress()).toBeNull()
  })
})

describe("Vercel AI Gateway egress", () => {
  it("brokers a Bearer token against the gateway host when configured", () => {
    process.env.AI_GATEWAY_API_KEY = "vck-real"

    expect(getVercelGatewayProvider().egress()).toEqual({
      host: "ai-gateway.vercel.sh",
      headers: { authorization: "Bearer vck-real" },
    })
  })

  it("returns null when no gateway key is configured", () => {
    expect(getVercelGatewayProvider().egress()).toBeNull()
  })
})

describe("OpenAI-compatible egress", () => {
  it("brokers a Bearer token against the configured base URL's host", () => {
    process.env.OPENAI_COMPATIBLE_BASE_URL = "https://openrouter.ai/api/v1"
    process.env.OPENAI_COMPATIBLE_API_KEY = "or-real"

    expect(getOpenAICompatibleProvider().egress()).toEqual({
      host: "openrouter.ai",
      headers: { authorization: "Bearer or-real" },
    })
  })

  it("returns null when a base URL is set but no key (nothing to broker)", () => {
    process.env.OPENAI_COMPATIBLE_BASE_URL = "http://localhost:1234/v1"

    expect(getOpenAICompatibleProvider().egress()).toBeNull()
  })

  it("returns null when the base URL is unparseable", () => {
    process.env.OPENAI_COMPATIBLE_BASE_URL = "not a url"
    process.env.OPENAI_COMPATIBLE_API_KEY = "k"

    expect(getOpenAICompatibleProvider().egress()).toBeNull()
  })
})

describe("Google egress", () => {
  it("returns null even when configured — its auth is a query param, not a header", () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "g-real"

    expect(getGoogleProvider().egress()).toBeNull()
  })
})
