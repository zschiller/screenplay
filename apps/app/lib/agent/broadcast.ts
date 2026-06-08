import "server-only"

import type { ChatControlEvent } from "@/lib/chat-store"
import type {
  RequestPermissionRequest,
  SessionUpdate,
} from "@/lib/agent/acp/schema"
import { broadcastChatEventViaDoc } from "@/lib/yjs/server"

/**
 * Broadcast an ACP-shaped `session/update` to every client in the Room over
 * the Y.Doc (ADR 0006). The server is the sole ACP peer; browsers render this
 * broadcast and never open an ACP connection. The Y.Doc fan-out is the
 * multiplexer — single ACP session in, N browsers out — so only the payload
 * changes shape, not the machinery.
 */
export async function broadcastAcpUpdate(
  roomId: string,
  chatId: string,
  update: SessionUpdate
): Promise<void> {
  try {
    await broadcastChatEventViaDoc(roomId, {
      type: "chat-acp-update",
      chatId,
      update: JSON.parse(JSON.stringify(update)),
    })
  } catch (e) {
    console.error("acp broadcast failed:", e)
  }
}

/**
 * Broadcast an ACP permission request (the plan-mode approval gate) to every
 * client in the Room (ADR 0006). ACP's permission round-trip is a JSON-RPC
 * *request*, not a `session/update`, so it rides its own envelope; the server is
 * still the sole ACP peer and the human responds through the run lifecycle, not
 * a per-browser ACP connection.
 */
export async function broadcastPermissionRequest(
  roomId: string,
  chatId: string,
  request: RequestPermissionRequest
): Promise<void> {
  try {
    await broadcastChatEventViaDoc(roomId, {
      type: "chat-acp-permission",
      chatId,
      request: JSON.parse(JSON.stringify(request)),
    })
  } catch (e) {
    console.error("acp permission broadcast failed:", e)
  }
}

/**
 * Broadcast a non-ACP control signal (ADR 0006) — an auto-naming rename, a plan
 * resolution, or a turn error — on its own dedicated envelope, structurally
 * distinct from the ACP `session/update` and permission-request channels. ACP
 * has no slot for these, so they stay screenplay-shaped here rather than being
 * smuggled into a `session/update`.
 */
export async function broadcastControl(
  roomId: string,
  chatId: string,
  control: ChatControlEvent
): Promise<void> {
  try {
    await broadcastChatEventViaDoc(roomId, {
      type: "chat-control",
      chatId,
      control: JSON.parse(JSON.stringify(control)),
    })
  } catch (e) {
    console.error("control broadcast failed:", e)
  }
}

export async function broadcastSignal(
  roomId: string,
  chatId: string,
  signal: "chat-stream-start" | "chat-stream-end"
): Promise<void> {
  try {
    await broadcastChatEventViaDoc(roomId, { type: signal, chatId })
  } catch (e) {
    console.error("v2 broadcast signal failed:", e)
  }
}
