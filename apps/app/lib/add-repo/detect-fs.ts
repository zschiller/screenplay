/**
 * The read-only filesystem abstraction deterministic settings detection runs
 * over (PRD #673, slice #678). Deliberately *our own* minimal interface rather
 * than `@netlify/build-info`'s `FileSystem`: the concrete adapters (the
 * GitHub-contents-API virtual FS, and the on-disk one that ships with the
 * desktop funnel) implement this, and {@link import("./detect-settings")}
 * adapts it to whatever library backs detection today. That keeps a future
 * build-info major bump — or a swap to `@vercel/fs-detectors` — a one-file
 * change in the `detectSettings` seam, never a churn across every adapter.
 *
 * Paths are absolute POSIX (rooted at `/`); adapters normalize on the way in.
 */
export interface DetectFileSystem {
  /** True for a file *or* a directory that exists at this path. */
  fileExists(path: string): Promise<boolean>
  /** File contents as UTF-8 text; rejects if the path isn't a readable file. */
  readFile(path: string): Promise<string>
  /**
   * The immediate children of a directory, name → kind. A missing directory
   * yields `{}` rather than throwing, matching build-info's own node adapter.
   */
  readDir(path: string): Promise<Record<string, "file" | "directory">>
}

/** Normalize any input path to an absolute POSIX key with no trailing slash. */
function normalize(path: string): string {
  const abs = path.startsWith("/") ? path : `/${path}`
  const collapsed = abs.replace(/\/+/g, "/")
  return collapsed.length > 1 ? collapsed.replace(/\/$/, "") : collapsed
}

/**
 * An in-memory {@link DetectFileSystem} built from a flat `path → contents`
 * map. The detection seam's test fixtures ride on this (a fake `package.json`,
 * a lockfile, a framework config → the mapped settings), and it doubles as the
 * reference implementation the two real adapters mirror.
 *
 * Directories are implicit: any path that is a prefix of a file key exists as a
 * directory, so `{ "apps/web/package.json": … }` gives you `/apps` and
 * `/apps/web` for free.
 */
export class InMemoryDetectFileSystem implements DetectFileSystem {
  private readonly files: Map<string, string>

  constructor(files: Record<string, string>) {
    this.files = new Map(
      Object.entries(files).map(([path, contents]) => [
        normalize(path),
        contents,
      ])
    )
  }

  async fileExists(path: string): Promise<boolean> {
    const key = normalize(path)
    if (key === "/" || this.files.has(key)) return true
    const prefix = `${key}/`
    for (const file of this.files.keys()) {
      if (file.startsWith(prefix)) return true
    }
    return false
  }

  async readFile(path: string): Promise<string> {
    const contents = this.files.get(normalize(path))
    if (contents === undefined) throw new Error(`ENOENT: ${path}`)
    return contents
  }

  async readDir(path: string): Promise<Record<string, "file" | "directory">> {
    const key = normalize(path)
    const prefix = key === "/" ? "/" : `${key}/`
    const entries: Record<string, "file" | "directory"> = {}
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue
      const rest = file.slice(prefix.length)
      const slash = rest.indexOf("/")
      if (slash === -1) entries[rest] = "file"
      else entries[rest.slice(0, slash)] = "directory"
    }
    return entries
  }
}
