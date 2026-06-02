import { describe, expect, it } from "vitest"

import type { ModelProvider } from "@/lib/agent/providers"
import { buildNetworkPolicy } from "@/lib/sandbox/network-policy"

/**
 * A stub provider whose only relevant behavior to the builder is `egress()`.
 * The builder reads nothing else, so the rest of the interface is filled with
 * loud no-ops — a fold over real provider *shape*, not real provider env.
 */
function provider(egress: ReturnType<ModelProvider["egress"]>): ModelProvider {
  return {
    key: "stub",
    label: "Stub",
    isConfigured: () => egress !== null,
    listModels: async () => [],
    resolve: () => {
      throw new Error("stub provider: resolve should not be called")
    },
    egress: () => egress,
  }
}

describe("buildNetworkPolicy", () => {
  it("emits an allow rule with an auth-header transform for a configured provider", () => {
    const policy = buildNetworkPolicy([
      provider({
        host: "api.anthropic.com",
        headers: { "x-api-key": "real-key" },
      }),
    ])

    expect(policy).toEqual({
      allow: {
        "api.anthropic.com": [
          { transform: [{ headers: { "x-api-key": "real-key" } }] },
        ],
        "*": [],
      },
    })
  })

  it("omits a provider with no egress descriptor, keeping only the passthrough", () => {
    const policy = buildNetworkPolicy([provider(null)])

    expect(policy).toEqual({ allow: { "*": [] } })
  })

  it("composes multiple configured providers into one policy", () => {
    const policy = buildNetworkPolicy([
      provider({ host: "api.anthropic.com", headers: { "x-api-key": "ak" } }),
      provider(null),
      provider({
        host: "api.openai.com",
        headers: { authorization: "Bearer ok" },
      }),
    ])

    expect(policy.allow).toEqual({
      "api.anthropic.com": [
        { transform: [{ headers: { "x-api-key": "ak" } }] },
      ],
      "api.openai.com": [
        { transform: [{ headers: { authorization: "Bearer ok" } }] },
      ],
      "*": [],
    })
  })

  it("injects the auth header in overwrite form — a single value under the header key", () => {
    // The firewall applies `transform.headers` as a replace, not an append, so
    // a harness's own (possibly dummy) auth value is overwritten by the
    // injected one. The builder's job is to emit the header in that map form;
    // a Record holds exactly one value per header name — overwrite, not append.
    const policy = buildNetworkPolicy([
      provider({
        host: "api.anthropic.com",
        headers: { "x-api-key": "real-key" },
      }),
    ])

    const headers =
      policy.allow["api.anthropic.com"]![0]!.transform![0]!.headers!
    expect(headers).toEqual({ "x-api-key": "real-key" })
    expect(Object.values(headers)).toEqual(["real-key"])
  })
})
