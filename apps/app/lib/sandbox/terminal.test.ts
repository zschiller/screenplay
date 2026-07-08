import { createHmac } from "crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  SandboxCommandResult,
  SandboxInstance,
  SandboxProvider,
} from "@/lib/sandbox/types"

// The terminal action resolves the live instance through the provider seam. A
// fake provider — scripted, no real VM — stands in for Vercel Sandbox so we
// exercise the real action + runner code path. `vi.hoisted` lets the mock
// factory close over mutable holders we rescript per test.
const fake = vi.hoisted(() => {
  let instance: SandboxInstance | null = null
  let getError: unknown = null
  const provider: SandboxProvider = {
    get: vi.fn(async () => {
      if (getError) throw getError
      if (!instance) throw new Error("test did not set a fake sandbox instance")
      return instance
    }),
    create: vi.fn(async () => {
      throw new Error("create not used by the terminal action")
    }),
  }
  return {
    provider,
    setInstance: (i: SandboxInstance) => {
      instance = i
      getError = null
    },
    setGetError: (e: unknown) => {
      getError = e
      instance = null
    },
  }
})

vi.mock("@/lib/sandbox", () => ({ sandboxProvider: fake.provider }))

import { TERMINAL_PORT } from "@/lib/sandbox/provision-internals"
import { selectTerminalAccessStrategy } from "@/lib/sandbox/terminal-access"
import { ensureTerminal, killTerminalSession } from "@/lib/sandbox/terminal"
import { tmuxSessionName } from "@/lib/terminal/session"

// Stand-in for the `bearer` terminal-access strategy: `ensureTerminal` now
// delegates the URL to a resolver run against the live instance, so these tests
// pass the same `domain(TERMINAL_PORT)` resolution the shipped default uses.
// The strategy seam itself is covered by `terminal-access.test.ts`; here we only
// need the daemon-launch behavior, so a minimal bearer-shaped resolver keeps the
// URL assertions meaningful.
const bearerResolve = (sandbox: SandboxInstance) =>
  Promise.resolve({ url: sandbox.domain(TERMINAL_PORT) })

type Scripted = { exitCode: number; stdout?: string; stderr?: string }
type Issued = { cmd: string; args: string[]; detached: boolean }

/**
 * Builds a fake {@link SandboxInstance} whose `runCommand` is scripted by
 * `respond(cmd, args)` and which records every command issued (with its
 * `detached` flag) into `issued`. Only the surface the action touches is
 * implemented; everything else throws so an accidental dependency is loud.
 */
function fakeSandbox(
  respond: (cmd: string, args: string[]) => Scripted = () => ({ exitCode: 0 }),
  /** Port seam override; identity (the hosted behavior) by default. */
  hostPort: (port: number) => number = (port) => port
): { sandbox: SandboxInstance; issued: Issued[] } {
  const issued: Issued[] = []
  const notUsed = (name: string) => () => {
    throw new Error(`fake sandbox: ${name} should not be called`)
  }
  const runCommand = (cmdOrOpts: unknown, maybeArgs?: string[]) => {
    const cmd =
      typeof cmdOrOpts === "string"
        ? cmdOrOpts
        : (cmdOrOpts as { cmd: string }).cmd
    const args =
      typeof cmdOrOpts === "string"
        ? (maybeArgs ?? [])
        : ((cmdOrOpts as { args?: string[] }).args ?? [])
    const detached =
      typeof cmdOrOpts === "string"
        ? false
        : Boolean((cmdOrOpts as { detached?: boolean }).detached)
    issued.push({ cmd, args, detached })
    const scripted = respond(cmd, args)
    const result: SandboxCommandResult = {
      exitCode: scripted.exitCode,
      stdout: async () => scripted.stdout ?? "",
      stderr: async () => scripted.stderr ?? "",
      logs: notUsed("logs") as never,
      kill: async () => {},
    }
    return Promise.resolve(result)
  }
  const sandbox: SandboxInstance = {
    name: "fake-sandbox",
    worktreePath: "/vercel/sandbox",
    homeDir: "/home/vercel-sandbox",
    domain: (port: number) => `https://fake-${hostPort(port)}.example.com`,
    hostPort,
    runCommand: runCommand as SandboxInstance["runCommand"],
    writeFiles: notUsed("writeFiles") as never,
    readFileToBuffer: notUsed("readFileToBuffer") as never,
    delete: async () => {},
  }
  return { sandbox, issued }
}

// The action probes whether a daemon is already running by reading the stdout
// of its check command, and probes the sandbox architecture (`uname -m`) to
// pick the ttyd asset. These scripts model the running/stopped outcomes and
// report an x86_64 sandbox for the arch probe.
const REPORTS_RUNNING = (cmd: string, args: string[]): Scripted =>
  isArchProbe(args)
    ? { exitCode: 0, stdout: "x86_64\n" }
    : isCheck(args)
      ? { exitCode: 0, stdout: "running\n" }
      : { exitCode: 0 }
const REPORTS_STOPPED = (cmd: string, args: string[]): Scripted =>
  isArchProbe(args)
    ? { exitCode: 0, stdout: "x86_64\n" }
    : isCheck(args)
      ? { exitCode: 0, stdout: "stopped\n" }
      : { exitCode: 0 }

/** The liveness probe is the one command that inspects the pidfile. */
function isCheck(args: string[]): boolean {
  return args.some((a) => a.includes("kill -0"))
}

/** The architecture probe is the one command that runs `uname -m`. */
function isArchProbe(args: string[]): boolean {
  return args.some((a) => a.includes("uname -m"))
}

/** The ttyd install is the step that curls the binary into /tmp/screenplay. */
function isTtydInstall(issued: Issued): boolean {
  const cmd = script(issued)
  return cmd.includes("/tmp/screenplay/ttyd") && cmd.includes("curl")
}

/** The tmux install is the step that curls + extracts the tarball. */
function isTmuxInstall(issued: Issued): boolean {
  const cmd = script(issued)
  return cmd.includes("/tmp/screenplay/tmux") && cmd.includes("curl")
}

/** The launch is the one detached command that spawns the daemon under setsid. */
function isLaunch(issued: Issued): boolean {
  return issued.detached && issued.args.some((a) => a.includes("setsid"))
}

/** The single command string of an issued `sh -c …` invocation. */
function script(issued: Issued): string {
  return issued.args.join(" ")
}

// `launchTerminal` reads the terminal-access strategy at call time, which folds
// over TERMINAL_AUTH (+ TERMINAL_AUTH_SECRET for the `ttyd-credential` secret).
// Save/restore both so a strategy-switching test can't leak into the bearer ones.
let savedAuth: string | undefined
let savedSecret: string | undefined
beforeEach(() => {
  vi.clearAllMocks()
  savedAuth = process.env.TERMINAL_AUTH
  savedSecret = process.env.TERMINAL_AUTH_SECRET
})
afterEach(() => {
  if (savedAuth === undefined) delete process.env.TERMINAL_AUTH
  else process.env.TERMINAL_AUTH = savedAuth
  if (savedSecret === undefined) delete process.env.TERMINAL_AUTH_SECRET
  else process.env.TERMINAL_AUTH_SECRET = savedSecret
})

describe("ensureTerminal", () => {
  it("launches the daemon and returns its forwarded-port URL", async () => {
    const { sandbox, issued } = fakeSandbox(REPORTS_STOPPED)
    fake.setInstance(sandbox)

    const result = await ensureTerminal("sandbox-a", bearerResolve)

    expect(result).toEqual({
      success: true,
      value: { url: `https://fake-${TERMINAL_PORT}.example.com` },
    })
    // The daemon wasn't running, so the action launched it.
    expect(issued.some(isLaunch)).toBe(true)
  })

  it("reuses a running daemon without launching a duplicate", async () => {
    const { sandbox, issued } = fakeSandbox(REPORTS_RUNNING)
    fake.setInstance(sandbox)

    const result = await ensureTerminal("sandbox-a", bearerResolve)

    // Same URL comes back…
    expect(result).toEqual({
      success: true,
      value: { url: `https://fake-${TERMINAL_PORT}.example.com` },
    })
    // …but no second daemon was started.
    expect(issued.some(isLaunch)).toBe(false)
  })

  it("provisions a static tmux binary (the base image ships none)", async () => {
    const { sandbox, issued } = fakeSandbox(REPORTS_RUNNING)
    fake.setInstance(sandbox)

    await ensureTerminal("sandbox-a", bearerResolve)

    // One install step fetches the tmux tarball and extracts the binary.
    const install = issued.find(isTmuxInstall)
    expect(install).toBeDefined()
    expect(script(install!)).toContain("tmux-builds")
    expect(script(install!)).toContain("tar -xzf")
    // Idempotent: a present binary short-circuits the download.
    expect(script(install!)).toContain("[ -x /tmp/screenplay/tmux ]")
  })

  it("launches ttyd with --url-arg and tmux attach-or-create as its command", async () => {
    const { sandbox, issued } = fakeSandbox(REPORTS_STOPPED)
    fake.setInstance(sandbox)

    await ensureTerminal("sandbox-a", bearerResolve)

    const launch = issued.find(isLaunch)
    expect(launch).toBeDefined()
    const cmd = script(launch!)
    // --url-arg lets each client append its per-tab session name as ?arg=…
    expect(cmd).toContain("--url-arg")
    // Base command is the bundled tmux attaching-or-creating a named session,
    // with `-u` forcing UTF-8 so box-drawing glyphs aren't mangled and `-f`
    // loading the config that hides the status bar.
    expect(cmd).toContain(
      "/tmp/screenplay/tmux -u -f /tmp/screenplay/tmux.conf new -A -s"
    )
    // The status bar is disabled via that config file.
    expect(cmd).toContain("set -g status off")
    // Under the default `bearer` posture the daemon stays unauthenticated —
    // byte-for-byte today's command, no `--credential`.
    expect(cmd).not.toContain("--credential")
  })

  describe("under ttyd-credential", () => {
    // The daemon's `--credential` and the client's `basicAuth` are the same
    // per-Sandbox secret, HMAC'd under TERMINAL_AUTH_SECRET over the Sandbox name.
    const SECRET = "test-terminal-auth-secret"
    const expectedCredential = (sandboxName: string) =>
      `screenplay:${createHmac("sha256", SECRET)
        .update(sandboxName)
        .digest("base64url")}`

    it("launches ttyd with a --credential and returns the matching basicAuth", async () => {
      process.env.TERMINAL_AUTH = "ttyd-credential"
      process.env.TERMINAL_AUTH_SECRET = SECRET
      const { sandbox, issued } = fakeSandbox(REPORTS_STOPPED)
      fake.setInstance(sandbox)

      // Exercise the real configured strategy end-to-end, so the launch arg and
      // the resolved response are asserted against one source of truth.
      const result = await ensureTerminal("sandbox-a", (s) =>
        selectTerminalAccessStrategy().resolve({
          sandbox: s,
          credential: { token: "decorative", expiresAt: 0 },
          binding: { roomId: "r", sessionId: "s" },
        })
      )

      const launch = issued.find(isLaunch)
      expect(launch).toBeDefined()
      // The daemon enforces the per-Sandbox secret on the WS handshake…
      expect(script(launch!)).toContain(
        `--credential '${expectedCredential("fake-sandbox")}'`
      )
      // …and the client is handed exactly that secret as `basicAuth`, alongside
      // the same public URL as `bearer`.
      expect(result).toEqual({
        success: true,
        value: {
          url: `https://fake-${TERMINAL_PORT}.example.com`,
          basicAuth: expectedCredential("fake-sandbox"),
        },
      })
    })
  })

  it("binds the daemon to its resolved port on a port-mapped backend", async () => {
    // Local-backend-shaped seam: the daemon must listen on the resolved port —
    // the same one `domain(TERMINAL_PORT)` advertises — so each open Branch's
    // Terminal Tab attaches to its own Sandbox's daemon instead of all of them
    // fighting over the logical 7681.
    const { sandbox, issued } = fakeSandbox(
      REPORTS_STOPPED,
      (port) => port + 50000
    )
    fake.setInstance(sandbox)

    const result = await ensureTerminal("sandbox-a", bearerResolve)

    const launch = issued.find(isLaunch)
    expect(script(launch!)).toContain(`--port ${TERMINAL_PORT + 50000}`)
    expect(result).toEqual({
      success: true,
      value: { url: `https://fake-${TERMINAL_PORT + 50000}.example.com` },
    })
  })

  it("keeps the daemon's output out of the shared sandbox log", async () => {
    const { sandbox, issued } = fakeSandbox(REPORTS_STOPPED)
    fake.setInstance(sandbox)

    await ensureTerminal("sandbox-a", bearerResolve)

    const launch = issued.find(isLaunch)
    expect(launch).toBeDefined()
    const cmd = script(launch!)
    // ttyd's connection/diagnostic chatter lands in its own terminal log…
    expect(cmd).toContain("/tmp/screenplay/fake-sandbox/terminal.log")
    // …never the sandbox log the logs tab streams.
    expect(cmd).not.toContain("/tmp/screenplay/fake-sandbox/sandbox.log")
  })

  it.each([
    ["x86_64", "ttyd.x86_64", "ttyd.aarch64"],
    ["aarch64", "ttyd.aarch64", "ttyd.x86_64"],
  ])(
    "downloads the ttyd asset matching the sandbox arch (%s)",
    async (arch, expectedAsset, otherAsset) => {
      // Report the sandbox arch for `uname -m`; daemon already running so the
      // run reduces to the install steps.
      const { sandbox, issued } = fakeSandbox((cmd, args) =>
        isArchProbe(args)
          ? { exitCode: 0, stdout: `${arch}\n` }
          : isCheck(args)
            ? { exitCode: 0, stdout: "running\n" }
            : { exitCode: 0 }
      )
      fake.setInstance(sandbox)

      await ensureTerminal("sandbox-a", bearerResolve)

      const install = issued.find(isTtydInstall)
      expect(install).toBeDefined()
      const cmd = script(install!)
      expect(cmd).toContain(`/releases/download/1.7.7/${expectedAsset}`)
      // Not the hardcoded-x86_64 bug: the other arch's asset never leaks in.
      expect(cmd).not.toContain(otherAsset)
    }
  )

  it.each([
    // tmux-builds names the arm asset `arm64`, NOT the `uname -m` `aarch64`, so
    // this proves the machine→asset translation, not just an identity copy.
    ["x86_64", "tmux-3.6b-linux-x86_64.tar.gz", "arm64"],
    ["aarch64", "tmux-3.6b-linux-arm64.tar.gz", "aarch64"],
  ])(
    "downloads the tmux asset matching the sandbox arch (%s)",
    async (arch, expectedAsset, otherToken) => {
      const { sandbox, issued } = fakeSandbox((cmd, args) =>
        isArchProbe(args)
          ? { exitCode: 0, stdout: `${arch}\n` }
          : isCheck(args)
            ? { exitCode: 0, stdout: "running\n" }
            : { exitCode: 0 }
      )
      fake.setInstance(sandbox)

      await ensureTerminal("sandbox-a", bearerResolve)

      const install = issued.find(isTmuxInstall)
      expect(install).toBeDefined()
      const cmd = script(install!)
      expect(cmd).toContain(expectedAsset)
      // The other arch's token (incl. the wrong `aarch64`/`arm64` naming) never leaks in.
      expect(cmd).not.toContain(otherToken)
    }
  )

  it("fails (redacted) rather than defaulting to x86_64 on an unknown arch", async () => {
    const { sandbox, issued } = fakeSandbox((cmd, args) =>
      isArchProbe(args)
        ? { exitCode: 0, stdout: "riscv64\n" }
        : isCheck(args)
          ? { exitCode: 0, stdout: "running\n" }
          : { exitCode: 0 }
    )
    fake.setInstance(sandbox)

    const result = await ensureTerminal("sandbox-a", bearerResolve)

    expect(result.success).toBe(false)
    // The unsupported arch short-circuits before any binary download is attempted.
    expect(issued.some(isTtydInstall)).toBe(false)
    expect(issued.some(isTmuxInstall)).toBe(false)
  })

  it("yields a fresh shell on a rebuilt sandbox rather than erroring", async () => {
    // A rebuilt VM (the old sandbox was reclaimed) boots from a snapshot of the
    // filesystem but with no running processes — so the ttyd daemon is gone and
    // its tmux session with it. The liveness probe therefore reports "stopped".
    const { sandbox, issued } = fakeSandbox(REPORTS_STOPPED)
    fake.setInstance(sandbox)

    const result = await ensureTerminal("sandbox-rebuilt", bearerResolve)

    // No error surfaces — reconnect transparently re-provisions the daemon…
    expect(result.success).toBe(true)
    // …re-fetching the bundled binaries the fresh image lacks…
    expect(
      issued.some(
        (i) =>
          script(i).includes("/tmp/screenplay/tmux") &&
          script(i).includes("curl")
      )
    ).toBe(true)
    // …and relaunching ttyd with tmux attach-or-create, so the operator lands in
    // a fresh working shell (the `-A` creates the session the rebuilt VM lacks).
    const launch = issued.find(isLaunch)
    expect(launch).toBeDefined()
    expect(script(launch!)).toContain(
      "/tmp/screenplay/tmux -u -f /tmp/screenplay/tmux.conf new -A -s"
    )
  })

  it("returns a redacted failure when a step fails, without spilling a token", async () => {
    const token = "ghp_0123456789abcdefABCDEF0123456789abcd"
    // The install step exits non-zero with a token in its stderr.
    const { sandbox } = fakeSandbox(() => ({
      exitCode: 1,
      stderr: `curl: (22) auth failed using token ${token}`,
    }))
    fake.setInstance(sandbox)

    const result = await ensureTerminal("sandbox-a", bearerResolve)

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).not.toContain(token)
    expect(result.error).toContain("[REDACTED]")
  })
})

describe("killTerminalSession", () => {
  it("kills the tab's namespaced tmux session, tolerating a missing one", async () => {
    const { sandbox, issued } = fakeSandbox()
    fake.setInstance(sandbox)

    const result = await killTerminalSession("sandbox-a", "tab-1")

    expect(result).toEqual({ success: true, value: undefined })
    const kill = issued.find((i) => script(i).includes("kill-session"))
    expect(kill).toBeDefined()
    const cmd = script(kill!)
    expect(cmd).toContain(`kill-session -t ${tmuxSessionName("tab-1")}`)
    expect(cmd).toContain("/tmp/screenplay/tmux")
    // `|| true` keeps closing an already-ended tab from failing.
    expect(cmd).toContain("|| true")
  })

  it("surfaces a redacted failure when the kill step errors", async () => {
    const token = "ghp_0123456789abcdefABCDEF0123456789abcd"
    const { sandbox } = fakeSandbox(() => ({
      exitCode: 1,
      stderr: `boom ${token}`,
    }))
    fake.setInstance(sandbox)

    const result = await killTerminalSession("sandbox-a", "tab-1")

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).not.toContain(token)
    expect(result.error).toContain("[REDACTED]")
  })
})
