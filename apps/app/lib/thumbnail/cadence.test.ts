import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * Load the cadence constants for a given build by stubbing `isLocalBuild` and
 * re-importing the module fresh — the bounds are top-level consts computed from
 * the flag, so each build needs an isolated module instance.
 */
async function loadCadence(local: boolean) {
  vi.resetModules()
  vi.doMock("@/lib/local-mode", () => ({ isLocalBuild: local }))
  return import("./cadence")
}

afterEach(() => {
  vi.doUnmock("@/lib/local-mode")
  vi.resetModules()
})

describe("thumbnail cadence bounds", () => {
  it("keeps the heartbeat period above the capture cooldown in both builds", async () => {
    // The load-bearing invariant: a throttled heartbeat fires once per period,
    // so the period must clear the route's dedup cooldown — otherwise every
    // throttled fire lands inside the cooldown and the per-frame round never
    // runs.
    for (const local of [true, false]) {
      const c = await loadCadence(local)
      expect(c.THUMBNAIL_HEARTBEAT_PERIOD_MS).toBeGreaterThan(
        c.THUMBNAIL_CAPTURE_COOLDOWN_MS
      )
    }
  })

  it("runs the local build hotter than the hosted build on both bounds", async () => {
    const localBuild = await loadCadence(true)
    const hosted = await loadCadence(false)

    // Desktop rounds are local-webview + local-fs, so both the trigger cadence
    // and the dedup window are shorter than the hosted, paid-function bounds.
    expect(localBuild.THUMBNAIL_HEARTBEAT_PERIOD_MS).toBeLessThan(
      hosted.THUMBNAIL_HEARTBEAT_PERIOD_MS
    )
    expect(localBuild.THUMBNAIL_CAPTURE_COOLDOWN_MS).toBeLessThan(
      hosted.THUMBNAIL_CAPTURE_COOLDOWN_MS
    )
  })

  it("keeps the unmount catch-up gap below the heartbeat period", async () => {
    // The catch-up round on unmount only fires when no round has run within the
    // gap; it must be shorter than the period so it stays a catch-up, not a
    // second throttled lane.
    for (const local of [true, false]) {
      const c = await loadCadence(local)
      expect(c.THUMBNAIL_HEARTBEAT_MIN_REFRESH_GAP_MS).toBeLessThan(
        c.THUMBNAIL_HEARTBEAT_PERIOD_MS
      )
    }
  })
})
