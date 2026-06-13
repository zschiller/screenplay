import { describe, expect, it, vi } from "vitest"

import {
  createDesktopResolver,
  filterByCapability,
} from "@/lib/agent/harnesses/availability"
import type { HostBinaryProber } from "@/lib/agent/harnesses/host-binary"

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
