// Build the Node sidecar the Tauri shell ships and runs (issue #418, packaging
// approach proven in spike #407).
//
// Produces `src-tauri/resources/sidecar.tar.gz`: the Next `output: "standalone"`
// tree plus the four things standalone tracing leaves out, all packed as a
// tarball. The tar is deliberate — Next's traced `node_modules` keeps pnpm's
// peer-dependency *symlinks* (~275 of them), and Tauri's resource copy drops
// symlinks; tar preserves them (and the `node` exec bit), so the shell restores
// a working tree by extracting on first launch.
//
// The four additions over the raw standalone tree:
//   1. `.next/static` and `public` — standalone never copies these (the hosted
//      deploy serves them off the CDN; here the sidecar serves them itself).
//   2. `drizzle/local/*.sql` — read from disk at runtime (not imported), so file
//      tracing misses it; PGlite's migrate-on-boot needs it.
//   3. `node-pty`'s native prebuild (`prebuilds/<platform>/pty.node`) — a
//      dynamically-loaded `.node` the tracer doesn't follow; the local terminal
//      transport's instrumentation hook crashes on boot without it.
//   4. the `node` binary itself — the shell runs `./node apps/app/server.js`.

import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, rmSync, copyFileSync, chmodSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const desktopDir = resolve(here, "..")
const repoRoot = resolve(desktopDir, "..", "..")
const appDir = join(repoRoot, "apps", "app")
const standalone = join(appDir, ".next", "standalone")
const resourcesDir = join(desktopDir, "src-tauri", "resources")
const tarball = join(resourcesDir, "sidecar.tar.gz")

function log(msg) {
  process.stdout.write(`[build-sidecar] ${msg}\n`)
}

/** Parse `desktop.env` into a plain key→value map (KEY=VALUE lines, # comments). */
function loadEnvProfile() {
  const text = execFileSync("cat", [join(desktopDir, "desktop.env")], {
    encoding: "utf8",
  })
  const env = {}
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
  }
  return env
}

// 1. Build the app with the desktop profile. We invoke `next build` directly
// (not the package's `build` script, which runs `drizzle-kit migrate` against a
// hosted Postgres first — irrelevant here, PGlite migrates on boot).
const profile = loadEnvProfile()
const buildEnv = {
  ...process.env,
  ...profile,
  // PGlite is instantiated at module-load during the build's data-collection
  // pass; point it at a throwaway dir so it never touches a real data dir.
  PGLITE_DATA_DIR: join(desktopDir, ".build-pglite"),
}
log("next build (output: standalone)…")
execFileSync("npx", ["next", "build"], {
  cwd: appDir,
  env: buildEnv,
  stdio: "inherit",
})
rmSync(join(desktopDir, ".build-pglite"), { recursive: true, force: true })

if (!existsSync(join(standalone, "apps", "app", "server.js"))) {
  throw new Error(
    "standalone build missing apps/app/server.js — did `output: standalone` not apply? (SCREENPLAY_DESKTOP=1 must be set)"
  )
}

// 2. Fold the un-traced pieces into the standalone tree in place.
const standaloneApp = join(standalone, "apps", "app")

log("+ .next/static")
cpSync(join(appDir, ".next", "static"), join(standaloneApp, ".next", "static"), {
  recursive: true,
})

if (existsSync(join(appDir, "public"))) {
  log("+ public")
  cpSync(join(appDir, "public"), join(standaloneApp, "public"), { recursive: true })
}

log("+ drizzle/local migrations")
cpSync(join(appDir, "drizzle", "local"), join(standaloneApp, "drizzle", "local"), {
  recursive: true,
})

log("+ node-pty native prebuild")
// node-pty is hoisted; resolve its real dir in the standalone tree and drop the
// prebuilds next to its lib (the path the loader probes).
const ptySrc = join(appDir, "node_modules", "node-pty", "prebuilds")
const ptyDest = findNodePtyPrebuildsDest(standalone)
if (!existsSync(ptySrc)) throw new Error(`node-pty prebuilds not found at ${ptySrc}`)
cpSync(ptySrc, ptyDest, { recursive: true })

log("+ node runtime")
copyFileSync(process.execPath, join(standalone, "node"))
chmodSync(join(standalone, "node"), 0o755)

// 3. Pack the tree as a gzipped tar (preserves symlinks + exec bits).
mkdirSync(resourcesDir, { recursive: true })
rmSync(tarball, { force: true })
log("packing sidecar.tar.gz…")
execFileSync("tar", ["-czf", tarball, "-C", standalone, "."], { stdio: "inherit" })
log(`done → ${tarball}`)

// Locate the prebuilds dir inside the standalone tree's hoisted node-pty
// package (under node_modules/.pnpm/node-pty@<version>/node_modules/node-pty).
function findNodePtyPrebuildsDest(root) {
  const pnpmDir = join(root, "node_modules", ".pnpm")
  const entries = execFileSync("ls", [pnpmDir], { encoding: "utf8" })
    .split("\n")
    .filter((d) => d.startsWith("node-pty@"))
  if (entries.length === 0) {
    throw new Error(`no node-pty package found under ${pnpmDir}`)
  }
  return join(pnpmDir, entries[0], "node_modules", "node-pty", "prebuilds")
}
