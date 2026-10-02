import { describe, expect, it } from "vitest"

import {
  buildNoRepositoryTools,
  roomHasRepository,
} from "@/lib/agent/no-repository-tools"
import type { RoomDoc, RoomReader } from "@/lib/room-access"
import { makeHarness } from "@/test/canvas/harness"

function reader(collections: ReturnType<typeof makeHarness>["collections"]) {
  return {
    roomId: "room-1",
    readDoc: async (fn) => fn(collections),
  } as RoomReader
}

describe("roomHasRepository", () => {
  it("is false on a canvas with no repository", async () => {
    const { collections } = makeHarness()
    expect(await roomHasRepository(reader(collections))).toBe(false)
  })

  it("is true once a repository is added", async () => {
    const { collections } = makeHarness()
    collections.repos.set("repo-1", {
      id: "repo-1",
    } as never)
    expect(await roomHasRepository(reader(collections))).toBe(true)
  })

  it("keeps the Coordinator delegating when the read fails", async () => {
    const room = {
      roomId: "room-1",
      readDoc: async () => {
        throw new Error("offline")
      },
    } as unknown as RoomReader
    expect(await roomHasRepository(room)).toBe(true)
  })
})

describe("buildNoRepositoryTools", () => {
  function coordinatorTools() {
    const h = makeHarness()
    const room = {
      roomId: "room-1",
      readDoc: async (fn) => fn(h.collections),
      mutateDoc: async (fn) => fn(h.collections),
    } as RoomDoc
    const tools = buildNoRepositoryTools({ room, chatId: "room-chat-room-1" })
    const run = (name: string, input: unknown) =>
      tools[name]!.execute!(input as never, {} as never) as Promise<string>
    return { ...h, run }
  }

  it("draws a Mockup on an empty canvas, owned by the Coordinator", async () => {
    const { run, collections } = coordinatorTools()

    const out = await run("create_mockup", {
      title: "Landing",
      html: "<h1>Hi</h1>",
    })

    expect(out).toContain('Created Mockup "Landing"')
    expect(collections.mockupLayers.toArray()).toEqual([
      expect.objectContaining({
        title: "Landing",
        ownerChatId: "room-chat-room-1",
      }),
    ])
  })

  it("writes a Document on an empty canvas, owned by the Coordinator", async () => {
    const { run, collections } = coordinatorTools()

    const out = await run("create_document", {
      title: "Plan",
      content: "First, sketch.",
    })

    expect(out).toContain('Created document "Plan"')
    expect(collections.markdownLayers.toArray()).toEqual([
      expect.objectContaining({ ownerChatId: "room-chat-room-1" }),
    ])
  })
})
