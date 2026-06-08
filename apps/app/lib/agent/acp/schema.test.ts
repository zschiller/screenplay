import { describe, expect, it } from "vitest"
import {
  isPlanGate,
  isUpdate,
  planFromPermissionRequest,
  planPermissionRequest,
  planResolutionOutcome,
  PLAN_APPROVE_OPTION_ID,
  PLAN_REJECT_OPTION_ID,
  type RequestPermissionRequest,
  type SessionUpdate,
} from "./schema"

describe("plan-mode gate as an ACP permission request", () => {
  const request = planPermissionRequest({
    sessionId: "chat_1",
    toolCallId: "toolu_1",
    plan: "## Plan\n1. do it",
  })

  it("carries the plan on the toolCall as an ACP content block + rawInput", () => {
    expect(request.toolCall.toolCallId).toBe("toolu_1")
    expect(request.toolCall.content).toEqual([
      { type: "content", content: { type: "text", text: "## Plan\n1. do it" } },
    ])
    expect(request.options.map((o) => o.optionId)).toEqual([
      PLAN_APPROVE_OPTION_ID,
      PLAN_REJECT_OPTION_ID,
    ])
  })

  it("recovers { toolCallId, plan } from the request", () => {
    expect(planFromPermissionRequest(request)).toEqual({
      toolCallId: "toolu_1",
      plan: "## Plan\n1. do it",
    })
  })

  it("recognises its own gate by its option ids", () => {
    expect(isPlanGate(request)).toBe(true)
    const other: RequestPermissionRequest = {
      sessionId: "s",
      toolCall: { toolCallId: "t" },
      options: [{ optionId: "yes", name: "Yes", kind: "allow_once" }],
    }
    expect(isPlanGate(other)).toBe(false)
  })

  it("is kept distinct from ACP's informational `plan` session update", () => {
    // The approval gate is a permission request; ACP's `plan` is a separate
    // `session/update` the UI may render. They must never be conflated.
    const planUpdate = {
      sessionUpdate: "plan",
      entries: [],
    } as unknown as SessionUpdate
    expect(isUpdate(planUpdate, "plan")).toBe(true)
    // The permission request is not a session update at all — no `sessionUpdate`.
    expect("sessionUpdate" in request).toBe(false)
  })

  it("maps a decision to the ACP RequestPermissionResponse outcome", () => {
    expect(planResolutionOutcome(true)).toEqual({
      outcome: "selected",
      optionId: PLAN_APPROVE_OPTION_ID,
    })
    expect(planResolutionOutcome(false)).toEqual({
      outcome: "selected",
      optionId: PLAN_REJECT_OPTION_ID,
    })
  })
})
