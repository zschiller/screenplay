import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { workspaceFiles } from "@/lib/frame-drive/mac/workspace-files"

let base: string
let root: string

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), "picks-")))
  root = path.join(base, "ws")
  await mkdir(path.join(root, "fixtures"), { recursive: true })
  await writeFile(path.join(root, "fixtures", "logo.png"), "png")
  await writeFile(path.join(base, "secret.env"), "x")
  await symlink(path.join(base, "secret.env"), path.join(root, "leak.env"))
})

afterAll(() => rm(base, { recursive: true, force: true }))

describe("workspaceFiles", () => {
  it("resolves files inside the Workspace", async () => {
    expect(await workspaceFiles(root, ["fixtures/logo.png"])).toEqual([
      path.join(root, "fixtures", "logo.png"),
    ])
  })

  it("refuses anything that isn't a file inside it", async () => {
    for (const paths of [
      ["../secret.env"],
      [path.join(root, "fixtures", "logo.png")],
      ["leak.env"],
      ["fixtures"],
      ["missing.txt"],
      ["fixtures/logo.png", "../secret.env"],
      [],
    ]) {
      expect(await workspaceFiles(root, paths), paths.join()).toBeNull()
    }
  })
})
