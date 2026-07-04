import { afterEach, describe, expect, it, vi } from "vitest"

import { GitHubDetectFileSystem } from "@/lib/add-repo/github-fs"

/**
 * The GitHub virtual FS is a thin shell under the `detectSettings` seam, so it's
 * exercised lightly: seed the file list from a faked trees API, then confirm
 * `fileExists`/`readDir`/`readFile` answer from the seed and read blobs lazily.
 */

const TREE = {
  tree: [
    { path: "package.json", type: "blob" },
    { path: "pnpm-lock.yaml", type: "blob" },
    { path: "apps", type: "tree" },
    { path: "apps/web", type: "tree" },
    { path: "apps/web/package.json", type: "blob" },
  ],
}

function fakeFetch(
  blobs: Record<string, string> = { "package.json": '{"name":"x"}' }
) {
  return vi.fn(async (url: string) => {
    if (url.includes("/git/trees/")) {
      return new Response(JSON.stringify(TREE), { status: 200 })
    }
    // contents API: .../contents/<path>?ref=...
    const match = url.match(/\/contents\/(.+)\?ref=/)
    const path = match ? decodeURIComponent(match[1]!) : ""
    const body = blobs[path]
    return body === undefined
      ? new Response("Not Found", { status: 404 })
      : new Response(body, { status: 200 })
  })
}

const config = {
  owner: "acme",
  repo: "widget",
  ref: "main",
  token: "gh-token",
}

afterEach(() => vi.restoreAllMocks())

describe("GitHubDetectFileSystem", () => {
  it("answers fileExists for seeded blobs, dirs, and implied parents", async () => {
    vi.stubGlobal("fetch", fakeFetch())
    const fs = new GitHubDetectFileSystem(config)

    expect(await fs.fileExists("/package.json")).toBe(true)
    expect(await fs.fileExists("/apps/web/package.json")).toBe(true)
    expect(await fs.fileExists("/apps")).toBe(true) // seeded tree entry
    expect(await fs.fileExists("/apps/web")).toBe(true) // implied parent
    expect(await fs.fileExists("/")).toBe(true)
    expect(await fs.fileExists("/missing.txt")).toBe(false)
  })

  it("lists a directory's immediate children by kind", async () => {
    vi.stubGlobal("fetch", fakeFetch())
    const fs = new GitHubDetectFileSystem(config)

    expect(await fs.readDir("/")).toEqual({
      "package.json": "file",
      "pnpm-lock.yaml": "file",
      apps: "directory",
    })
    expect(await fs.readDir("/apps/web")).toEqual({
      "package.json": "file",
    })
  })

  it("reads a blob lazily via the contents API and caches it", async () => {
    const fetchMock = fakeFetch({ "package.json": '{"name":"widget"}' })
    vi.stubGlobal("fetch", fetchMock)
    const fs = new GitHubDetectFileSystem(config)

    expect(await fs.readFile("/package.json")).toBe('{"name":"widget"}')
    // Second read is served from cache — no extra contents request.
    await fs.readFile("/package.json")
    const contentsCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/contents/")
    )
    expect(contentsCalls).toHaveLength(1)
  })

  it("rejects readFile for a path absent from the tree", async () => {
    vi.stubGlobal("fetch", fakeFetch())
    const fs = new GitHubDetectFileSystem(config)
    await expect(fs.readFile("/nope.json")).rejects.toThrow(/ENOENT/)
  })

  it("seeds empty on a non-OK trees response (detection sees no files)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 }))
    )
    const fs = new GitHubDetectFileSystem(config)
    expect(await fs.fileExists("/package.json")).toBe(false)
    expect(await fs.readDir("/")).toEqual({})
  })
})
