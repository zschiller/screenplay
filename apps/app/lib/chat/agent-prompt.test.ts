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
} satisfies Pick<
  ResolveTargetChatInput,
  "roomId" | "freshChatId" | "createdAt" | "message"
>

describe("resolveTargetChat", () => {
  it("sends in the Workspace's one chat", () => {
    const decision = resolveTargetChat({
      ...base,
      agent: agent(),
      chatSessions: [chat("c1", 1)],
    })

    expect(decision).toEqual({
      kind: "send",
      session: null,
      isFirstChat: true,
      select: { kind: "agent", agentId: "a1", chatId: "c1" },
      send: {
        roomId: "room-1",
        chatId: "c1",
        target: { kind: "agent", branchId: "a1", sandboxName: "sb-a1" },
        message: "do the thing",
        isFirstChat: true,
        planMode: undefined,
        model: undefined,
      },
    })
  })

  it("carries the chat's plan-mode and model forward", () => {
    const decision = resolveTargetChat({
      ...base,
      agent: agent(),
      chatSessions: [chat("c1", 1, { planMode: true, model: "opus" })],
    })
    expect(decision.kind === "send" && decision.send.planMode).toBe(true)
    expect(decision.kind === "send" && decision.send.model).toBe("opus")
  })

  it("sends in a busy chat rather than opening another (#1315)", () => {
    const decision = resolveTargetChat({
      ...base,
      agent: agent(),
      chatSessions: [chat("c1", 1, { isStreaming: true })],
    })
    expect(decision.kind === "send" && decision.select.chatId).toBe("c1")
    expect(decision.kind === "send" && decision.session).toBeNull()
  })

  it("picks the newest of an old canvas's chats, closed or not", () => {
    const decision = resolveTargetChat({
      ...base,
      agent: agent(),
      chatSessions: [
        chat("c1", 1),
        chat("c2", 2),
        chat("c3", 3, { closedAt: 99 }),
      ],
    })
    expect(decision.kind === "send" && decision.select.chatId).toBe("c3")
    expect(decision.kind === "send" && decision.session).toBeNull()
  })

  it("opens a fresh chat when the Workspace has none", () => {
    const decision = resolveTargetChat({
      ...base,
      agent: agent(),
      chatSessions: [],
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
        target: { kind: "agent", branchId: "a1", sandboxName: "sb-a1" },
        message: "do the thing",
        isFirstChat: true,
        planMode: undefined,
        model: undefined,
      },
    })
  })

  it("ignores other agents' chats", () => {
    const decision = resolveTargetChat({
      ...base,
      agent: agent(),
      chatSessions: [chat("other", 1, { branchId: "a2" })],
    })
    expect(decision.kind === "send" && decision.select.chatId).toBe("chat-new")
  })

  it("yields none when the agent has no sandbox yet", () => {
    const decision = resolveTargetChat({
      ...base,
      agent: agent({ sandboxName: "" }),
      chatSessions: [],
    })
    expect(decision).toEqual({ kind: "none" })
  })

  it("yields none when the agent has no branch ref", () => {
    const decision = resolveTargetChat({
      ...base,
      agent: agent({ ref: "" }),
      chatSessions: [],
    })
    expect(decision).toEqual({ kind: "none" })
  })
})
