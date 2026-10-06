import "server-only"

import {
  FileSystem,
  Project,
  type DirType,
  type Environment,
  type Settings,
} from "@netlify/build-info"

import type { DetectFileSystem } from "@/lib/add-repo/detect-fs"
import type {
  DetectedApp,
  DetectedProject,
  DetectedSettings,
} from "@/lib/add-repo/resolver"
import { DEFAULT_DEV_SERVER_PORT } from "@/lib/run-settings"

/**
 * The `detectSettings` seam (PRD #673, slice #678): deterministic, no-model
 * detection of the essential run settings from a project's files, run over the
 * abstract {@link DetectFileSystem}. **This is the only file that touches
 * `@netlify/build-info`** — it's pinned to the `11.x` line to match
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
 * monorepo, build-info yields one settings entry per workspace package; each
 * becomes a {@link DetectedApp} the add modal offers in its App picker, and
 * the settings are the first app's (see {@link sortApps}).
 */

/** Today's plain defaults — the no-op result for an unrecognized project. */
const PLAIN_DEFAULTS: DetectedSettings = {
  setupScript: "",
  devScript: "",
  devServerPort: DEFAULT_DEV_SERVER_PORT,
}

export async function detectSettings(
  fs: DetectFileSystem
): Promise<DetectedProject> {
  try {
    const project = new Project(new BuildInfoFileSystem(fs), "/")
    // Detection reports through bugsnag by default; a virtual FS has nothing to
    // phone home about, so silence it rather than construct a live session.
    project.setReportFn(() => undefined)

    // Package manager first — `getBuildSettings` reads the detected manager to
    // shape each framework's dev command, so the order matters.
    const packageManager = await project.detectPackageManager()
    const settings = await project.getBuildSettings()
    const apps = listApps(settings)
    // A root-level detection is a single-app repo, whatever packages sit
    // beside it; otherwise the first app (apps/ before packages/) leads.
    const root = settings.find((s) => !s.packagePath)
    const primary = root ? appFrom(root, "") : apps[0]

    return {
      setupScript: packageManager?.installCommand ?? PLAIN_DEFAULTS.setupScript,
      devScript: primary?.devScript ?? PLAIN_DEFAULTS.devScript,
      devServerPort: primary?.devServerPort ?? PLAIN_DEFAULTS.devServerPort,
      apps: root ? [] : apps,
    }
  } catch {
    // A total seam: a malformed project or a detector that throws falls back to
    // today's defaults rather than surfacing an error — the modal's "couldn't
    // auto-detect" path is driven by the caller's timeout, not by this throwing.
    return { ...PLAIN_DEFAULTS, apps: [] }
  }
}

/**
 * One app per workspace package build-info recognized, in picker order. A
 * package can match more than one framework; its first match wins, the same
 * one build-info would run.
 */
function listApps(settings: Settings[]): DetectedApp[] {
  const byPath = new Map<string, DetectedApp>()
  for (const entry of settings) {
    const path = entry.packagePath?.replace(/^\/+|\/+$/g, "")
    if (!path || byPath.has(path)) continue
    byPath.set(path, appFrom(entry, path))
  }
  return sortApps([...byPath.values()])
}

function appFrom(entry: Settings, path: string): DetectedApp {
  return {
    name: path.split("/").pop() ?? path,
    path,
    framework: entry.framework?.name ?? "",
    devScript: entry.devCommand ?? PLAIN_DEFAULTS.devScript,
    devServerPort: entry.frameworkPort ?? PLAIN_DEFAULTS.devServerPort,
  }
}

/**
 * Picker order: `apps/` first, `packages/` last, any other folder between,
 * then by path. build-info lists packages in workspace-glob order, which can
 * put a component playground in `packages/` ahead of the real app — the first
 * entry here is the one the modal suggests.
 */
export function sortApps(apps: DetectedApp[]): DetectedApp[] {
  const rank = (path: string) => {
    const top = path.split("/")[0]
    return top === "apps" ? 0 : top === "packages" ? 2 : 1
  }
  return [...apps].sort(
    (a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path)
  )
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
