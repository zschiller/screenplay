import { describe, expect, it } from "vitest"

import { bannerLines } from "./banner.mjs"

describe("bannerLines", () => {
  it("prints the host URL, the viewer port and one ssh -L for both ports", () => {
    const text = bannerLines({
      hostPort: 4100,
      portlessPort: 1355,
      viewers: [{ name: "corp", address: "0.0.0.0", port: 4200 }],
      user: "zack",
      machine: "devbox",
    }).join("\n")
    expect(text).toContain("Host:    http://localhost:4100")
    expect(text).toContain("Viewers: 0.0.0.0:4200 (corp)")
    expect(text).toContain(
      "ssh -N -L 4100:127.0.0.1:4100 -L 1355:127.0.0.1:1355 zack@devbox"
    )
  })
})
