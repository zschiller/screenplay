import { homedir } from "node:os"
import { describe, expect, it, vi } from "vitest"

import type { HostBinaryProber } from "@/lib/agent/harnesses/host-binary"
import { HARNESSES } from "@/lib/agent/harnesses/index"
import { abbreviateHome, createHarnessSetup } from "@/lib/agent/harnesses/setup"
import type {
  Harness,
  HarnessProcessRunner,
  HostFacts,
} from "@/lib/agent/harnesses/types"
import type { HarnessResolver } from "@/lib/agent/harnesses/availability"
import { CLAUDE_CODE_INSTALL_PACKAGE } from "@/lib/agent/harnesses/claude-code"
import { CODEX_INSTALL_PACKAGE } from "@/lib/agent/harnesses/codex"
import { OPENCODE_INSTALL_PACKAGE } from "@/lib/agent/harnesses/opencode"

/**
 * The **Harness Setup** module (ADR 0015) against a fake host: its prober and
 * process runner are injected ports, so every rule it owns — the live read, the
 * one dedupe-by-`hostBinary` rule, host facts, install → sign-in chaining, and the
 * row policy the Settings panel and first-run gate now only render — is covered
 * here without touching a real CLI or credential store.
 */

/** A prober reporting the named binaries present (a vi.fn, so probes are counted). */
function fakeProbe(present: string[]) {
  const set = new Set(present)
  return vi.fn<HostBinaryProber>(async (binary) => set.has(binary))
}

/** A runner that reports Claude's keychain credential present (→ authed). */
const authedRunner: HarnessProcessRunner = async (cmd) =>
  cmd === "security"
    ? { exitCode: 0, stdout: "secret\n" }
    : { exitCode: 1, stdout: "" }

/** A runner with no credential anywhere (→ not authed). */
const signedOutRunner: HarnessProcessRunner = async () => ({
  exitCode: 1,
  stdout: "",
})

/** A runner reporting opencode's `auth list` naming a provider (→ authed). */
const opencodeAuthedRunner: HarnessProcessRunner = async (cmd, args) =>
  cmd === "opencode" && args[0] === "auth" && args[1] === "list"
    ? { exitCode: 0, stdout: "anthropic\n" }
    : { exitCode: 1, stdout: "" }

/** Host facts from the branch inputs; nothing present, arm64 by default. */
function facts(partial: Partial<HostFacts> = {}): HostFacts {
  return { npmPresent: false, brewPresent: false, arch: "arm64", ...partial }
}

function harness(key: string): Harness {
  return HARNESSES.find((h) => h.key === key)!
}

/** A module over the real catalog and a fake host. */
function setup(
  opts: {
    present?: string[]
    run?: HarnessProcessRunner
    harnesses?: Harness[]
    probe?: ReturnType<typeof fakeProbe>
    host?: HostFacts
    availability?: HarnessResolver
  } = {}
) {
  return createHarnessSetup({
    harnesses: opts.harnesses ?? HARNESSES,
    probe: opts.probe ?? fakeProbe(opts.present ?? []),
    run: opts.run ?? signedOutRunner,
    availability: opts.availability ?? {
      list: async () => [],
      invalidate() {},
    },
    ...(opts.host ? { facts: async () => opts.host! } : {}),
  })
}

describe("rows (the live read + the dedupe rule)", () => {
  it("collapses the catalog to one row per distinct hostBinary, in catalog order", async () => {
    const rows = await setup({
      present: ["claude", "codex", "opencode"],
    }).rows()

    // The two opencode slots share one binary → a single row (opencode-gateway
    // is the representative, the first catalog entry on the binary).
    expect(rows.map((r) => r.hostBinary)).toEqual([
      "claude",
      "codex",
      "opencode",
    ])
    expect(rows.map((r) => r.key)).toEqual([
      "claude-code",
      "codex",
      "opencode-gateway",
    ])
  })

  it("drives the one opencode row from opencode's own auth probe", async () => {
    const rows = await setup({
      present: ["opencode"],
      run: opencodeAuthedRunner,
    }).rows()

    const opencodeRows = rows.filter((r) => r.hostBinary === "opencode")
    expect(opencodeRows).toHaveLength(1)
    expect(opencodeRows[0]).toMatchObject({
      key: "opencode-gateway",
      label: "OpenCode",
      hostBinary: "opencode",
      installed: true,
      authenticated: true,
    })
  })

  it("probes a descriptor's own login only when its binary is installed", async () => {
    const rows = await setup({ present: ["claude"], run: authedRunner }).rows()

    expect(rows.find((r) => r.hostBinary === "claude")).toMatchObject({
      installed: true,
      authenticated: true,
    })
    // An uninstalled binary is never auth-probed — authenticated is null (moot).
    expect(rows.find((r) => r.hostBinary === "codex")).toMatchObject({
      installed: false,
      authenticated: null,
    })
  })

  it("reports authenticated: null for an installed harness with no probeAuth", async () => {
    // Every catalog harness now carries its own probeAuth (#660 gave opencode
    // one), so exercise the probe-less path with a descriptor whose probeAuth is
    // stripped: on presence alone the row must report `null` ("can't tell"),
    // never a false "connected".
    const probeless: Harness = {
      ...harness("opencode-gateway"),
      probeAuth: undefined,
    }
    const rows = await setup({
      harnesses: [probeless],
      present: ["opencode"],
      run: authedRunner,
    }).rows()

    expect(rows[0]).toMatchObject({ installed: true, authenticated: null })
  })

  it("reads fresh every call — a second call re-probes the host (no memo)", async () => {
    const probe = fakeProbe(["claude"])
    const harnessSetup = setup({ probe, run: authedRunner })

    await harnessSetup.rows()
    const afterFirst = probe.mock.calls.length
    await harnessSetup.rows()

    // The second call re-probes every distinct binary — the setup surface reads
    // live, never the launch-memoized availability resolver.
    expect(probe.mock.calls.length).toBe(afterFirst * 2)
  })
})

describe("rows (the row policy)", () => {
  /** The claude-code row on a host with the given install/auth state. */
  async function claudeRow(present: string[], run: HarnessProcessRunner) {
    const rows = await setup({ present, run }).rows()
    return rows.find((r) => r.hostBinary === "claude")!
  }

  it("offers install-and-sign-in for a CLI that isn't installed", async () => {
    expect(await claudeRow([], authedRunner)).toMatchObject({
      installed: false,
      detection: "not-installed",
      connected: false,
      state: "Not installed",
      version: null,
      path: null,
      action: { kind: "install", label: "Install and sign in", primary: true },
    })
  })

  it("offers a primary sign-in for an installed but signed-out CLI", async () => {
    expect(await claudeRow(["claude"], signedOutRunner)).toMatchObject({
      installed: true,
      authenticated: false,
      detection: "installed-not-authed",
      connected: false,
      state: "Signed out",
      action: { kind: "auth", label: "Sign in", primary: true },
    })
  })

  it("reads a signed-in CLI as connected, offering only a secondary re-run", async () => {
    expect(await claudeRow(["claude"], authedRunner)).toMatchObject({
      authenticated: true,
      detection: "authed",
      connected: true,
      state: "Signed in",
      action: { kind: "auth", label: "Sign in again", primary: false },
    })
  })

  it("reads an installed CLI's version and PATH location for its facts line", async () => {
    const home = homedir()
    const run: HarnessProcessRunner = async (cmd, args) => {
      if (cmd === "claude" && args[0] === "--version") {
        return { exitCode: 0, stdout: "2.1.4 (Claude Code)\n" }
      }
      if (cmd === "sh" && args[2] === "claude") {
        return { exitCode: 0, stdout: `${home}/.local/bin/claude\n` }
      }
      return authedRunner(cmd, args)
    }
    expect(await claudeRow(["claude"], run)).toMatchObject({
      version: "2.1.4",
      path: "~/.local/bin/claude",
    })
  })

  it("leaves the facts out when the CLI can't say", async () => {
    expect(await claudeRow(["claude"], signedOutRunner)).toMatchObject({
      version: null,
      path: null,
    })
  })

  it("treats an indeterminate auth probe as signed out, never as connected", async () => {
    // Honest degradation: `authenticated: null` on an installed CLI offers a
    // sign-in rather than a false green row.
    const probeless: Harness = {
      ...harness("claude-code"),
      probeAuth: undefined,
    }
    const [row] = await setup({
      harnesses: [probeless],
      present: ["claude"],
    }).rows()

    expect(row).toMatchObject({
      authenticated: null,
      detection: "installed-not-authed",
      connected: false,
      action: { kind: "auth", primary: true },
    })
  })

  it("never offers sign-out or uninstall — help is one-directional", async () => {
    const rows = await setup({
      present: ["claude", "codex", "opencode"],
      run: authedRunner,
    }).rows()

    expect(rows.every((r) => r.action?.kind !== undefined)).toBe(true)
    for (const row of rows) {
      expect(["install", "auth"]).toContain(row.action!.kind)
      expect(row.action!.label).not.toMatch(/sign out|uninstall|remove/i)
    }
  })

  it("offers no action for a descriptor with no sign-in path", async () => {
    const noAuth: Harness = { ...harness("codex"), authCommand: undefined }
    const [row] = await setup({ harnesses: [noAuth], present: [] }).rows()

    expect(row).toMatchObject({ detection: "not-installed", action: null })
  })
})

/**
 * The setup terminal commands (ADR 0015), resolved exactly as the panel's action
 * click resolves them: each real catalog descriptor's `buildInstallCommand`
 * against live host facts, chained into its `authCommand` in one `sh -c`. Every
 * host-facts variant a harness branches on (npm / brew / release binary / vendor
 * installer) is covered.
 */
describe("commandsFor (install → sign-in chaining)", () => {
  /** The chained `sh -c` script for a harness on the given host. */
  async function script(key: string, host: HostFacts): Promise<string> {
    const run = await setup({ host }).commandsFor(key, "install")
    const argv = run!.command
    expect(argv.slice(0, 2)).toEqual(["sh", "-c"])
    expect(argv).toHaveLength(3)
    return argv[2]!
  }

  const cases: Array<{
    key: string
    host: HostFacts
    install: string | RegExp
    auth: string
  }> = [
    {
      key: "claude-code",
      host: facts({ npmPresent: true }),
      install: `npm install -g ${CLAUDE_CODE_INSTALL_PACKAGE}`,
      auth: "claude /login",
    },
    {
      key: "claude-code",
      host: facts(),
      install: "curl -fsSL https://claude.ai/install.sh | bash",
      auth: "claude /login",
    },
    {
      key: "codex",
      host: facts({ brewPresent: true, npmPresent: true }),
      install: "brew install codex",
      auth: "codex login",
    },
    {
      key: "codex",
      host: facts({ npmPresent: true }),
      install: `npm i -g ${CODEX_INSTALL_PACKAGE}`,
      auth: "codex login",
    },
    {
      key: "codex",
      host: facts({ arch: "arm64" }),
      install:
        /^mkdir -p "\$HOME\/\.local\/bin" && curl -fsSL \S+\/codex-aarch64-apple-darwin\.tar\.gz \| tar xz -C "\$HOME\/\.local\/bin" && mv \S+\/codex-aarch64-apple-darwin \S+\/codex && chmod \+x \S+\/codex$/,
      auth: "codex login",
    },
    {
      key: "codex",
      host: facts({ arch: "x64" }),
      install:
        /codex-x86_64-apple-darwin\.tar\.gz.*\/codex-x86_64-apple-darwin /,
      auth: "codex login",
    },
    {
      key: "opencode-gateway",
      host: facts({ npmPresent: true }),
      install: `npm install -g ${OPENCODE_INSTALL_PACKAGE}`,
      auth: "opencode auth login",
    },
    {
      key: "opencode-gateway",
      host: facts(),
      install:
        'OPENCODE_INSTALL_DIR="$HOME/.local/bin" curl -fsSL https://opencode.ai/install | bash',
      auth: "opencode auth login",
    },
  ]

  it.each(cases)(
    "$key on npm=$host.npmPresent brew=$host.brewPresent arch=$host.arch → install && $auth",
    async ({ key, host, install, auth }) => {
      const chained = await script(key, host)
      // Auth is chained after the install with && — a failed install never
      // reaches the sign-in.
      expect(chained.endsWith(` && ${auth}`)).toBe(true)
      const installPart = chained.slice(0, -` && ${auth}`.length)
      if (typeof install === "string") expect(installPart).toBe(install)
      else expect(installPart).toMatch(install)
      // No install path needs sudo.
      expect(chained).not.toMatch(/\bsudo\b/)
    }
  )

  it("derives the install's host facts from its own injected prober", async () => {
    // npm / brew presence is read through the *same* prober host detection uses —
    // the one host-facts probe — so a host with npm takes the npm path.
    const withNpm = await setup({ present: ["npm"] }).commandsFor(
      "claude-code",
      "install"
    )
    const withoutNpm = await setup({ present: [] }).commandsFor(
      "claude-code",
      "install"
    )

    expect(withNpm!.command[2]).toContain(
      `npm install -g ${CLAUDE_CODE_INSTALL_PACKAGE}`
    )
    expect(withoutNpm!.command[2]).toContain("curl -fsSL")
  })

  it("runs each harness's own sign-in verbatim for an auth action", async () => {
    const authArgv = async (key: string) =>
      (await setup({ host: facts() }).commandsFor(key, "auth"))!.command

    expect(await authArgv("claude-code")).toEqual(["claude", "/login"])
    expect(await authArgv("codex")).toEqual(["codex", "login"])
    expect(await authArgv("opencode-gateway")).toEqual([
      "opencode",
      "auth",
      "login",
    ])
  })

  it("gives both opencode slots the identical install and sign-in", async () => {
    const host = facts({ npmPresent: true })
    expect(await script("opencode-compat", host)).toBe(
      await script("opencode-gateway", host)
    )
  })

  it("narrates an install run as install-then-sign-in, an auth run as sign-in", async () => {
    const harnessSetup = setup({ host: facts() })
    expect(
      (await harnessSetup.commandsFor("codex", "install"))!.message
    ).toMatch(/^Installing Codex, then signing you in/)
    expect((await harnessSetup.commandsFor("codex", "auth"))!.message).toMatch(
      /^Signing in to Codex/
    )
  })

  it("probes no host facts, and runs the bare sign-in, without an install builder", async () => {
    const host = vi.fn(async () => facts())
    const noInstall: Harness = {
      ...harness("codex"),
      buildInstallCommand: undefined,
    }
    const harnessSetup = createHarnessSetup({
      harnesses: [noInstall],
      probe: fakeProbe([]),
      run: signedOutRunner,
      availability: { list: async () => [], invalidate() {} },
      facts: host,
    })

    expect(await harnessSetup.commandsFor("codex", "install")).toMatchObject({
      command: ["codex", "login"],
    })
    expect(host).not.toHaveBeenCalled()
  })

  it("resolves nothing for an unknown key or a harness with no sign-in command", async () => {
    const noAuth: Harness = { ...harness("codex"), authCommand: undefined }

    expect(await setup().commandsFor("nope", "auth")).toBeNull()
    expect(
      await setup({ harnesses: [noAuth] }).commandsFor("codex", "auth")
    ).toBeNull()
  })
})

describe("markConnected", () => {
  it("busts the availability memo and hands back freshly probed rows", async () => {
    const invalidate = vi.fn()
    const probe = fakeProbe(["claude"])
    const harnessSetup = setup({
      probe,
      run: authedRunner,
      availability: { list: async () => [], invalidate },
    })

    const rows = await harnessSetup.markConnected()

    // The shared launch-memoized resolver is invalidated, so the model dropdown
    // and new-tab picker re-probe on their next read — no reload, no restart.
    expect(invalidate).toHaveBeenCalledTimes(1)
    // …and the caller gets the post-connect rows from the same call.
    expect(rows.find((r) => r.hostBinary === "claude")).toMatchObject({
      installed: true,
      connected: true,
    })
    expect(probe).toHaveBeenCalledWith("claude")
  })

  it("re-probes rather than replaying the pre-connect read", async () => {
    // A CLI installed *during* the run shows up in the rows markConnected
    // returns: the probe is live, so the row flips without a reload.
    const present = new Set<string>()
    const probe = vi.fn<HostBinaryProber>(async (b) => present.has(b))
    const harnessSetup = setup({ probe, run: authedRunner })

    const before = await harnessSetup.rows()
    expect(before.find((r) => r.hostBinary === "claude")!.installed).toBe(false)

    present.add("claude")
    const after = await harnessSetup.markConnected()
    expect(after.find((r) => r.hostBinary === "claude")).toMatchObject({
      installed: true,
      detection: "authed",
    })
  })
})

describe("abbreviateHome", () => {
  it("shortens paths under home to ~ and leaves others alone", () => {
    expect(abbreviateHome("/Users/zo/.local/bin/claude", "/Users/zo")).toBe(
      "~/.local/bin/claude"
    )
    expect(abbreviateHome("/Users/zoe/bin/claude", "/Users/zo")).toBe(
      "/Users/zoe/bin/claude"
    )
    expect(abbreviateHome("/usr/local/bin/codex", "/Users/zo")).toBe(
      "/usr/local/bin/codex"
    )
  })
})

describe("readiness", () => {
  it("reports each row's install/auth pair without the facts-line probes", async () => {
    const run = vi.fn<HarnessProcessRunner>(authedRunner)
    const readiness = await setup({ present: ["claude"], run }).readiness()

    const rows = await setup({ present: ["claude"], run: authedRunner }).rows()
    expect(readiness).toEqual(
      rows.map(({ installed, authenticated }) => ({ installed, authenticated }))
    )
    // Only the auth probe ran: no `--version`, no `command -v`.
    for (const [cmd, args] of run.mock.calls) {
      expect(args[0]).not.toBe("--version")
      expect(cmd).not.toBe("sh")
    }
  })
})
