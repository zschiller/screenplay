// Regenerate `src-tauri/icons/icon.car` from the Icon Composer source
// `src-tauri/icons/icon.icon` (macOS 26 Liquid Glass app icon).
//
//   node apps/desktop/scripts/build-icon.mjs
//
// Why a committed, pre-compiled `.car` instead of letting Tauri run actool at
// build time: Tauri 2.11 will compile a `.icon` in `bundle.icon` via `actool`,
// but that path is fragile — actool ships only with full Xcode (not the Command
// Line Tools), and its `ibtoold` daemon intermittently wedges into a crash loop
// ("attempt to insert nil object"). Tauri's bundler has an escape hatch: if
// `bundle.icon` contains an already-compiled `.car`, it copies it and skips
// actool entirely (and still reads CFBundleIconName from it via assetutil). So
// we compile once here, commit the result, and point `bundle.icon` at it —
// making the release build deterministic and Xcode-optional.
//
// Requires full Xcode (for actool). Run whenever icon.icon changes.
//
// The two things that make actool actually emit a .car (both learned the hard
// way): a healthy ibtoold (we kill it first to clear a wedged state) and the
// `--output-partial-info-plist` flag (without it actool no-ops with a warning).

import { execFileSync } from "node:child_process"
import { cpSync, copyFileSync, existsSync, mkdtempSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const iconsDir = resolve(here, "..", "src-tauri", "icons")
const source = join(iconsDir, "icon.icon")
const dest = join(iconsDir, "icon.car")

function log(msg) {
  process.stdout.write(`[build-icon] ${msg}\n`)
}

if (!existsSync(source)) {
  process.stderr.write(`[build-icon] ✗ missing ${source}\n`)
  process.exit(1)
}

// actool lives only in full Xcode; point at it explicitly so this works even
// when the global `xcode-select` is the Command Line Tools.
const developerDir = "/Applications/Xcode.app/Contents/Developer"
const actool = join(developerDir, "usr", "bin", "actool")
if (!existsSync(actool)) {
  process.stderr.write(
    `[build-icon] ✗ actool not found at ${actool} — full Xcode is required to compile the Liquid Glass icon.\n`
  )
  process.exit(1)
}

// Clear a wedged ibtoold before compiling (see header note).
try {
  execFileSync("killall", ["-9", "ibtoold"], { stdio: "ignore" })
  log("reset ibtoold")
} catch {
  // Not running — nothing to reset.
}

const work = mkdtempSync(join(tmpdir(), "icon-"))
// Tauri names the app icon after the .icon file stem; use "Icon" so the
// resulting CFBundleIconName matches what Tauri's own actool path would emit.
const stagedIcon = join(work, "Icon.icon")
const outDir = join(work, "out")
cpSync(source, stagedIcon, { recursive: true })
execFileSync("mkdir", ["-p", outDir])

log("compiling icon.car via actool…")
execFileSync(
  actool,
  [
    stagedIcon,
    "--compile", outDir,
    "--output-format", "human-readable-text",
    "--notices",
    "--warnings",
    "--output-partial-info-plist", join(outDir, "partial.plist"),
    "--app-icon", "Icon",
    "--include-all-app-icons",
    "--enable-on-demand-resources", "NO",
    "--development-region", "en",
    "--target-device", "mac",
    "--minimum-deployment-target", "26.0",
    "--platform", "macosx",
  ],
  { stdio: "inherit", env: { ...process.env, DEVELOPER_DIR: developerDir } }
)

const car = join(outDir, "Assets.car")
if (!existsSync(car)) {
  process.stderr.write("[build-icon] ✗ actool did not produce Assets.car\n")
  process.exit(1)
}
copyFileSync(car, dest)
log(`done → ${dest}`)
