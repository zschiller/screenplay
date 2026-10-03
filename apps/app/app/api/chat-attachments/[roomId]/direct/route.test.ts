import { beforeEach, describe, expect, it, vi } from "vitest"

import { createFiles, memoryFileIndex, type Files } from "@/lib/files/files"
import { memoryFileStore } from "@/lib/files/store"

const fx = vi.hoisted(() => ({
  files: null as Files | null,
  store: null as ReturnType<typeof memoryFileStore> | null,
  backend: "vercel" as "vercel" | "local-fs",
}))
vi.mock("@/lib/room-access", () => ({
  openRoomForRoute: async (roomId: string) => ({
    roomId,
    userId: "user-1",
    role: "editor",
  }),
}))
vi.mock("@/lib/blob/select", () => ({
  blobStoreChoiceFromEnv: () => fx.backend,
}))
vi.mock("@/lib/files", () => ({
  canvasFiles: () => fx.files,
  get fileStore() {
    return fx.store
  },
}))
// The token exchange itself is Vercel's; the route decides which keys get one.
vi.mock("@vercel/blob/client", () => ({
  handleUpload: async ({
    body,
    onBeforeGenerateToken,
  }: {
    body: { payload: { pathname: string } }
    onBeforeGenerateToken: (pathname: string) => Promise<unknown>
  }) => {
    const options = await onBeforeGenerateToken(body.payload.pathname)
    return { type: "blob.generate-client-token", clientToken: "t", options }
  },
}))

import { POST } from "./route"

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/chat-attachments/room-1/direct", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ roomId: "room-1" }) }
  )

const tokenRequest = (pathname: string) => ({
  type: "blob.generate-client-token",
  payload: { pathname, clientPayload: null, multipart: true },
})

describe("/api/chat-attachments/[roomId]/direct (#1525)", () => {
  beforeEach(() => {
    fx.backend = "vercel"
    fx.store = memoryFileStore()
    fx.files = createFiles({
      index: memoryFileIndex(),
      store: fx.store,
      keyPrefix: "canvas/room-1",
    })
  })

  it("hands out a token for a fresh key in this canvas, capped at 25 MB", async () => {
    const res = await post(tokenRequest("canvas/room-1/file-abcdefghijkl"))
    expect(res.status).toBe(200)
    expect((await res.json()).options).toEqual({
      maximumSizeInBytes: 25 * 1024 * 1024,
      addRandomSuffix: false,
      allowOverwrite: false,
    })
  })

  it("refuses a token for another canvas's key, or any other path", async () => {
    expect(
      (await post(tokenRequest("canvas/room-2/file-abcdefghijkl"))).status
    ).toBe(400)
    expect((await post(tokenRequest("canvas/room-1/../x"))).status).toBe(400)
    expect((await post(tokenRequest("thumbnails/x.png"))).status).toBe(400)
  })

  it("adds the uploaded file under uploads once the browser says it's up", async () => {
    await fx.store!.put(
      "canvas/room-1/file-abcdefghijkl",
      new Uint8Array(9),
      ""
    )
    const res = await post({
      type: "attachment.complete",
      name: "deck.pdf",
      mediaType: "application/pdf",
      key: "canvas/room-1/file-abcdefghijkl",
    })
    expect(await res.json()).toEqual({
      path: "uploads/deck.pdf",
      mediaType: "application/pdf",
      size: 9,
    })
  })

  it("is not there on the desktop build, which uploads everything plainly", async () => {
    fx.backend = "local-fs"
    expect(
      (await post(tokenRequest("canvas/room-1/file-abcdefghijkl"))).status
    ).toBe(404)
  })
})
