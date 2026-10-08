import { describe, expect, it } from "vitest"

import { selectViewerIdentity } from "./index"

describe("selectViewerIdentity", () => {
  it("picks Tailscale by default", () => {
    expect(selectViewerIdentity({}).id).toBe("tailscale")
  })

  it("refuses an id it doesn't know", () => {
    expect(() => selectViewerIdentity({ VIEWER_IDENTITY: "okta" })).toThrow(
      'VIEWER_IDENTITY "okta" isn’t known (known: tailscale)'
    )
  })
})
