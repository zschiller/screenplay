import { describe, expect, it } from "vitest"
import {
  planResolutionRecord,
  resolvePlanGate,
  type PlanResolutionPorts,
} from "./resolution"
import type { AcpMessageRecord } from "./record"
import type { PlanResolution } from "../run-state"

/**
 * In-memory ports for the human side of the plan gate. We assert on the
 * observable outcome — the ACP-native record persisted and the resolution
 * broadcast — never on how it was produced (mirrors the consumer harness).
 */
function harness(resolveResult: { runId: string } | null = { runId: "run_1" }) {
  const records: AcpMessageRecord[] = []
  const broadcasts: Array<{ planId: string; resolution: PlanResolution }> = []
  const resolved: Array<{ planId: string; resolution: PlanResolution }> = []

  const ports: PlanResolutionPorts = {
    async resolvePlan(planId, resolution) {
      resolved.push({ planId, resolution })
      return resolveResult
    },
    async appendResolution(record) {
      records.push(record)
    },
    async broadcastResolution(planId, resolution) {
      broadcasts.push({ planId, resolution })
    },
  }
  return { ports, records, broadcasts, resolved }
}

describe("resolvePlanGate — human side of the plan gate, ACP-native", () => {
  it("approve: supersedes the paused run and persists a 'proceed' user record", async () => {
    const h = harness()
    const out = await resolvePlanGate(h.ports, "toolu_1", { approved: true })

    expect(out).toEqual({ runId: "run_1" })
    expect(h.resolved).toEqual([
      { planId: "toolu_1", resolution: { approved: true } },
    ])
    expect(h.records).toEqual<AcpMessageRecord[]>([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Approved the plan. Proceed with the implementation.",
          },
        ],
      },
    ])
    expect(h.broadcasts).toHaveLength(1)
  })

  it("reject-with-feedback: persists the feedback as the next user turn (drives a revision)", async () => {
    const h = harness()
    const resolution: PlanResolution = {
      approved: false,
      feedback: "Use a queue instead.",
    }
    await resolvePlanGate(h.ports, "toolu_2", resolution)

    expect(h.records).toEqual<AcpMessageRecord[]>([
      {
        role: "user",
        content: [{ type: "text", text: "Use a queue instead." }],
      },
    ])
    expect(h.broadcasts).toEqual([{ planId: "toolu_2", resolution }])
  })

  it("no-ops when nothing was pending (double-submit / torn-down gate)", async () => {
    const h = harness(null)
    const out = await resolvePlanGate(h.ports, "toolu_3", { approved: true })

    expect(out).toBeNull()
    // Resolve was attempted, but nothing is persisted or broadcast.
    expect(h.records).toEqual([])
    expect(h.broadcasts).toEqual([])
  })

  it("planResolutionRecord falls back when reject feedback is blank", () => {
    expect(planResolutionRecord({ approved: false, feedback: "  " })).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Requested changes to the plan. Please revise." },
      ],
    })
  })
})
