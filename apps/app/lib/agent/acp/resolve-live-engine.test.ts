import { afterEach, describe, expect, it, vi } from "vitest"

// The in-process engine binds to the model providers at import time; stub the
// resolution that would otherwise demand real API keys (mirrors engine-select.test).
vi.mock("@/lib/agent/providers", () => ({
  resolveLanguageModel: () => ({}),
}))

// The external path resolves the Branch's worktree through the sandbox seam.
const get = vi.fn(async ({ name }: { name: string }) => ({
  name,
  worktreePath: `/work/${name}`,
}))
vi.mock("@/lib/sandbox", () => ({ sandboxProvider: { get: (o: { name: string }) => get(o) } }))

// Native session resume reads/writes the chat's stored ACP session id, and a
// stale-model fallback reconciles the stored `model`. Mock the persistence seam
// so this unit doesn't reach the db.
const getAcpSessionId = vi.fn(async (_chatId: string): Promise<string | null> => null)
const setAcpSessionId = vi.fn(async (_chatId: string, _id: string) => {})
const setChatModel = vi.fn(async (_chatId: string, _model: string) => {})
vi.mock("@/lib/agent/persistence", () => ({
  getAcpSessionId: (chatId: string) => getAcpSessionId(chatId),
  setAcpSessionId: (chatId: string, id: string) => setAcpSessionId(chatId, id),
  setChatModel: (chatId: string, model: string) => setChatModel(chatId, model),
}))

// Capture which harness key + model the external engine is wired to spawn,
// without reaching the real adapter resolver / subprocess spawn.
const factoryConfig =
  vi.fn<(config: { harnessKey: string; modelId?: string }) => void>()
vi.mock("./spawn-session-factory", () => ({
  SpawnAcpSessionFactory: class {
    constructor(config: { harnessKey: string; modelId?: string }) {
      factoryConfig(config)
    }
  },
}))

import { ENGINE_ENV_VAR } from "./engine-select"
import { ExternalEngine } from "./acp-engine"
import { inProcessEngine } from "./in-process-engine"
import {
  ACP_HARNESS_ENV_VAR,
  acpHarnessFromEnv,
  resolveLiveEngine,
} from "./resolve-live-engine"

describe("acpHarnessFromEnv", () => {
  it("defaults to claude-code when unset, empty, or whitespace", () => {
    expect(acpHarnessFromEnv({})).toBe("claude-code")
    expect(acpHarnessFromEnv({ [ACP_HARNESS_ENV_VAR]: "" })).toBe("claude-code")
    expect(acpHarnessFromEnv({ [ACP_HARNESS_ENV_VAR]: "  " })).toBe(
      "claude-code"
    )
  })

  it("uses the configured harness key", () => {
    expect(acpHarnessFromEnv({ [ACP_HARNESS_ENV_VAR]: "codex" })).toBe("codex")
  })
})

describe("resolveLiveEngine", () => {
  const original = process.env[ENGINE_ENV_VAR]
  afterEach(() => {
    if (original === undefined) delete process.env[ENGINE_ENV_VAR]
    else process.env[ENGINE_ENV_VAR] = original
    get.mockClear()
    getAcpSessionId.mockClear()
    setAcpSessionId.mockClear()
    setChatModel.mockClear()
    factoryConfig.mockClear()
  })

  it("returns the in-process engine by default — no sandbox lookup", async () => {
    delete process.env[ENGINE_ENV_VAR]
    const engine = await resolveLiveEngine({ sandboxName: "s1" })
    expect(engine).toBe(inProcessEngine)
    expect(get).not.toHaveBeenCalled()
  })

  it("builds an external engine over the sandbox's worktree when AGENT_ENGINE=external", async () => {
    process.env[ENGINE_ENV_VAR] = "external"
    const engine = await resolveLiveEngine({ sandboxName: "branch-7" })
    expect(engine).toBeInstanceOf(ExternalEngine)
    expect(engine.id).toBe("external")
    expect(get).toHaveBeenCalledWith({ name: "branch-7" })
  })

  it("builds an external engine without a worktree for a sandbox-less (layer) chat", async () => {
    process.env[ENGINE_ENV_VAR] = "external"
    const engine = await resolveLiveEngine({})
    expect(engine).toBeInstanceOf(ExternalEngine)
    expect(get).not.toHaveBeenCalled()
  })

  it("reads the chat's stored ACP session id to wire native resume", async () => {
    process.env[ENGINE_ENV_VAR] = "external"
    await resolveLiveEngine({ sandboxName: "branch-7", chatId: "chat-9" })
    expect(getAcpSessionId).toHaveBeenCalledWith("chat-9")
  })

  it("does not touch the persistence seam without a chatId", async () => {
    process.env[ENGINE_ENV_VAR] = "external"
    await resolveLiveEngine({ sandboxName: "branch-7" })
    expect(getAcpSessionId).not.toHaveBeenCalled()
  })

  // Per-chat harness selection (#479): the chat's stored `model` picks the
  // adapter the external engine spawns; the engine choice itself stays the
  // build-time env decision.
  it("spawns the adapter named by the chat's `harness:` model id", async () => {
    process.env[ENGINE_ENV_VAR] = "external"
    await resolveLiveEngine({ sandboxName: "branch-7", model: "harness:codex" })
    expect(factoryConfig).toHaveBeenCalledWith({ harnessKey: "codex" })
  })

  it("falls back to SCREENPLAY_ACP_HARNESS when no model id is stored", async () => {
    process.env[ENGINE_ENV_VAR] = "external"
    process.env[ACP_HARNESS_ENV_VAR] = "codex"
    try {
      await resolveLiveEngine({ sandboxName: "branch-7" })
      expect(factoryConfig).toHaveBeenCalledWith({ harnessKey: "codex" })
    } finally {
      delete process.env[ACP_HARNESS_ENV_VAR]
    }
  })

  it("ignores a `provider:` model id, falling back to the env default", async () => {
    process.env[ENGINE_ENV_VAR] = "external"
    // A provider id never selects (or reconfigures) the external engine — the
    // adapter stays the default rather than the engine treating it as a harness.
    await resolveLiveEngine({
      sandboxName: "branch-7",
      model: "anthropic:claude-sonnet-4-6",
    })
    expect(factoryConfig).toHaveBeenCalledWith({
      harnessKey: "claude-code",
      modelId: undefined,
    })
  })

  // Per-chat *model* selection (#526, AC#1): the stored id's `:<modelId>` half
  // is parsed alongside the key and threaded to the spawn factory, so a
  // spawn-applied adapter (codex's `--model`) gets it on the argv.
  it("threads the chat's `harness:<key>:<modelId>` model to the spawn factory", async () => {
    process.env[ENGINE_ENV_VAR] = "external"
    await resolveLiveEngine({
      sandboxName: "branch-7",
      model: "harness:codex:gpt-5.5",
    })
    expect(factoryConfig).toHaveBeenCalledWith({
      harnessKey: "codex",
      modelId: "gpt-5.5",
    })
  })

  it("keeps a model id with colons intact (split on the first colon only)", async () => {
    process.env[ENGINE_ENV_VAR] = "external"
    await resolveLiveEngine({
      sandboxName: "branch-7",
      model: "harness:claude-code:vendor:opus:4.6",
    })
    expect(factoryConfig).toHaveBeenCalledWith({
      harnessKey: "claude-code",
      modelId: "vendor:opus:4.6",
    })
  })

  it("threads no model id for a bare `harness:<key>` (Harness default)", async () => {
    process.env[ENGINE_ENV_VAR] = "external"
    await resolveLiveEngine({
      sandboxName: "branch-7",
      model: "harness:claude-code",
    })
    expect(factoryConfig).toHaveBeenCalledWith({
      harnessKey: "claude-code",
      modelId: undefined,
    })
  })

  // The reconcile callback (#526, story #6): a stale-model fallback rewrites the
  // stored `model` to the resolved id re-encoded under the same Harness key.
  it("reconciles a resolved model back to the chat's stored id under its harness key", async () => {
    process.env[ENGINE_ENV_VAR] = "external"
    // The resolver returns a real ExternalEngine; read the reconcile callback off
    // the config it was built with and invoke it as the session would on a
    // stale-model fallback.
    const engine = (await resolveLiveEngine({
      sandboxName: "branch-7",
      chatId: "chat-9",
      model: "harness:claude-code:sonnet",
    })) as ExternalEngine
    const reconcile = (
      engine as unknown as {
        config: { reconcileModel?: (m: string) => unknown }
      }
    ).config.reconcileModel
    expect(reconcile).toBeTypeOf("function")
    await reconcile!("default")
    expect(setChatModel).toHaveBeenCalledWith(
      "chat-9",
      "harness:claude-code:default"
    )
  })

  it("wires no reconcile callback for a chat with no id to key on", async () => {
    process.env[ENGINE_ENV_VAR] = "external"
    const engine = (await resolveLiveEngine({
      sandboxName: "branch-7",
      model: "harness:claude-code:sonnet",
    })) as ExternalEngine
    const reconcile = (
      engine as unknown as {
        config: { reconcileModel?: (m: string) => unknown }
      }
    ).config.reconcileModel
    expect(reconcile).toBeUndefined()
  })
})
