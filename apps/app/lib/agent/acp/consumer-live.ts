import "server-only"

import {
  broadcastAcpUpdate,
  broadcastControl,
  broadcastPermissionRequest,
  broadcastSignal,
} from "../broadcast"
import { appendAcpMessage, upsertAcpToolCall } from "../persistence"
import {
  pauseForPlan,
  resolvePlan,
  transition,
  type RunStatus,
} from "../run-state"
import type { AcpConsumerPorts } from "./consumer"
import type { PlanResolutionPorts } from "./resolution"
import { planResolutionText } from "./resolution"
import { userMessageChunk } from "./schema"

/**
 * The live {@link AcpConsumerPorts} bound to the real Y.Doc broadcast, the
 * ACP-native persistence, and the database-backed run-state machine (ADR
 * 0006). Tests inject in-memory fakes instead; this is the production wiring
 * the route hands the consumer.
 */
export function liveAcpConsumerPorts(
  roomId: string,
  chatId: string,
  runId: string
): AcpConsumerPorts {
  return {
    broadcastUpdate: (update) => broadcastAcpUpdate(roomId, chatId, update),
    // ACP has no error session-update; a turn failure rides the non-ACP control
    // envelope so the UI surfaces it.
    broadcastError: (message) =>
      broadcastControl(roomId, chatId, { kind: "error", message }),
    broadcastEnd: () => broadcastSignal(roomId, chatId, "chat-stream-end"),
    appendRecord: (record) => appendAcpMessage(chatId, record),
    upsertToolCall: (record) => upsertAcpToolCall(chatId, record),
    transition: (to: RunStatus) => transition(runId, to),
    broadcastPermissionRequest: (request) =>
      broadcastPermissionRequest(roomId, chatId, request),
    // The consumer derives the plan-gate tool-call; the run-state machine needs
    // the chat id, which this live port owns.
    pauseForPlan: (planCall) => pauseForPlan(runId, { ...planCall, chatId }),
  }
}

/**
 * The live {@link PlanResolutionPorts} for the human side of the plan gate
 * (ADR 0006) — the `/api/agent/plan` route's wiring. Marks the pending plan
 * resolved and supersedes its paused run (atomically), persists the resolution
 * as an ACP-native `user` record, and broadcasts the outcome: the plan card
 * flips via the control envelope, and the continuation is echoed as a live
 * `user_message_chunk` so the Room shows the same turn a reload rebuilds from
 * the durable record.
 */
export function livePlanResolutionPorts(
  roomId: string,
  chatId: string
): PlanResolutionPorts {
  return {
    resolvePlan: (planId, resolution) => resolvePlan(planId, resolution),
    appendResolution: (record) => appendAcpMessage(chatId, record),
    broadcastResolution: async (planId, resolution) => {
      await broadcastControl(roomId, chatId, {
        kind: "plan_resolved",
        planId,
        approved: resolution.approved,
      })
      await broadcastAcpUpdate(
        roomId,
        chatId,
        userMessageChunk(planResolutionText(resolution))
      )
    },
  }
}
