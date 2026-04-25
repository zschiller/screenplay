import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"

/**
 * Sandbox-side runtime packages that screenplay pre-installs into the user's
 * sandbox at dev-server start. Mirrors the `sandbox-bridge` pattern: we read
 * the source files at module init time, hash them for cache-busting, and
 * expose the contents for `installSandboxRuntime` to write into
 * `node_modules/<pkg>/` on the sandbox VM.
 *
 * This keeps the runtime helpers (e.g. `screenplay-knobs` for declaring
 * adjustable knobs from a prototype) out of the user's git history — the
 * agent just imports from the package name.
 */

const dir = join(process.cwd(), "lib", "sandbox-runtime")

export interface RuntimePackageFile {
  /** Path relative to the package root inside `node_modules/<pkg>/`. */
  path: string
  content: string
}

export interface RuntimePackage {
  /** Bare-import name. Becomes `node_modules/<name>/` on the sandbox. */
  name: string
  files: RuntimePackageFile[]
}

function loadPackage(name: string, files: string[]): RuntimePackage {
  return {
    name,
    files: files.map((file) => ({
      path: file,
      content: readFileSync(join(dir, name, file), "utf8"),
    })),
  }
}

export const KNOBS_RUNTIME: RuntimePackage = loadPackage("knobs", [
  "package.json",
  "index.js",
  "index.d.ts",
])

// Map the on-disk directory name ("knobs") to the published package name
// ("screenplay-knobs") so the package lives at
// node_modules/screenplay-knobs/ on the sandbox.
KNOBS_RUNTIME.name = "screenplay-knobs"

export const RUNTIME_PACKAGES: RuntimePackage[] = [KNOBS_RUNTIME]

export const RUNTIME_VERSION: string = (() => {
  const hash = createHash("sha256")
  for (const pkg of RUNTIME_PACKAGES) {
    hash.update(pkg.name)
    hash.update("\0")
    for (const file of pkg.files) {
      hash.update(file.path)
      hash.update("\0")
      hash.update(file.content)
      hash.update("\0")
    }
  }
  return hash.digest("hex").slice(0, 12)
})()
