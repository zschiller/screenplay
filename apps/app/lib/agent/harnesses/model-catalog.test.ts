import { describe, expect, it, vi } from "vitest"

import {
  createHarnessModelCatalog,
  type HarnessModelDiscovery,
  mergeHarnessModels,
} from "@/lib/agent/harnesses/model-catalog"
import type { Harness, HarnessModel } from "@/lib/agent/harnesses/types"

/**
 * The Harness model catalog (#527) resolves a Harness's dropdown list from its
 * **curated floor** plus a **discover-once-and-cached** live augment, mirroring
 * the model-provider `discover()` cache. These tests pin the three contracts the
 * acceptance criteria name: discover-once-and-cache (a second `list()` reuses the
 * first discovery), curated fallback on empty/unreachable, and shared discovery
 * across two calls — and the spike's inversion: curated floor authoritative,
 * discovery purely additive.
 */

/** A descriptor stub carrying only the catalog-relevant `key`/`models`. */
function harness(key: string, models?: HarnessModel[]): Harness {
  return { key, models } as Harness
}

/** A discovery (a vi.fn, so calls are counted) advertising the given ids per key. */
function fakeDiscovery(advertised: Record<string, string[]>) {
  return vi.fn<HarnessModelDiscovery>(
    async () => new Map(Object.entries(advertised))
  )
}

const claudeFloor: HarnessModel[] = [
  { id: "default", label: "Default" },
  { id: "sonnet", label: "Sonnet" },
]

describe("mergeHarnessModels (curated floor authoritative, discovery additive)", () => {
  it("keeps the curated floor's order and labels when nothing is advertised", () => {
    expect(mergeHarnessModels(claudeFloor, [])).toEqual(claudeFloor)
  })

  it("appends only advertised ids the floor doesn't already name, labeled by id", () => {
    expect(mergeHarnessModels(claudeFloor, ["opus", "haiku"])).toEqual([
      { id: "default", label: "Default" },
      { id: "sonnet", label: "Sonnet" },
      { id: "opus", label: "opus" },
      { id: "haiku", label: "haiku" },
    ])
  })

  it("never relabels or reorders a curated entry a discovery also advertises", () => {
    // `sonnet` is advertised but already curated — the curated label/position win.
    expect(mergeHarnessModels(claudeFloor, ["sonnet", "opus"])).toEqual([
      { id: "default", label: "Default" },
      { id: "sonnet", label: "Sonnet" },
      { id: "opus", label: "opus" },
    ])
  })
})

describe("createHarnessModelCatalog", () => {
  it("returns the curated floor when discovery advertises nothing for a harness (empty fallback)", async () => {
    const catalog = createHarnessModelCatalog({
      discover: fakeDiscovery({ codex: ["gpt-5"] }),
    })

    // claude-code isn't in the advertised map → just its curated floor.
    expect(await catalog.list(harness("claude-code", claudeFloor))).toEqual(
      claudeFloor
    )
  })

  it("returns the curated floor when discovery is unreachable (rejects)", async () => {
    const catalog = createHarnessModelCatalog({
      discover: async () => {
        throw new Error("upstream unreachable")
      },
    })

    expect(await catalog.list(harness("claude-code", claudeFloor))).toEqual(
      claudeFloor
    )
  })

  it("unions live-advertised ids onto the curated floor (additive)", async () => {
    const catalog = createHarnessModelCatalog({
      discover: fakeDiscovery({ "claude-code": ["sonnet", "opus"] }),
    })

    expect(await catalog.list(harness("claude-code", claudeFloor))).toEqual([
      { id: "default", label: "Default" },
      { id: "sonnet", label: "Sonnet" },
      { id: "opus", label: "opus" },
    ])
  })

  it("discovers once per launch — a second list() reuses the first discovery (no re-probe)", async () => {
    const discover = fakeDiscovery({ "claude-code": ["opus"] })
    const catalog = createHarnessModelCatalog({ discover })

    // Two list() calls — even for different harnesses — share one discovery.
    await catalog.list(harness("claude-code", claudeFloor))
    await catalog.list(harness("codex", [{ id: "gpt-5", label: "GPT-5" }]))

    expect(discover).toHaveBeenCalledTimes(1)
  })

  it("caches a failed discovery too, so a flapping upstream isn't re-probed mid-launch", async () => {
    const discover = vi.fn<HarnessModelDiscovery>(async () => {
      throw new Error("upstream unreachable")
    })
    const catalog = createHarnessModelCatalog({ discover })

    expect(await catalog.list(harness("claude-code", claudeFloor))).toEqual(
      claudeFloor
    )
    expect(await catalog.list(harness("codex", []))).toEqual([])
    expect(discover).toHaveBeenCalledTimes(1)
  })

  it("advertises nothing by default — the production catalog returns the curated floor unchanged", async () => {
    const catalog = createHarnessModelCatalog()

    expect(await catalog.list(harness("claude-code", claudeFloor))).toEqual(
      claudeFloor
    )
  })
})
