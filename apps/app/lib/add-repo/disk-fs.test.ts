import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { detectSettings } from "@/lib/add-repo/detect-settings"
import { DiskDetectFileSystem } from "@/lib/add-repo/disk-fs"

/**
 * The on-disk adapter is a thin shell under the `detectSettings` seam (PRD #673,
 * desktop funnel slice #682), so it's exercised lightly against a real temp
 * checkout: its three FS methods answer from disk, and — the point of the seam —
 * a real read maps through to the detected settings the modal pre-fills, with no
 * GitHub connection.
 */

let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "screenplay-disk-fs-"))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("DiskDetectFileSystem", () => {
  it("answers fileExists, readDir, and readFile from real disk", async () => {
    await writeFile(path.join(root, "package.json"), '{"name":"x"}')
    await mkdir(path.join(root, "src"))
    await writeFile(path.join(root, "src", "index.ts"), "export {}")
    const fs = new DiskDetectFileSystem(root)

    expect(await fs.fileExists("/package.json")).toBe(true)
    expect(await fs.fileExists("/src")).toBe(true)
    expect(await fs.fileExists("/missing.txt")).toBe(false)
    expect(await fs.readDir("/")).toEqual({
      "package.json": "file",
      src: "directory",
    })
    expect(await fs.readFile("/package.json")).toBe('{"name":"x"}')
  })

  it("returns {} for a missing directory rather than throwing", async () => {
    const fs = new DiskDetectFileSystem(root)
    expect(await fs.readDir("/does/not/exist")).toEqual({})
  })

  it("rejects readFile for a path that isn't a readable file", async () => {
    const fs = new DiskDetectFileSystem(root)
    await expect(fs.readFile("/nope.json")).rejects.toThrow()
  })

  it("maps a real on-disk checkout through detectSettings (Next.js)", async () => {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "fixture",
        dependencies: { next: "15.0.0", react: "19", "react-dom": "19" },
        scripts: { dev: "next dev" },
      })
    )
    await writeFile(path.join(root, "package-lock.json"), "{}")
    await writeFile(path.join(root, "next.config.js"), "module.exports = {}")

    const settings = await detectSettings(new DiskDetectFileSystem(root))
    expect(settings).toEqual({
      setupScript: "npm install",
      devScript: "npm run dev",
      devServerPort: 3000,
    })
  })
})
