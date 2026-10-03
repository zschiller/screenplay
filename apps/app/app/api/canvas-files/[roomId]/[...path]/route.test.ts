import { beforeEach, describe, expect, it, vi } from "vitest"

import { createFiles, memoryFileIndex, type Files } from "@/lib/files/files"
import { memoryFileStore } from "@/lib/files/store"

// Room Access decides who's a member; the route only has to honour it.
const access = vi.hoisted(() => ({
  response: null as Response | null,
  files: null as Files | null,
}))
vi.mock("@/lib/room-access", () => ({
  openRoomForRoute: async (roomId: string) =>
    access.response ?? { roomId, userId: "user-1", role: "member" },
}))
vi.mock("@/lib/files", () => ({ canvasFiles: () => access.files }))

import { GET } from "./route"

const get = (...path: string[]) =>
  GET(new Request("http://localhost/api/canvas-files/room-1"), {
    params: Promise.resolve({ roomId: "room-1", path }),
  })

describe("GET /api/canvas-files/[roomId]/[...path]", () => {
  beforeEach(async () => {
    access.response = null
    access.files = createFiles({
      index: memoryFileIndex(),
      store: memoryFileStore(),
      keyPrefix: "canvas/room-1",
    })
    await access.files.save({
      path: "research/notes.html",
      bytes: new TextEncoder().encode("<script>alert(1)</script>"),
      fallbackMediaType: "text/plain",
      author: { addedBy: "agent", addedById: "chat-1" },
    })
  })

  it("serves a member the file, uncached and sandboxed", async () => {
    const res = await get("research", "notes.html")

    expect(res.status).toBe(200)
    expect(await res.text()).toBe("<script>alert(1)</script>")
    expect(res.headers.get("content-type")).toBe("text/html")
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(res.headers.get("content-security-policy")).toMatch(/^sandbox/)
  })

  it("serves nothing to someone who isn't a member", async () => {
    access.response = new Response("You don't have access", { status: 403 })
    const res = await get("research", "notes.html")
    expect(res.status).toBe(403)
  })

  it("answers 404 for a folder or a missing file", async () => {
    expect((await get("research")).status).toBe(404)
    expect((await get("nope.md")).status).toBe(404)
  })
})
