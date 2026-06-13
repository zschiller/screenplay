import { describe, expect, it } from "vitest"

import type { ModelProvider } from "@/lib/agent/providers"
import {
  BROKERED_VALUE,
  buildBrokeredEnv,
  resolveLaunchArgv,
  selectHarnesses,
  unconfiguredBannerArgv,
  type Harness,
} from "@/lib/agent/harnesses"
import { createHostedResolver } from "@/lib/agent/harnesses/availability"

/**
 * A stub provider whose only behavior relevant to the selection fold is
 * `egress()` (configured + header-brokerable ⇒ non-null). The rest of the
 * interface is loud no-ops — the fold reads nothing else. Mirrors the stub in
 * `lib/sandbox/network-policy.test.ts`.
 */
function provider(
  key: string,
  egress: ReturnType<ModelProvider["egress"]>
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

const openaiConfigured = provider("openai", {
  host: "api.openai.com",
  headers: { authorization: "Bearer real-openai-key" },
})
const openaiUnconfigured = provider("openai", null)

describe("selectHarnesses", () => {
  it("yields no installable harnesses when SANDBOX_HARNESSES is unset", () => {
    expect(selectHarnesses(undefined, [anthropicConfigured])).toEqual({
      installable: [],
      skipped: [],
    })
  })

  it("yields none for an empty / whitespace-only value", () => {
    expect(selectHarnesses("   ", [anthropicConfigured]).installable).toEqual(
      []
    )
  })

  it("selects claude-code when its broker provider is configured and brokerable", () => {
    const { installable, skipped } = selectHarnesses("claude-code", [
      anthropicConfigured,
    ])

    expect(installable.map((h) => h.key)).toEqual(["claude-code"])
    expect(skipped).toEqual([])
  })

  it("drops an unknown key with a skip reason, never a hard failure", () => {
    const { installable, skipped } = selectHarnesses("nope", [
      anthropicConfigured,
    ])

    expect(installable).toEqual([])
    expect(skipped).toHaveLength(1)
    expect(skipped[0]!.key).toBe("nope")
    expect(skipped[0]!.reason).toContain("unknown")
  })

  it("skips a known harness whose broker provider is unconfigured / non-brokerable", () => {
    const { installable, skipped } = selectHarnesses("claude-code", [
      anthropicUnconfigured,
    ])

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
    const { installable } = selectHarnesses("claude-code,claude-code", [
      anthropicConfigured,
    ])

    expect(installable.map((h) => h.key)).toEqual(["claude-code"])
  })

  it("preserves order and reports both installable and skipped together", () => {
    const { installable, skipped } = selectHarnesses("ghost,claude-code", [
      anthropicConfigured,
    ])

    expect(installable.map((h) => h.key)).toEqual(["claude-code"])
    expect(skipped.map((s) => s.key)).toEqual(["ghost"])
  })

  it("installs codex only when OpenAI is configured and brokerable", () => {
    const { installable, skipped } = selectHarnesses("codex", [
      openaiConfigured,
    ])

    expect(installable.map((h) => h.key)).toEqual(["codex"])
    expect(skipped).toEqual([])
  })

  it("skips codex (logged, non-fatal) when OpenAI isn't configured / brokerable", () => {
    const { installable, skipped } = selectHarnesses("codex", [
      openaiUnconfigured,
    ])

    expect(installable).toEqual([])
    expect(skipped).toHaveLength(1)
    expect(skipped[0]!.key).toBe("codex")
    expect(skipped[0]!.reason).toContain("openai")
  })

  it("selects claude-code and codex side by side from a mixed provider registry", () => {
    const { installable } = selectHarnesses("claude-code,codex", [
      anthropicConfigured,
      openaiConfigured,
    ])

    expect(installable.map((h) => h.key)).toEqual(["claude-code", "codex"])
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
    launchCommand: "fake",
    brokerProviderKey: "fake-provider",
    gateEnvVar: "FAKE_API_KEY",
    baseUrlEnv: { name: "FAKE_BASE_URL", value: "https://broker.example/v1" },
    launchArgv: ["fake"],
    hostBinary: "fake",
    acpAdapter: null,
    seed: async () => {},
  }

  it("emits no env for an empty installable set", () => {
    expect(buildBrokeredEnv([])).toEqual({})
  })

  it("emits the dummy gate var (BROKERED_VALUE) for each harness, never a real key", () => {
    const { installable } = selectHarnesses("claude-code", [
      anthropicConfigured,
    ])

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

describe("resolveLaunchArgv", () => {
  const installable = selectHarnesses("claude-code", [
    anthropicConfigured,
  ]).installable

  it("resolves an installed harness key → its launch command wrapped for Ctrl-D-to-shell", () => {
    // The harness is wrapped so quitting it (Ctrl-D) `exec`s a login shell in
    // the same tmux session rather than ending the session (#285).
    expect(resolveLaunchArgv("claude-code", installable)).toEqual([
      "sh",
      "-c",
      "claude; exec $SHELL",
    ])
  })

  it("opens a plain shell (empty argv) for a null/undefined key — a pre-#285 tab", () => {
    expect(resolveLaunchArgv(null, installable)).toEqual([])
    expect(resolveLaunchArgv(undefined, installable)).toEqual([])
  })

  it("opens a plain shell when the stored key isn't in the installed set", () => {
    // The harness was dropped from SANDBOX_HARNESSES (or its provider went
    // unconfigured): fall through to a shell, never an error.
    expect(resolveLaunchArgv("claude-code", [])).toEqual([])
    expect(resolveLaunchArgv("ghost", installable)).toEqual([])
  })
})

describe("unconfiguredBannerArgv", () => {
  it("wraps a SANDBOX_HARNESSES banner around a login shell (exec $SHELL) on the hosted backend", () => {
    // Hosted is the default; an explicit "hosted" must read the same.
    for (const argv of [
      unconfiguredBannerArgv(),
      unconfiguredBannerArgv("hosted"),
    ]) {
      // Wrapped like the harness launch so the operator lands in a normal shell
      // after the banner prints.
      expect(argv[0]).toBe("sh")
      expect(argv[1]).toBe("-c")
      const script = argv[2]!
      expect(script).toContain("SANDBOX_HARNESSES")
      expect(script).toMatch(/exec \$SHELL$/)
    }
  })

  it("points the desktop banner at installing a CLI, not SANDBOX_HARNESSES", () => {
    const argv = unconfiguredBannerArgv("desktop")

    expect(argv[0]).toBe("sh")
    expect(argv[1]).toBe("-c")
    const script = argv[2]!
    // Desktop detects a host CLI — no env, no install — so its guidance points at
    // installing one (managed from Settings), never at SANDBOX_HARNESSES.
    expect(script).not.toContain("SANDBOX_HARNESSES")
    expect(script).toContain("Settings")
    expect(script).toMatch(/exec \$SHELL$/)
  })
})

/**
 * The hosted Harness Availability resolver lifts the same selection fold above
 * into the backend-aware seam (#476): it must return exactly what `selectHarnesses`
 * would, each entry carrying an `installed` status, so routing the hosted terminal
 * picker through the seam doesn't change what it shows. Providers and the
 * `SANDBOX_HARNESSES` value are injected so the fold is exercised without the
 * provider graph or the ambient env.
 */
describe("createHostedResolver (Harness Availability — hosted fold)", () => {
  it("lists the installable harnesses, each with installed status", async () => {
    const resolver = createHostedResolver({
      sandboxHarnesses: "claude-code,codex",
      providers: [anthropicConfigured, openaiConfigured],
    })

    const available = await resolver.list()

    expect(available.map(({ harness }) => harness.key)).toEqual([
      "claude-code",
      "codex",
    ])
    expect(available.every(({ status }) => status.installed)).toBe(true)
  })

  it("yields nothing when SANDBOX_HARNESSES is empty (matches selectHarnesses)", async () => {
    const resolver = createHostedResolver({
      sandboxHarnesses: "",
      providers: [anthropicConfigured],
    })

    expect(await resolver.list()).toEqual([])
  })

  it("drops a harness whose broker provider isn't configured / brokerable", async () => {
    const resolver = createHostedResolver({
      sandboxHarnesses: "claude-code,codex",
      providers: [anthropicConfigured, openaiUnconfigured],
    })

    const available = await resolver.list()

    // codex is dropped (OpenAI not brokerable) exactly as the bare fold drops it.
    expect(available.map(({ harness }) => harness.key)).toEqual(["claude-code"])
  })
})
