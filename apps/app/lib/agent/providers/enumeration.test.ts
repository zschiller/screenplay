import { describe, expect, it } from "vitest"

import { providerDefaultModelId, providerModels } from "@/lib/agent/providers"
import type { ModelInfo, ModelProvider } from "@/lib/agent/providers"

/**
 * The **hosted** arm of backend-uniform model enumeration: the provider registry
 * folds into `provider:` `ModelInfo` entries, and the default honors
 * `AGENT_DEFAULT_MODEL` only when its provider is configured. These drive the
 * stub-injected tests below; the desktop arm (`harness:` entries from the
 * Availability seam) lives in `harnesses/availability.test.ts`. Together they
 * cover the issue's invariant: neither backend returns a default the seam
 * doesn't contain.
 */

/** A stub provider: configured-ness and its listed models are the only fold inputs. */
function stubProvider(
  key: string,
  opts: {
    configured?: boolean
    models?: Array<Omit<ModelInfo, "provider">>
  } = {}
): ModelProvider {
  return {
    key,
    label: key.toUpperCase(),
    isConfigured: () => opts.configured ?? true,
    listModels: async () => opts.models ?? [],
    resolve: () => {
      throw new Error("stub provider: resolve should not be called")
    },
    egress: () => null,
  }
}

describe("providerModels (hosted enumeration fold)", () => {
  it("flattens each provider's models in registry order, decorated with provider metadata", async () => {
    const providers = [
      stubProvider("anthropic", {
        models: [{ id: "anthropic:opus", label: "Opus" }],
      }),
      stubProvider("openai", {
        models: [
          { id: "openai:gpt-5", label: "GPT-5" },
          { id: "openai:gpt-5-mini", label: "GPT-5 mini" },
        ],
      }),
    ]

    expect(await providerModels(providers)).toEqual([
      {
        id: "anthropic:opus",
        label: "Opus",
        provider: { key: "anthropic", label: "ANTHROPIC" },
      },
      {
        id: "openai:gpt-5",
        label: "GPT-5",
        provider: { key: "openai", label: "OPENAI" },
      },
      {
        id: "openai:gpt-5-mini",
        label: "GPT-5 mini",
        provider: { key: "openai", label: "OPENAI" },
      },
    ])
  })

  it("contributes nothing for a provider that lists no models", async () => {
    expect(await providerModels([stubProvider("anthropic")])).toEqual([])
  })
})

describe("providerDefaultModelId (hosted default fold)", () => {
  const models: ModelInfo[] = [
    {
      id: "openai:gpt-5",
      label: "GPT-5",
      provider: { key: "openai", label: "OPENAI" },
    },
  ]

  it("returns AGENT_DEFAULT_MODEL when its provider is configured", () => {
    const providers = [stubProvider("anthropic"), stubProvider("openai")]

    expect(
      providerDefaultModelId(providers, models, "anthropic:claude-sonnet-4-6")
    ).toBe("anthropic:claude-sonnet-4-6")
  })

  it("never returns a default whose provider isn't configured — falls back to the first model", () => {
    // Anthropic isn't configured here, so the hardcoded anthropic default must
    // not surface; the first enabled (openai) model wins instead.
    const providers = [
      stubProvider("anthropic", { configured: false }),
      stubProvider("openai"),
    ]

    expect(
      providerDefaultModelId(providers, models, "anthropic:claude-sonnet-4-6")
    ).toBe("openai:gpt-5")
  })

  it("returns null when nothing is configured and there are no models", () => {
    const providers = [stubProvider("anthropic", { configured: false })]

    expect(
      providerDefaultModelId(providers, [], "anthropic:claude-sonnet-4-6")
    ).toBeNull()
  })

  it("falls back to the first model when AGENT_DEFAULT_MODEL is malformed", () => {
    expect(
      providerDefaultModelId([stubProvider("openai")], models, "no-prefix")
    ).toBe("openai:gpt-5")
  })
})
