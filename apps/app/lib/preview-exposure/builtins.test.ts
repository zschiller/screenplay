import { describe, expect, it } from "vitest"

import { loopbackExposure, selectPreviewExposure } from "@/lib/preview-exposure"

describe("loopback", () => {
  it("loads each port at http://localhost, as the Mac app does", async () => {
    expect(await loopbackExposure().expose(51234)).toEqual({
      browserOrigin: "http://localhost:51234",
    })
  })
})

describe("selectPreviewExposure", () => {
  it("is loopback with no override", async () => {
    for (const env of [{}, { PREVIEW_EXPOSURE: "loopback" }]) {
      expect(await selectPreviewExposure(env).expose(4000)).toEqual({
        browserOrigin: "http://localhost:4000",
      })
    }
  })

  it("picks tailscale when asked", () => {
    expect(() =>
      selectPreviewExposure({ PREVIEW_EXPOSURE: "tailscale" })
    ).not.toThrow()
  })

  it("refuses an id it doesn't know", () => {
    expect(() => selectPreviewExposure({ PREVIEW_EXPOSURE: "funnel" })).toThrow(
      'PREVIEW_EXPOSURE "funnel" isn’t known (known: loopback, tailscale)'
    )
  })
})
