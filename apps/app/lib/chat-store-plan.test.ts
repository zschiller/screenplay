import { describe, expect, it } from "vitest"
import { chatStore } from "./chat-store"
import { planPermissionRequest } from "./agent/acp/schema"

let seq = 0
const nextId = () => `evt_${++seq}`

function play(
  chatId: string,
  events: Array<Parameters<typeof chatStore.handleBroadcastEvent>[0]>
) {
  for (const e of events) chatStore.handleBroadcastEvent(e)
}

describe("chat-store — plan gate (ACP)", () => {
  it("renders an ACP permission request as a pending plan card", () => {
    const chatId = `chat_${++seq}`
    play(chatId, [
      { type: "chat-stream-start", chatId, id: nextId() },
      {
        type: "chat-acp-permission",
        chatId,
        id: nextId(),
        request: planPermissionRequest({
          sessionId: chatId,
          toolCallId: "toolu_plan_1",
          plan: "## Plan\n- step one",
        }),
      },
    ])

    expect(chatStore.getSnapshot(chatId).messages).toEqual([
      {
        role: "plan",
        content: "## Plan\n- step one",
        status: "pending",
        planId: "toolu_plan_1",
      },
    ])
    chatStore.cleanup(chatId)
  })

  it("flips the plan card to rejected and shows the feedback as the human's next turn", () => {
    const chatId = `chat_${++seq}`
    play(chatId, [
      { type: "chat-stream-start", chatId, id: nextId() },
      {
        type: "chat-acp-permission",
        chatId,
        id: nextId(),
        request: planPermissionRequest({
          sessionId: chatId,
          toolCallId: "toolu_plan_2",
          plan: "do X",
        }),
      },
      // The human rejects: the card flips via the control envelope, and the
      // feedback rides its own ACP `user_message_chunk` echo (the continuation
      // the agent acts on) — feedback shown, ACP-native, no bespoke event.
      {
        type: "chat-control",
        chatId,
        id: nextId(),
        control: {
          kind: "plan_resolved",
          planId: "toolu_plan_2",
          approved: false,
        },
      },
      {
        type: "chat-acp-update",
        chatId,
        id: nextId(),
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "Do Y instead." },
        },
      },
    ])

    expect(chatStore.getSnapshot(chatId).messages).toEqual([
      {
        role: "plan",
        content: "do X",
        status: "rejected",
        planId: "toolu_plan_2",
      },
      { role: "user", content: "Do Y instead." },
    ])
    chatStore.cleanup(chatId)
  })

  it("flips the plan card to approved on approval", () => {
    const chatId = `chat_${++seq}`
    play(chatId, [
      { type: "chat-stream-start", chatId, id: nextId() },
      {
        type: "chat-acp-permission",
        chatId,
        id: nextId(),
        request: planPermissionRequest({
          sessionId: chatId,
          toolCallId: "toolu_plan_3",
          plan: "do X",
        }),
      },
      {
        type: "chat-control",
        chatId,
        id: nextId(),
        control: {
          kind: "plan_resolved",
          planId: "toolu_plan_3",
          approved: true,
        },
      },
    ])

    expect(chatStore.getSnapshot(chatId).messages).toEqual([
      {
        role: "plan",
        content: "do X",
        status: "approved",
        planId: "toolu_plan_3",
      },
    ])
    chatStore.cleanup(chatId)
  })
})
