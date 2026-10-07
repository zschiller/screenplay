import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"

import type { Files } from "./files"

/**
 * A readable copy of a scope's files on the desktop (#1517): the same folders
 * and names the Files tree shows, so the Mac can open a file in its own app or
 * reveal it in Finder. The private store keeps bytes under ids, which nothing
 * on the Mac could open by name.
 *
 * The copy only follows the files module; edits made in it never sync back.
 * Each sync writes what changed since the last one (by size and save time)
 * and removes what agents deleted or moved.
 *
 * `extra` adds files that aren't in the module, by path: a canvas's
 * Documents and Mockups (#1884, `lib/files/layer-files.ts`). Each is
 * rewritten when its text changes.
 */
export async function syncFileMirror(
  files: Files,
  dir: string,
  extra: readonly MirrorExtra[] = []
): Promise<void> {
  const listed = await files.list()
  if (!listed.ok) throw new Error(listed.error)
  const root = resolve(dir)
  const inside = (path: string) => {
    const full = resolve(root, path)
    if (!full.startsWith(root + sep)) throw new Error(`Bad file path: ${path}`)
    return full
  }

  await mkdir(root, { recursive: true })
  const keep = new Set<string>()
  for (const entry of listed.value) {
    const full = inside(entry.path)
    keep.add(full)
    if (entry.kind === "folder") {
      await mkdir(full, { recursive: true })
      continue
    }
    const current = await stat(full).catch(() => null)
    if (
      current?.isFile() &&
      current.size === entry.size &&
      Math.round(current.mtimeMs) === entry.updatedAt
    ) {
      continue
    }
    const read = await files.read(entry.path)
    if (!read.ok) continue
    await rm(full, { recursive: true, force: true })
    await writeFile(full, read.value.bytes)
    // The save time marks the copy current, so the next sync skips it.
    const at = new Date(entry.updatedAt)
    await utimes(full, at, at)
  }
  for (const item of extra) {
    const full = inside(item.path)
    keep.add(full)
    // Its folders too, so the prune keeps them.
    for (
      let parent = dirname(full);
      parent.startsWith(root + sep);
      parent = dirname(parent)
    ) {
      keep.add(parent)
    }
    await mkdir(dirname(full), { recursive: true })
    const current = await readFile(full, "utf8").catch(() => null)
    if (current === item.text) continue
    await rm(full, { recursive: true, force: true })
    await writeFile(full, item.text)
  }
  await prune(root, keep)
}

/** A file the mirror writes that the files module doesn't hold. */
export interface MirrorExtra {
  /** Folders joined by `/`, as a saved file's path. */
  path: string
  text: string
}

/** Remove everything under `dir` that isn't in `keep`. */
async function prune(dir: string, keep: Set<string>): Promise<void> {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, item.name)
    if (!keep.has(full)) await rm(full, { recursive: true, force: true })
    else if (item.isDirectory()) await prune(full, keep)
  }
}

/** A folder name from a canvas's name, unique by its id. */
export function mirrorFolderName(name: string, roomId: string): string {
  const safe = name
    .replace(/[/\\:\0]/g, "-")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 80)
  return `${safe || "Untitled"} (${roomId})`
}
