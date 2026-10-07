import "server-only"

import { latestUserMessageText } from "./persistence"
import { parseCanvasViewPageId } from "./message-markers"
import type { SenderPage } from "./layer-page"

/**
 * The page a chat's turn sender is on (#1842): the one their latest message's
 * Canvas view footer names, read when a tool places a new Layer. A Steer
 * mid-turn is the latest message, so its sender's page wins. Read from the
 * chat's log rather than handed in, so a harness's MCP calls and the
 * in-process engine agree. `undefined` (the first page) when no message names
 * one.
 */
export function senderPageOf(chatId: string): SenderPage {
  return async () => {
    const wire = await latestUserMessageText(chatId).catch(() => null)
    return wire ? parseCanvasViewPageId(wire) : undefined
  }
}
