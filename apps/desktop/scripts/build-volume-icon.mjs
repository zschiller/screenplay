// Compose `src-tauri/icons/dmg-volume.icns`: the icon the mounted disk image
// shows in Finder (its `.VolumeIcon.icns`). It's macOS's own disk-image drive,
// the icon Finder gives any mounted .dmg, with its pressed-in down arrow
// replaced by the app icon's smiley pressed in the same way, so the volume
// reads as "Screenplay's disk" rather than as the app itself.
//
//   pnpm --filter desktop build:volume-icon [--preview <file.png>]
//
// The drive is read from the running macOS at build time, so this only runs on
// a Mac, and its output is gitignored: it derives from Apple's artwork, which
// we don't redistribute in the repo. release.mjs runs this before `tauri build`
// and swaps the result into the dmg afterwards, because Tauri's bundler always
// uses the app's own .icns as the volume icon.
//
// The smiley is `icon.icon/Assets/face.svg`, the face layer of the app icon.

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
// The down arrow on the drive's face, with its light rim (1024px canvas).
const ARROW = { left: 352, top: 274, right: 672, bottom: 644 }
// face.svg is drawn on a 32-unit grid; the smiley spans x 7.5–25.5, y 7–19.3.
const FACE_SCALE = 18
const FACE_CENTRE = { x: 16.5, y: 13.15 }
const FACE_AT = { x: 512, y: 458 }

if (process.platform !== "darwin") {
  process.stderr.write("[build-volume-icon] needs macOS: it reads the system disk-image icon\n")
  process.exit(1)
}

// Erase the arrow: mask the pixels that stand out from a straight row blend
// across the arrow's box (the arrow and its rim), grow the mask a little, then
// fill it smoothly in from its edges so the face's shading carries across.
// Pixels outside the mask are left as Apple drew them.
function eraseArrow(data, channels) {
  const { left, top, right, bottom } = ARROW
  const at = (x, y) => y * CANVAS + x
  const lum = (i) => data[i * channels]
  const rowBlend = (field, x, y) => {
    const t = (x - left) / (right - left)
    return field(at(left, y)) * (1 - t) + field(at(right, y)) * t
  }

  const mask = new Uint8Array(CANVAS * CANVAS)
  let masked = 0
  for (let y = top; y <= bottom; y++) {
    for (let x = left + 1; x < right; x++) {
      if (Math.abs(lum(at(x, y)) - rowBlend(lum, x, y)) > 2) {
        mask[at(x, y)] = 1
        masked++
      }
    }
  }
  // Guard against a macOS update redrawing the drive: the arrow must be there.
  if (masked < 30000) {
    throw new Error(`no down arrow where expected in ${SYSTEM_DRIVE_ICNS}; ARROW needs updating`)
  }
  for (let pass = 0; pass < 4; pass++) {
    const grown = mask.slice()
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const i = at(x, y)
        if (mask[i - 1] || mask[i + 1] || mask[i - CANVAS] || mask[i + CANVAS]) grown[i] = 1
      }
    }
    mask.set(grown)
  }

  const field = new Float32Array(CANVAS * CANVAS)
  for (let i = 0; i < field.length; i++) field[i] = lum(i)
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if (mask[at(x, y)]) field[at(x, y)] = rowBlend((i) => field[i], x, y)
    }
  }
  for (let iter = 0; iter < 3000; iter++) {
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const i = at(x, y)
        if (mask[i]) field[i] = (field[i - 1] + field[i + 1] + field[i - CANVAS] + field[i + CANVAS]) / 4
      }
    }
  }
  for (let i = 0; i < field.length; i++) {
    if (mask[i]) for (let c = 0; c < 3; c++) data[i * channels + c] = Math.round(field[i])
  }
}

// The smiley pressed into the face the way the arrow was: a grey fill that
// darkens downwards, a soft shadow under its top edge, and a light rim.
function pressedFaceSvg() {
  const face = readFileSync(join(iconsDir, "icon.icon", "Assets", "face.svg"), "utf8")
  const shapes = [...face.matchAll(/<(?:circle|path)[^>]*\/>/g)]
    .map(([shape]) => shape.replace(/ fill="[^"]*"/, ""))
    .join("")
  const s = FACE_SCALE
  const tx = FACE_AT.x - FACE_CENTRE.x * s
  const ty = FACE_AT.y - FACE_CENTRE.y * s
  const glyph = `<g transform="translate(${tx} ${ty}) scale(${s})">${shapes}</g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}">
  <defs>
    <linearGradient id="fill" gradientUnits="userSpaceOnUse" x1="0" y1="${ty + 7 * s}" x2="0" y2="${ty + 19.3 * s}">
      <stop offset="0" stop-color="rgb(196,196,196)"/>
      <stop offset="1" stop-color="rgb(183,183,183)"/>
    </linearGradient>
    <filter id="rim" x="-20%" y="-20%" width="140%" height="140%">
      <feMorphology in="SourceAlpha" operator="dilate" radius="2.5"/>
      <feGaussianBlur stdDeviation="1.5" result="grown"/>
      <feFlood flood-color="#fff" flood-opacity="0.55"/>
      <feComposite in2="grown" operator="in"/>
    </filter>
    <filter id="inset" x="-20%" y="-20%" width="140%" height="140%">
      <feComponentTransfer in="SourceAlpha"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer>
      <feOffset dy="3"/>
      <feGaussianBlur stdDeviation="1.5" result="outside"/>
      <feFlood flood-color="#000" flood-opacity="0.28"/>
      <feComposite in2="outside" operator="in"/>
      <feComposite in2="SourceAlpha" operator="in"/>
    </filter>
  </defs>
  <g filter="url(#rim)">${glyph}</g>
  <g fill="url(#fill)">${glyph}</g>
  <g filter="url(#inset)">${glyph}</g>
</svg>`
}

const workDir = mkdtempSync(join(tmpdir(), "screenplay-volume-icon-"))
try {
  const driveIconset = join(workDir, "drive.iconset")
  execFileSync("iconutil", ["-c", "iconset", SYSTEM_DRIVE_ICNS, "-o", driveIconset])
  const { data, info } = await sharp(join(driveIconset, "icon_512x512@2x.png"))
    .resize(CANVAS, CANVAS)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  eraseArrow(data, info.channels)

  const master = await sharp(data, { raw: info })
    .composite([{ input: Buffer.from(pressedFaceSvg()) }])
    .png()
    .toBuffer()

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
