import { describe, expect, it } from "vitest"
import {
  CHAT_CAPABILITIES,
  chatCapabilitiesOf,
} from "@/lib/chat/chat-capabilities"

describe("CHAT_CAPABILITIES", () => {
  it("turns on the sandbox affordances for an agent chat only", () => {
    const on = (k: "skills" | "planMode" | "elementPicking") =>
      Object.entries(CHAT_CAPABILITIES)
        .filter(([, row]) => row[k])
        .map(([kind]) => kind)
    expect(on("skills")).toEqual(["agent"])
    expect(on("planMode")).toEqual(["agent"])
    expect(on("elementPicking")).toEqual(["agent"])
  })

  it("offers the `/` skill menu only where there are skills", () => {
    expect(CHAT_CAPABILITIES.agent.placeholder).toContain("/ skill")
    expect(CHAT_CAPABILITIES.room.placeholder).not.toContain("/")
  })

  it("names the Coordinator in the Room chat's placeholder", () => {
    expect(CHAT_CAPABILITIES.room.placeholder).toBe(
      "Ask the Coordinator… (@ to mention a document)"
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

  it("resolves neither for the Room chat", () => {
    const caps = chatCapabilitiesOf({ kind: "room" })
    expect(caps.skillSandboxName).toBeUndefined()
    expect(caps.pickBranchId).toBeUndefined()
  })
})
