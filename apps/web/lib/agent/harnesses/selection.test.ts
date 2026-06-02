import { describe, expect, it } from "vitest"

import type { ModelProvider } from "@/lib/agent/providers"
import {
  BROKERED_VALUE,
  buildBrokeredEnv,
  selectHarnesses,
  type Harness,
} from "@/lib/agent/harnesses"

/**
 * A stub provider whose only behavior relevant to the selection fold is
 * `egress()` (configured + header-brokerable ⇒ non-null). The rest of the
 * interface is loud no-ops — the fold reads nothing else. Mirrors the stub in
 * `lib/sandbox/network-policy.test.ts`.
 */
function provider(
  key: string,
  egress: ReturnType<ModelProvider["egress"]>,
): ModelProvider {
  return {
    key,
    label: key,
    isConfigured: () => egress !== null,
    listModels: async () => [],
    resolve: () => {
      throw new Error("stub provider: resolve should not be called")
    },
    egress: () => egress,
  }
}

const anthropicConfigured = provider("anthropic", {
  host: "api.anthropic.com",
  headers: { "x-api-key": "real-key" },
})
const anthropicUnconfigured = provider("anthropic", null)

describe("selectHarnesses", () => {
  it("yields no installable harnesses when SANDBOX_HARNESSES is unset", () => {
    expect(selectHarnesses(undefined, [anthropicConfigured])).toEqual({
      installable: [],
      skipped: [],
    })
  })

  it("yields none for an empty / whitespace-only value", () => {
    expect(selectHarnesses("   ", [anthropicConfigured]).installable).toEqual([])
  })

  it("selects claude-code when its broker provider is configured and brokerable", () => {
    const { installable, skipped } = selectHarnesses("claude-code", [anthropicConfigured])

    expect(installable.map((h) => h.key)).toEqual(["claude-code"])
    expect(skipped).toEqual([])
  })

  it("drops an unknown key with a skip reason, never a hard failure", () => {
    const { installable, skipped } = selectHarnesses("nope", [anthropicConfigured])

    expect(installable).toEqual([])
    expect(skipped).toHaveLength(1)
    expect(skipped[0]!.key).toBe("nope")
    expect(skipped[0]!.reason).toContain("unknown")
  })

  it("skips a known harness whose broker provider is unconfigured / non-brokerable", () => {
    const { installable, skipped } = selectHarnesses("claude-code", [anthropicUnconfigured])

    expect(installable).toEqual([])
    expect(skipped).toHaveLength(1)
    expect(skipped[0]!.key).toBe("claude-code")
    expect(skipped[0]!.reason).toContain("anthropic")
  })

  it("skips a known harness whose broker provider is absent from the registry", () => {
    const { installable, skipped } = selectHarnesses("claude-code", [])

    expect(installable).toEqual([])
    expect(skipped[0]!.key).toBe("claude-code")
  })

  it("collapses duplicates, keeping a single installable entry", () => {
    const { installable } = selectHarnesses("claude-code,claude-code", [anthropicConfigured])

    expect(installable.map((h) => h.key)).toEqual(["claude-code"])
  })

  it("preserves order and reports both installable and skipped together", () => {
    const { installable, skipped } = selectHarnesses(
      "ghost,claude-code",
      [anthropicConfigured],
    )

    expect(installable.map((h) => h.key)).toEqual(["claude-code"])
    expect(skipped.map((s) => s.key)).toEqual(["ghost"])
  })
})

describe("buildBrokeredEnv", () => {
  // A fabricated harness lets the env fold be tested independently of the
  // catalog: it asserts the fold's shape (gate var + base-url override), not
  // which descriptors happen to ship today.
  const withBaseUrl: Harness = {
    key: "fake",
    label: "Fake",
    installPackage: "fake-cli",
    brokerProviderKey: "fake-provider",
    gateEnvVar: "FAKE_API_KEY",
    baseUrlEnv: { name: "FAKE_BASE_URL", value: "https://broker.example/v1" },
    seed: async () => {},
  }

  it("emits no env for an empty installable set", () => {
    expect(buildBrokeredEnv([])).toEqual({})
  })

  it("emits the dummy gate var (BROKERED_VALUE) for each harness, never a real key", () => {
    const { installable } = selectHarnesses("claude-code", [anthropicConfigured])

    const env = buildBrokeredEnv(installable)

    expect(env).toEqual({ ANTHROPIC_API_KEY: BROKERED_VALUE })
    // The real provider key ("real-key") never leaks into the boot env — the
    // firewall injects it on egress instead (ADR 0002 invariant).
    expect(Object.values(env)).not.toContain("real-key")
  })

  it("emits a base-url override alongside the gate var when the harness declares one", () => {
    expect(buildBrokeredEnv([withBaseUrl])).toEqual({
      FAKE_API_KEY: BROKERED_VALUE,
      FAKE_BASE_URL: "https://broker.example/v1",
    })
  })
})
