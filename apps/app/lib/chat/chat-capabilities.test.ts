import { describe, expect, it } from "vitest"
import {
  CHAT_CAPABILITIES,
  chatCapabilitiesOf,
} from "@/lib/chat/chat-capabilities"

describe("CHAT_CAPABILITIES", () => {
  it("turns on the sandbox affordances for an agent chat only, and `/` everywhere", () => {
    const on = (k: "skills" | "planMode" | "elementPicking") =>
      Object.entries(CHAT_CAPABILITIES)
        .filter(([, row]) => row[k])
        .map(([kind]) => kind)
    expect(on("skills")).toEqual(["agent", "room", "sketch"])
    expect(on("planMode")).toEqual(["agent"])
    expect(on("elementPicking")).toEqual(["agent"])
  })

  it("offers the `/` skill menu in every chat's placeholder (#1556)", () => {
    for (const row of Object.values(CHAT_CAPABILITIES))
      expect(row.placeholder).toContain("/ skill")
  })

  it("names the Coordinator in the Room chat's placeholder", () => {
    expect(CHAT_CAPABILITIES.room.placeholder).toBe(
      "Ask the Coordinator… (@ document, / skill)"
    )
  })

  it("gives every kind its own empty state and starters", () => {
    const rows = Object.values(CHAT_CAPABILITIES)
    for (const row of rows) expect(row.starters.length).toBeGreaterThan(0)
    const titles = new Set(rows.map((r) => r.emptyTitle))
    const firstStarters = new Set(rows.map((r) => r.starters[0]))
    expect(titles.size).toBe(rows.length)
    expect(firstStarters.size).toBe(rows.length)
  })
})

describe("chatCapabilitiesOf", () => {
  it("resolves an agent chat's skill Sandbox and pick Branch", () => {
    const caps = chatCapabilitiesOf({
      kind: "agent",
      branchId: "b1",
      sandboxName: "sbx-1",
    })
    expect(caps.skillSandboxName).toBe("sbx-1")
    expect(caps.pickBranchId).toBe("b1")
  })

  it("resolves no Sandbox for the Room chat, only its own Skills", () => {
    const caps = chatCapabilitiesOf({ kind: "room" })
    expect(caps.skillSandboxName).toBeUndefined()
    expect(caps.skillChat).toBe("room")
    expect(caps.pickBranchId).toBeUndefined()
  })
})
