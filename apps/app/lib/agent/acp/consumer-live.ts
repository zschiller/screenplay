import "server-only"

import {
  broadcastAcpUpdate,
  broadcastControl,
  broadcastPermissionRequest,
  broadcastSignal,
} from "../broadcast"
import { appendAcpMessage, upsertAcpToolCall } from "../persistence"
import {
  isRunActive,
  pauseForPlan,
  transition,
  type RunStatus,
} from "../run-state"
import type { AcpConsumerPorts } from "./consumer"
import { contentBlocksToWire } from "./markers"
import { userTurnEcho } from "../user-turn"

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
    upsertToolCall: (record) => upsertAcpToolCall(chatId, runId, record),
    transition: (to: RunStatus) => transition(runId, to),
    broadcastPermissionRequest: (request) =>
      broadcastPermissionRequest(roomId, chatId, request),
    // The consumer derives the plan-gate tool-call; the run-state machine needs
    // the chat id, which this live port owns.
    pauseForPlan: (planCall) => pauseForPlan(runId, { ...planCall, chatId }),
    // Asked before each durable write, so output racing a Stop stays out of
    // the log even before the abort watchdog trips (#1263).
    isLive: () => isRunActive(runId),
    // A taken Steer becomes an ordinary user message: in the log where the
    // agent took it, and on every client as the same echo a turn's first
    // message gets.
    async settleSteers(steers) {
      for (const steer of steers) {
        await appendAcpMessage(chatId, { role: "user", content: steer.content })
      }
      await broadcastControl(roomId, chatId, {
        kind: "steers_taken",
        ids: steers.map((s) => s.id),
      })
      for (const steer of steers) {
        await broadcastAcpUpdate(
          roomId,
          chatId,
          userTurnEcho(contentBlocksToWire(steer.content))
        )
      }
    },
  }
}
