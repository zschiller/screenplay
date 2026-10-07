import "server-only"

import type { RoomDoc } from "@/lib/room-access"
import type { AskCoordinatorPorts } from "./ask-coordinator-tools"

/**
 * `ask_coordinator`'s port over the live Room: a Coordinator turn through
 * Turn Launch (`askCoordinator` in `turn-launch-live.ts`). Loaded when a chat
 * asks, since Turn Launch builds the chats' own tool sets.
 */
export function liveAskCoordinator(
  room: RoomDoc,
  sender: { userId: string; senderless?: boolean },
  chatId: string
): AskCoordinatorPorts {
  return {
    async ask(request) {
      const { askCoordinator } = await import("./turn-launch-live")
      await askCoordinator(room, sender, chatId, request)
    },
  }
}
