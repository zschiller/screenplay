// The real desktop release mechanism (issue #631, PRD #629): one command turns a
// bump keyword into a signed, notarized, published macOS build.
//
//   pnpm --filter desktop release <patch|minor|major|none|X.Y.Z> [--notes <file>]
//
// --notes takes a short Markdown summary for people downloading the app; it
// goes above GitHub's generated list of merged PRs in the Release.
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
//   5. Build the sidecar, then `tauri build` → signed + notarized .app/.dmg,
//      with the disk-drive volume icon swapped into the dmg.
//   6. Verify signature, Gatekeeper assessment, and notarization staple.
//   7. Only then: commit the bump → tag desktop-v<version> → create the Release,
//      with the dmg attached twice: under its versioned name, and as
//      Screenplay.dmg so releases/latest/download/Screenplay.dmg (the homepage's
//      Download link) always fetches the newest build.

import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
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

// The stable asset name the homepage's Download buttons link to
// (apps/homepage/lib/app-url.ts). Renaming it breaks every Download button.
const STABLE_DMG_NAME = "Screenplay.dmg"

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

// ── 1. Arguments and credentials ──────────────────────────────────────────
const args = process.argv.slice(2)
const notesFlag = args.indexOf("--notes")
let notesPath = null
if (notesFlag !== -1) {
  if (!args[notesFlag + 1]) fail("--notes needs a file: --notes <file>")
  notesPath = resolve(process.cwd(), args[notesFlag + 1])
  if (!existsSync(notesPath)) fail(`--notes points at a missing file: ${notesPath}`)
  args.splice(notesFlag, 2)
} else {
  warn("no --notes file — the Release will list merged PRs only.")
}

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
const bump = args[0] ?? "patch"
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

// Compile the Liquid Glass icon catalog (Assets.car) from icons/icon.icon.
// The generated .car is gitignored; bundle.icon points at it, which makes
// Tauri copy it verbatim instead of running its own (fragile) actool path.
// Runs first: it's seconds, and needs full Xcode — fail here, not after the
// 20-minute build.
log("compiling Liquid Glass icon…")
run(process.execPath, [join(here, "build-icon.mjs")], { cwd: desktopDir })
// The dmg's volume icon (gitignored: it's composed from macOS's own drive icon).
log("composing the dmg volume icon…")
run(process.execPath, [join(here, "build-volume-icon.mjs")], { cwd: desktopDir })

// buildEnv carries APPLE_SIGNING_IDENTITY so build-sidecar signs the nested
// native binaries (node-pty, sharp, keyring, leveldown …) before packing them
// into the tarball — the notary service validates every Mach-O inside it, and
// Tauri's outer signing never reaches into a resource archive (issue #632).
log("building sidecar…")
run(process.execPath, [join(here, "build-sidecar.mjs")], { cwd: desktopDir, env: buildEnv })

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

// Tauri always gives the mounted dmg the app's own .icns as its volume icon.
// Swap in the disk-drive composite (scripts/build-volume-icon.mjs) so the
// mounted volume reads as an installer disk: convert to read-write, replace
// .VolumeIcon.icns in place (keeping its Finder flags), convert back to the
// same compressed UDZO Tauri produced, and re-sign, since the rewrite drops
// Tauri's dmg signature.
log("setting the dmg volume icon…")
const volumeWorkDir = mkdtempSync(join(tmpdir(), "screenplay-dmg-"))
const rwDmgPath = join(volumeWorkDir, "rw.dmg")
const mountPoint = join(volumeWorkDir, "mnt")
run("hdiutil", ["convert", dmgPath, "-format", "UDRW", "-o", rwDmgPath])
run("hdiutil", ["attach", rwDmgPath, "-nobrowse", "-noautoopen", "-mountpoint", mountPoint])
try {
  copyFileSync(join(srcTauri, "icons", "dmg-volume.icns"), join(mountPoint, ".VolumeIcon.icns"))
} finally {
  run("hdiutil", ["detach", mountPoint])
}
run("hdiutil", [
  "convert",
  rwDmgPath,
  "-format",
  "UDZO",
  "-imagekey",
  "zlib-level=9",
  "-ov",
  "-o",
  dmgPath,
])
rmSync(volumeWorkDir, { recursive: true, force: true })
run("codesign", ["--force", "--timestamp", "--sign", releaseEnv.APPLE_SIGNING_IDENTITY, dmgPath])

// Tauri notarizes only the .app; the dmg needs its own ticket or Gatekeeper
// rejects it as "Unnotarized Developer ID" (and the offline fresh-Mac install
// depends on the *dmg's* staple — that's the artifact users download).
// notarytool's exit code isn't a reliable Invalid signal, but the staple and
// the spctl assessment below both hard-fail without an accepted ticket.
log("notarizing the dmg…")
run("xcrun", [
  "notarytool",
  "submit",
  dmgPath,
  "--key",
  apiKeyPath,
  "--key-id",
  releaseEnv.APPLE_API_KEY,
  "--issuer",
  releaseEnv.APPLE_API_ISSUER,
  "--wait",
])
log("stapling the notarization ticket onto the dmg…")
run("xcrun", ["stapler", "staple", dmgPath])

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

// The same verified dmg under the stable name; gh names assets by file name.
const stableDmgPath = join(dirname(dmgPath), STABLE_DMG_NAME)
copyFileSync(dmgPath, stableDmgPath)

log("creating GitHub Release…")
run("gh", [
  "release",
  "create",
  tag,
  "--title",
  `Screenplay Desktop ${version}`,
  // With --notes-file, gh puts the file's text above the generated notes.
  ...(notesPath ? ["--notes-file", notesPath] : []),
  "--generate-notes",
  dmgPath,
  stableDmgPath,
])

log(`done → released ${tag}`)
