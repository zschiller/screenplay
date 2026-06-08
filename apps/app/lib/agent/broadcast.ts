import "server-only"

import type { AgentStreamEvent } from "@/lib/agent/types"
import type { SessionUpdate } from "@/lib/agent/acp/schema"
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

export async function broadcastEvent(
  roomId: string,
  chatId: string,
  event: AgentStreamEvent
): Promise<void> {
  try {
    await broadcastChatEventViaDoc(roomId, {
      type: "chat-stream",
      chatId,
      event: JSON.parse(JSON.stringify(event)),
    })
  } catch (e) {
    console.error("v2 broadcast failed:", e)
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

/**
 * Per-stream accumulator that translates streamText `onChunk` callbacks into
 * the `AgentStreamEvent` wire format the v1 client already understands.
 *
 * Text deltas accumulate per text block id and broadcast cumulatively (the
 * v1 chat-store applies `text` events by replacing the trailing assistant
 * message). Tool-calls and tool-results map 1:1 onto `tool_use` / `tool_result`
 * events. `submit_plan` is intentionally suppressed here — the stream route
 * emits a `plan_submitted` event instead once the loop halts on it.
 */
export class StreamBroadcaster {
  private textBuffers = new Map<string, string>()

  constructor(
    private readonly roomId: string,
    private readonly chatId: string
  ) {}

  async onTextDelta(textId: string, delta: string): Promise<void> {
    const next = (this.textBuffers.get(textId) ?? "") + delta
    this.textBuffers.set(textId, next)
    await broadcastEvent(this.roomId, this.chatId, {
      type: "text",
      text: next,
      textId,
    })
  }

  /**
   * A new text block is starting — clear the previous block's buffer so the
   * client appends a fresh assistant message rather than replacing the old
   * one. Without this, agent text emitted across tool steps would clobber
   * each other in the UI.
   */
  startNewTextBlock(): void {
    this.textBuffers.clear()
  }

  async onToolCall(toolName: string, input: unknown): Promise<void> {
    if (toolName === "submit_plan") return // surfaced as plan_submitted
    await broadcastEvent(this.roomId, this.chatId, {
      type: "tool_use",
      name: toolName,
      input: input as Record<string, unknown>,
    })
  }

  async onToolResult(toolName: string, output: unknown): Promise<void> {
    if (toolName === "submit_plan") return
    await broadcastEvent(this.roomId, this.chatId, {
      type: "tool_result",
      name: toolName,
      output: typeof output === "string" ? output : JSON.stringify(output),
    })
  }

  async onError(message: string): Promise<void> {
    await broadcastEvent(this.roomId, this.chatId, { type: "error", message })
  }

  async onUserMessage(text: string): Promise<void> {
    await broadcastEvent(this.roomId, this.chatId, {
      type: "user_message",
      text,
    })
  }
}
