import { beforeAll, describe, expect, it, vi } from "vitest"

import { memoryFileStore } from "@/lib/files/store"
import { mockupPageToken } from "@/lib/mockup-folder-server"

const files = vi.hoisted(() => ({ store: null as unknown }))
vi.mock("@/lib/files", () => ({
  get fileStore() {
    return files.store
  },
}))

const { GET } = await import("./route")

/** Ask the pages route for `path` with `token`. */
const get = (token: string, path: string[]) =>
  GET(new Request("http://app.test/"), {
    params: Promise.resolve({ token, path }),
  })

describe("the Mockup pages route (#1886)", () => {
  let token: string
  beforeAll(async () => {
    process.env.TERMINAL_AUTH_SECRET ??= "test-secret"
    const store = memoryFileStore()
    files.store = store
    const put = (key: string, body: string) =>
      store.put(key, new TextEncoder().encode(body), "")
    await put("canvas/room-1/mockups/m/index.html", "<p>A</p>")
    await put("canvas/room-1/mockups/m/data.js", "1")
    await put("canvas/room-1/mockups/other/data.js", "2")
    await put("canvas/room-1/skills/s/SKILL.md", "secret")
    token = mockupPageToken("room-1", "m").token
  })

  it("serves a file of the token’s Mockup, at any revision", async () => {
    const res = await get(token, ["r3", "data.js"])
    expect(res.status).toBe(200)
    expect(await res.text()).toBe("1")
    expect(res.headers.get("Content-Type")).toBe("text/javascript")
    expect(res.headers.get("Content-Security-Policy")).toBe(
      "sandbox allow-scripts"
    )
    expect(await (await get(token, ["r1"])).text()).toBe("<p>A</p>")
  })

  it("serves nothing outside that folder", async () => {
    for (const path of [
      ["r1", "..", "other", "data.js"],
      ["r1", "../other/data.js"],
      ["r1", "../../skills/s/SKILL.md"],
    ]) {
      expect((await get(token, path)).status).toBe(404)
    }
  })

  it("serves nothing for a bad token or path", async () => {
    expect((await get("nope", ["r1", "data.js"])).status).toBe(404)
    expect((await get(token, ["data.js"])).status).toBe(404)
    expect((await get(token, ["r1", "gone.js"])).status).toBe(404)
  })
})
