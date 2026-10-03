import { describe, expect, it } from "vitest"
import { mockupAskTargets } from "./document-owner"

const chats = [
  { id: "sketch", target: "sketch" as const, createdAt: 1 },
  { id: "old", branchId: "ws-1", createdAt: 1 },
  { id: "current", branchId: "ws-1", createdAt: 2 },
]

describe("mockupAskTargets", () => {
  it("sends a sketch-made Mockup's Ask to its Sketch Chat", () => {
    const targets = mockupAskTargets(
      [{ id: "m", ownerChatId: "sketch" }],
      chats
    )
    expect(targets.get("m")).toEqual({ kind: "sketch", chatId: "sketch" })
  })

  it("sends a Mockup made by an earlier chat to its Workspace's chat", () => {
    const targets = mockupAskTargets([{ id: "m", ownerChatId: "old" }], chats)
    expect(targets.get("m")).toEqual({
      kind: "workspace",
      chatId: "current",
      branchId: "ws-1",
    })
  })

  it("offers no Ask on a hand-made Mockup or one whose chat is gone", () => {
    const targets = mockupAskTargets(
      [{ id: "hand" }, { id: "orphan", ownerChatId: "deleted" }],
      chats
    )
    expect(targets.size).toBe(0)
  })
})
