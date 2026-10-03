import { beforeEach, describe, expect, it, vi } from "vitest"

import { createFiles, memoryFileIndex, type Files } from "@/lib/files/files"
import { memoryFileStore } from "@/lib/files/store"

// Each person's Account Files; the route reads only the signed-in person's.
const state = vi.hoisted(() => ({
  userId: "ana" as string | null,
  files: new Map<string, Files>(),
}))
vi.mock("@/lib/auth-helpers", () => ({ getUserId: async () => state.userId }))
vi.mock("@/lib/files", () => ({
  accountFiles: (userId: string) => state.files.get(userId),
}))

import { DELETE, GET } from "./route"

const params = (path: string[]) => ({ params: Promise.resolve({ path }) })
const get = (...path: string[]) =>
  GET(new Request("http://localhost/api/account-files"), params(path))
const del = (...path: string[]) =>
  DELETE(
    new Request("http://localhost/api/account-files", { method: "DELETE" }),
    params(path)
  )

const author = { addedBy: "agent" as const, addedById: "chat-1" }

beforeEach(async () => {
  state.userId = "ana"
  state.files.clear()
  for (const userId of ["ana", "ben"]) {
    const files = createFiles({
      index: memoryFileIndex(),
      store: memoryFileStore(),
      keyPrefix: `account/${userId}`,
    })
    await files.save({
      path: `notes/${userId}.html`,
      bytes: new TextEncoder().encode(`<b>${userId}</b>`),
      fallbackMediaType: "text/plain",
      author,
    })
    state.files.set(userId, files)
  }
})

describe("GET /api/account-files/[...path]", () => {
  it("serves you your own file, uncached and sandboxed", async () => {
    const res = await get("notes", "ana.html")

    expect(res.status).toBe(200)
    expect(await res.text()).toBe("<b>ana</b>")
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(res.headers.get("content-security-policy")).toMatch(/^sandbox/)
  })

  it("never serves another person's file", async () => {
    expect((await get("notes", "ben.html")).status).toBe(404)
  })

  it("serves nothing to someone signed out", async () => {
    state.userId = null
    expect((await get("notes", "ana.html")).status).toBe(401)
  })
})

describe("DELETE /api/account-files/[...path]", () => {
  it("deletes a folder of yours with everything in it", async () => {
    const res = await del("notes")

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ kind: "folder", removed: 2 })
    const listed = await state.files.get("ana")!.list()
    expect(listed.ok && listed.value).toEqual([])
  })

  it("can't reach another person's files", async () => {
    expect((await del("notes", "ben.html")).status).toBe(404)
    const listed = await state.files.get("ben")!.list()
    expect(listed.ok && listed.value.length).toBe(2)
  })

  it("deletes nothing for someone signed out", async () => {
    state.userId = null
    expect((await del("notes")).status).toBe(401)
  })
})
