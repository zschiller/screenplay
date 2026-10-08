import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getPreviewExposure, loopbackExposure } from "@/lib/preview-exposure"
import type {
  SandboxCommandResult,
  SandboxInstance,
  SandboxRunCommandOptions,
} from "@/lib/sandbox/types"

/**
 * The preview exposure these tests run with: what each test sets, else the
 * select module's own pick. A fork's exposure replaces the select module, so
 * the tests stand in for it here.
 */
const exposure = vi.hoisted(() => ({
  current: null as import("@/lib/preview-exposure").PreviewExposure | null,
}))
vi.mock("@/lib/preview-exposure", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/preview-exposure")>()
  return {
    ...actual,
    getPreviewExposure: () => exposure.current ?? actual.getPreviewExposure(),
  }
})

function setPreviewExposure(
  next: import("@/lib/preview-exposure").PreviewExposure
): void {
  exposure.current = next
}

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

  it("binds loopback, and hands browsers the exposed origin", async () => {
    setPreviewExposure({
      // A fork's exposure, serving each port at its own origin.
      expose: async (port) => ({
        browserOrigin: `https://${port}-box.tailnet.example`,
      }),
      release: async () => {},
    })
    const launches: SandboxRunCommandOptions[] = []
    fake.sandbox = fakeSandbox(launches)

    const result = await ensureFrameStream("sandbox-a", 3000)

    expect(launches[0]!.env).toMatchObject({
      SCREENPLAY_STREAM_PORT: String(STREAM_HOST_PORT),
      SCREENPLAY_STREAM_HOST: "127.0.0.1",
    })
    expect(result).toEqual({
      success: true,
      value: {
        url: `wss://${STREAM_HOST_PORT}-box.tailnet.example`,
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
