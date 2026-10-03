import { describe, expect, it } from "vitest"
import {
  editRight,
  isOrphaned,
  layerOwner,
  layerOwners,
  orphanedLayerIds,
} from "./document-owner"

const chats = [
  { id: "sketch", target: "sketch" as const, createdAt: 1 },
  { id: "old", branchId: "ws-1", createdAt: 1 },
  { id: "current", branchId: "ws-1", createdAt: 2 },
]

describe("layerOwner", () => {
  it("gives a sketch-made layer to its Sketch Chat", () => {
    expect(layerOwner("sketch", chats)).toEqual({
      kind: "sketch",
      chatId: "sketch",
    })
  })

  it("gives a layer an earlier chat made to its Workspace's chat", () => {
    expect(layerOwner("old", chats)).toEqual({
      kind: "workspace",
      chatId: "current",
      branchId: "ws-1",
    })
  })

  it("gives a hand-made layer no owner", () => {
    expect(layerOwner(undefined, chats)).toBeNull()
  })

  it("gives a layer whose chat was deleted no owner", () => {
    expect(layerOwner("deleted", chats)).toBeNull()
  })

  it("gives a layer the Coordinator made no owner", () => {
    expect(layerOwner("room", [...chats, { id: "room", createdAt: 3 }])).toBe(
      null
    )
  })
})

describe("layerOwners", () => {
  it("maps each layer with an owner, by id", () => {
    const owners = layerOwners(
      [
        { id: "m", ownerChatId: "sketch" },
        { id: "d", ownerChatId: "old" },
        { id: "hand" },
        { id: "orphan", ownerChatId: "deleted" },
      ],
      chats
    )
    expect([...owners.keys()]).toEqual(["m", "d"])
    expect(owners.get("d")?.chatId).toBe("current")
  })
})

describe("orphanedLayerIds", () => {
  it("lists only the layers whose chat was deleted", () => {
    expect(
      orphanedLayerIds(
        [
          { id: "m", ownerChatId: "sketch" },
          { id: "hand" },
          { id: "orphan", ownerChatId: "deleted" },
        ],
        chats
      )
    ).toEqual(new Set(["orphan"]))
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
