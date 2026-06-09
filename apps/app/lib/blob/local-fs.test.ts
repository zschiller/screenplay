import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { getLocalFsBlobStore } from "./local-fs"

describe("local-fs BlobStore", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "screenplay-blob-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("writes the body to the local dir and returns a readable localhost URL", async () => {
    const store = getLocalFsBlobStore({
      dir,
      baseUrl: "http://localhost:4000/blobs",
    })
    const body = Buffer.from("a thumbnail's worth of bytes")

    const { url } = await store.put("thumbnails/room-1.webp", body, {
      contentType: "image/webp",
      cacheControlMaxAge: 60,
    })

    // The URL is a localhost URL whose path is the key under the served dir.
    expect(url).toBe("http://localhost:4000/blobs/thumbnails/room-1.webp")

    // Round-trip: the returned URL maps back to the bytes we wrote under `dir`.
    const key = new URL(url).pathname.slice("/blobs/".length)
    const readBack = await readFile(join(dir, key))
    expect(readBack.equals(body)).toBe(true)
  })

  it("normalizes a trailing slash on the base URL", async () => {
    const store = getLocalFsBlobStore({
      dir,
      baseUrl: "http://localhost:4000/blobs/",
    })

    const { url } = await store.put(
      "thumbnails/room-2.webp",
      Buffer.from("x"),
      {
        contentType: "image/webp",
      }
    )

    expect(url).toBe("http://localhost:4000/blobs/thumbnails/room-2.webp")
  })

  it("accepts a Uint8Array body", async () => {
    const store = getLocalFsBlobStore({ dir, baseUrl: "http://localhost:4000" })
    const body = new Uint8Array([1, 2, 3, 4])

    const { url } = await store.put("k.bin", body, {
      contentType: "application/octet-stream",
    })

    const readBack = await readFile(join(dir, "k.bin"))
    expect(Uint8Array.from(readBack)).toEqual(body)
    expect(url).toBe("http://localhost:4000/k.bin")
  })
})
