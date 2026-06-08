import "server-only"

import {
  broadcastAcpUpdate,
  broadcastEvent,
  broadcastSignal,
} from "../broadcast"
import { appendAcpMessage } from "../persistence"
import { transition, type RunStatus } from "../run-state"
import type { AcpConsumerPorts } from "./consumer"

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
    // ACP has no error session-update; a turn failure stays a screenplay
    // broadcast on the existing channel so the UI surfaces it unchanged.
    broadcastError: (message) =>
      broadcastEvent(roomId, chatId, { type: "error", message }),
    broadcastEnd: () => broadcastSignal(roomId, chatId, "chat-stream-end"),
    appendRecord: (record) => appendAcpMessage(chatId, record),
    transition: (to: RunStatus) => transition(runId, to),
  }
}
