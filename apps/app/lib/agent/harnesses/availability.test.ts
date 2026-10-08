import { describe, expect, it, vi } from "vitest"

import type { ModelProvider } from "@/lib/agent/providers"
import {
  type AvailableHarness,
  createDesktopResolver,
  createHostedResolver,
  filterByCapability,
  harnessDefaultModelId,
  harnessModels,
  resolveTerminalLaunch,
} from "@/lib/agent/harnesses/availability"
import type { HostBinaryProber } from "@/lib/agent/harnesses/host-binary"
import type { Harness } from "@/lib/agent/harnesses/types"
import { claudeCodeHarness } from "@/lib/agent/harnesses/claude-code"
import { groupModelsByProvider } from "@/lib/model-selection"

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
    // The launch-memoized fold surfaces presence only; auth is `null` (the live
    // setup status probes it, not this hot path).
    expect(available[0]!.status).toEqual({
      installed: true,
      authenticated: null,
    })
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

  it("lists opencode once, as OpenCode, when its shared hostBinary is present, probing it once", async () => {
    const probe = fakeProbe(["opencode"])
    const resolver = createDesktopResolver({ probe })

    const available = await resolver.list()

    // The two hosted slots mean nothing on desktop, where the CLI rides its
    // own login: one entry, the first slot, under its desktop name (#1589).
    expect(
      available.map(({ harness }) => [harness.key, harness.label])
    ).toEqual([["opencode-gateway", "OpenCode"]])
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

    // Four distinct binaries, probed once total across both list() calls.
    expect(probedBinaries(probe).sort()).toEqual([
      "agy_acp_server.par",
      "claude",
      "codex",
      "opencode",
    ])
  })

  it("invalidate() busts the memo — the next list() re-runs the injected prober", async () => {
    const probe = fakeProbe(["claude"])
    const resolver = createDesktopResolver({ probe })

    await resolver.list()
    await resolver.list()
    // Two list()s so far share one probe of `claude` (the memo).
    expect(probedBinaries(probe).filter((b) => b === "claude")).toHaveLength(1)

    resolver.invalidate()
    await resolver.list()

    // After invalidate the next list() re-probes — the connect path's re-probe
    // (a freshly installed CLI shows up without a restart).
    expect(probedBinaries(probe).filter((b) => b === "claude")).toHaveLength(2)
  })
})

describe("filterByCapability", () => {
  it("chat keeps only harnesses with an ACP adapter; terminal keeps all", () => {
    const terminalOnly = {
      harness: { ...claudeCodeHarness, key: "shell-only", acpAdapter: null },
      status: { installed: true, authenticated: null },
    }
    const chat = {
      harness: claudeCodeHarness,
      status: { installed: true, authenticated: null },
    }
    const available = [chat, terminalOnly]

    expect(
      filterByCapability(available, "terminal").map((a) => a.harness.key)
    ).toEqual(["claude-code", "shell-only"])
    expect(
      filterByCapability(available, "chat").map((a) => a.harness.key)
    ).toEqual(["claude-code"])
  })

  it("keeps every installed desktop CLI for chat, OpenCode included (#1589)", async () => {
    const available = await createDesktopResolver({
      probe: fakeProbe(["claude", "codex", "opencode"]),
    }).list()

    expect(
      filterByCapability(available, "chat").map((a) => a.harness.key)
    ).toEqual(["claude-code", "codex", "opencode-gateway"])
  })

  it("preserves order and is a no-op for terminal on an empty list", () => {
    expect(filterByCapability([], "terminal")).toEqual([])
    expect(filterByCapability([], "chat")).toEqual([])
  })
})

/**
 * A chat-capable harness with a curated model list, for driving the per-Harness
 * grouping fold directly (no host probe) — the only fold-relevant fields are
 * `key`/`label`/`acpAdapter`/`models`/`defaultModelId`. Cast through `Harness`
 * so the test states just those, mirroring the stub providers above.
 */
function chatHarness(partial: Partial<Harness> & Pick<Harness, "key">): {
  harness: Harness
} {
  return {
    harness: {
      label: partial.key,
      acpAdapter: { command: "npx", args: [] },
      ...partial,
    } as Harness,
  }
}

describe("harnessModels (desktop arm of backend-uniform enumeration)", () => {
  it("gives each detected chat-capable Harness its own heading with its curated models nested, as harness:<key>:<modelId> entries", async () => {
    // The real catalog: claude-code and codex both ship curated model lists, so
    // each becomes its own dropdown heading with its models nested — replacing
    // the single "Installed agents" heading this fold emitted before.
    const available = await createDesktopResolver({
      probe: fakeProbe(["codex", "claude"]),
    }).list()

    const models = harnessModels(available)

    // Per-Harness headings, alphabetically, each carrying its own models —
    // exactly what the shared groupModelsByProvider fold draws in the dropdown.
    expect(
      groupModelsByProvider(models).map((g) => ({
        key: g.key,
        label: g.label,
        models: g.models.map((m) => ({ id: m.id, label: m.label })),
      }))
    ).toEqual([
      {
        key: "claude-code",
        label: "Claude Code",
        models: [
          { id: "harness:claude-code:fable", label: "Fable 5.1" },
          { id: "harness:claude-code:opus", label: "Opus 5.5" },
          { id: "harness:claude-code:sonnet", label: "Sonnet 5.5" },
          { id: "harness:claude-code:haiku", label: "Haiku 4.5" },
        ],
      },
      {
        key: "codex",
        label: "Codex",
        models: [
          { id: "harness:codex:gpt-6-astra", label: "GPT-6 Astra" },
          { id: "harness:codex:gpt-6-luna", label: "GPT-6 Luna" },
          { id: "harness:codex:gpt-5.5", label: "GPT-5.5" },
        ],
      },
    ])
    // The retired single "Installed agents" group is gone — no entry groups
    // under the old shared `harness` provider key.
    expect(models.some((m) => m.provider.key === "harness")).toBe(false)
  })

  it("degrades a Harness advertising no models to a single bare harness:<key> 'harness default' entry", async () => {
    const available: AvailableHarness[] = [
      chatHarness({ key: "modelless", label: "Modelless" }),
    ].map((h) => ({ ...h, status: { installed: true, authenticated: null } }))

    expect(harnessModels(available)).toEqual([
      {
        id: "harness:modelless",
        label: "Modelless",
        provider: { key: "modelless", label: "Modelless" },
        isDefault: true,
      },
    ])
  })

  it("lists OpenCode as one chat entry that runs its own default model (#1589)", async () => {
    const available = await createDesktopResolver({
      probe: fakeProbe(["claude", "opencode"]),
    }).list()

    const models = harnessModels(available)
    expect(groupModelsByProvider(models).map((g) => g.key)).toEqual([
      "claude-code",
      "opencode-gateway",
    ])
    // opencode's models are whatever providers the user signed in to, so
    // there's no curated list: the bare entry rides opencode's own default.
    expect(models.filter((m) => m.provider.key === "opencode-gateway")).toEqual(
      [
        {
          id: "harness:opencode-gateway",
          label: "OpenCode",
          provider: { key: "opencode-gateway", label: "OpenCode" },
          isDefault: true,
        },
      ]
    )
  })

  it("emits no models when the seam detects nothing — never a hardcoded fallback agent", async () => {
    const available = await createDesktopResolver({
      probe: fakeProbe([]),
    }).list()

    expect(harnessModels(available)).toEqual([])
  })

  it("marks each Harness's curated default, so a chat can fall back within it", async () => {
    const available = await createDesktopResolver({
      probe: fakeProbe(["codex", "claude"]),
    }).list()

    expect(
      harnessModels(available)
        .filter((m) => m.isDefault)
        .map((m) => m.id)
    ).toEqual(["harness:claude-code:opus", "harness:codex:gpt-6-astra"])
  })
})

describe("harnessDefaultModelId (desktop default fold)", () => {
  it("keeps the catalog's preference when another agent lists first alphabetically", async () => {
    const available = await createDesktopResolver({
      probe: fakeProbe(["agy_acp_server.par", "claude"]),
    }).list()

    expect(groupModelsByProvider(harnessModels(available))[0]!.key).toBe(
      "antigravity"
    )
    expect(harnessDefaultModelId(available)).toBe("harness:claude-code:opus")
  })

  it("is the first detected chat-capable Harness's curated default, encoded", async () => {
    // claude-code lists before codex in the catalog, so the overall desktop
    // default is claude-code's curated default model.
    const available = await createDesktopResolver({
      probe: fakeProbe(["codex", "claude"]),
    }).list()

    expect(harnessDefaultModelId(available)).toBe("harness:claude-code:opus")
  })

  it("ignores terminal-only harnesses — the default is the first chat-capable one", async () => {
    // opencode (terminal-only) sorts first in the catalog but can't back chat,
    // so the default comes from codex, the first chat-capable detected harness.
    const available = await createDesktopResolver({
      probe: fakeProbe(["opencode", "codex"]),
    }).list()

    expect(harnessDefaultModelId(available)).toBe("harness:codex:gpt-6-astra")
  })

  it("falls back to a bare harness:<key> when the first Harness advertises no models", () => {
    const available: AvailableHarness[] = [
      chatHarness({ key: "modelless" }),
    ].map((h) => ({ ...h, status: { installed: true, authenticated: null } }))

    expect(harnessDefaultModelId(available)).toBe("harness:modelless")
  })

  it("falls back to the first curated model when a Harness lists models but names no default", () => {
    const available: AvailableHarness[] = [
      chatHarness({
        key: "nodefault",
        models: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      }),
    ].map((h) => ({ ...h, status: { installed: true, authenticated: null } }))

    expect(harnessDefaultModelId(available)).toBe("harness:nodefault:a")
  })

  it("is null when the seam detects nothing chat-capable", async () => {
    const available = await createDesktopResolver({
      probe: fakeProbe([]),
    }).list()

    expect(harnessDefaultModelId(available)).toBeNull()
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
