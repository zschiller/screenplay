import "server-only"

import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname, relative, resolve, sep } from "node:path"
import type { FileStore } from "./store"

const DEFAULT_DIR = ".screenplay/files"

/**
 * A {@link FileStore} on local disk, for the desktop build. Unlike the
 * local blob directory, nothing serves this one: bytes leave only through the
 * checked files route.
 */
export function localFsFileStore(
  dir: string = process.env.LOCAL_FILES_DIR ?? DEFAULT_DIR
): FileStore {
  const root = resolve(dir)
  // Keys come from the files module, but a key that climbed out of the root
  // would still be a write anywhere on disk.
  const pathOf = (key: string) => {
    const path = resolve(root, key)
    if (!path.startsWith(root + sep)) throw new Error(`Bad file key: ${key}`)
    return path
  }
  return {
    async put(key, body) {
      const path = pathOf(key)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, body)
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(pathOf(key)))
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null
        throw e
      }
    },
    async delete(keys) {
      await Promise.all(keys.map((key) => rm(pathOf(key), { force: true })))
    },
    async size(key) {
      try {
        return (await stat(pathOf(key))).size
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null
        throw e
      }
    },
    async list(prefix) {
      // The folder the prefix names, or the one it ends inside.
      const at = prefix.endsWith("/") ? prefix : dirname(prefix)
      let names: string[]
      try {
        names = await readdir(pathOf(at), { recursive: true })
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return []
        throw e
      }
      const found: { key: string; size: number }[] = []
      for (const name of names) {
        const path = resolve(pathOf(at), name)
        const info = await stat(path)
        if (!info.isFile()) continue
        const key = relative(root, path).split(sep).join("/")
        if (key.startsWith(prefix)) found.push({ key, size: info.size })
      }
      return found.sort((a, b) => (a.key < b.key ? -1 : 1))
    },
  }
}
