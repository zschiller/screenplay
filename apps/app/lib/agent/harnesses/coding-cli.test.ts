import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest"

// `engine-contract` reaches the run-state machine, which binds to the live
// Drizzle handle at import time; stub the db boundary (mirrors contract.test.ts).
vi.mock("@/lib/db", () => ({ db: {} }))

/**
 * The CLIs these tests run the host with: what each test picks, else the
 * select module's own pick. A fork's own CLI replaces the select module, so
 * the tests stand in for it here.
 */
const picked = vi.hoisted(() => ({
  current: null as import("./types").HostHarness[] | null,
}))
vi.mock("./coding-cli", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./coding-cli")>()
  return {
    ...actual,
    selectCodingClis: (env?: Record<string, string | undefined>) =>
      picked.current ?? actual.selectCodingClis(env),
  }
})

import { ExternalEngine } from "../acp/acp-engine"
import { AcpUpdateConsumer } from "../acp/consumer"
import type { AcpScript } from "../acp/engine-contract"
import type { AcpMessageRecord } from "../acp/record"
import { textBlock } from "../acp/schema"
import { SpawnAcpSessionFactory } from "../acp/spawn-session-factory"
import { resolveAcpLaunch } from "./acp-launch"
import {
  createDesktopResolver,
  createHostedResolver,
  harnessModels,
} from "./availability"
import {
  checkKeys,
  codingCliHarness,
  selectCodingClis,
  type CodingCli,
} from "./coding-cli"
import { HARNESSES, harnessToolNaming, hostCatalog } from "./index"
import { claudeCodeHarness } from "./claude-code"
import { opencodeHostHarness } from "./opencode"
import { createHarnessSetup } from "./setup"
import type { HarnessProcessRunner, HostHarness } from "./types"

const FAKE_AGENT = fileURLToPath(
  new URL("../acp/fake-acp-agent.mjs", import.meta.url)
)

const ACME = {
  key: "acme-code",
  label: "Acme Code",
  command: "acme-code",
}

/** Run the host with exactly these CLIs, as a fork's select module would. */
function pick(...harnesses: HostHarness[]): void {
  picked.current = checkKeys(harnesses)
}

/** A host where exactly `binaries` are on `PATH`. */
const onPath =
  (...binaries: string[]) =>
  async (binary: string) =>
    binaries.includes(binary)

/** A runner where every command fails, as on a host with nothing signed in. */
const failing: HarnessProcessRunner = async () => ({ exitCode: 1, stdout: "" })

afterEach(() => {
  picked.current = null
})

describe("the OpenCode built-in", () => {
  it("runs everything under the command it’s given", () => {
    const cli = opencodeHostHarness(ACME)
    expect(cli).toMatchObject({
      key: "acme-code",
      label: "Acme Code",
      hostBinary: "acme-code",
      launchArgv: ["acme-code"],
      authCommand: ["acme-code", "auth", "login"],
      acpAdapter: { command: "acme-code", args: ["acp"], plan: "reply" },
    })
    expect(cli!.modelList!.argv).toEqual(["acme-code", "models", "--verbose"])
    expect(cli!.printModel!.buildArgv("hi")).toEqual(["acme-code", "run", "hi"])
    // A fork isn’t installed from here.
    expect(cli!.buildInstallCommand).toBeUndefined()
  })

  it("is the Mac app’s OpenCode with no options", () => {
    const cli = opencodeHostHarness()
    expect(cli).toMatchObject({
      key: "opencode-gateway",
      label: "OpenCode",
      hostBinary: "opencode",
    })
    expect(cli!.buildInstallCommand).toBeDefined()
  })

  it("probes a fork’s sign-in through its own command", async () => {
    const cli = opencodeHostHarness(ACME)
    const calls: string[] = []
    const run: HarnessProcessRunner = async (cmd, args) => {
      calls.push([cmd, ...args].join(" "))
      return { exitCode: 0, stdout: "anthropic  oauth\n" }
    }
    expect(await cli!.probeAuth!(run)).toBe(true)
    expect(calls).toEqual(["acme-code auth list"])
  })

  it("leaves out model listing when the fork has none", () => {
    const cli = opencodeHostHarness({ ...ACME, listModels: false })
    expect(cli!.modelList).toBeUndefined()
  })
})

describe("selectCodingClis", () => {
  it("keeps the whole catalog with no override", () => {
    expect(selectCodingClis({})).toBeNull()
  })

  it("picks the built-ins CODING_CLIS lists, in order", () => {
    expect(
      selectCodingClis({ CODING_CLIS: "codex, claude-code" })!.map((h) => h.key)
    ).toEqual(["codex", "claude-code"])
  })

  it("refuses an id it doesn’t know, or one named twice", () => {
    expect(() => selectCodingClis({ CODING_CLIS: "acme" })).toThrow(
      /CODING_CLIS "acme" isn’t known \(known: claude-code, codex, opencode\)/
    )
    expect(() => selectCodingClis({ CODING_CLIS: "codex,codex" })).toThrow(
      /"codex" is used more than once/
    )
  })
})

describe("configured Coding CLIs", () => {
  it("list under the configured label in the model menu", async () => {
    pick(opencodeHostHarness(ACME))
    const available = await createDesktopResolver({
      probe: onPath("acme-code"),
    }).list()
    expect(harnessModels(available)).toEqual([
      {
        id: "harness:acme-code",
        label: "Acme Code",
        provider: { key: "acme-code", label: "Acme Code" },
        isDefault: true,
      },
    ])
  })

  it("show the configured label in Settings", async () => {
    pick(opencodeHostHarness(ACME))
    const rows = await createHarnessSetup({
      probe: onPath("acme-code"),
      run: failing,
      facts: async () => ({
        npmPresent: true,
        brewPresent: false,
        arch: "x64",
      }),
    }).rows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      key: "acme-code",
      label: "Acme Code",
      hostBinary: "acme-code",
      installed: true,
      choosesModels: true,
    })
  })

  it("show one default model for a CLI without model listing", async () => {
    const plain: CodingCli = {
      key: "plain",
      label: "Plain",
      command: "plain-agent",
      acp: { args: ["--acp"], modelOption: "model", promptQueueing: false },
    }
    pick(codingCliHarness(plain))
    const resolver = createDesktopResolver({ probe: onPath("plain-agent") })
    expect(harnessModels(await resolver.list())).toEqual([
      {
        id: "harness:plain",
        label: "Plain",
        provider: { key: "plain", label: "Plain" },
        isDefault: true,
      },
    ])
    const [row] = await createHarnessSetup({
      probe: onPath("plain-agent"),
      run: failing,
    }).rows()
    expect(row).toMatchObject({ choosesModels: false, authenticated: null })
    expect(resolveAcpLaunch("plain", { cwd: "/w", env: {} })).toMatchObject({
      command: "plain-agent",
      args: ["--acp"],
    })
  })

  it("replace the catalog on the host, in order", () => {
    pick(opencodeHostHarness(ACME), claudeCodeHarness)
    expect(hostCatalog().map((h) => h.key)).toEqual([
      "acme-code",
      "claude-code",
    ])
    // A key outside the configuration has no adapter on this host.
    expect(resolveAcpLaunch("codex", { cwd: "/w", env: {} })).toBeNull()
    // Tool names follow the configured CLI’s ACP details.
    expect(harnessToolNaming("acme-code", "screenplay").name("x")).toBe(
      "screenplay_x"
    )
  })

  it("refuse a bad or repeated key", () => {
    expect(() =>
      pick(opencodeHostHarness({ ...ACME, key: "acme:code" }))
    ).toThrow(/must be non-empty and contain no comma or colon/)
    expect(() =>
      pick(opencodeHostHarness(ACME), opencodeHostHarness(ACME))
    ).toThrow(/"acme-code" is used more than once/)
  })
})

describe("with nothing configured", () => {
  it("the host lists the whole catalog, as the Mac app always has", async () => {
    expect(hostCatalog()).toBe(HARNESSES)
    const available = await createDesktopResolver({
      probe: onPath("claude", "codex", "opencode"),
    }).list()
    expect(available.map(({ harness }) => harness.label)).toEqual([
      "Claude Code",
      "Codex",
      "OpenCode",
    ])
  })

  it("Hosted ignores a host configuration", async () => {
    pick(opencodeHostHarness(ACME))
    const available = await createHostedResolver({
      sandboxHarnesses: "claude-code",
      providers: [{ key: "anthropic", egress: () => ({}) } as never],
    }).list()
    expect(available.map(({ harness }) => harness.key)).toEqual(["claude-code"])
  })
})

/**
 * The OpenCode built-in under another command runs a chat: the configured
 * command is a real executable on `PATH` that starts a stub ACP agent for
 * `acp`, spawned by the production factory with nothing injected.
 */
describe("a CLI configured under another command", () => {
  let bin: string
  const factories: SpawnAcpSessionFactory[] = []

  beforeAll(async () => {
    bin = await mkdtemp(join(tmpdir(), "coding-cli-"))
    const script = join(bin, "acme-code")
    await writeFile(
      script,
      [
        "#!/bin/sh",
        `[ "$1" = acp ] || exit 2`,
        `exec "${process.execPath}" "${FAKE_AGENT}"`,
        "",
      ].join("\n")
    )
    await chmod(script, 0o755)
  })

  afterAll(async () => {
    for (const factory of factories) factory.dispose()
    await rm(bin, { recursive: true, force: true })
  })

  it("runs a chat end to end", async () => {
    pick(opencodeHostHarness(ACME))
    const script: AcpScript = {
      instructions: [
        {
          kind: "update",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: textBlock("Hello"),
          },
        },
      ],
      stopReason: "end_turn",
      threw: false,
    }
    const factory = new SpawnAcpSessionFactory({
      harnessKey: "acme-code",
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_ACP_SCRIPT: JSON.stringify(script),
      },
    })
    factories.push(factory)

    const records: AcpMessageRecord[] = []
    let completed = false
    const consumer = new AcpUpdateConsumer({
      async broadcastUpdate() {},
      async broadcastError() {},
      async broadcastEnd() {},
      async appendRecord(r) {
        records.push(r)
      },
      async upsertToolCall() {},
      async transition(to) {
        if (to === "completed") completed = true
      },
      async broadcastPermissionRequest() {},
      async pauseForPlan() {},
      async settleSteers() {},
    })
    await new ExternalEngine({ sessionFactory: factory }).run(
      {
        chatId: "chat_1",
        runId: "run_1",
        roomId: "room_1",
        systemPrompt: "sys",
        model: "harness:acme-code",
        history: [{ role: "user", content: [textBlock("hi")] }],
      },
      (u) => consumer.handle(u),
      new AbortController().signal
    )

    expect(records).toEqual([{ role: "agent", content: [textBlock("Hello")] }])
    expect(completed).toBe(true)
  })
})
