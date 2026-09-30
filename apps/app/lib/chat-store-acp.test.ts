import { describe, expect, it, vi } from "vitest"
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
import { contentBlocksToWire, wireToContentBlocks } from "./agent/acp/markers"
import { projectUserTurn, userTurnEcho } from "./agent/user-turn"
import {
  buildReferencedDocsFooter,
  buildTargetedElementsFooter,
  prependTurnMarkers,
  serializeElement,
  serializeMention,
  serializeSkill,
  type TargetedElement,
} from "./agent/message-markers"

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

describe("chat-store — user turns, reload == live (#1252, #1253)", () => {
  const element: TargetedElement = {
    ref: "el1",
    route: "/login",
    selector: "button#submit",
    frameLabel: "Sign in",
    iframeLayerId: "layer-1",
  }

  const turns = [
    { kind: "plain", wire: "Fix the redirect" },
    {
      kind: "wake",
      wire: prependTurnMarkers("Workspace finished its turn.", {
        wakeFrom: "ws-1",
      }),
    },
    {
      kind: "delegated",
      wire: prependTurnMarkers("Keep the next param.", {
        delegatedFrom: "room-chat-r1",
        branch: "fix-sign-in",
      }),
    },
    {
      kind: "plan mode",
      wire: prependTurnMarkers("Plan it", { planMode: true }),
    },
    {
      kind: "mentions and skills",
      wire:
        `${serializeSkill("review")} ${serializeMention("Spec", "doc-1")}` +
        buildReferencedDocsFooter([{ id: "doc-1", title: "Spec" }]),
    },
    {
      kind: "targeted elements",
      wire:
        `Make ${serializeElement("button#submit", "el1")} blue` +
        buildTargetedElementsFooter([element]),
    },
  ]

  /** What a reload draws for a user turn persisted as `wire`. */
  const reload = (wire: string) =>
    renderHistory([
      {
        kind: "record",
        record: { role: "user", content: wireToContentBlocks(wire) },
      },
    ])

  it.each(turns)(
    "echoes a $kind turn the way a reload renders it",
    ({ wire }) => {
      const chatId = `chat_${++seq}`
      play(chatId, [
        { type: "chat-stream-start", chatId, id: nextId() },
        {
          type: "chat-acp-update",
          chatId,
          id: nextId(),
          // Turn Launch's echo of the persisted turn.
          update: userTurnEcho(wire),
        },
      ])

      expect(reload(wire)).toEqual(chatStore.getSnapshot(chatId).messages)
      chatStore.cleanup(chatId)
    }
  )

  it.each(turns)(
    "shows a $kind Steer pending, then taken, the way a reload renders it",
    ({ wire }) => {
      const chatId = `chat_${++seq}`
      // The Steer is stored as content blocks; the Steer path echoes those.
      const content = wireToContentBlocks(wire)
      play(chatId, [
        { type: "chat-stream-start", chatId, id: nextId() },
        {
          type: "chat-control",
          chatId,
          id: nextId(),
          control: {
            kind: "steer_pending",
            steer: { id: "s1", message: wire, turn: projectUserTurn(wire) },
          },
        },
      ])
      const [pending] = chatStore.getSnapshot(chatId).pendingSteers
      const [reloaded] = reload(wire)
      expect(reloaded).toMatchObject({ content: pending.turn.body })

      play(chatId, [
        {
          type: "chat-control",
          chatId,
          id: nextId(),
          control: { kind: "steers_taken", ids: ["s1"] },
        },
        {
          type: "chat-acp-update",
          chatId,
          id: nextId(),
          update: userTurnEcho(contentBlocksToWire(content)),
        },
      ])
      expect(chatStore.getSnapshot(chatId).pendingSteers).toEqual([])
      expect(chatStore.getSnapshot(chatId).messages).toEqual([reloaded])
      chatStore.cleanup(chatId)
    }
  )

  it("sends a Composer turn that already reads as its echo and its reload", async () => {
    const chatId = `chat_${++seq}`
    const body = `Make ${serializeElement("button#submit", "el1")} blue`
    const wire = body + buildTargetedElementsFooter([element])
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ runId: "run-1" }),
    }))
    vi.stubGlobal("fetch", fetchMock)
    try {
      await chatStore.sendMessage({
        roomId: "room-1",
        chatId,
        target: { kind: "room" },
        message: wire,
        turn: { body, targetedElements: [element] },
      })
    } finally {
      vi.unstubAllGlobals()
    }
    const sent = chatStore.getSnapshot(chatId).messages
    expect(sent).toEqual(reload(wire))

    play(chatId, [
      { type: "chat-stream-start", chatId, id: nextId() },
      {
        type: "chat-acp-update",
        chatId,
        id: nextId(),
        update: userTurnEcho(wire),
      },
    ])
    // The echo dedups against the optimistic message rather than doubling it.
    expect(chatStore.getSnapshot(chatId).messages).toEqual(sent)
    chatStore.cleanup(chatId)
  })
})
