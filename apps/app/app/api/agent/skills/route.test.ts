import { describe, expect, it, vi } from "vitest"

import { makeHarness } from "@/test/canvas/harness"
import type { RoomCollections } from "@/lib/yjs/schema"

/**
 * The `/`-menu Skill route (#1555): a member's request for a canvas lists its
 * saved Skills among the App Skills; anyone else gets the room's refusal.
 */

vi.mock("@/lib/auth-helpers", () => ({ getUserId: async () => "user-1" }))
let collections: RoomCollections
vi.mock("@/lib/room-access", () => ({
  openRoomForRoute: async (roomId: string) =>
    roomId === "room-1"
      ? {
          roomId,
          readDoc: async <T>(fn: (c: RoomCollections) => T) => fn(collections),
          mutateDoc: async <T>(fn: (c: RoomCollections) => T) =>
            fn(collections),
        }
      : new Response("Not a member", { status: 403 }),
}))

import { GET } from "./route"

function folder(path: string, description?: string) {
  return {
    id: `f-${path}`,
    path,
    kind: "folder" as const,
    size: 0,
    mediaType: "",
    addedBy: "agent" as const,
    addedById: "chat-1",
    blobKey: "",
    createdAt: 1,
    updatedAt: 1,
    ...(description === undefined ? {} : { description }),
  }
}

describe("GET /api/agent/skills", () => {
  it("lists a canvas's saved Skills, shadowing an App Skill of the same name", async () => {
    collections = makeHarness().collections
    collections.skills.set("f-review", folder("review", "Review a PR."))
    collections.skills.set(
      "f-knob",
      folder("screenplay-add-knob", "Canvas knob.")
    )

    const res = await GET(
      new Request("http://localhost/api/agent/skills?room=room-1")
    )
    const { skills } = await res.json()

    expect(skills).toContainEqual({
      name: "review",
      description: "Review a PR.",
      origin: "canvas",
    })
    expect(
      skills.filter((s: { name: string }) => s.name === "screenplay-add-knob")
    ).toEqual([
      {
        name: "screenplay-add-knob",
        description: "Canvas knob.",
        origin: "canvas",
      },
    ])
  })

  it("refuses a canvas the asker isn't a member of", async () => {
    const res = await GET(
      new Request("http://localhost/api/agent/skills?room=room-2")
    )
    expect(res.status).toBe(403)
  })

  it("lists App Skills only with no canvas or sandbox", async () => {
    const res = await GET(new Request("http://localhost/api/agent/skills"))
    const { skills } = await res.json()
    expect(skills.length).toBeGreaterThan(0)
    expect(skills.every((s: { origin: string }) => s.origin === "app")).toBe(
      true
    )
  })
})
