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
    access.response ?? { roomId, userId: "user-1", role: "editor" },
}))
vi.mock("@/lib/files", () => ({ canvasFiles: () => access.files }))

import { DELETE, POST } from "./route"

const params = { params: Promise.resolve({ roomId: "room-1" }) }

const post = (name: string, body: string, type = "") =>
  POST(
    new Request(
      `http://localhost/api/chat-attachments/room-1?name=${encodeURIComponent(name)}`,
      { method: "POST", body, headers: { "Content-Type": type } }
    ),
    params
  )

describe("/api/chat-attachments/[roomId] (#1525)", () => {
  beforeEach(() => {
    access.response = null
    access.files = createFiles({
      index: memoryFileIndex(),
      store: memoryFileStore(),
      keyPrefix: "canvas/room-1",
    })
  })

  it("saves a member’s file under uploads and names it", async () => {
    const res = await post("notes.md", "# Notes", "text/markdown")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      path: "uploads/notes.md",
      mediaType: "text/markdown",
      size: 7,
    })
    const again = await post("notes.md", "# More", "text/markdown")
    expect((await again.json()).path).toBe("uploads/notes-2.md")
  })

  it("refuses a type agents can’t read, with the reason", async () => {
    const res = await post("clip.mov", "x", "video/quicktime")
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/can’t be attached/)
  })

  it("refuses a body over 25 MB before reading it", async () => {
    const res = await POST(
      new Request("http://localhost/api/chat-attachments/room-1?name=big.png", {
        method: "POST",
        body: "x",
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(30 * 1024 * 1024),
        },
      }),
      params
    )
    expect(res.status).toBe(413)
    expect((await res.json()).error).toBe(
      "big.png is 30.0 MB. Files can be up to 25.0 MB."
    )
  })

  it("saves nothing for someone who isn’t a member", async () => {
    access.response = new Response("You don’t have access", { status: 403 })
    expect((await post("a.md", "x")).status).toBe(403)
  })

  it("deletes an attachment its sender took back out", async () => {
    const saved = await (await post("a.md", "x")).json()
    const del = (path: string) =>
      DELETE(
        new Request(
          `http://localhost/api/chat-attachments/room-1?path=${encodeURIComponent(path)}`,
          { method: "DELETE" }
        ),
        params
      )
    expect((await del(saved.path)).status).toBe(204)
    expect((await del(saved.path)).status).toBe(404)
  })
})
