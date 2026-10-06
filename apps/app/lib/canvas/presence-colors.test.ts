import { describe, expect, it } from "vitest"

import { PRESENCE_COLORS, pickPresenceColor } from "./presence-colors"
import { presenceInk } from "./presence-ink"

describe("PRESENCE_COLORS", () => {
  it("puts black ink on every colour, as on every Signal fill", () => {
    for (const color of PRESENCE_COLORS) expect(presenceInk(color)).toBe("dark")
  })

  it("picks from the palette", () => {
    expect(pickPresenceColor(() => 0)).toBe(PRESENCE_COLORS[0])
    expect(pickPresenceColor(() => 0.999)).toBe(PRESENCE_COLORS.at(-1))
  })
})
