import type { Tool } from "ai"

/**
 * A tool that runs only after plan review (#898). It has no `execute`: when
 * the model calls it, the in-process engine halts the turn on the same
 * approval card `submit_plan` raises, with the plan {@link PlanGate} renders
 * from the call. What the gate returns as `input` is kept on the pending plan,
 * so approving it acts on exactly what the user reviewed (`/api/agent/plan`).
 */
export type PlanGate = (
  input: unknown
) => Promise<PlanGateRequest | PlanGateRefusal>

export interface PlanGateRequest {
  /** The plan the approval card shows, as markdown. */
  plan: string
  /** Stored with the pending plan; `gate` names the tool that raised it. */
  input: { gate: string } & Record<string, unknown>
}

/**
 * A gate that can't raise its card for this call (the Workspace it names is
 * gone, or already has a PR): the call completes with `refusal` as its
 * result, and nothing waits on the user. A refusal is an outcome, not a
 * failure, so its row isn't shown as failed (#1231).
 */
export interface PlanGateRefusal {
  refusal: string
}

const PLAN_GATE = "planGate"

/** Mark `tool` as a plan-gated tool. It must have no `execute`. */
export function withPlanGate(tool: Tool, gate: PlanGate): Tool {
  return Object.assign(tool, { [PLAN_GATE]: gate })
}

/** The plan gate on `tool`, if it has one. */
export function planGateOf(tool: Tool | undefined): PlanGate | null {
  const gate = (tool as Record<string, unknown> | undefined)?.[PLAN_GATE]
  return typeof gate === "function" ? (gate as PlanGate) : null
}
