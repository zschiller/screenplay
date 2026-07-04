import "server-only"

import type { DetectFileSystem } from "@/lib/add-repo/detect-fs"

/**
 * The GitHub-contents-API virtual FS (PRD #673, slice #678): a
 * {@link DetectFileSystem} over a hosted repo, so `detectSettings` runs against
 * a GitHub-repo pick without cloning. It's a thin shell under the detection
 * seam — the mapping lives in `detect-settings.ts`; this only answers file
 * questions.
 *
 * The file list is seeded from the git **trees API** in one recursive call
 * (cheap, no per-directory walk), so `fileExists`/`readDir` are answered from
 * memory. File **contents** are read lazily via the contents API and cached —
 * detection only ever opens a handful (`package.json`, a lockfile, the odd
 * framework config), so paying per-file beats fetching the whole tree.
 */
export interface GitHubFileSystemConfig {
  owner: string
  repo: string
  /** Branch, tag, or commit SHA to read the tree at. */
  ref: string
  token: string
}

export class GitHubDetectFileSystem implements DetectFileSystem {
  private readonly config: GitHubFileSystemConfig
  /** Absolute POSIX paths of every blob, e.g. `/apps/web/package.json`. */
  private readonly files = new Set<string>()
  /** Absolute POSIX paths of every directory, including implied parents. */
  private readonly dirs = new Set<string>()
  private readonly contents = new Map<string, string>()
  private seeding: Promise<void> | null = null

  constructor(config: GitHubFileSystemConfig) {
    this.config = config
  }

  /**
   * Seed the file/directory sets from the recursive trees API, once. Kicked off
   * lazily and awaited by every method, so callers never have to remember to
   * prime it. A non-OK response leaves the FS empty — detection then yields
   * plain defaults rather than throwing.
   */
  private seed(): Promise<void> {
    if (!this.seeding) this.seeding = this.doSeed()
    return this.seeding
  }

  private async doSeed(): Promise<void> {
    const { owner, repo, ref } = this.config
    const res = await this.fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`
    )
    if (!res.ok) return
    // `truncated: true` on a huge repo means we seeded a partial tree; detection
    // over the project root (package.json, lockfiles) is unaffected in practice,
    // so we take what we got rather than paginating the whole tree.
    const data = (await res.json()) as {
      tree?: Array<{ path: string; type: string }>
    }
    for (const entry of data.tree ?? []) {
      const path = normalize(entry.path)
      if (entry.type === "blob") {
        this.files.add(path)
        this.addParents(path)
      } else if (entry.type === "tree") {
        this.dirs.add(path)
        this.addParents(path)
      }
    }
  }

  /** Record every ancestor directory of a path so `readDir`/`findUp` walk up. */
  private addParents(path: string): void {
    let dir = parentDir(path)
    while (dir !== "/" && !this.dirs.has(dir)) {
      this.dirs.add(dir)
      dir = parentDir(dir)
    }
  }

  async fileExists(path: string): Promise<boolean> {
    await this.seed()
    const key = normalize(path)
    return key === "/" || this.files.has(key) || this.dirs.has(key)
  }

  async readDir(path: string): Promise<Record<string, "file" | "directory">> {
    await this.seed()
    const key = normalize(path)
    const prefix = key === "/" ? "/" : `${key}/`
    const entries: Record<string, "file" | "directory"> = {}
    for (const file of this.files) {
      const child = childSegment(file, prefix)
      if (child && !entries[child.name]) entries[child.name] = child.type
    }
    for (const dir of this.dirs) {
      const child = childSegment(dir, prefix)
      // A directory entry always wins over a same-named blob (there won't be
      // one in git, but keep the kind honest).
      if (child) entries[child.name] = child.type
    }
    return entries
  }

  async readFile(path: string): Promise<string> {
    await this.seed()
    const key = normalize(path)
    const cached = this.contents.get(key)
    if (cached !== undefined) return cached
    if (!this.files.has(key)) throw new Error(`ENOENT: ${path}`)

    const { owner, repo, ref } = this.config
    const res = await this.fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${key
        .slice(1)
        .split("/")
        .map(encodeURIComponent)
        .join("/")}?ref=${encodeURIComponent(ref)}`,
      // The raw media type hands back the file body directly — no base64 hop.
      "application/vnd.github.raw"
    )
    if (!res.ok) throw new Error(`Failed to read ${path}: ${res.status}`)
    const text = await res.text()
    this.contents.set(key, text)
    return text
  }

  private fetch(url: string, accept = "application/vnd.github+json") {
    return fetch(url, {
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: accept,
      },
    })
  }
}

/** Absolute POSIX key, no trailing slash: `apps/web` → `/apps/web`. */
function normalize(path: string): string {
  const abs = path.startsWith("/") ? path : `/${path}`
  const collapsed = abs.replace(/\/+/g, "/")
  return collapsed.length > 1 ? collapsed.replace(/\/$/, "") : collapsed
}

function parentDir(path: string): string {
  const idx = path.lastIndexOf("/")
  return idx <= 0 ? "/" : path.slice(0, idx)
}

/** The immediate child of `prefix` that `path` lies under, or null. */
function childSegment(
  path: string,
  prefix: string
): { name: string; type: "file" | "directory" } | null {
  if (!path.startsWith(prefix)) return null
  const rest = path.slice(prefix.length)
  if (!rest) return null
  const slash = rest.indexOf("/")
  return slash === -1
    ? { name: rest, type: "file" }
    : { name: rest.slice(0, slash), type: "directory" }
}
