import { describe, expect, it } from "vitest"

import type { ModelProvider } from "@/lib/agent/providers"
import type { SandboxInstance } from "@/lib/sandbox/types"
import {
  BROKERED_VALUE,
  buildBrokeredEnv,
  harnessLaunchArgv,
  selectHarnesses,
} from "@/lib/agent/harnesses"
import {
  opencodeCompatHarness,
  opencodeConfigJson,
  opencodeGatewayHarness,
} from "./opencode"

/**
 * Stub provider mirroring the one in `selection.test.ts`: only `egress()`
 * (configured + header-brokerable ⇒ non-null) matters to the selection fold.
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

/** A `runCommand` invocation captured by the fake sandbox below. */
type RecordedCall = {
  cmd: string
  args: string[]
  env?: Record<string, string>
}

/**
 * Minimal fake {@link SandboxInstance} that records every `runCommand` so a test
 * can assert what the seed wrote and where. Mirrors the fake in `codex.test.ts`;
 * `homeDir` differs from any backend default to prove the seed follows the
 * provider-supplied path. Everything the seed doesn't touch throws.
 */
function fakeSandbox(calls: RecordedCall[], homeDir = "/home/agent"): SandboxInstance {
  const notUsed = (name: string) => () => {
    throw new Error(`fake sandbox: ${name} should not be called`)
  }
  return {
    name: "fake-sandbox",
    worktreePath: "/workspace/repo",
    homeDir,
    domain: (port: number) => `https://fake-${port}.example.com`,
    runCommand: ((cmdOrOpts: unknown) => {
      const opts = cmdOrOpts as {
        cmd: string
        args?: string[]
        env?: Record<string, string>
      }
      calls.push({ cmd: opts.cmd, args: opts.args ?? [], env: opts.env })
      return Promise.resolve({
        exitCode: 0,
        stdout: async () => "",
        stderr: async () => "",
        logs: notUsed("logs") as never,
        kill: async () => {},
      })
    }) as SandboxInstance["runCommand"],
    writeFiles: notUsed("writeFiles") as never,
    readFileToBuffer: notUsed("readFileToBuffer") as never,
    delete: async () => {},
  }
}

const vercelConfigured = provider("vercel", {
  host: "ai-gateway.vercel.sh",
  headers: { authorization: "Bearer real-gateway-key" },
})
const compatConfigured = provider("compat", {
  host: "models.internal.example",
  headers: { authorization: "Bearer real-compat-key" },
})
// `compat.egress()` returns null when OPENAI_COMPATIBLE_API_KEY is unset — the
// exact condition the issue calls out for skipping `opencode-compat`.
const compatUnconfigured = provider("compat", null)

describe("opencode catalog selection", () => {
  it("installs opencode-gateway when the Vercel gateway provider is brokerable", () => {
    const { installable, skipped } = selectHarnesses("opencode-gateway", [
      vercelConfigured,
    ])

    expect(installable.map((h) => h.key)).toEqual(["opencode-gateway"])
    expect(skipped).toEqual([])
  })

  it("installs opencode-compat when the OpenAI-compatible provider is brokerable", () => {
    const { installable, skipped } = selectHarnesses("opencode-compat", [
      compatConfigured,
    ])

    expect(installable.map((h) => h.key)).toEqual(["opencode-compat"])
    expect(skipped).toEqual([])
  })

  it("skips opencode-compat (non-fatal) when OPENAI_COMPATIBLE_API_KEY is unset", () => {
    const { installable, skipped } = selectHarnesses("opencode-compat", [
      compatUnconfigured,
    ])

    expect(installable).toEqual([])
    expect(skipped).toHaveLength(1)
    expect(skipped[0]!.key).toBe("opencode-compat")
    expect(skipped[0]!.reason).toContain("compat")
  })

  it("skips opencode-gateway when its broker provider is absent", () => {
    const { installable, skipped } = selectHarnesses("opencode-gateway", [
      compatConfigured,
    ])

    expect(installable).toEqual([])
    expect(skipped[0]!.key).toBe("opencode-gateway")
  })

  it("both opencode descriptors install opencode and broker through OpenAI-protocol providers", () => {
    expect(opencodeGatewayHarness.installPackage).toBe("opencode-ai")
    expect(opencodeCompatHarness.installPackage).toBe("opencode-ai")
    expect(opencodeGatewayHarness.brokerProviderKey).toBe("vercel")
    expect(opencodeCompatHarness.brokerProviderKey).toBe("compat")
  })
})

describe("buildBrokeredEnv for opencode slots", () => {
  it("emits a dummy gate var + the gateway endpoint override, never a real key", () => {
    const env = buildBrokeredEnv([opencodeGatewayHarness])

    expect(env).toEqual({
      AI_GATEWAY_API_KEY: BROKERED_VALUE,
      OPENCODE_GATEWAY_BASE_URL: "https://ai-gateway.vercel.sh/v1",
    })
    expect(Object.values(env)).not.toContain("real-gateway-key")
  })

  it("emits opencode-compat's dummy gate var alongside its base-url override env", () => {
    const env = buildBrokeredEnv([opencodeCompatHarness])

    expect(env.OPENAI_COMPATIBLE_API_KEY).toBe(BROKERED_VALUE)
    // The endpoint override is passed through under its own env name; the value
    // is deployment-specific (read from OPENAI_COMPATIBLE_BASE_URL), so only the
    // presence of the override key is asserted here.
    expect(env).toHaveProperty("OPENAI_COMPATIBLE_BASE_URL")
  })
})

describe("opencodeConfigJson", () => {
  it("points the openai-compatible adapter at the slot's endpoint via env refs", () => {
    const config = JSON.parse(
      opencodeConfigJson({
        providerId: "gateway",
        providerLabel: "Vercel AI Gateway",
        baseUrlEnv: "OPENCODE_GATEWAY_BASE_URL",
        apiKeyEnv: "AI_GATEWAY_API_KEY",
        defaultModel: "gateway/anthropic/claude-sonnet-4-6",
      }),
    )

    expect(config.provider.gateway.npm).toBe("@ai-sdk/openai-compatible")
    expect(config.provider.gateway.options.baseURL).toBe(
      "{env:OPENCODE_GATEWAY_BASE_URL}",
    )
    // The API key is an env ref to the dummy gate var — never a real secret.
    expect(config.provider.gateway.options.apiKey).toBe(
      "{env:AI_GATEWAY_API_KEY}",
    )
    expect(config.model).toBe("gateway/anthropic/claude-sonnet-4-6")
  })

  it("omits the default model when the slot's endpoint fronts unknown models", () => {
    const config = JSON.parse(
      opencodeConfigJson({
        providerId: "compat",
        providerLabel: "OpenAI-compatible",
        baseUrlEnv: "OPENAI_COMPATIBLE_BASE_URL",
        apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
      }),
    )

    expect(config.provider.compat.options.baseURL).toBe(
      "{env:OPENAI_COMPATIBLE_BASE_URL}",
    )
    expect(config.provider.compat.options.apiKey).toBe(
      "{env:OPENAI_COMPATIBLE_API_KEY}",
    )
    expect(config).not.toHaveProperty("model")
  })
})

describe("seedOpencode", () => {
  it("writes opencode.json + AGENTS.md under the provider-supplied ~/.config/opencode", async () => {
    const calls: RecordedCall[] = []
    await opencodeGatewayHarness.seed(fakeSandbox(calls))

    const configCall = calls.find((c) => c.env?.OPENCODE_CONFIG)
    expect(configCall).toBeDefined()
    expect(configCall!.args.at(-1)).toContain(
      '"/home/agent/.config/opencode/opencode.json"',
    )
    // The seeded config points opencode at the slot's endpoint via env refs.
    const config = JSON.parse(configCall!.env!.OPENCODE_CONFIG!)
    expect(config.provider.gateway.options.baseURL).toBe(
      "{env:OPENCODE_GATEWAY_BASE_URL}",
    )

    const agentsCall = calls.find((c) => c.env?.OPENCODE_AGENTS_MD)
    expect(agentsCall).toBeDefined()
    expect(agentsCall!.args.at(-1)).toContain(
      '"/home/agent/.config/opencode/AGENTS.md"',
    )
  })

  it("seeds the always-commit-and-push rule into the home-level AGENTS.md, not the repo root", async () => {
    const calls: RecordedCall[] = []
    await opencodeCompatHarness.seed(fakeSandbox(calls))

    const agentsMd = calls.find((c) => c.env?.OPENCODE_AGENTS_MD)!.env!
      .OPENCODE_AGENTS_MD!
    expect(agentsMd).toContain("always commit and push")
    expect(agentsMd).toContain("git push")

    const wrote = calls.map((c) => c.args.join(" ")).join("\n")
    expect(wrote).toContain("/home/agent/.config/opencode/AGENTS.md")
    expect(wrote).not.toContain("/workspace/repo/AGENTS.md")
  })
})

describe("harnessLaunchArgv for opencode slots", () => {
  it("returns opencode's launch argv for both keys", () => {
    expect(harnessLaunchArgv("opencode-gateway")).toEqual(["opencode"])
    expect(harnessLaunchArgv("opencode-compat")).toEqual(["opencode"])
  })

  it("returns null for an unknown harness key", () => {
    expect(harnessLaunchArgv("nope")).toBeNull()
  })
})
