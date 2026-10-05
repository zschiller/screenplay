import { beforeEach, describe, expect, it, vi } from "vitest"

// Room Access decides who's a member; the route only has to honour it.
const fx = vi.hoisted(() => ({
  response: null as Response | null,
  sourcesFor: vi.fn(),
}))
vi.mock("@/lib/room-access", () => ({
  openRoomForRoute: async (roomId: string) =>
    fx.response ?? { roomId, userId: "user-1", role: "member" },
}))
vi.mock("@/lib/mockup-refs-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mockup-refs-server")>()),
  mockupRefSources: async (...args: unknown[]) => {
    fx.sourcesFor(...args)
    return {
      skillFile: async (skill: string, path: string) =>
        skill === "explore" && path === "a.js"
          ? { type: "text/javascript", bytes: new TextEncoder().encode("a") }
          : null,
      canvasFile: async () => null,
    }
  },
}))

import { POST } from "./route"

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/mockup-refs/room-1", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ roomId: "room-1" }) }
  )

describe("POST /api/mockup-refs/[roomId]", () => {
  beforeEach(() => {
    fx.response = null
    fx.sourcesFor.mockClear()
  })

  it("resolves a member's references, as their own chats see Skills", async () => {
    const res = await post({
      mockupId: "m-1",
      refs: ["skill:explore/a.js", "files:gone.png"],
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(await res.json()).toEqual({
      resources: {
        "skill:explore/a.js": { type: "text/javascript", data: "YQ==" },
        "files:gone.png": null,
      },
    })
    expect(fx.sourcesFor).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: "room-1" }),
      { mockupId: "m-1", userId: "user-1" }
    )
  })

  it("resolves nothing for someone who isn't a member", async () => {
    fx.response = new Response("You don't have access", { status: 403 })
    const res = await post({ mockupId: "m-1", refs: ["files:a.png"] })
    expect(res.status).toBe(403)
    expect(fx.sourcesFor).not.toHaveBeenCalled()
  })

  it("refuses a body that isn't a Mockup and its references", async () => {
    expect((await post({ refs: ["files:a.png"] })).status).toBe(400)
    expect((await post({ mockupId: "m-1", refs: [1] })).status).toBe(400)
  })
})
