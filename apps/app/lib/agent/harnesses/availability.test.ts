import { describe, expect, it, vi } from "vitest"

import type { ModelProvider } from "@/lib/agent/providers"
import {
  createDesktopResolver,
  createHostedResolver,
  filterByCapability,
  harnessModels,
  INSTALLED_AGENTS_GROUP,
  resolveTerminalLaunch,
} from "@/lib/agent/harnesses/availability"
import type { HostBinaryProber } from "@/lib/agent/harnesses/host-binary"

/**
 * A stub provider whose only fold-relevant behavior is `egress()` (configured +
 * header-brokerable ⇒ non-null), so the hosted resolver lists its harness.
 * Mirrors the stub in `selection.test.ts`.
 */
function brokerableProvider(key: string): ModelProvider {
  return {
    key,
    label: key,
    isConfigured: () => true,
    listModels: async () => [],
    resolve: () => {
      throw new Error("stub provider: resolve should not be called")
    },
    egress: () => ({
      host: `api.${key}.com`,
      headers: { "x-api-key": "real" },
    }),
  }
}

/**
 * The desktop Harness Availability resolver detects installed CLIs by probing
 * each catalog descriptor's `hostBinary` on the host — no broker, no install
 * (#476). These tests drive the real catalog through a **fake prober** so the
 * fold is exercised without touching the host: given which binaries "exist", the
 * right harnesses list (with `installed` status) and the absent ones drop. The
 * sibling hosted fold lives in `selection.test.ts`.
 */

/** A prober reporting the named binaries present (a vi.fn, so probes are recorded). */
function fakeProbe(present: string[]) {
  const set = new Set(present)
  return vi.fn<HostBinaryProber>(async (binary) => set.has(binary))
}

/** The distinct sequence of binaries a fake prober was asked to probe. */
function probedBinaries(probe: ReturnType<typeof fakeProbe>): string[] {
  return probe.mock.calls.map(([binary]) => binary)
}

describe("createDesktopResolver (Harness Availability — desktop fold)", () => {
  it("lists a harness whose hostBinary the prober reports present, with installed status", async () => {
    const resolver = createDesktopResolver({ probe: fakeProbe(["claude"]) })

    const available = await resolver.list()

    expect(available.map(({ harness }) => harness.key)).toEqual(["claude-code"])
    expect(available[0]!.status).toEqual({ installed: true })
  })

  it("drops every harness when no binary is present", async () => {
    const resolver = createDesktopResolver({ probe: fakeProbe([]) })

    expect(await resolver.list()).toEqual([])
  })

  it("lists multiple detected CLIs, in catalog order", async () => {
    const resolver = createDesktopResolver({
      probe: fakeProbe(["codex", "claude"]),
    })

    const available = await resolver.list()

    // Catalog order (claude-code before codex), not probe order.
    expect(available.map(({ harness }) => harness.key)).toEqual([
      "claude-code",
      "codex",
    ])
  })

  it("lists both opencode slots when their shared hostBinary is present, probing it once", async () => {
    const probe = fakeProbe(["opencode"])
    const resolver = createDesktopResolver({ probe })

    const available = await resolver.list()

    expect(available.map(({ harness }) => harness.key)).toEqual([
      "opencode-gateway",
      "opencode-compat",
    ])
    // The two slots share one binary, so it's probed once — not per slot.
    expect(probedBinaries(probe).filter((b) => b === "opencode")).toHaveLength(
      1
    )
  })

  it("probes once per app launch — a second list() reuses the cached detection", async () => {
    const probe = fakeProbe(["claude", "codex", "opencode"])
    const resolver = createDesktopResolver({ probe })

    await resolver.list()
    await resolver.list()

    // Three distinct binaries, probed once total across both list() calls.
    expect(probedBinaries(probe).sort()).toEqual([
      "claude",
      "codex",
      "opencode",
    ])
  })
})

describe("filterByCapability", () => {
  it("chat keeps only harnesses with an ACP adapter; terminal keeps all", async () => {
    // Everything installed, so the only filter in play is the capability one.
    const resolver = createDesktopResolver({
      probe: fakeProbe(["claude", "codex", "opencode"]),
    })
    const available = await resolver.list()

    expect(
      filterByCapability(available, "terminal").map((a) => a.harness.key)
    ).toEqual(["claude-code", "codex", "opencode-gateway", "opencode-compat"])
    // The opencode slots are terminal-only (no acpAdapter) → dropped for chat.
    expect(
      filterByCapability(available, "chat").map((a) => a.harness.key)
    ).toEqual(["claude-code", "codex"])
  })

  it("preserves order and is a no-op for terminal on an empty list", () => {
    expect(filterByCapability([], "terminal")).toEqual([])
    expect(filterByCapability([], "chat")).toEqual([])
  })
})

describe("harnessModels (desktop arm of backend-uniform enumeration)", () => {
  it("emits a harness: ModelInfo per detected chat-capable CLI, grouped under Installed agents, in catalog order", async () => {
    const available = await createDesktopResolver({
      probe: fakeProbe(["codex", "claude"]),
    }).list()

    expect(harnessModels(available)).toEqual([
      {
        id: "harness:claude-code",
        label: "Claude Code",
        provider: INSTALLED_AGENTS_GROUP,
      },
      {
        id: "harness:codex",
        label: "Codex",
        provider: INSTALLED_AGENTS_GROUP,
      },
    ])
  })

  it("drops terminal-only harnesses (no ACP adapter can't back chat)", async () => {
    // The opencode slots are detected (their shared host binary is present) but
    // carry no acpAdapter, so they list in the terminal picker yet never as a
    // chat model.
    const available = await createDesktopResolver({
      probe: fakeProbe(["claude", "opencode"]),
    }).list()

    expect(harnessModels(available).map((m) => m.id)).toEqual([
      "harness:claude-code",
    ])
  })

  it("emits no models when the seam detects nothing — never a hardcoded fallback agent", async () => {
    const available = await createDesktopResolver({
      probe: fakeProbe([]),
    }).list()

    expect(harnessModels(available)).toEqual([])
  })
})

describe("resolveTerminalLaunch (terminal launch payload from the seam)", () => {
  it("resolves a picked harness key against the desktop-detected harnesses → its wrapped launch argv", async () => {
    // The desktop resolver detects `claude` on the host PATH; the tab's picked
    // key resolves to that CLI's launch command, wrapped so Ctrl-D drops to a
    // shell — the CLI runs on the user's own login (no broker, no API key).
    const available = await createDesktopResolver({
      probe: fakeProbe(["claude"]),
    }).list()

    const { harnesses, launchArgv } = resolveTerminalLaunch(
      "claude-code",
      available
    )

    expect(harnesses).toEqual([{ key: "claude-code", label: "Claude Code" }])
    expect(launchArgv).toEqual(["sh", "-c", "claude; exec $SHELL"])
  })

  it("routes both backends through the seam — the same picked key resolves identically off either resolver", async () => {
    // Hosted: SANDBOX_HARNESSES ∩ broker-egress lists claude-code.
    const hosted = await createHostedResolver({
      sandboxHarnesses: "claude-code",
      providers: [brokerableProvider("anthropic")],
    }).list()
    // Desktop: a detected `claude` host binary lists the same harness.
    const desktop = await createDesktopResolver({
      probe: fakeProbe(["claude"]),
    }).list()

    // The picked key resolves to the same launch payload regardless of which
    // backend's resolver produced the availability list — one fold, many
    // backends.
    const fromHosted = resolveTerminalLaunch("claude-code", hosted)
    const fromDesktop = resolveTerminalLaunch("claude-code", desktop)

    expect(fromHosted).toEqual(fromDesktop)
    expect(fromHosted.launchArgv).toEqual(["sh", "-c", "claude; exec $SHELL"])
  })

  it("opens a plain shell (empty argv) for a tab with no harness key", async () => {
    const available = await createDesktopResolver({
      probe: fakeProbe(["claude"]),
    }).list()

    expect(resolveTerminalLaunch(undefined, available).launchArgv).toEqual([])
    expect(resolveTerminalLaunch(null, available).launchArgv).toEqual([])
  })

  it("opens a plain shell (empty argv + empty menu) when nothing is available", () => {
    const { harnesses, launchArgv } = resolveTerminalLaunch("claude-code", [])

    expect(harnesses).toEqual([])
    expect(launchArgv).toEqual([])
  })
})
