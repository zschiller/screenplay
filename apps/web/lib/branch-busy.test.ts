import { describe, expect, it } from "vitest"
import { type BranchBusyChat, isBranchBusy } from "./branch-busy"

/** Build a chat fixture targeting a branch; defaults to an open, idle chat. */
function chat(overrides: Partial<BranchBusyChat> = {}): BranchBusyChat {
  return {
    branchId: "branch-1",
    closedAt: undefined,
    isStreaming: false,
    ...overrides,
  }
}

describe("isBranchBusy", () => {
  // The Engine has no per-Branch status field — a "running agent" *is* a
  // streaming chat targeting the branch — so the running-agent and
  // streaming-chat acceptance cases collapse onto the same `isStreaming` signal.
  const cases: {
    name: string
    branchId: string
    chats: BranchBusyChat[]
    expected: boolean
  }[] = [
    {
      name: "running agent (a targeting chat is streaming) ⇒ busy",
      branchId: "branch-1",
      chats: [chat({ isStreaming: true })],
      expected: true,
    },
    {
      name: "any one of several targeting chats streaming ⇒ busy",
      branchId: "branch-1",
      chats: [chat(), chat({ isStreaming: true }), chat()],
      expected: true,
    },
    {
      name: "idle agent + no streaming chat ⇒ not busy",
      branchId: "branch-1",
      chats: [chat(), chat()],
      expected: false,
    },
    {
      name: "no chats at all ⇒ not busy",
      branchId: "branch-1",
      chats: [],
      expected: false,
    },
    {
      name: "a streaming chat targeting a *different* branch ⇒ not busy",
      branchId: "branch-1",
      chats: [chat({ branchId: "branch-2", isStreaming: true })],
      expected: false,
    },
    {
      name: "a closed chat still flagged streaming ⇒ not busy",
      branchId: "branch-1",
      chats: [chat({ isStreaming: true, closedAt: 123 })],
      expected: false,
    },
    {
      name: "undefined isStreaming counts as idle ⇒ not busy",
      branchId: "branch-1",
      chats: [chat({ isStreaming: undefined })],
      expected: false,
    },
  ]

  for (const { name, branchId, chats, expected } of cases) {
    it(name, () => {
      expect(isBranchBusy(branchId, chats)).toBe(expected)
    })
  }
})
