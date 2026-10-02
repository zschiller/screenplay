import { describe, expect, it } from "vitest"

import { isEarlierChat, workspaceChatId } from "@/lib/chat/workspace-chat"

const chat = (
  id: string,
  createdAt: number,
  branchId: string | undefined = "b1"
) => ({ id, createdAt, branchId })

describe("workspaceChatId", () => {
  it("is the Workspace's only chat", () => {
    expect(workspaceChatId([chat("c1", 1)], "b1")).toBe("c1")
  })

  it("is undefined for a Workspace with no chat", () => {
    expect(workspaceChatId([chat("c1", 1, "b2")], "b1")).toBeUndefined()
  })

  it("is the newest of an old canvas's chats, closed or not", () => {
    const chats = [chat("c1", 1), chat("c3", 3), chat("c2", 2)]
    expect(workspaceChatId(chats, "b1")).toBe("c3")
  })

  it("ignores other Workspaces' chats and the Coordinator", () => {
    const chats = [
      chat("c1", 1),
      chat("c9", 9, "b2"),
      { id: "room", createdAt: 10, branchId: undefined },
    ]
    expect(workspaceChatId(chats, "b1")).toBe("c1")
  })

  it("breaks a createdAt tie by id, so every caller agrees", () => {
    const chats = [chat("a", 5), chat("b", 5)]
    expect(workspaceChatId(chats, "b1")).toBe("b")
    expect(workspaceChatId([...chats].reverse(), "b1")).toBe("b")
  })
})

describe("isEarlierChat", () => {
  const chats = [chat("c1", 1), chat("c2", 2)]

  it("marks the older chats on a Workspace", () => {
    expect(isEarlierChat(chats, chats[0]!)).toBe(true)
    expect(isEarlierChat(chats, chats[1]!)).toBe(false)
  })

  it("never marks a chat with no Workspace", () => {
    expect(isEarlierChat(chats, { id: "room", branchId: undefined })).toBe(
      false
    )
  })
})
