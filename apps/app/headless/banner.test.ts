import { describe, expect, it } from "vitest"

import { bannerLines } from "./banner.mjs"

describe("bannerLines", () => {
  it("prints the host URL, one ssh -L for both ports", () => {
    const text = bannerLines({
      hostPort: 4100,
      portlessPort: 1355,
      user: "zack",
      machine: "devbox",
    }).join("\n")
    expect(text).toContain("Host:    http://localhost:4100")
    expect(text).toContain(
      "ssh -N -L 4100:127.0.0.1:4100 -L 1355:127.0.0.1:1355 zack@devbox"
    )
  })
})
