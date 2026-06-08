import type { PlanResolution } from "../run-state"
import type { AcpMessageRecord } from "./record"
import { textBlock } from "./schema"

/**
 * The human side of the plan-mode gate, ACP-native (ADR 0006, PRD #375).
 *
 * The consumer maps the agent's permission *request* onto `pauseForPlan`; this
 * module maps the human's *response* back the other way — the ACP-native record
 * that closes the gate and drives what happens next:
 *
 *   - **Approve → resume the same session.** The human's "proceed" lands as a
 *     `user` turn so the rebuilt history continues the conversation; the caller
 *     starts a fresh run against that history.
 *   - **Reject-with-feedback → revise.** The feedback lands as the next `user`
 *     turn, which is exactly the revision instruction the agent acts on.
 *
 * The decision itself is also the genuine ACP {@link planResolutionOutcome}
 * (a `RequestPermissionResponse` outcome) — the artifact a real ACP client
 * produces verbatim — which the live port broadcasts so the Room updates the
 * plan card. The seam stays honest: nothing here is screenplay-shaped.
 */

/** The side-effecting boundary {@link resolvePlanGate} drives (cf. the consumer). */
export interface PlanResolutionPorts {
  /**
   * Mark the pending plan approved/rejected and supersede its paused run,
   * atomically (run-state machine). Returns the affected run id, or null when
   * there was no still-pending plan under `planId`.
   */
  resolvePlan(
    planId: string,
    resolution: PlanResolution
  ): Promise<{ runId: string } | null>
  /** Append the ACP-native record of the human resolution to the durable log. */
  appendResolution(record: AcpMessageRecord): Promise<void>
  /** Broadcast the resolution so the Room updates the plan card (ACP outcome). */
  broadcastResolution(planId: string, resolution: PlanResolution): Promise<void>
}

/**
 * The continuation text a human plan resolution lands as. Reject carries the
 * verbatim feedback (the revision instruction); approve carries an explicit
 * "proceed" so the rebuilt history resumes the same session cleanly. The single
 * source for both the durable {@link planResolutionRecord} and the live user
 * echo the route broadcasts, so the turn the model sees and the bubble the Room
 * renders never drift.
 */
export function planResolutionText(resolution: PlanResolution): string {
  return resolution.approved
    ? "Approved the plan. Proceed with the implementation."
    : resolution.feedback?.trim() ||
        "Requested changes to the plan. Please revise."
}

/**
 * The ACP-native record of a human plan resolution — a `user` turn carrying the
 * continuation the agent acts on next.
 */
export function planResolutionRecord(
  resolution: PlanResolution
): AcpMessageRecord {
  return { role: "user", content: [textBlock(planResolutionText(resolution))] }
}

/**
 * Resolve a paused plan gate, ACP-native. Supersedes the paused run, persists
 * the human resolution as an ACP-native `user` record, and broadcasts the
 * outcome. Returns the resolved run id (the caller starts the continuation run
 * against the now-extended history), or null when nothing was pending — a
 * double-submit or a gate a `/stop` already tore down.
 */
export async function resolvePlanGate(
  ports: PlanResolutionPorts,
  planId: string,
  resolution: PlanResolution
): Promise<{ runId: string } | null> {
  const resolved = await ports.resolvePlan(planId, resolution)
  if (!resolved) return null
  await ports.appendResolution(planResolutionRecord(resolution))
  await ports.broadcastResolution(planId, resolution)
  return resolved
}
