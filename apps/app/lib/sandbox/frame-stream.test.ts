import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  getPreviewExposure,
  loopbackExposure,
  setPreviewExposure,
  urlTemplateExposure,
} from "@/lib/preview-exposure"
import type {
  SandboxCommandResult,
  SandboxInstance,
  SandboxRunCommandOptions,
} from "@/lib/sandbox/types"

const fake = vi.hoisted(() => ({ sandbox: null as unknown }))

vi.mock("@/lib/sandbox", () => ({
  sandboxProvider: { get: async () => fake.sandbox },
}))
vi.mock("@/lib/sandbox-bridge", () => ({ FRAME_STREAM_JS: "// stream" }))

import { ensureFrameStream } from "@/lib/sandbox/frame-stream"

const STREAM_HOST_PORT = 57682

function fakeSandbox(launches: SandboxRunCommandOptions[]): SandboxInstance {
  const result = (stdout = ""): SandboxCommandResult => ({
    exitCode: 0,
    stdout: async () => stdout,
    stderr: async () => "",
    logs: async function* () {},
    kill: async () => {},
  })
  const hostPort = (port: number) => port + 50000
  return {
    name: "sandbox-a",
    worktreePath: "/tmp/wt",
    homeDir: "/tmp",
    domain: (port) => `http://localhost:${hostPort(port)}`,
    internalUrl: (port) => `http://127.0.0.1:${hostPort(port)}`,
    expose: async (port) => getPreviewExposure().expose(hostPort(port)),
    hostPort,
    runCommand: (async (
      cmdOrOpts: string | SandboxRunCommandOptions,
      args?: string[]
    ) => {
      const opts =
        typeof cmdOrOpts === "string" ? { cmd: cmdOrOpts, args } : cmdOrOpts
      if (opts.detached) launches.push(opts)
      // The liveness probe: never running yet, so the service launches.
      return result(
        opts.args?.join(" ").includes("echo running") ? "stopped" : ""
      )
    }) as SandboxInstance["runCommand"],
    writeFiles: async () => {},
    readFileToBuffer: async () => null,
    delete: async () => {},
  }
}

describe("ensureFrameStream", () => {
  beforeEach(() => {
    vi.stubEnv("TERMINAL_AUTH_SECRET", "test-secret")
    vi.stubEnv("SANDBOX_BACKEND", "local")
  })

  afterEach(() => {
    setPreviewExposure(loopbackExposure())
    vi.unstubAllEnvs()
  })

  it("binds where the preview exposure says, and hands browsers the exposed origin", async () => {
    setPreviewExposure(
      urlTemplateExposure({ origin: "https://{port}-box.corp.example" })
    )
    const launches: SandboxRunCommandOptions[] = []
    fake.sandbox = fakeSandbox(launches)

    const result = await ensureFrameStream("sandbox-a", 3000)

    expect(launches[0]!.env).toMatchObject({
      SCREENPLAY_STREAM_PORT: String(STREAM_HOST_PORT),
      SCREENPLAY_STREAM_HOST: "0.0.0.0",
    })
    expect(result).toEqual({
      success: true,
      value: {
        url: `wss://${STREAM_HOST_PORT}-box.corp.example`,
        // The server's own connection stays on loopback.
        internalUrl: `ws://127.0.0.1:${STREAM_HOST_PORT}`,
      },
    })
  })

  it("stays on loopback in the Mac app", async () => {
    const launches: SandboxRunCommandOptions[] = []
    fake.sandbox = fakeSandbox(launches)

    const result = await ensureFrameStream("sandbox-a", 3000)

    expect(launches[0]!.env).toMatchObject({
      SCREENPLAY_STREAM_HOST: "127.0.0.1",
    })
    expect(result).toMatchObject({
      value: { url: `ws://localhost:${STREAM_HOST_PORT}` },
    })
  })
})
