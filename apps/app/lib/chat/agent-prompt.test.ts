import { describe, expect, it } from "vitest"

import {
  resolveTargetChat,
  type ResolveTargetChatInput,
} from "@/lib/chat/agent-prompt"
import type { BranchData, ChatSessionData } from "@/lib/types"

function agent(extra: Partial<BranchData> = {}): BranchData {
  return {
    id: "a1",
    repoId: "repo-1",
    sandboxName: "sb-a1",
    gitUrl: "",
    ref: "ref-a1",
    previewDomain: "",
    port: 3000,
    status: "running",
    createdAt: 1,
    ...extra,
  } as BranchData
}

function chat(
  id: string,
  createdAt: number,
  extra: Partial<ChatSessionData> = {}
): ChatSessionData {
  return {
    id,
    branchId: "a1",
    label: "Untitled",
    createdAt,
    ...extra,
  }
}

const base = {
  roomId: "room-1",
  freshChatId: "chat-new",
  createdAt: 42,
  message: "do the thing",
  isBusy: () => false,
} satisfies Pick<
  ResolveTargetChatInput,
  "roomId" | "freshChatId" | "createdAt" | "message" | "isBusy"
>

describe("resolveTargetChat", () => {
  it("reuses the remembered chat when it is still open", () => {
    const decision = resolveTargetChat({
      ...base,
      agent: agent(),
      chatSessions: [chat("c1", 1), chat("c2", 2)],
      rememberedChatId: "c2",
    })

    expect(decision).toEqual({
      kind: "send",
      session: null,
      isFirstChat: false,
      select: { kind: "agent", agentId: "a1", chatId: "c2" },
      send: {
        roomId: "room-1",
        chatId: "c2",
        sandboxName: "sb-a1",
        branch: "ref-a1",
        message: "do the thing",
        isFirstChat: false,
        autoNamedBranch: undefined,
        planMode: undefined,
        model: undefined,
      },
    })
  })

  it("carries the reused chat's plan-mode and model forward", () => {
    const decision = resolveTargetChat({
      ...base,
      agent: agent(),
      chatSessions: [chat("c1", 1, { planMode: true, model: "opus" })],
      rememberedChatId: "c1",
    })
    expect(decision.kind === "send" && decision.send.planMode).toBe(true)
    expect(decision.kind === "send" && decision.send.model).toBe("opus")
  })

  it("falls back to the first open chat when the remembered one is closed", () => {
    const decision = resolveTargetChat({
      ...base,
      agent: agent(),
      chatSessions: [
        chat("c1", 1),
        chat("c2", 2, { closedAt: 99 }),
        chat("c3", 3),
      ],
      rememberedChatId: "c2",
    })
    expect(decision.kind === "send" && decision.select.chatId).toBe("c1")
    expect(decision.kind === "send" && decision.session).toBeNull()
  })

  it("opens a fresh chat when the agent has no open chat", () => {
    const decision = resolveTargetChat({
      ...base,
      agent: agent(),
      chatSessions: [],
      rememberedChatId: undefined,
    })

    expect(decision).toEqual({
      kind: "send",
      session: {
        id: "chat-new",
        branchId: "a1",
        label: "Untitled",
        createdAt: 42,
      },
      isFirstChat: true,
      select: { kind: "agent", agentId: "a1", chatId: "chat-new" },
      send: {
        roomId: "room-1",
        chatId: "chat-new",
        sandboxName: "sb-a1",
        branch: "ref-a1",
        message: "do the thing",
        isFirstChat: true,
        autoNamedBranch: undefined,
        planMode: undefined,
        model: undefined,
      },
    })
  })

  it("bumps a busy (streaming) target to a fresh chat", () => {
    const decision = resolveTargetChat({
      ...base,
      isBusy: (id) => id === "c1",
      agent: agent(),
      chatSessions: [chat("c1", 1)],
      rememberedChatId: "c1",
    })
    expect(decision.kind === "send" && decision.select.chatId).toBe("chat-new")
    expect(decision.kind === "send" && decision.session?.id).toBe("chat-new")
    // A fresh chat is still not the agent's first — c1 already exists.
    expect(decision.kind === "send" && decision.send.isFirstChat).toBe(false)
  })

  it("treats a fresh chat as the first chat when no other chat exists", () => {
    const decision = resolveTargetChat({
      ...base,
      isBusy: () => true,
      agent: agent(),
      chatSessions: [chat("c1", 1)].filter(() => false),
      rememberedChatId: undefined,
    })
    expect(decision.kind === "send" && decision.send.isFirstChat).toBe(true)
  })

  it("ignores other agents' chats and only reuses this agent's", () => {
    const decision = resolveTargetChat({
      ...base,
      agent: agent(),
      chatSessions: [chat("other", 1, { branchId: "a2" })],
      rememberedChatId: undefined,
    })
    expect(decision.kind === "send" && decision.select.chatId).toBe("chat-new")
  })

  it("yields none when the agent has no sandbox yet", () => {
    const decision = resolveTargetChat({
      ...base,
      agent: agent({ sandboxName: "" }),
      chatSessions: [],
      rememberedChatId: undefined,
    })
    expect(decision).toEqual({ kind: "none" })
  })

  it("yields none when the agent has no branch ref", () => {
    const decision = resolveTargetChat({
      ...base,
      agent: agent({ ref: "" }),
      chatSessions: [],
      rememberedChatId: undefined,
    })
    expect(decision).toEqual({ kind: "none" })
  })
})
