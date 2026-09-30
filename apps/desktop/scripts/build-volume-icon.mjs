// Compose `src-tauri/icons/dmg-volume.icns`: the icon the mounted disk image
// shows in Finder (its `.VolumeIcon.icns`). It's macOS's own disk-image drive,
// the icon Finder gives any mounted .dmg, with the app icon laid over its face
// (the create-dmg look), so the volume reads as "installer disk for
// Screenplay" rather than as the app itself.
//
//   pnpm --filter desktop build:volume-icon
//
// The drive is read from the running macOS at build time, so this only runs on
// a Mac, and its output is gitignored: it derives from Apple's artwork, which
// we don't redistribute in the repo. release.mjs runs this before `tauri build`
// and swaps the result into the dmg afterwards, because Tauri's bundler always
// uses the app's own .icns as the volume icon.
//
// The app icon comes from the 1024px PNG (`ic10`) inside `icon.icns`, the same
// render Finder uses for the app on macOS before 26.

import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const here = dirname(fileURLToPath(import.meta.url))
const iconsDir = resolve(here, "..", "src-tauri", "icons")

// What Finder shows for a mounted disk image with no volume icon of its own.
const SYSTEM_DRIVE_ICNS =
  "/System/Library/Extensions/IOStorageFamily.kext/Contents/Resources/Removable.icns"

const CANVAS = 1024
// The app icon covers the drive's arrow, centred on the face above the base
// strip. icon.icns carries Apple's grid padding, so its artwork is ~80% of this.
const APP_SIZE = 600
const APP_LEFT = (CANVAS - APP_SIZE) / 2
const APP_TOP = 160

if (process.platform !== "darwin") {
  process.stderr.write("[build-volume-icon] needs macOS: it reads the system disk-image icon\n")
  process.exit(1)
}

function readIcnsEntry(buffer, type) {
  let offset = 8
  while (offset < buffer.length) {
    const entryType = buffer.toString("latin1", offset, offset + 4)
    const length = buffer.readUInt32BE(offset + 4)
    if (entryType === type) return buffer.subarray(offset + 8, offset + length)
    offset += length
  }
  throw new Error(`icon.icns has no ${type} entry`)
}

const workDir = mkdtempSync(join(tmpdir(), "screenplay-volume-icon-"))
try {
  const driveIconset = join(workDir, "drive.iconset")
  execFileSync("iconutil", ["-c", "iconset", SYSTEM_DRIVE_ICNS, "-o", driveIconset])
  const drivePng = readFileSync(join(driveIconset, "icon_512x512@2x.png"))

  const appPng = readIcnsEntry(readFileSync(join(iconsDir, "icon.icns")), "ic10")
  const appLayer = await sharp(appPng).resize(APP_SIZE, APP_SIZE).png().toBuffer()

  const master = await sharp(drivePng)
    .resize(CANVAS, CANVAS)
    .composite([{ input: appLayer, left: APP_LEFT, top: APP_TOP }])
    .png()
    .toBuffer()

  // `--preview <file.png>` also writes the 1024px master, for eyeballing.
  const previewArg = process.argv.indexOf("--preview")
  if (previewArg !== -1) writeFileSync(process.argv[previewArg + 1], master)

  // iconutil packs the icns, so Finder reads every size exactly as it reads
  // Apple's own icons.
  const iconset = join(workDir, "dmg-volume.iconset")
  mkdirSync(iconset)
  for (const size of [16, 32, 128, 256, 512]) {
    for (const [scale, suffix] of [
      [1, ""],
      [2, "@2x"],
    ]) {
      await sharp(master)
        .resize(size * scale, size * scale)
        .png()
        .toFile(join(iconset, `icon_${size}x${size}${suffix}.png`))
    }
  }
  const out = join(iconsDir, "dmg-volume.icns")
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", out])
  process.stdout.write(`[build-volume-icon] wrote ${out}\n`)
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
