import { describe, expect, it, vi } from "vitest"

import type { HostBinaryProber } from "@/lib/agent/harnesses/host-binary"
import { HARNESSES } from "@/lib/agent/harnesses/index"
import {
  resolveHarnessSetupCommandsFor,
  resolveHarnessSetupStatuses,
} from "@/lib/agent/harnesses/setup-status"
import type {
  Harness,
  HarnessProcessRunner,
  HostFacts,
} from "@/lib/agent/harnesses/types"
import { CLAUDE_CODE_INSTALL_PACKAGE } from "@/lib/agent/harnesses/claude-code"
import { CODEX_INSTALL_PACKAGE } from "@/lib/agent/harnesses/codex"
import { OPENCODE_INSTALL_PACKAGE } from "@/lib/agent/harnesses/opencode"

/**
 * The live setup-status fold (ADR 0015) reads host presence + each descriptor's
 * own auth probe **fresh on every call** (no launch memo — that freshness is the
 * point), and collapses the catalog to **one row per distinct `hostBinary`**.
 * Both seams are injected so the fold runs against fakes.
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

describe("resolveHarnessSetupStatuses (live setup-status fold)", () => {
  it("collapses the catalog to one row per distinct hostBinary, in catalog order", async () => {
    const rows = await resolveHarnessSetupStatuses(
      HARNESSES,
      fakeProbe(["claude", "codex", "opencode"]),
      signedOutRunner
    )

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

  it("collapses the two opencode slots to one opencode row driven by opencode's own auth probe", async () => {
    // Both opencode-gateway and opencode-compat share hostBinary "opencode", so
    // the fold must emit a single row (the #658 panel's observable collapse),
    // keyed on the binary, with opencode's own probeAuth deciding its auth fact.
    const rows = await resolveHarnessSetupStatuses(
      HARNESSES,
      fakeProbe(["opencode"]),
      opencodeAuthedRunner
    )

    const opencodeRows = rows.filter((r) => r.hostBinary === "opencode")
    expect(opencodeRows).toHaveLength(1)
    expect(opencodeRows[0]).toMatchObject({
      key: "opencode-gateway",
      hostBinary: "opencode",
      installed: true,
      authenticated: true,
    })
  })

  it("probes a descriptor's own login only when its binary is installed", async () => {
    const rows = await resolveHarnessSetupStatuses(
      HARNESSES,
      fakeProbe(["claude"]),
      authedRunner
    )

    const claude = rows.find((r) => r.hostBinary === "claude")!
    expect(claude).toMatchObject({ installed: true, authenticated: true })
    // An uninstalled binary is never auth-probed — authenticated is null (moot).
    const codex = rows.find((r) => r.hostBinary === "codex")!
    expect(codex).toMatchObject({ installed: false, authenticated: null })
  })

  it("reports a signed-out install as installed-but-not-authed", async () => {
    const rows = await resolveHarnessSetupStatuses(
      HARNESSES,
      fakeProbe(["claude"]),
      signedOutRunner
    )

    expect(rows.find((r) => r.hostBinary === "claude")).toMatchObject({
      installed: true,
      authenticated: false,
    })
  })

  it("reports authenticated: null for an installed harness with no probeAuth", async () => {
    // Every catalog harness now carries its own probeAuth (#660 gave opencode
    // one), so exercise the probe-less path with a descriptor whose probeAuth is
    // stripped: on presence alone the fold must report `null` ("can't tell"),
    // never a false "connected".
    const opencode = HARNESSES.find((h) => h.hostBinary === "opencode")!
    const probeless: Harness = { ...opencode, probeAuth: undefined }

    const rows = await resolveHarnessSetupStatuses(
      [probeless],
      fakeProbe(["opencode"]),
      authedRunner
    )

    expect(rows.find((r) => r.hostBinary === "opencode")).toMatchObject({
      installed: true,
      authenticated: null,
    })
  })

  it("reads fresh every call — a second call re-probes the host (no memo)", async () => {
    const probe = fakeProbe(["claude"])

    await resolveHarnessSetupStatuses(HARNESSES, probe, authedRunner)
    const afterFirst = probe.mock.calls.length
    await resolveHarnessSetupStatuses(HARNESSES, probe, authedRunner)

    // The second call re-probes every distinct binary — the setup surface reads
    // live, never the launch-memoized resolver.
    expect(probe.mock.calls.length).toBe(afterFirst * 2)
  })
})

/**
 * The setup terminal commands (ADR 0015), resolved through the same path the
 * `resolveHarnessSetupCommands` server action runs: each real catalog
 * descriptor's `buildInstallCommand` against host facts, chained into its
 * `authCommand` in one `sh -c`. Every host-facts variant a harness branches on
 * (npm / brew / release binary / vendor installer) is covered.
 */
describe("resolveHarnessSetupCommandsFor (install → sign-in chaining)", () => {
  /** Host facts from the branch inputs; nothing present, arm64 by default. */
  function facts(partial: Partial<HostFacts> = {}): HostFacts {
    return { npmPresent: false, brewPresent: false, arch: "arm64", ...partial }
  }

  function harness(key: string): Harness {
    return HARNESSES.find((h) => h.key === key)!
  }

  /** The chained `sh -c` script for a harness on the given host. */
  async function script(key: string, host: HostFacts): Promise<string> {
    const cmds = await resolveHarnessSetupCommandsFor(
      harness(key),
      async () => host
    )
    const argv = cmds!.installAndAuth!
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

  it("returns each harness's own sign-in as the bare auth-only argv", async () => {
    const authOnly = async (key: string) =>
      (await resolveHarnessSetupCommandsFor(harness(key), async () => facts()))!
        .authOnly

    expect(await authOnly("claude-code")).toEqual(["claude", "/login"])
    expect(await authOnly("codex")).toEqual(["codex", "login"])
    expect(await authOnly("opencode-gateway")).toEqual([
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

  it("has no install chain, and probes no host facts, without an install builder", async () => {
    const hostFacts = vi.fn(async () => facts())
    const noInstall: Harness = {
      ...harness("codex"),
      buildInstallCommand: undefined,
    }

    expect(await resolveHarnessSetupCommandsFor(noInstall, hostFacts)).toEqual({
      installAndAuth: null,
      authOnly: ["codex", "login"],
    })
    expect(hostFacts).not.toHaveBeenCalled()
  })

  it("resolves nothing for a harness without a sign-in command", async () => {
    const noAuth: Harness = { ...harness("codex"), authCommand: undefined }
    expect(
      await resolveHarnessSetupCommandsFor(noAuth, async () => facts())
    ).toBeNull()
  })
})
