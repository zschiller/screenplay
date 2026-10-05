import { describe, expect, it } from "vitest"
import {
  PLAN_APPROVAL,
  parseProposedPlan,
  planProposalOutcomes,
} from "@/lib/agent/coordinator-plan"
import type { AgentMessage } from "@/lib/agent/types"

const proposal = (id: string): AgentMessage =>
  ({
    role: "tool_call",
    toolCallId: id,
    title: "propose_plan",
    rawInput: { plan: "- Start “Checkout”" },
  }) as unknown as AgentMessage

describe("planProposalOutcomes", () => {
  it("leaves a proposal open until a user message follows it", () => {
    expect(planProposalOutcomes([proposal("p1")]).size).toBe(0)
  })

  it("settles it approved on the Approve message, and replaced on anything else", () => {
    const outcomes = planProposalOutcomes([
      proposal("p1"),
      { role: "user", content: PLAN_APPROVAL },
      proposal("p2"),
      { role: "user", content: "Make it two chats" },
    ])
    expect(outcomes.get("p1")).toBe("approved")
    expect(outcomes.get("p2")).toBe("replaced")
  })

  it("isn’t settled by a wake, which nobody sent", () => {
    const outcomes = planProposalOutcomes([
      proposal("p1"),
      { role: "user", content: "done", wakeFrom: "ws-1" },
    ])
    expect(outcomes.size).toBe(0)
  })
})

describe("parseProposedPlan", () => {
  it("reads the plan, and nothing from an empty or streaming call", () => {
    expect(parseProposedPlan({ plan: "  - Send it  " })).toBe("- Send it")
    expect(parseProposedPlan({ plan: " " })).toBeNull()
    expect(parseProposedPlan(undefined)).toBeNull()
  })
})
