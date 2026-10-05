import { describe, expect, it } from "vitest"
import {
  heldByOther,
  lastChangedBy,
  layerChat,
  layerHolder,
  layerHolders,
  layerRoute,
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

describe("holding a layer (#1725)", () => {
  const working = (
    id: string,
    layers: Record<string, number>,
    more: object = {}
  ) => ({
    id,
    branchId: `ws-${id}`,
    createdAt: 1,
    isStreaming: true,
    workingLayers: layers,
    ...more,
  })

  it.each([
    ["nobody while no turn changes it", [working("a", {})], undefined],
    ["the chat whose turn is changing it", [working("a", { m: 5 })], "a"],
    [
      "the chat that started on it first",
      [working("a", { m: 5 }), working("b", { m: 2 })],
      "b",
    ],
    [
      "nobody once the turn ended",
      [working("a", { m: 5 }, { isStreaming: false })],
      undefined,
    ],
    [
      "nobody for a closed chat",
      [working("a", { m: 5 }, { closedAt: 9 })],
      undefined,
    ],
  ])("is held by %s", (_, list, expected) => {
    expect(layerHolder("m", list)?.id).toBe(expected)
  })

  it("finds every held layer's holder at once (#1726)", () => {
    const list = [
      working("a", { m: 5, d: 1 }),
      working("b", { m: 2 }),
      working("c", { n: 1 }, { isStreaming: false }),
      working("e", { n: 1 }, { closedAt: 9 }),
    ]
    const holders = layerHolders(list)
    expect(new Map([...holders].map(([id, c]) => [id, c.id]))).toEqual(
      new Map([
        ["m", "b"],
        ["d", "a"],
      ])
    )
    for (const id of ["m", "d", "n"]) {
      expect(holders.get(id)).toBe(layerHolder(id, list))
    }
  })

  it("lets the holder change it and refuses everyone else", () => {
    const list = [working("a", { m: 5 }), working("b", { m: 7 })]
    expect(heldByOther("m", "a", list)).toBeUndefined()
    expect(heldByOther("m", "b", list)?.id).toBe("a")
    expect(heldByOther("m", "c", list)?.id).toBe("a")
    expect(heldByOther("other", "c", list)).toBeUndefined()
  })

  it("routes to the holder before the last changer", () => {
    const list = [working("a", { m: 5 }), working("b", {})]
    expect(layerRoute({ id: "m", lastChangedByChatId: "b" }, list)).toBe("a")
    expect(layerRoute({ id: "n", lastChangedByChatId: "b" }, list)).toBe("b")
    expect(layerRoute({ id: "n", ownerChatId: "b" }, list)).toBe("b")
    expect(layerChats([{ id: "m", lastChangedByChatId: "b" }], list)).toEqual(
      new Map([["m", { kind: "workspace", chatId: "a", branchId: "ws-a" }]])
    )
  })
})
