import "server-only"

import type { Tool } from "ai"

import { buildDocumentTools } from "@/lib/agent/document-tools"
import { buildMockupTools } from "@/lib/agent/mockup-tools"
import type { RoomDoc, RoomReader } from "@/lib/room-access"

/** Whether the Room has a repository yet. A failed read counts as one. */
export async function roomHasRepository(room: RoomReader): Promise<boolean> {
  return room
    .readDoc(({ repos }) => repos.toArray().length > 0)
    .catch(() => true)
}

/**
 * The Coordinator's Document and Mockup tools on a canvas with no repository.
 * With no repository there are no Workspaces, so no chat but the Coordinator
 * could make them; it owns what it makes, like any chat. Once a repository is
 * added the Coordinator goes back to only delegating, and gets none of these.
 */
export function buildNoRepositoryTools({
  room,
  chatId,
}: {
  room: RoomDoc
  /** The Coordinator chat, which owns what these tools make. */
  chatId: string
}): Record<string, Tool> {
  return {
    ...buildDocumentTools({ room, chatId }),
    ...buildMockupTools({ room, chatId }),
  }
}
