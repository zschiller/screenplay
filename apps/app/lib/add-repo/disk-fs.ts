import "server-only"

import { readFile, readdir, stat } from "node:fs/promises"
import path from "node:path"

import type { DetectFileSystem } from "@/lib/add-repo/detect-fs"

/**
 * The on-disk virtual FS (PRD #673, desktop funnel slice #682): a
 * {@link DetectFileSystem} over a real folder on disk, so `detectSettings` runs
 * against a local-folder pick with no GitHub connection at all — the mirror of
 * the GitHub-contents-API adapter, for the checkout the user already has. Like
 * that one it's a thin shell under the detection seam; the mapping lives in
 * `detect-settings.ts`, this only answers file questions.
 *
 * Detection's paths are absolute POSIX rooted at `/` (build-info's `cwd`); they
 * are resolved against `root` — `/package.json` reads `<root>/package.json` —
 * splitting on `/` and re-joining with the platform separator so a Windows
 * checkout resolves as happily as a POSIX one.
 */
export class DiskDetectFileSystem implements DetectFileSystem {
  /** @param root Absolute path of the user's checkout (`NewRepoSource.localPath`). */
  constructor(private readonly root: string) {}

  private resolve(posixPath: string): string {
    const segments = posixPath.split("/").filter(Boolean)
    return path.join(this.root, ...segments)
  }

  async fileExists(posixPath: string): Promise<boolean> {
    try {
      await stat(this.resolve(posixPath))
      return true
    } catch {
      return false
    }
  }

  async readFile(posixPath: string): Promise<string> {
    return readFile(this.resolve(posixPath), "utf8")
  }

  async readDir(
    posixPath: string
  ): Promise<Record<string, "file" | "directory">> {
    let dirents
    try {
      dirents = await readdir(this.resolve(posixPath), { withFileTypes: true })
    } catch {
      // A missing directory yields `{}` rather than throwing — matching the
      // in-memory reference and build-info's own node adapter.
      return {}
    }
    const entries: Record<string, "file" | "directory"> = {}
    for (const dirent of dirents) {
      entries[dirent.name] = dirent.isDirectory() ? "directory" : "file"
    }
    return entries
  }
}
