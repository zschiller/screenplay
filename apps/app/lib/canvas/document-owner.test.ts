import { describe, expect, it } from "vitest"
import { editRight, isOrphaned, mockupAskTargets } from "./document-owner"

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

  it("offers no Ask on a hand-made Mockup", () => {
    const targets = mockupAskTargets([{ id: "hand" }], chats)
    expect(targets.size).toBe(0)
  })

  it("sends the Ask on a Mockup whose chat was deleted to the chat shown", () => {
    const targets = mockupAskTargets(
      [{ id: "orphan", ownerChatId: "deleted" }],
      chats
    )
    expect(targets.get("orphan")).toEqual({ kind: "shown" })
  })
})

describe("editRight", () => {
  const exists = (id: string) => chats.some((c) => c.id === id)

  it("lets a chat edit what it made", () => {
    expect(editRight("old", "old", exists)).toBe("own")
  })

  it("refuses another chat's layer while that chat is on the canvas", () => {
    expect(editRight("old", "sketch", exists)).toBe("theirs")
  })

  it("lets any chat claim a layer whose chat was deleted", () => {
    expect(editRight("deleted", "sketch", exists)).toBe("claim")
  })

  it("refuses a layer made by hand", () => {
    expect(editRight(undefined, "sketch", exists)).toBe("theirs")
  })
})

describe("isOrphaned", () => {
  it("is true only when the owning chat is gone", () => {
    expect(isOrphaned("deleted", chats)).toBe(true)
    expect(isOrphaned("old", chats)).toBe(false)
    expect(isOrphaned(undefined, chats)).toBe(false)
  })
})
