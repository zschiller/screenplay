import "server-only"

import {
  FileSystem,
  Project,
  type DirType,
  type Environment,
  type Settings,
} from "@netlify/build-info"

import type { DetectFileSystem } from "@/lib/add-repo/detect-fs"
import type { DetectedSettings } from "@/lib/add-repo/resolver"

/**
 * The `detectSettings` seam (PRD #673, slice #678): deterministic, no-model
 * detection of the essential run settings from a project's files, run over the
 * abstract {@link DetectFileSystem}. **This is the only file that touches
 * `@netlify/build-info`** — it's pinned to the `10.x` line to match
 * `netlify-cli`, imported via its library export (never `/node`), and kept
 * server-only. A future major bump, or the documented swap to
 * `@vercel/fs-detectors`, is a change to this file alone: the input
 * (`DetectFileSystem`) and output ({@link DetectedSettings}) contracts hold.
 *
 * The mapping is fixed by the PRD:
 * - package-manager install command → setup script
 * - framework dev command → run script
 * - framework default port → dev server port
 *
 * Env vars, frame size, and the system prompt are never detected. For a
 * monorepo, build-info yields one settings entry per workspace package; v1
 * takes the top-level/primary detection (see {@link pickPrimary}).
 */

/** Today's plain defaults — the no-op result for an unrecognized project. */
const PLAIN_DEFAULTS: DetectedSettings = {
  setupScript: "",
  devScript: "",
  devServerPort: 3000,
}

export async function detectSettings(
  fs: DetectFileSystem
): Promise<DetectedSettings> {
  try {
    const project = new Project(new BuildInfoFileSystem(fs), "/")
    // Detection reports through bugsnag by default; a virtual FS has nothing to
    // phone home about, so silence it rather than construct a live session.
    project.setReportFn(() => undefined)

    // Package manager first — `getBuildSettings` reads the detected manager to
    // shape each framework's dev command, so the order matters.
    const packageManager = await project.detectPackageManager()
    const settings = await project.getBuildSettings()
    const primary = pickPrimary(settings)

    return {
      setupScript: packageManager?.installCommand ?? PLAIN_DEFAULTS.setupScript,
      devScript: primary?.devCommand ?? PLAIN_DEFAULTS.devScript,
      devServerPort: primary?.frameworkPort ?? PLAIN_DEFAULTS.devServerPort,
    }
  } catch {
    // A total seam: a malformed project or a detector that throws falls back to
    // today's defaults rather than surfacing an error — the modal's "couldn't
    // auto-detect" path is driven by the caller's timeout, not by this throwing.
    return { ...PLAIN_DEFAULTS }
  }
}

/**
 * The top-level/primary settings entry. A monorepo returns one per workspace
 * package, keyed by `packagePath`; prefer a root-level detection (no package
 * path) when one exists, else the first entry build-info returned — a stable,
 * deterministic pick. Choosing a specific workspace is a manual adjustment in
 * the advanced section (a later slice), not something detection infers.
 */
function pickPrimary(settings: Settings[]): Settings | undefined {
  return settings.find((s) => !s.packagePath) ?? settings[0]
}

/**
 * Adapts our {@link DetectFileSystem} to build-info's abstract `FileSystem`.
 * The base class already implements every path helper (`join`, `dirname`,
 * `findUp`, …) over POSIX `/`, so this only forwards the three real I/O
 * methods and supplies the POSIX `resolve`/`isAbsolute` primitives. Reporting
 * "node" keeps build-info on its full server-side detection path.
 */
class BuildInfoFileSystem extends FileSystem {
  constructor(private readonly inner: DetectFileSystem) {
    super()
    this.cwd = "/"
  }

  getEnvironment(): Environment {
    return "node" as unknown as Environment
  }

  isAbsolute(path: string): boolean {
    return path.startsWith("/")
  }

  resolve(...paths: string[]): string {
    let resolved = this.cwd
    for (const path of paths) {
      resolved = this.isAbsolute(path) ? path : this.join(resolved, path)
    }
    return this.join(resolved)
  }

  fileExists(path: string): Promise<boolean> {
    return this.inner.fileExists(this.resolve(path))
  }

  readFile(path: string): Promise<string> {
    return this.inner.readFile(this.resolve(path))
  }

  readDir(path: string): Promise<string[]>
  readDir(path: string, withFileTypes: true): Promise<Record<string, DirType>>
  async readDir(
    path: string,
    withFileTypes?: true
  ): Promise<Record<string, DirType> | string[]> {
    const entries = await this.inner.readDir(this.resolve(path))
    return withFileTypes ? entries : Object.keys(entries)
  }
}
