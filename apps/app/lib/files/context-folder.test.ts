import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  agentContextFolder,
  isInsideFolder,
  savedFileSections,
  syncContextFolder,
} from "./context-folder"
import { createFiles, memoryFileIndex, type Files } from "./files"
import { memoryFileStore } from "./store"

const author = { addedBy: "agent", addedById: "chat-1" } as const
const save = (files: Files, path: string, text: string) =>
  files.save({
    path,
    bytes: new TextEncoder().encode(text),
    fallbackMediaType: "text/plain",
    author,
  })
const scope = (keyPrefix: string) =>
  createFiles({ index: memoryFileIndex(), store: memoryFileStore(), keyPrefix })

/** Every file and folder under `dir`, relative, sorted. */
async function tree(dir: string): Promise<string[]> {
  const items = await readdir(dir, { recursive: true, withFileTypes: true })
  return items
    .map((i) => join(i.parentPath, i.name).slice(dir.length + 1))
    .sort()
}

describe("syncContextFolder", () => {
  let folder: string
  let canvas: Files
  let account: Files
  beforeEach(async () => {
    folder = join(await mkdtemp(join(tmpdir(), "context-")), "chat-1")
    canvas = scope("canvas/room-1")
    account = scope("account/u1")
  })
  afterEach(() => rm(join(folder, ".."), { recursive: true, force: true }))

  it("writes the canvas's and the sender's files in their own sections", async () => {
    await save(canvas, "research/notes.md", "# Notes")
    await save(account, "voice.md", "plain copy")

    await syncContextFolder(folder, savedFileSections(canvas, account))

    expect(await tree(folder)).toEqual([
      "account",
      "account/voice.md",
      "canvas",
      "canvas/research",
      "canvas/research/notes.md",
    ])
    expect(
      await readFile(join(folder, "canvas/research/notes.md"), "utf8")
    ).toBe("# Notes")
  })

  it("drops the account section on a turn nobody sent", async () => {
    await save(account, "voice.md", "plain copy")
    await syncContextFolder(folder, savedFileSections(canvas, account))

    await syncContextFolder(folder, savedFileSections(canvas, null))

    expect(await tree(folder)).toEqual(["canvas"])
  })

  it("removes anything no section owns", async () => {
    await syncContextFolder(folder, savedFileSections(canvas, account))
    await writeFile(join(folder, "stray.txt"), "made by hand")

    await syncContextFolder(folder, savedFileSections(canvas, account))

    expect(await tree(folder)).toEqual(["account", "canvas"])
  })

  it("removes a section that fails rather than leaving it stale, and syncs the rest", async () => {
    await save(canvas, "a.md", "one")
    await save(account, "b.md", "two")
    await syncContextFolder(folder, savedFileSections(canvas, account))
    const broken: Files = {
      ...account,
      list: async () => ({ ok: false, error: "store down" }),
    }
    const log = vi.spyOn(console, "error").mockImplementation(() => {})

    await syncContextFolder(folder, savedFileSections(canvas, broken))

    expect(await tree(folder)).toEqual(["canvas", "canvas/a.md"])
    log.mockRestore()
  })
})

describe("agentContextFolder", () => {
  it("sits beside the desktop's file store, one folder per chat", () => {
    expect(
      agentContextFolder("chat-1", { LOCAL_FILES_DIR: "/data/files" })
    ).toBe("/data/agent-context/chat-1")
  })

  it("never lets a chat id climb out of the root", () => {
    expect(
      agentContextFolder("../../etc", { LOCAL_FILES_DIR: "/data/files" })
    ).toBe("/data/agent-context/______etc")
  })
})

describe("isInsideFolder", () => {
  it("is true for the folder itself and anything under it", () => {
    expect(isInsideFolder("/work/repo", "/work/repo")).toBe(true)
    expect(isInsideFolder("/work/repo/.ctx", "/work/repo")).toBe(true)
  })

  it("is false for a sibling or a parent", () => {
    expect(isInsideFolder("/work/repo-ctx", "/work/repo")).toBe(false)
    expect(isInsideFolder("/work", "/work/repo")).toBe(false)
  })
})
