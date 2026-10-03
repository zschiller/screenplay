import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The in-process engine binds to the model providers at import time; stub the
// resolution that would otherwise demand real API keys.
vi.mock("@/lib/agent/providers", () => ({
  resolveLanguageModel: () => ({}),
}))

// The external path resolves the Branch's worktree through the sandbox seam.
const get = vi.fn(async ({ name }: { name: string }) => ({
  name,
  worktreePath: `/work/${name}`,
}))
vi.mock("@/lib/sandbox", () => ({
  sandboxProvider: { get: (o: { name: string }) => get(o) },
}))

// Native session resume reads/writes the chat's stored ACP session id, and a
// stale-model fallback reconciles the stored `model`. Mock the persistence seam
// so this unit doesn't reach the db.
const getAcpSessionId = vi.fn(
  async (_chatId: string): Promise<string | null> => null
)
const setAcpSessionId = vi.fn(async (_chatId: string, _id: string) => {})
const setChatModel = vi.fn(async (_chatId: string, _model: string) => {})
// The model the chat's last turn ran on (null: none yet, the env default).
const getChatModel = vi.fn(
  async (_chatId: string): Promise<string | null> => null
)
vi.mock("@/lib/agent/persistence", () => ({
  getAcpSessionId: (chatId: string) => getAcpSessionId(chatId),
  getChatModel: (chatId: string) => getChatModel(chatId),
  setAcpSessionId: (chatId: string, id: string) => setAcpSessionId(chatId, id),
  setChatModel: (chatId: string, model: string) => setChatModel(chatId, model),
}))

// Capture which harness key the external engine is wired to spawn, without
// reaching the real adapter resolver / subprocess spawn.
const factoryConfig = vi.fn<(config: { harnessKey: string }) => void>()
vi.mock("./spawn-session-factory", () => ({
  SpawnAcpSessionFactory: class {
    constructor(config: { harnessKey: string }) {
      factoryConfig(config)
    }
  },
}))

// The Coordinator's MCP server is served by the local build only.
const localMode = vi.hoisted(() => ({ isLocalBuild: false }))
vi.mock("@/lib/local-mode", () => localMode)

// The Coordinator's folder is created on disk; keep it out of the home dir.
const ensureCoordinatorFolder = vi.fn(
  async (roomId: string) => `/coordinator/${roomId}`
)
vi.mock("@/lib/agent/coordinator-mcp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent/coordinator-mcp")>()),
  ensureCoordinatorFolder: (roomId: string) => ensureCoordinatorFolder(roomId),
}))

import { resolveCoordinatorToken } from "@/lib/agent/coordinator-mcp"
import { savedFileSections } from "@/lib/files/context-folder"
import { createFiles, memoryFileIndex, type Files } from "@/lib/files/files"
import { memoryFileStore } from "@/lib/files/store"
import { savedSkillSections } from "@/lib/skills/on-disk"
import { createSavedSkills, type SavedSkills } from "@/lib/skills/saved"
import { ExternalEngine, type ExternalEngineConfig } from "./acp-engine"
import { inProcessEngine } from "./in-process-engine"
import {
  ACP_HARNESS_ENV_VAR,
  ENGINE_ENV_VAR,
  acpHarnessFromEnv,
  engineChoiceFromEnv,
  resolveLiveEngine,
  toolNamingForTurn,
} from "./resolve-live-engine"

/** The in-Harness model the engine applies in-session when it opens a session. */
function engineModelId(engine: unknown): string | undefined {
  return (engine as { config: { modelId?: string } }).config.modelId
}

/**
 * Engine selection is minimal and explicit (ADR 0006): one per-deployment env
 * var, default `in-process`, no per-Chat-Session column.
 */
describe("engineChoiceFromEnv", () => {
  it("defaults to in-process when AGENT_ENGINE is unset", () => {
    expect(engineChoiceFromEnv({})).toBe("in-process")
  })

  it("selects external on the explicit value", () => {
    expect(engineChoiceFromEnv({ [ENGINE_ENV_VAR]: "external" })).toBe(
      "external"
    )
  })

  it("treats an unrecognised value as the default, never a silent swap", () => {
    expect(engineChoiceFromEnv({ [ENGINE_ENV_VAR]: "External" })).toBe(
      "in-process"
    )
    expect(engineChoiceFromEnv({ [ENGINE_ENV_VAR]: "" })).toBe("in-process")
  })
})

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
    getChatModel.mockReset()
    getChatModel.mockImplementation(async () => null)
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

  // Switching models mid-chat: a model of the same Harness resumes its session
  // (the new model is applied to it); another Harness's starts a fresh one.
  it("resumes the stored session when the chat switches model within its Harness", async () => {
    process.env[ENGINE_ENV_VAR] = "external"
    getChatModel.mockImplementation(async () => "harness:claude-code:opus")
    await resolveLiveEngine({
      sandboxName: "branch-7",
      chatId: "chat-9",
      model: "harness:claude-code:sonnet",
    })
    expect(getAcpSessionId).toHaveBeenCalledWith("chat-9")
  })

  it("starts a fresh session when the chat switches to another Harness", async () => {
    process.env[ENGINE_ENV_VAR] = "external"
    getChatModel.mockImplementation(async () => "harness:claude-code:opus")
    const engine = await resolveLiveEngine({
      sandboxName: "branch-7",
      chatId: "chat-9",
      model: "harness:codex:gpt-6-astra",
    })
    expect(getAcpSessionId).not.toHaveBeenCalled()
    expect(factoryConfig).toHaveBeenCalledWith({ harnessKey: "codex" })
    expect(engineModelId(engine)).toBe("gpt-6-astra")
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
    const engine = await resolveLiveEngine({
      sandboxName: "branch-7",
      model: "anthropic:claude-sonnet-4-6",
    })
    expect(factoryConfig).toHaveBeenCalledWith({ harnessKey: "claude-code" })
    expect(engineModelId(engine)).toBeUndefined()
  })

  // Per-chat *model* selection (#526, AC#1): the stored id's `:<modelId>` half
  // is parsed alongside the key and handed to the engine, which applies it
  // in-session. Codex takes it that way too now, not on its spawn argv (#1271).
  it("hands the chat's `harness:<key>:<modelId>` model to the engine, not the spawn", async () => {
    process.env[ENGINE_ENV_VAR] = "external"
    const engine = await resolveLiveEngine({
      sandboxName: "branch-7",
      model: "harness:codex:gpt-6-astra",
    })
    expect(factoryConfig).toHaveBeenCalledWith({ harnessKey: "codex" })
    expect(engineModelId(engine)).toBe("gpt-6-astra")
  })

  it("keeps a model id with colons intact (split on the first colon only)", async () => {
    process.env[ENGINE_ENV_VAR] = "external"
    const engine = await resolveLiveEngine({
      sandboxName: "branch-7",
      model: "harness:claude-code:vendor:opus:4.6",
    })
    expect(factoryConfig).toHaveBeenCalledWith({ harnessKey: "claude-code" })
    expect(engineModelId(engine)).toBe("vendor:opus:4.6")
  })

  it("threads no model id for a bare `harness:<key>` (Harness default)", async () => {
    process.env[ENGINE_ENV_VAR] = "external"
    const engine = await resolveLiveEngine({
      sandboxName: "branch-7",
      model: "harness:claude-code",
    })
    expect(factoryConfig).toHaveBeenCalledWith({ harnessKey: "claude-code" })
    expect(engineModelId(engine)).toBeUndefined()
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

  // The Coordinator on a desktop harness (#903).
  describe("for the Coordinator chat", () => {
    type Config = {
      cwd?: string
      mcpServers?: {
        type?: string
        name: string
        url?: string
        headers?: { name: string; value: string }[]
      }[]
      sessionMeta?: Record<string, unknown>
    }
    const configOf = (engine: unknown) => (engine as { config: Config }).config

    afterEach(() => {
      localMode.isLocalBuild = false
      ensureCoordinatorFolder.mockClear()
    })

    it("runs in the Room's own folder and gets its tools over MCP", async () => {
      process.env[ENGINE_ENV_VAR] = "external"
      localMode.isLocalBuild = true
      const config = configOf(
        await resolveLiveEngine({ chatId: "room-chat-r1" })
      )

      expect(ensureCoordinatorFolder).toHaveBeenCalledWith("r1")
      expect(config.cwd).toBe("/coordinator/r1")
      const [server] = config.mcpServers!
      expect(server).toMatchObject({
        type: "http",
        name: "screenplay",
        url: expect.stringMatching(
          /^http:\/\/127\.0\.0\.1:\d+\/api\/agent\/mcp$/
        ),
      })
      const auth = server!.headers!.find((h) => h.name === "Authorization")
      expect(resolveCoordinatorToken(auth!.value)).toEqual({
        roomId: "r1",
        chatId: "room-chat-r1",
      })
      expect(config.sessionMeta).toEqual({
        claudeCode: { options: { allowedTools: ["mcp__screenplay__*"] } },
      })
    })

    it("keeps one token per chat across turns", async () => {
      process.env[ENGINE_ENV_VAR] = "external"
      localMode.isLocalBuild = true
      const first = configOf(
        await resolveLiveEngine({ chatId: "room-chat-r2" })
      )
      const second = configOf(
        await resolveLiveEngine({ chatId: "room-chat-r2" })
      )
      expect(second.mcpServers).toEqual(first.mcpServers)
    })

    it("passes no MCP server outside the local build, which has no route", async () => {
      process.env[ENGINE_ENV_VAR] = "external"
      const config = configOf(
        await resolveLiveEngine({ chatId: "room-chat-r1" })
      )
      expect(config.mcpServers).toBeUndefined()
      expect(ensureCoordinatorFolder).not.toHaveBeenCalled()
    })

    it("gives a Workspace chat its worktree and its dev server's tools", async () => {
      process.env[ENGINE_ENV_VAR] = "external"
      localMode.isLocalBuild = true
      const config = configOf(
        await resolveLiveEngine({
          sandboxName: "branch-7",
          chatId: "chat-9",
          roomId: "r1",
        })
      )
      expect(config.cwd).toBe("/work/branch-7")
      expect(ensureCoordinatorFolder).not.toHaveBeenCalled()
      const auth = config.mcpServers![0]!.headers!.find(
        (h) => h.name === "Authorization"
      )
      expect(resolveCoordinatorToken(auth!.value)).toEqual({
        roomId: "r1",
        chatId: "chat-9",
        sandboxName: "branch-7",
      })
      expect(config.sessionMeta).toEqual({
        claudeCode: { options: { allowedTools: ["mcp__screenplay__*"] } },
      })
    })

    it("passes a Workspace chat no MCP server outside the local build", async () => {
      process.env[ENGINE_ENV_VAR] = "external"
      const config = configOf(
        await resolveLiveEngine({
          sandboxName: "branch-7",
          chatId: "chat-9",
          roomId: "r1",
        })
      )
      expect(config.mcpServers).toBeUndefined()
      expect(config.sessionMeta).toBeUndefined()
    })
  })
})

/**
 * Files on disk for coding agents (#1524), at the turn-launch seam: the
 * engine the launcher resolves for a Workspace chat on a fake sandbox writes
 * the canvas's and the sender's saved files into the chat's context folder
 * before each session opens, and hands the agent that folder, never anything
 * inside the checkout.
 */
describe("resolveLiveEngine — context folder", () => {
  const originalEngine = process.env[ENGINE_ENV_VAR]
  const originalFilesDir = process.env.LOCAL_FILES_DIR
  let root: string
  let worktree: string
  let canvas: Files
  let account: Files

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "context-seam-"))
    worktree = join(root, "worktrees", "branch-7")
    await mkdir(worktree, { recursive: true })
    process.env[ENGINE_ENV_VAR] = "external"
    process.env.LOCAL_FILES_DIR = join(root, "app-data", "files")
    get.mockImplementation(async ({ name }) => ({
      name,
      worktreePath: worktree,
    }))
    const scope = (keyPrefix: string) =>
      createFiles({
        index: memoryFileIndex(),
        store: memoryFileStore(),
        keyPrefix,
      })
    canvas = scope("canvas/room-1")
    account = scope("account/u1")
  })
  afterEach(async () => {
    if (originalEngine === undefined) delete process.env[ENGINE_ENV_VAR]
    else process.env[ENGINE_ENV_VAR] = originalEngine
    if (originalFilesDir === undefined) delete process.env.LOCAL_FILES_DIR
    else process.env.LOCAL_FILES_DIR = originalFilesDir
    get.mockReset()
    get.mockImplementation(async ({ name }) => ({
      name,
      worktreePath: `/work/${name}`,
    }))
    await rm(root, { recursive: true, force: true })
  })

  const author = { addedBy: "agent", addedById: "chat-1" } as const
  const save = (files: Files, path: string, text: string) =>
    files.save({
      path,
      bytes: new TextEncoder().encode(text),
      fallbackMediaType: "text/plain",
      author,
    })

  /** The engine's context folder settings, as a turn would get them. */
  async function contextOf(opts: {
    account: Files | null
    chatId?: string
  }): Promise<
    Pick<ExternalEngineConfig, "additionalDirectories" | "prepareContext">
  > {
    const engine = await resolveLiveEngine({
      sandboxName: "branch-7",
      chatId: "chatId" in opts ? opts.chatId : "chat-1",
      roomId: "room-1",
      contextSections: () => savedFileSections(canvas, opts.account),
    })
    return (engine as unknown as { config: ExternalEngineConfig }).config
  }

  async function tree(dir: string): Promise<string[]> {
    const items = await readdir(dir, { recursive: true, withFileTypes: true })
    return items
      .map((i) => join(i.parentPath, i.name).slice(dir.length + 1))
      .sort()
  }

  it("writes canvas and account files outside the checkout and hands the agent the folder", async () => {
    await save(canvas, "research/notes.md", "# Notes")
    await save(account, "voice.md", "plain copy")

    const config = await contextOf({ account })
    const folder = join(root, "app-data", "agent-context", "chat-1")
    expect(config.additionalDirectories).toEqual([folder])
    await config.prepareContext!()

    expect(await tree(folder)).toEqual([
      "account",
      "account/voice.md",
      "canvas",
      "canvas/research",
      "canvas/research/notes.md",
    ])
    expect(await readFile(join(folder, "account/voice.md"), "utf8")).toBe(
      "plain copy"
    )
    expect(await readdir(worktree)).toEqual([])
  })

  it("drops deleted and moved files on the next turn", async () => {
    await save(canvas, "a.md", "one")
    await save(canvas, "b.md", "two")
    await (
      await contextOf({ account })
    ).prepareContext!()

    await canvas.remove("a.md")
    await canvas.move("b.md", "kept/b.md")
    await (
      await contextOf({ account })
    ).prepareContext!()

    const folder = join(root, "app-data", "agent-context", "chat-1")
    expect(await tree(folder)).toEqual([
      "account",
      "canvas",
      "canvas/kept",
      "canvas/kept/b.md",
    ])
  })

  it("leaves out account files on a turn nobody sent", async () => {
    await save(account, "voice.md", "plain copy")
    await (
      await contextOf({ account: null })
    ).prepareContext!()

    const folder = join(root, "app-data", "agent-context", "chat-1")
    expect(await tree(folder)).toEqual(["canvas"])
  })

  it("hands over no folder that would sit inside the checkout", async () => {
    process.env.LOCAL_FILES_DIR = join(worktree, ".screenplay", "files")

    const config = await contextOf({ account })

    expect(config.additionalDirectories).toBeUndefined()
    expect(config.prepareContext).toBeUndefined()
  })

  it("hands over no folder without a chat to key it on", async () => {
    const config = await contextOf({ account, chatId: undefined })

    expect(config.additionalDirectories).toBeUndefined()
  })
  /** A Skill scope over in-memory fakes. */
  const skillScope = (keyPrefix: string) =>
    createSavedSkills({
      index: memoryFileIndex(),
      store: memoryFileStore(),
      keyPrefix,
    })
  const skillMd = (name: string, body = "Step one.") =>
    `---\nname: ${name}\ndescription: Do ${name}.\n---\n${body}`

  /** The engine's context folder with the saved Skills too, as a turn gets it (#1559). */
  async function skillsContextOf(opts: {
    canvasSkills: SavedSkills
    accountSkills: SavedSkills | null
    repoSkills?: string[]
  }) {
    const engine = await resolveLiveEngine({
      sandboxName: "branch-7",
      chatId: "chat-1",
      roomId: "room-1",
      contextSections: () => ({
        ...savedFileSections(canvas, account),
        ...savedSkillSections({
          canvas: opts.canvasSkills,
          account: opts.accountSkills,
          shadowed: async () => opts.repoSkills ?? [],
        }),
      }),
    })
    return (engine as unknown as { config: ExternalEngineConfig }).config
  }

  it("writes canvas and account skills where Claude Code and Codex load them", async () => {
    const canvasSkills = skillScope("canvas/room-1/skills")
    const accountSkills = skillScope("account/u1/skills")
    await canvasSkills.save({
      name: "review",
      content: skillMd("review"),
      files: [{ path: "references/checklist.md", content: "- tests" }],
      author,
    })
    await accountSkills.save({
      name: "voice",
      content: skillMd("voice", "Plain words."),
      author,
    })

    const config = await skillsContextOf({ canvasSkills, accountSkills })
    const folder = join(root, "app-data", "agent-context", "chat-1")
    expect(config.additionalDirectories).toEqual([folder])
    await config.prepareContext!()

    for (const harness of [".claude", ".agents"]) {
      expect(
        (await tree(join(folder, harness))).filter((p) => p.endsWith(".md"))
      ).toEqual([
        "skills/review/SKILL.md",
        "skills/review/references/checklist.md",
        "skills/voice/SKILL.md",
      ])
    }
    expect(
      await readFile(join(folder, ".claude/skills/voice/SKILL.md"), "utf8")
    ).toBe(skillMd("voice", "Plain words."))
    expect(await readdir(worktree)).toEqual([])
  })

  it("drops a deleted skill on the next turn", async () => {
    const canvasSkills = skillScope("canvas/room-1/skills")
    await canvasSkills.save({ name: "a", content: skillMd("a"), author })
    await canvasSkills.save({ name: "b", content: skillMd("b"), author })
    await (
      await skillsContextOf({ canvasSkills, accountSkills: null })
    ).prepareContext!()

    await canvasSkills.remove("a")
    await (
      await skillsContextOf({ canvasSkills, accountSkills: null })
    ).prepareContext!()

    const folder = join(root, "app-data", "agent-context", "chat-1")
    expect(await readdir(join(folder, ".claude/skills"))).toEqual(["b"])
    expect(await readdir(join(folder, ".agents/skills"))).toEqual(["b"])
  })

  it("writes the winning skill once: repository, then canvas, then account", async () => {
    const canvasSkills = skillScope("canvas/room-1/skills")
    const accountSkills = skillScope("account/u1/skills")
    await canvasSkills.save({
      name: "ship",
      content: skillMd("ship", "Canvas way."),
      author,
    })
    await canvasSkills.save({ name: "lint", content: skillMd("lint"), author })
    await accountSkills.save({
      name: "ship",
      content: skillMd("ship", "My way."),
      author,
    })

    await (
      await skillsContextOf({
        canvasSkills,
        accountSkills,
        repoSkills: ["lint"],
      })
    ).prepareContext!()

    const folder = join(root, "app-data", "agent-context", "chat-1")
    expect(await readdir(join(folder, ".claude/skills"))).toEqual(["ship"])
    expect(
      await readFile(join(folder, ".agents/skills/ship/SKILL.md"), "utf8")
    ).toBe(skillMd("ship", "Canvas way."))
  })
})

describe("toolNamingForTurn", () => {
  afterEach(() => {
    localMode.isLocalBuild = false
  })
  const external = { [ENGINE_ENV_VAR]: "external" }

  it("names tools bare on the in-process engine", () => {
    localMode.isLocalBuild = true
    expect(
      toolNamingForTurn("harness:claude-code", {}).name("read_skill")
    ).toBe("read_skill")
  })

  it("names tools bare where no MCP server is served", () => {
    expect(
      toolNamingForTurn("harness:claude-code", external).name("read_skill")
    ).toBe("read_skill")
  })

  it("names tools the way the turn's harness exposes them", () => {
    localMode.isLocalBuild = true
    expect(
      toolNamingForTurn("harness:claude-code", external).name("read_skill")
    ).toBe("mcp__screenplay__read_skill")
    // No stored harness: the env default, Claude Code.
    expect(toolNamingForTurn(undefined, external).name("read_skill")).toBe(
      "mcp__screenplay__read_skill"
    )
    const codex = toolNamingForTurn("harness:codex", external)
    expect(codex.name("read_skill")).toBe("read_skill")
    expect(codex.note).toContain("`screenplay`")
  })
})
