import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

import type { CaptureProfile } from "../profile"
import type { Theme } from "../lib/browser"
import { looksTheSame } from "./frame"
import type { Crop, DocsScreen } from "./screens"

/** Where the marketing homepage imports its product images from. */
export const HOMEPAGE_SHOT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../web/components/marketing/shots"
)

/**
 * The homepage's product images (#1010): plain captures of docs screens, with
 * no window chrome or backdrop, since the homepage draws its own hairline
 * frame. `crop` (CSS px of the 1280×800 capture) cuts a 16:10 detail for the
 * "how it works" scenes; `width` is the output width in image pixels.
 */
const HOMEPAGE_SHOTS: readonly {
  name: string
  screen: string
  crop?: Crop
  width: number
}[] = [
  { name: "hero", screen: "hero", width: 2400 },
  { name: "frame-selected", screen: "frame-selected", width: 1600 },
  {
    name: "scene-repo",
    screen: "home-recents",
    crop: [228, 64, 711, 444],
    width: 800,
  },
  {
    name: "scene-takes",
    screen: "new-workspace-multi",
    crop: [284, 160, 711, 444],
    width: 800,
  },
  {
    name: "scene-run",
    screen: "frame-selected",
    crop: [245, 40, 640, 400],
    width: 800,
  },
  { name: "scene-pr", screen: "ws-menu", crop: [0, 50, 560, 350], width: 800 },
]

/**
 * Write the homepage's product images from the raw docs captures, keeping any
 * committed image that renders visually the same (as the docs framing does),
 * so the Docs screenshots workflow only proposes real changes.
 */
export async function writeHomepageShots(
  profile: CaptureProfile,
  options: {
    label: string
    screens: readonly DocsScreen[]
    themes: readonly Theme[]
  }
): Promise<void> {
  const rawDir = join(profile.captureRoot, options.label)
  const captured = new Set(options.screens.map((s) => s.name))
  await mkdir(HOMEPAGE_SHOT_DIR, { recursive: true })
  let written = 0
  for (const shot of HOMEPAGE_SHOTS) {
    if (!captured.has(shot.screen)) continue
    for (const theme of options.themes) {
      const src = join(rawDir, `${shot.screen}.${theme}.png`)
      if (!existsSync(src)) continue
      let image = sharp(src)
      if (shot.crop) {
        const { width } = await image.metadata()
        // Captures are taken at a device scale factor; crops are in CSS px.
        const scale = (width ?? 1280) / 1280
        const [left, top, w, h] = shot.crop.map((n) => Math.round(n * scale))
        image = image.extract({ left: left!, top: top!, width: w!, height: h! })
      }
      const webp = await image
        .resize({ width: shot.width })
        .webp({ quality: 86 })
        .toBuffer()
      const out = join(HOMEPAGE_SHOT_DIR, `${shot.name}.${theme}.webp`)
      if (await looksTheSame(webp, out)) continue
      await writeFile(out, webp)
      written++
    }
  }
  if (written) console.log(`Homepage: ${written} product image(s) updated.`)
}
