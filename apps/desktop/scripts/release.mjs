// The real desktop release mechanism (issue #631, PRD #629): one command turns a
// bump keyword into a signed, notarized, published macOS build.
//
//   pnpm --filter desktop release <patch|minor|major|none|X.Y.Z>
//
// This is thin orchestration around the pure, unit-tested version seam (#630) —
// all version resolution and file rewriting lives in
// `apps/app/lib/desktop/release-version.ts`, imported directly (Node ≥ 23 strips
// the TypeScript types natively). Everything here is the impure shell: env,
// git, the Tauri build, and Gatekeeper verification.
//
// Signing + notarization are driven entirely by env vars for Tauri's bundler,
// loaded from a gitignored `apps/desktop/.env.release` (see `.env.release.example`):
// APPLE_SIGNING_IDENTITY plus the App Store Connect API key trio (APPLE_API_ISSUER,
// APPLE_API_KEY = the Key ID, APPLE_API_KEY_PATH = the .p8). SCREENPLAY_GITHUB_CLIENT_ID
// is passed through so the `option_env!` bake-in in sidecar.rs picks it up — the
// OAuth client *secret* is never baked in (device flow is a public client).
//
// Apple Silicon only, consistent with build-sidecar.mjs (the sidecar ships this
// machine's own `node`). Auto-update is out of scope — no updater.
//
// Strict ordering, so nothing is tagged or published unless the build verifies:
//   1. Load .env.release; warn (don't fail) on a missing optional input.
//   2. Refuse to run on a dirty working tree.
//   3. Resolve the target version via the seam; abort if its tag already exists.
//   4. Rewrite package.json, tauri.conf.json, Cargo.toml in lockstep.
//   5. Build the sidecar, then `tauri build` → signed + notarized .app/.dmg.
//   6. Verify signature, Gatekeeper assessment, and notarization staple.
//   7. Only then: commit the bump → tag desktop-v<version> → create the Release.

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  resolveVersion,
  setPackageJsonVersion,
  setTauriConfVersion,
  setCargoTomlVersion,
} from "../../app/lib/desktop/release-version.ts"

const here = dirname(fileURLToPath(import.meta.url))
const desktopDir = resolve(here, "..")
const repoRoot = resolve(desktopDir, "..", "..")
const srcTauri = join(desktopDir, "src-tauri")

const packageJsonPath = join(desktopDir, "package.json")
const tauriConfPath = join(srcTauri, "tauri.conf.json")
const cargoTomlPath = join(srcTauri, "Cargo.toml")
const cargoLockPath = join(srcTauri, "Cargo.lock")

// Signing + notarization must be present, or Tauri silently ships an unsigned
// bundle — fail before the ~20 min build rather than after.
const REQUIRED_ENV = [
  "APPLE_SIGNING_IDENTITY",
  "APPLE_API_ISSUER",
  "APPLE_API_KEY",
  "APPLE_API_KEY_PATH",
]
// Optional build inputs: absence degrades a feature but doesn't break the build.
const OPTIONAL_ENV = ["SCREENPLAY_GITHUB_CLIENT_ID"]

function log(msg) {
  process.stdout.write(`[release] ${msg}\n`)
}

function warn(msg) {
  process.stdout.write(`[release] ⚠ ${msg}\n`)
}

function fail(msg) {
  process.stderr.write(`[release] ✗ ${msg}\n`)
  process.exit(1)
}

/** Run a command, streaming its output; throws (aborting the release) on failure. */
function run(cmd, cmdArgs, opts = {}) {
  execFileSync(cmd, cmdArgs, { stdio: "inherit", cwd: repoRoot, ...opts })
}

/** Run a command and return its trimmed stdout. */
function capture(cmd, cmdArgs, opts = {}) {
  return execFileSync(cmd, cmdArgs, {
    encoding: "utf8",
    cwd: repoRoot,
    ...opts,
  }).trim()
}

/** Parse `.env.release` into a key→value map (KEY=VALUE, # comments, quotes stripped). */
function loadReleaseEnv() {
  const path = join(desktopDir, ".env.release")
  if (!existsSync(path)) {
    fail(
      `Missing ${path}. Copy apps/desktop/.env.release.example to .env.release and fill it in.`
    )
  }
  const env = {}
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

// ── 1. Credentials ─────────────────────────────────────────────────────────
const releaseEnv = loadReleaseEnv()

const missingRequired = REQUIRED_ENV.filter((k) => !releaseEnv[k])
if (missingRequired.length > 0) {
  fail(
    `Missing required signing/notarization inputs in .env.release: ${missingRequired.join(", ")} — see .env.release.example.`
  )
}
for (const key of OPTIONAL_ENV) {
  if (!releaseEnv[key]) {
    warn(`${key} is unset — building without it (that feature stays disabled).`)
  }
}

// The App Store Connect key path may be repo-relative; resolve it and confirm
// the .p8 actually exists before a 20-minute build banks on it.
const apiKeyPath = resolve(repoRoot, releaseEnv.APPLE_API_KEY_PATH)
if (!existsSync(apiKeyPath)) {
  fail(`APPLE_API_KEY_PATH points at a missing file: ${apiKeyPath}`)
}

// ── 2. Clean working tree ────────────────────────────────────────────────────
if (capture("git", ["status", "--porcelain"]) !== "") {
  fail("Working tree is dirty — commit or stash changes before releasing.")
}

// ── 3. Resolve target version via the #630 seam ──────────────────────────────
const bump = process.argv[2] ?? "patch"
const currentVersion = JSON.parse(readFileSync(packageJsonPath, "utf8")).version
const existingTags = capture("git", ["tag", "--list", "desktop-v*"])
  .split("\n")
  .filter(Boolean)

const resolved = resolveVersion(currentVersion, bump, existingTags)
if (!resolved.ok) {
  fail(resolved.message)
}
const { version, tag } = resolved
log(`releasing ${currentVersion} → ${version} (tag ${tag})`)

// ── 4. Rewrite the three version files in lockstep (Cargo.lock follows in 5) ──
writeFileSync(packageJsonPath, setPackageJsonVersion(readFileSync(packageJsonPath, "utf8"), version))
writeFileSync(tauriConfPath, setTauriConfVersion(readFileSync(tauriConfPath, "utf8"), version))
writeFileSync(cargoTomlPath, setCargoTomlVersion(readFileSync(cargoTomlPath, "utf8"), version))
log("bumped package.json, tauri.conf.json, Cargo.toml")

// ── 5. Build the sidecar, then the signed + notarized bundle ─────────────────
const buildEnv = {
  ...process.env,
  APPLE_SIGNING_IDENTITY: releaseEnv.APPLE_SIGNING_IDENTITY,
  APPLE_API_ISSUER: releaseEnv.APPLE_API_ISSUER,
  APPLE_API_KEY: releaseEnv.APPLE_API_KEY,
  APPLE_API_KEY_PATH: apiKeyPath,
}
// Passed through only when present so the compile-time option_env! reads unset
// (not empty) when unconfigured.
if (releaseEnv.SCREENPLAY_GITHUB_CLIENT_ID) {
  buildEnv.SCREENPLAY_GITHUB_CLIENT_ID = releaseEnv.SCREENPLAY_GITHUB_CLIENT_ID
}

log("building sidecar…")
run(process.execPath, [join(here, "build-sidecar.mjs")], { cwd: desktopDir })

log("building + signing + notarizing (tauri build)…")
run(
  "pnpm",
  ["exec", "tauri", "build", "--bundles", "app,dmg", "--config", "src-tauri/tauri.release.conf.json"],
  { cwd: desktopDir, env: buildEnv }
)

// ── 6. Verify before publishing anything ─────────────────────────────────────
const appPath = join(srcTauri, "target", "release", "bundle", "macos", "Screenplay.app")
const dmgPath = join(
  srcTauri,
  "target",
  "release",
  "bundle",
  "dmg",
  `Screenplay_${version}_aarch64.dmg`
)
if (!existsSync(appPath)) fail(`Expected bundle missing: ${appPath}`)
if (!existsSync(dmgPath)) fail(`Expected disk image missing: ${dmgPath}`)

log("verifying code signature…")
run("codesign", ["--verify", "--strict", "--verbose=2", appPath])

log("verifying Gatekeeper assessment on the dmg…")
run("spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose", dmgPath])

log("verifying the notarization staple…")
run("xcrun", ["stapler", "validate", appPath])

// ── 7. Commit → tag → publish (Release created last) ─────────────────────────
run("git", ["add", packageJsonPath, tauriConfPath, cargoTomlPath, cargoLockPath])
// `none` with no dependency churn leaves nothing staged — skip the empty commit
// but still tag + publish the already-committed version.
const staged = capture("git", ["diff", "--cached", "--name-only"])
if (staged !== "") {
  run("git", ["commit", "-m", `Release Screenplay Desktop ${version}`])
  run("git", ["push", "origin", "HEAD"])
} else {
  log("no version/lockfile changes to commit (bump=none)")
}

run("git", ["tag", tag])
run("git", ["push", "origin", tag])

log("creating GitHub Release…")
run("gh", [
  "release",
  "create",
  tag,
  "--title",
  `Screenplay Desktop ${version}`,
  "--generate-notes",
  dmgPath,
])

log(`done → released ${tag}`)
