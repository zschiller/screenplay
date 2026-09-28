import type { PlanResolution } from "../run-state"

/**
 * The human side of the plan-mode gate, ACP-native (ADR 0006, PRD #375).
 *
 * The consumer maps the agent's permission *request* onto `pauseForPlan`; the
 * human's *response* comes back as the next `user` turn, which Turn Launch
 * resolves and resumes with (`lib/agent/turn-launch.ts`):
 *
 *   - **Approve → resume the same session.** The human's "proceed" lands as a
 *     `user` turn so the rebuilt history continues the conversation.
 *   - **Reject-with-feedback → revise.** The feedback lands as the next `user`
 *     turn, which is exactly the revision instruction the agent acts on.
 */

/**
 * The continuation text a human plan resolution lands as. Reject carries the
 * verbatim feedback (the revision instruction); approve carries an explicit
 * "proceed" so the rebuilt history resumes the same session cleanly. The single
 * source for both the durable user record and the live user echo, so the turn
 * the model sees and the bubble the Room renders never drift.
 */
export function planResolutionText(resolution: PlanResolution): string {
  return resolution.approved
    ? "Approved the plan. Proceed with the implementation."
    : resolution.feedback?.trim() ||
        "Requested changes to the plan. Please revise."
}
