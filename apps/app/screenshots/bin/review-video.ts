#!/usr/bin/env tsx
import { relative, resolve } from "node:path"

import { boolFlag, parseArgs } from "../lib/args"
import { encodeReviewVideo } from "../lib/review-video"

/**
 * `pnpm screenshots:review-video <file.webm…>` — convert recordings made outside
 * the harness (a one-off Playwright script, the homepage) into the GIF + MP4 a PR
 * can show. `screenshots:video` already does this for named interactions.
 *
 *   --keep-webm   leave the source next to the outputs
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  // `--keep-webm a.webm b.webm` parses `a.webm` as the flag's value.
  const keep = args.flags["keep-webm"]
  if (typeof keep === "string") args.positionals.unshift(keep)
  if (args.positionals.length === 0) {
    console.log(
      "Usage: pnpm screenshots:review-video <file.webm…> [--keep-webm]"
    )
    process.exit(1)
  }
  for (const file of args.positionals) {
    console.log(`Encoding ${file}`)
    const result = await encodeReviewVideo(resolve(file), {
      keepWebm: boolFlag(args, "keep-webm"),
      log: (m) => console.log(m),
    })
    console.log(
      `  Wrote ${relative(process.cwd(), result.gif)} (${result.gifWidth}px, ${result.gifFps}fps)`
    )
    console.log(`  Wrote ${relative(process.cwd(), result.mp4)}`)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
