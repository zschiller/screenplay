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

describe("chat-store — plan gate", () => {
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

  it("shows rejection feedback on the plan card (the gap #379 closes)", () => {
    const chatId = `chat_${++seq}`
    play(chatId, [
      { type: "chat-stream-start", chatId, id: nextId() },
      {
        type: "chat-stream",
        chatId,
        id: nextId(),
        event: {
          type: "plan_submitted",
          planId: "toolu_plan_2",
          plan: "do X",
          toolEventId: "te_1",
        },
      },
      {
        type: "chat-stream",
        chatId,
        id: nextId(),
        event: {
          type: "plan_rejected",
          planId: "toolu_plan_2",
          feedback: "Do Y instead.",
        },
      },
    ])

    expect(chatStore.getSnapshot(chatId).messages).toEqual([
      {
        role: "plan",
        content: "do X",
        status: "rejected",
        planId: "toolu_plan_2",
        feedback: "Do Y instead.",
      },
    ])
    chatStore.cleanup(chatId)
  })

  it("leaves feedback unset on approval", () => {
    const chatId = `chat_${++seq}`
    play(chatId, [
      { type: "chat-stream-start", chatId, id: nextId() },
      {
        type: "chat-stream",
        chatId,
        id: nextId(),
        event: {
          type: "plan_submitted",
          planId: "toolu_plan_3",
          plan: "do X",
          toolEventId: "te_2",
        },
      },
      {
        type: "chat-stream",
        chatId,
        id: nextId(),
        event: { type: "plan_approved", planId: "toolu_plan_3" },
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
