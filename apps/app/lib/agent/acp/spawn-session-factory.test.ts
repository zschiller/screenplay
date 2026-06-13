import { spawn as nodeSpawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"

// `engine-contract` reaches the run-state machine, which binds to the live
// Drizzle handle at import time; stub the db boundary (mirrors contract.test.ts).
vi.mock("@/lib/db", () => ({ db: {} }))

import { ExternalEngine } from "./acp-engine"
import {
  captureAcpScript,
  contractFor,
  type AcpScript,
} from "./engine-contract"
import type { StreamDriver } from "./in-process-engine"
import { SpawnAcpSessionFactory, type AcpSpawn } from "./spawn-session-factory"

const FAKE_AGENT = fileURLToPath(
  new URL("./fake-acp-agent.mjs", import.meta.url)
)

/**
 * The production {@link SpawnAcpSessionFactory} drives the *same* Engine contract
 * scenario the in-memory transport passes (`contractFor`), but across a **real
 * spawned subprocess** — a fake ACP-agent script that speaks genuine ACP over
 * its own stdio (issue #414, AC #3). The only injected seam is *which* binary to
 * launch: we substitute the fake agent for the real `npx @zed-industries/...`
 * adapter (no network, no CLI login), while the resolver, the ndjson stdio
 * wiring, and {@link AcpSession.open} all run for real. Both transports reaching
 * the identical observable outcome is the proof the seam is honest.
 */

// Every factory we spawn is tracked here and reaped after each test, so no
// child agent process outlives its scenario.
const spawnedFactories: SpawnAcpSessionFactory[] = []
afterEach(() => {
  for (const factory of spawnedFactories) factory.dispose()
  spawnedFactories.length = 0
})

/** Launch the fake ACP agent in place of the resolved adapter, carrying the script. */
function fakeAgentSpawn(script: AcpScript): AcpSpawn {
  return (_command, _args, options) =>
    nodeSpawn(process.execPath, [FAKE_AGENT], {
      cwd: options.cwd,
      env: {
        ...options.env,
        FAKE_ACP_SCRIPT: JSON.stringify(script),
      } as unknown as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "inherit"],
    })
}

contractFor("external (spawned subprocess)", (driver: StreamDriver) => {
  // The factory is built fresh per `open` so each turn's captured script rides
  // its own child; `open` is async, which is where the (async) capture happens.
  const sessionFactory = {
    async open(
      ports: Parameters<SpawnAcpSessionFactory["open"]>[0],
      options: Parameters<SpawnAcpSessionFactory["open"]>[1]
    ) {
      const script = await captureAcpScript(driver)
      const factory = new SpawnAcpSessionFactory({
        // A real adapter key so `resolveAcpLaunch` returns non-null; the
        // injected spawn launches the fake agent regardless of the argv.
        harnessKey: "claude-code",
        env: { PATH: process.env.PATH },
        spawn: fakeAgentSpawn(script),
      })
      spawnedFactories.push(factory)
      return factory.open(ports, options)
    },
  }
  return new ExternalEngine({ sessionFactory })
})

describe("SpawnAcpSessionFactory — resolution and lifecycle", () => {
  it("throws when the harness key has no registered ACP adapter", async () => {
    const factory = new SpawnAcpSessionFactory({
      harnessKey: "no-such-harness",
      // Never reached — resolution fails before spawning.
      spawn: () => {
        throw new Error("should not spawn")
      },
    })
    await expect(
      factory.open(
        {
          onUpdate: () => {},
          requestPlanApproval: async () => ({ approved: false }),
        },
        { cwd: "/work" }
      )
    ).rejects.toThrow(/no ACP adapter is registered/i)
  })

  it("spawns the resolved adapter with the worktree cwd and stripped env", async () => {
    let seen: {
      command: string
      cwd: string
      env: Record<string, string>
    } | null = null
    const factory = new SpawnAcpSessionFactory({
      harnessKey: "claude-code",
      env: { CLAUDECODE: "1", PATH: "/usr/bin" },
      spawn: (command, _args, options) => {
        seen = { command, cwd: options.cwd, env: options.env }
        // A real subprocess so the ndjson transport + handshake run for real.
        return nodeSpawn(process.execPath, [FAKE_AGENT], {
          cwd: options.cwd,
          env: {
            ...options.env,
            FAKE_ACP_SCRIPT: "{}",
          } as unknown as NodeJS.ProcessEnv,
          stdio: ["pipe", "pipe", "inherit"],
        })
      },
    })
    spawnedFactories.push(factory)

    await factory.open(
      {
        onUpdate: () => {},
        requestPlanApproval: async () => ({ approved: false }),
      },
      { cwd: "/" }
    )

    expect(seen!.command).toBe("npx")
    expect(seen!.cwd).toBe("/")
    // The Claude-Code session var is stripped; the rest passes through.
    expect(seen!.env.CLAUDECODE).toBeUndefined()
    expect(seen!.env.PATH).toBe("/usr/bin")
  })

  it("dispose kills the spawned child", async () => {
    let killed = false
    const factory = new SpawnAcpSessionFactory({
      harnessKey: "claude-code",
      env: { PATH: process.env.PATH },
      spawn: (_command, _args, options) => {
        const child = nodeSpawn(process.execPath, [FAKE_AGENT], {
          cwd: options.cwd,
          env: {
            ...options.env,
            FAKE_ACP_SCRIPT: "{}",
          } as unknown as NodeJS.ProcessEnv,
          stdio: ["pipe", "pipe", "inherit"],
        })
        child.on("exit", () => {
          killed = true
        })
        return child
      },
    })

    await factory.open(
      {
        onUpdate: () => {},
        requestPlanApproval: async () => ({ approved: false }),
      },
      { cwd: "/" }
    )
    factory.dispose()

    await vi.waitFor(() => expect(killed).toBe(true))
  })
})
