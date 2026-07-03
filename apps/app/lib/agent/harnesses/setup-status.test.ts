import { describe, expect, it, vi } from "vitest"

import type { HostBinaryProber } from "@/lib/agent/harnesses/host-binary"
import { HARNESSES } from "@/lib/agent/harnesses/index"
import { resolveHarnessSetupStatuses } from "@/lib/agent/harnesses/setup-status"
import type { HarnessProcessRunner } from "@/lib/agent/harnesses/types"

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
    // codex is installed but carries no probeAuth in this slice → 'can't tell'.
    const rows = await resolveHarnessSetupStatuses(
      HARNESSES,
      fakeProbe(["codex"]),
      authedRunner
    )

    expect(rows.find((r) => r.hostBinary === "codex")).toMatchObject({
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
