import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { localFsFileStore } from "./local-fs"

describe("local-fs FileStore", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "screenplay-files-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("puts, gets, replaces and deletes bytes by key", async () => {
    const store = localFsFileStore(dir)
    await store.put("canvas/room-1/file-a", Uint8Array.from([1, 2]), "x")
    await store.put("canvas/room-1/file-a", Uint8Array.from([3]), "x")

    expect(await store.get("canvas/room-1/file-a")).toEqual(
      Uint8Array.from([3])
    )
    await store.delete(["canvas/room-1/file-a", "canvas/room-1/missing"])
    expect(await store.get("canvas/room-1/file-a")).toBeNull()
  })

  it("refuses a key that climbs out of its directory", async () => {
    const store = localFsFileStore(dir)
    await expect(
      store.put("../outside", Uint8Array.from([1]), "x")
    ).rejects.toThrow(/Bad file key/)
  })
})
