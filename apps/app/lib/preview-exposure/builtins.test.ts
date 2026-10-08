import { describe, expect, it } from "vitest"

import { loopbackExposure, selectPreviewExposure } from "@/lib/preview-exposure"

describe("loopback", () => {
  it("binds 127.0.0.1 and loads each port at http://localhost, as the Mac app does", async () => {
    const exposure = loopbackExposure()
    expect(exposure.bind).toEqual({ host: "127.0.0.1" })
    expect(await exposure.expose(51234)).toEqual({
      browserOrigin: "http://localhost:51234",
    })
  })

  it("takes a port range, for a fixed list of forwarded ports", () => {
    const exposure = loopbackExposure({
      ports: { from: 20000, to: 20009 },
    })
    expect(exposure.bind).toEqual({
      host: "127.0.0.1",
      ports: { from: 20000, to: 20009 },
    })
  })
})

describe("loopback's options", () => {
  it("names the option that's wrong", () => {
    expect(() => loopbackExposure({ origin: "http://localhost" })).toThrow(
      'Preview exposure "loopback": origin must contain {port}'
    )
    expect(() =>
      loopbackExposure({ ports: { from: 20010, to: 20000 } })
    ).toThrow("ports")
    expect(() =>
      loopbackExposure({ origni: "x" } as Parameters<
        typeof loopbackExposure
      >[0])
    ).toThrow('Preview exposure "loopback"')
  })
})

describe("selectPreviewExposure", () => {
  it("is loopback with no override", () => {
    expect(selectPreviewExposure({}).bind).toEqual({ host: "127.0.0.1" })
    expect(
      selectPreviewExposure({ PREVIEW_EXPOSURE: "loopback" }).bind
    ).toEqual({ host: "127.0.0.1" })
  })

  it("picks tailscale when asked, binding 127.0.0.1 for tailscale serve", () => {
    expect(
      selectPreviewExposure({ PREVIEW_EXPOSURE: "tailscale" }).bind
    ).toEqual({ host: "127.0.0.1" })
  })

  it("refuses an id it doesn't know", () => {
    expect(() => selectPreviewExposure({ PREVIEW_EXPOSURE: "funnel" })).toThrow(
      'PREVIEW_EXPOSURE "funnel" isn’t known (known: loopback, tailscale)'
    )
  })
})
