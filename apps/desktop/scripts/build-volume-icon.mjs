// Compose `src-tauri/icons/dmg-volume.icns`: the icon the mounted disk image
// shows in Finder (its `.VolumeIcon.icns`). It's the macOS disk-image drive
// drawn in `dmg-volume-base.svg` with the app icon laid over its face, so the
// volume reads as "installer disk for Screenplay" rather than as the app itself.
//
//   pnpm --filter desktop build:volume-icon
//
// The output is committed; re-run this whenever `icon.icns` or the base SVG
// changes. release.mjs swaps it into the dmg after `tauri build`, because
// Tauri's bundler always uses the app's own .icns as the volume icon.
//
// The app icon comes from the 1024px PNG (`ic10`) inside `icon.icns`, the same
// render Finder uses for the app on macOS before 26.

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const here = dirname(fileURLToPath(import.meta.url))
const iconsDir = resolve(here, "..", "src-tauri", "icons")

const CANVAS = 1024
// The app icon sits on the drive's face, above the darker base strip.
const APP_SIZE = 440
const APP_LEFT = (CANVAS - APP_SIZE) / 2
const APP_TOP = 246

// PNG-backed icns entries: [type, pixel size].
const ICNS_TYPES = [
  ["icp4", 16],
  ["icp5", 32],
  ["icp6", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
  ["ic11", 32],
  ["ic12", 64],
  ["ic13", 256],
  ["ic14", 512],
]

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

function packIcns(entries) {
  const chunks = entries.map(([type, png]) => {
    const header = Buffer.alloc(8)
    header.write(type, 0, "latin1")
    header.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([header, png])
  })
  const header = Buffer.alloc(8)
  header.write("icns", 0, "latin1")
  header.writeUInt32BE(8 + chunks.reduce((sum, c) => sum + c.length, 0), 4)
  return Buffer.concat([header, ...chunks])
}

const appPng = readIcnsEntry(readFileSync(join(iconsDir, "icon.icns")), "ic10")
const appLayer = await sharp(appPng).resize(APP_SIZE, APP_SIZE).png().toBuffer()

const master = await sharp(join(iconsDir, "dmg-volume-base.svg"), { density: 72 })
  .resize(CANVAS, CANVAS)
  .composite([{ input: appLayer, left: APP_LEFT, top: APP_TOP }])
  .png()
  .toBuffer()

const bySize = new Map()
for (const [, size] of ICNS_TYPES) {
  if (!bySize.has(size)) {
    bySize.set(size, await sharp(master).resize(size, size).png().toBuffer())
  }
}

const out = join(iconsDir, "dmg-volume.icns")
writeFileSync(out, packIcns(ICNS_TYPES.map(([type, size]) => [type, bySize.get(size)])))
process.stdout.write(`[build-volume-icon] wrote ${out}\n`)
