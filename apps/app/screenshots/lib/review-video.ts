import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, rm, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const run = promisify(execFile)

/**
 * Turns a Playwright `.webm` into something a reviewer can actually watch.
 *
 * GitHub won't play a `.webm` (or any video) linked from a branch: the browser
 * downloads it, and QuickTime on a Mac can't open VP8 either. So every recording
 * becomes two files next to the source:
 *
 * - `<stem>.gif` — **embed this** in the PR (`![](…raw…/x.gif)`). An image plays
 *   inline in the description. Kept under {@link GIF_BUDGET} so the PR page
 *   stays quick to open; a busy recording steps down in size and frame rate.
 * - `<stem>.mp4` — H.264 at full size, **link this** for detail. It plays in
 *   QuickTime, Safari and Chrome.
 *
 * The `.webm` is removed.
 */
export interface ReviewVideo {
  gif: string
  mp4: string
  /** The GIF's width and frame rate after fitting the budget. */
  gifWidth: number
  gifFps: number
}

/**
 * The PR page loads the GIF in full before it plays, so past this it drags,
 * especially on a phone. (Images on this repo's branches load straight from
 * raw.githubusercontent.com, not through GitHub's size-capped image proxy.)
 */
export const GIF_BUDGET = 10_000_000

/** Largest first: the first rung under budget wins. */
const GIF_LADDER: readonly { width: number; fps: number }[] = [
  { width: 1200, fps: 15 },
  { width: 960, fps: 12 },
  { width: 800, fps: 12 },
  { width: 720, fps: 10 },
  { width: 640, fps: 8 },
  { width: 480, fps: 8 },
]

export async function encodeReviewVideo(
  webm: string,
  options: { keepWebm?: boolean; log?: (message: string) => void } = {}
): Promise<ReviewVideo> {
  const log = options.log ?? (() => {})
  const ffmpeg = await resolveFfmpeg(log)
  const stem = webm.replace(/\.webm$/, "")
  const mp4 = `${stem}.mp4`
  const gif = `${stem}.gif`

  await run(ffmpeg, [
    ...["-v", "error", "-y", "-i", webm],
    ...["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20"],
    ...["-preset", "slow", "-movflags", "+faststart", "-an"],
    // H.264 needs even dimensions.
    ...["-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2"],
    mp4,
  ])

  const sourceWidth = await probeWidth(ffmpeg, webm)
  const rungs = GIF_LADDER.filter((r) => r.width <= sourceWidth)
  if (rungs.length === 0) rungs.push({ width: sourceWidth, fps: 12 })
  let chosen = rungs[rungs.length - 1]!
  for (const rung of rungs) {
    await writeGif(ffmpeg, webm, gif, rung)
    const size = (await stat(gif)).size
    if (size <= GIF_BUDGET) {
      chosen = rung
      break
    }
    log(
      `  ${(size / 1e6).toFixed(1)}MB GIF at ${rung.width}px ${rung.fps}fps is over budget, stepping down`
    )
  }

  if (!options.keepWebm) await rm(webm, { force: true })
  return { gif, mp4, gifWidth: chosen.width, gifFps: chosen.fps }
}

async function writeGif(
  ffmpeg: string,
  input: string,
  output: string,
  { width, fps }: { width: number; fps: number }
): Promise<void> {
  // One pass, two branches: build a palette from the frames that change, then
  // map every frame onto it. Only the changed rectangle is re-dithered, which
  // keeps static UI from shimmering and the file small.
  const filter =
    `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];` +
    `[a]palettegen=stats_mode=diff[p];` +
    `[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`
  await run(ffmpeg, [
    "-v",
    "error",
    "-y",
    "-i",
    input,
    "-vf",
    filter,
    "-loop",
    "0",
    output,
  ])
}

async function probeWidth(ffmpeg: string, input: string): Promise<number> {
  // ffmpeg with no output exits non-zero but prints the stream line to stderr.
  const result = await run(ffmpeg, ["-hide_banner", "-i", input]).catch(
    (err: { stderr?: string }) => ({ stderr: err.stderr ?? "" })
  )
  const match = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(result.stderr)
  return match ? Number(match[1]) : 1440
}

const TOOLS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".screenshots",
  "tools"
)
const FFMPEG_STATIC = "ffmpeg-static@5.3.0"

/**
 * An ffmpeg that can write GIF and H.264. Playwright's bundled ffmpeg only
 * encodes VP8, so it can't be used. `ffmpeg` on PATH wins (Homebrew, apt);
 * otherwise a static build is installed once into the gitignored
 * `.screenshots/tools/` — not a package dependency, so installs and CI don't
 * download 80MB for a tool only recordings need.
 */
async function resolveFfmpeg(log: (message: string) => void): Promise<string> {
  const fromEnv = process.env.SCREENSHOTS_FFMPEG
  if (fromEnv) return fromEnv
  if (await canEncode("ffmpeg")) return "ffmpeg"

  const bundled = join(TOOLS_DIR, "node_modules", "ffmpeg-static", "ffmpeg")
  if (!existsSync(bundled)) {
    log(`  Installing ${FFMPEG_STATIC} into ${TOOLS_DIR} (once)`)
    await mkdir(TOOLS_DIR, { recursive: true })
    await run(
      "npm",
      [
        "install",
        "--no-save",
        "--no-package-lock",
        "--prefix",
        TOOLS_DIR,
        FFMPEG_STATIC,
      ],
      { maxBuffer: 16 * 1024 * 1024 }
    )
  }
  return bundled
}

async function canEncode(bin: string): Promise<boolean> {
  try {
    const { stdout } = await run(bin, ["-hide_banner", "-encoders"])
    return /\bgif\b/.test(stdout) && /libx264/.test(stdout)
  } catch {
    return false
  }
}
