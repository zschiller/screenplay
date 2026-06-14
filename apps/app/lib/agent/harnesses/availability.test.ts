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
import { createHarnessModelCatalog } from "@/lib/agent/harnesses/model-catalog"
import type { Harness } from "@/lib/agent/harnesses/types"
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

    const models = await harnessModels(available)

    // Per-Harness headings, in catalog order, each carrying its own models —
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
          { id: "harness:claude-code:default", label: "Default" },
          { id: "harness:claude-code:sonnet", label: "Sonnet" },
          { id: "harness:claude-code:opus", label: "Opus" },
          {
            id: "harness:claude-code:opusplan",
            label: "Opus (plan), Sonnet (execute)",
          },
          { id: "harness:claude-code:haiku", label: "Haiku" },
        ],
      },
      {
        key: "codex",
        label: "Codex",
        models: [
          { id: "harness:codex:gpt-5-codex", label: "GPT-5 Codex" },
          { id: "harness:codex:gpt-5", label: "GPT-5" },
          { id: "harness:codex:gpt-5-mini", label: "GPT-5 mini" },
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
    ].map((h) => ({ ...h, status: { installed: true } }))

    expect(await harnessModels(available)).toEqual([
      {
        id: "harness:modelless",
        label: "Modelless",
        provider: { key: "modelless", label: "Modelless" },
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

    // Only claude-code heads a group; the opencode slots never appear as chat
    // models even though the terminal picker would list them.
    expect(
      groupModelsByProvider(await harnessModels(available)).map((g) => g.key)
    ).toEqual(["claude-code"])
  })

  it("emits no models when the seam detects nothing — never a hardcoded fallback agent", async () => {
    const available = await createDesktopResolver({
      probe: fakeProbe([]),
    }).list()

    expect(await harnessModels(available)).toEqual([])
  })

  it("sources each Harness's models from the catalog — a discovered model appends after the curated floor", async () => {
    const available = await createDesktopResolver({
      probe: fakeProbe(["claude"]),
    }).list()
    // A catalog whose discovery advertises one id beyond claude-code's floor.
    const catalog = createHarnessModelCatalog({
      discover: async () => new Map([["claude-code", ["opus-4-1"]]]),
    })

    const ids = (await harnessModels(available, catalog)).map((m) => m.id)

    // Curated floor first (catalog order), the discovered alias appended last.
    expect(ids).toEqual([
      "harness:claude-code:default",
      "harness:claude-code:sonnet",
      "harness:claude-code:opus",
      "harness:claude-code:opusplan",
      "harness:claude-code:haiku",
      "harness:claude-code:opus-4-1",
    ])
  })
})

describe("harnessDefaultModelId (desktop default fold)", () => {
  it("is the first detected chat-capable Harness's curated default, encoded", async () => {
    // claude-code lists before codex in the catalog, so the overall desktop
    // default is claude-code's curated default model.
    const available = await createDesktopResolver({
      probe: fakeProbe(["codex", "claude"]),
    }).list()

    expect(harnessDefaultModelId(available)).toBe("harness:claude-code:default")
  })

  it("ignores terminal-only harnesses — the default is the first chat-capable one", async () => {
    // opencode (terminal-only) sorts first in the catalog but can't back chat,
    // so the default comes from codex, the first chat-capable detected harness.
    const available = await createDesktopResolver({
      probe: fakeProbe(["opencode", "codex"]),
    }).list()

    expect(harnessDefaultModelId(available)).toBe("harness:codex:gpt-5-codex")
  })

  it("falls back to a bare harness:<key> when the first Harness advertises no models", () => {
    const available: AvailableHarness[] = [
      chatHarness({ key: "modelless" }),
    ].map((h) => ({ ...h, status: { installed: true } }))

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
    ].map((h) => ({ ...h, status: { installed: true } }))

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
