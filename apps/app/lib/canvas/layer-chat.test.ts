import { describe, expect, it } from "vitest"
import {
  lastChangedBy,
  layerChat,
  layerChats,
  layerWorkspaceIds,
} from "./layer-chat"

const chats = [
  { id: "sketch", target: "sketch" as const, createdAt: 1 },
  { id: "old", branchId: "ws-1", createdAt: 1 },
  { id: "current", branchId: "ws-1", createdAt: 2 },
  { id: "other", branchId: "ws-2", createdAt: 3 },
]

describe("lastChangedBy", () => {
  it.each([
    ["the chat that last changed it", { lastChangedByChatId: "b" }, "b"],
    [
      "the last changer over the chat that made it",
      { lastChangedByChatId: "b", ownerChatId: "a" },
      "b",
    ],
    [
      "the chat that made a layer from before (#1724)",
      { ownerChatId: "a" },
      "a",
    ],
    ["nothing for a layer made by hand", {}, undefined],
  ])("reads %s", (_, layer, expected) => {
    expect(lastChangedBy(layer)).toBe(expected)
  })
})

describe("layerChat", () => {
  it("goes to the Sketch Chat that last changed it", () => {
    expect(layerChat("sketch", chats)).toEqual({
      kind: "sketch",
      chatId: "sketch",
    })
  })

  it("goes to the Workspace's chat when an earlier chat changed it", () => {
    expect(layerChat("old", chats)).toEqual({
      kind: "workspace",
      chatId: "current",
      branchId: "ws-1",
    })
  })

  it("goes nowhere for a layer no chat changed", () => {
    expect(layerChat(undefined, chats)).toBeNull()
  })

  it("goes nowhere once its last chat was deleted", () => {
    expect(layerChat("deleted", chats)).toBeNull()
  })

  it("goes nowhere for a layer the Coordinator changed", () => {
    expect(layerChat("room", [...chats, { id: "room", createdAt: 3 }])).toBe(
      null
    )
  })
})

describe("layerChats", () => {
  it("routes each layer to its last changer, by id", () => {
    const routes = layerChats(
      [
        { id: "m", lastChangedByChatId: "sketch" },
        // Made by one chat, changed since by another.
        { id: "moved", ownerChatId: "sketch", lastChangedByChatId: "other" },
        // From before the shared rule: the chat that made it.
        { id: "d", ownerChatId: "old" },
        { id: "hand" },
        { id: "gone", lastChangedByChatId: "deleted" },
      ],
      chats
    )
    expect([...routes.keys()]).toEqual(["m", "moved", "d"])
    expect(routes.get("moved")).toEqual({
      kind: "workspace",
      chatId: "other",
      branchId: "ws-2",
    })
    expect(routes.get("d")?.chatId).toBe("current")
  })
})

describe("layerWorkspaceIds", () => {
  it("maps each layer a Workspace's chat last changed to that Workspace", () => {
    expect(
      layerWorkspaceIds(
        [
          { id: "doc-1", lastChangedByChatId: "current" },
          { id: "doc-2" },
          { id: "doc-3", lastChangedByChatId: "deleted" },
          { id: "doc-4", lastChangedByChatId: "sketch" },
          { id: "doc-5", ownerChatId: "old", lastChangedByChatId: "other" },
        ],
        chats
      )
    ).toEqual(
      new Map([
        ["doc-1", "ws-1"],
        ["doc-5", "ws-2"],
      ])
    )
  })
})
