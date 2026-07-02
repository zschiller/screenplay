import { describe, expect, it } from "vitest"
import { chatStore } from "./chat-store"
import {
  agentMessageChunk,
  agentThoughtChunk,
  toolCallStart,
  toolCallUpdate,
  type SessionUpdate,
  type ToolCallContent,
} from "./agent/acp/schema"
import { applyToolCallUpdate } from "./agent/acp/record"
import { renderHistory } from "./agent/history-render"

/** Attach a subagent parent id to a `tool_call(_update)` (issue #639). */
const withParent = (
  update: SessionUpdate,
  parentToolUseId: string
): SessionUpdate =>
  ({
    ...update,
    _meta: { claudeCode: { toolName: "Read", parentToolUseId } },
  }) as SessionUpdate

let seq = 0
const nextId = () => `evt_${++seq}`

/** Drive a fresh chat through a sequence of broadcast events. */
function play(
  chatId: string,
  events: Array<Parameters<typeof chatStore.handleBroadcastEvent>[0]>
) {
  for (const e of events) chatStore.handleBroadcastEvent(e)
}

describe("chat-store — ACP text path (renders the server's broadcast)", () => {
  it("accumulates agent_message_chunk deltas into one assistant message", () => {
    const chatId = `chat_${++seq}`
    play(chatId, [
      { type: "chat-stream-start", chatId, id: nextId() },
      {
        type: "chat-acp-update",
        chatId,
        id: nextId(),
        update: agentMessageChunk("Hel"),
      },
      {
        type: "chat-acp-update",
        chatId,
        id: nextId(),
        update: agentMessageChunk("lo"),
      },
      { type: "chat-stream-end", chatId, id: nextId() },
    ])

    expect(chatStore.getSnapshot(chatId).messages).toEqual([
      { role: "assistant", content: "Hello" },
    ])
    chatStore.cleanup(chatId)
  })

  it("starts a fresh assistant block per turn (stream-start resets the accumulator)", () => {
    const chatId = `chat_${++seq}`
    play(chatId, [
      { type: "chat-stream-start", chatId, id: nextId() },
      {
        type: "chat-acp-update",
        chatId,
        id: nextId(),
        update: agentMessageChunk("first"),
      },
      { type: "chat-stream-end", chatId, id: nextId() },
      { type: "chat-stream-start", chatId, id: nextId() },
      {
        type: "chat-acp-update",
        chatId,
        id: nextId(),
        update: agentMessageChunk("second"),
      },
      { type: "chat-stream-end", chatId, id: nextId() },
    ])

    expect(chatStore.getSnapshot(chatId).messages).toEqual([
      { role: "assistant", content: "first" },
      { role: "assistant", content: "second" },
    ])
    chatStore.cleanup(chatId)
  })

  it("accumulates thought chunks into a reasoning message, distinct from the reply", () => {
    const chatId = `chat_${++seq}`
    play(chatId, [
      { type: "chat-stream-start", chatId, id: nextId() },
      {
        type: "chat-acp-update",
        chatId,
        id: nextId(),
        update: agentThoughtChunk("let me "),
      },
      {
        type: "chat-acp-update",
        chatId,
        id: nextId(),
        update: agentThoughtChunk("think"),
      },
      {
        type: "chat-acp-update",
        chatId,
        id: nextId(),
        update: agentMessageChunk("Answer"),
      },
      { type: "chat-stream-end", chatId, id: nextId() },
    ])

    // Reasoning lands in its own `reasoning` message, ahead of the assistant
    // reply — the renderer shows it in a collapsible block apart from the body.
    expect(chatStore.getSnapshot(chatId).messages).toEqual([
      { role: "reasoning", content: "let me think" },
      { role: "assistant", content: "Answer" },
    ])
    chatStore.cleanup(chatId)
  })

  it("dedups a chunk delivered by two subscribers (same event id)", () => {
    const chatId = `chat_${++seq}`
    const startId = nextId()
    const chunkId = nextId()
    play(chatId, [
      { type: "chat-stream-start", chatId, id: startId },
      {
        type: "chat-acp-update",
        chatId,
        id: chunkId,
        update: agentMessageChunk("once"),
      },
      // Same event id again (second Room subscriber) — must not double-apply.
      {
        type: "chat-acp-update",
        chatId,
        id: chunkId,
        update: agentMessageChunk("once"),
      },
    ])

    expect(chatStore.getSnapshot(chatId).messages).toEqual([
      { role: "assistant", content: "once" },
    ])
    chatStore.cleanup(chatId)
  })
})

describe("chat-store — ACP tool-call lifecycle (in place, keyed by id)", () => {
  it("advances one tool-call row pending → in_progress → completed without spawning rows", () => {
    const chatId = `chat_${++seq}`
    const diff: ToolCallContent = {
      type: "diff",
      path: "src/a.ts",
      oldText: "old",
      newText: "new",
    }
    play(chatId, [
      { type: "chat-stream-start", chatId, id: nextId() },
      {
        type: "chat-acp-update",
        chatId,
        id: nextId(),
        update: toolCallStart({
          toolCallId: "call_1",
          title: "edit_file",
          kind: "edit",
          status: "pending",
        }),
      },
      {
        type: "chat-acp-update",
        chatId,
        id: nextId(),
        update: toolCallUpdate({ toolCallId: "call_1", status: "in_progress" }),
      },
      {
        type: "chat-acp-update",
        chatId,
        id: nextId(),
        update: toolCallUpdate({
          toolCallId: "call_1",
          status: "completed",
          content: [diff],
        }),
      },
    ])

    // One row, merged in place to its final state — the diff carried as
    // structure, not flattened to text.
    expect(chatStore.getSnapshot(chatId).messages).toEqual([
      {
        role: "tool_call",
        toolCallId: "call_1",
        title: "edit_file",
        kind: "edit",
        status: "completed",
        content: [diff],
        rawInput: undefined,
      },
    ])
    chatStore.cleanup(chatId)
  })

  it("interleaves agent text and a tool call without clobbering either", () => {
    const chatId = `chat_${++seq}`
    play(chatId, [
      { type: "chat-stream-start", chatId, id: nextId() },
      {
        type: "chat-acp-update",
        chatId,
        id: nextId(),
        update: agentMessageChunk("Reading the file"),
      },
      {
        type: "chat-acp-update",
        chatId,
        id: nextId(),
        update: toolCallStart({ toolCallId: "call_1", title: "read_file" }),
      },
      {
        type: "chat-acp-update",
        chatId,
        id: nextId(),
        update: toolCallUpdate({ toolCallId: "call_1", status: "completed" }),
      },
      // Text after the tool call starts a fresh assistant message.
      {
        type: "chat-acp-update",
        chatId,
        id: nextId(),
        update: agentMessageChunk("Done"),
      },
    ])

    const messages = chatStore.getSnapshot(chatId).messages
    expect(messages.map((m) => m.role)).toEqual([
      "assistant",
      "tool_call",
      "assistant",
    ])
    expect(messages[0]).toEqual({
      role: "assistant",
      content: "Reading the file",
    })
    expect(messages[2]).toEqual({ role: "assistant", content: "Done" })
    chatStore.cleanup(chatId)
  })

  it("keeps two concurrent tool calls separate by id", () => {
    const chatId = `chat_${++seq}`
    play(chatId, [
      { type: "chat-stream-start", chatId, id: nextId() },
      {
        type: "chat-acp-update",
        chatId,
        id: nextId(),
        update: toolCallStart({ toolCallId: "a", title: "read_file" }),
      },
      {
        type: "chat-acp-update",
        chatId,
        id: nextId(),
        update: toolCallStart({ toolCallId: "b", title: "run_command" }),
      },
      {
        type: "chat-acp-update",
        chatId,
        id: nextId(),
        update: toolCallUpdate({ toolCallId: "a", status: "completed" }),
      },
    ])

    const messages = chatStore.getSnapshot(chatId).messages
    expect(messages).toHaveLength(2)
    expect(messages.map((m) => m.role === "tool_call" && m.status)).toEqual([
      "completed",
      "pending",
    ])
    chatStore.cleanup(chatId)
  })

  it("lands a subagent tool call with parentToolCallId, and reload == live", () => {
    const chatId = `chat_${++seq}`
    // A subagent (`Task`) child call: the creation frame carries the parent id
    // in `_meta`; the completing update omits it and must not clear it.
    const startUpdate = withParent(
      toolCallStart({
        toolCallId: "child_read",
        title: "Read config.ts",
        kind: "read",
        status: "pending",
      }),
      "parent_task"
    )
    const doneUpdate = toolCallUpdate({
      toolCallId: "child_read",
      status: "completed",
    })

    play(chatId, [
      { type: "chat-stream-start", chatId, id: nextId() },
      { type: "chat-acp-update", chatId, id: nextId(), update: startUpdate },
      { type: "chat-acp-update", chatId, id: nextId(), update: doneUpdate },
    ])

    const [live] = chatStore.getSnapshot(chatId).messages
    expect(live).toMatchObject({
      role: "tool_call",
      toolCallId: "child_read",
      status: "completed",
      parentToolCallId: "parent_task",
    })

    // Reload path: the consumer persists via the same `applyToolCallUpdate`
    // seam, so fold the frames into a durable record and render it. Post-change
    // reload reproduces the live shape — parent linkage and all.
    const record = applyToolCallUpdate(
      applyToolCallUpdate(undefined, startUpdate),
      doneUpdate
    )
    const [reloaded] = renderHistory([{ kind: "record", record }])
    expect(reloaded).toEqual(live)
    chatStore.cleanup(chatId)
  })
})
