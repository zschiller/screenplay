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
  it("keeps the capture cooldown above the settle window in both builds", async () => {
    // A capture fires once its content settles (`SETTLE_MS` of quiet). The
    // cooldown is the floor on capture frequency, so it must clear the settle
    // window — otherwise a single post-settle capture lands inside its own
    // cooldown and is dropped.
    for (const local of [true, false]) {
      const c = await loadCadence(local)
      expect(c.THUMBNAIL_CAPTURE_COOLDOWN_MS).toBeGreaterThan(
        c.THUMBNAIL_CAPTURE_SETTLE_MS
      )
    }
  })

  it("keeps the cheap layout lane faster than the capture lane", async () => {
    // The layout-only rebuild opens no browser, so it coalesces and writes
    // faster than a capture settles — the home grid's rects track edits ahead of
    // the screenshots catching up.
    for (const local of [true, false]) {
      const c = await loadCadence(local)
      expect(c.THUMBNAIL_LAYOUT_DEBOUNCE_MS).toBeLessThan(
        c.THUMBNAIL_CAPTURE_SETTLE_MS
      )
    }
  })

  it("runs the local build hotter than the hosted build on both capture bounds", async () => {
    const localBuild = await loadCadence(true)
    const hosted = await loadCadence(false)

    // Desktop rounds are local-webview + local-fs, so both the settle and the
    // dedup window are shorter than the hosted, paid-function bounds.
    expect(localBuild.THUMBNAIL_CAPTURE_SETTLE_MS).toBeLessThan(
      hosted.THUMBNAIL_CAPTURE_SETTLE_MS
    )
    expect(localBuild.THUMBNAIL_CAPTURE_COOLDOWN_MS).toBeLessThan(
      hosted.THUMBNAIL_CAPTURE_COOLDOWN_MS
    )
  })
})
