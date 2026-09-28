#!/usr/bin/env tsx
import { relative } from "node:path"

import { seedFixtureWorld } from "../fixtures/seed"
import {
  applyHostedFlag,
  boolFlag,
  listFlag,
  parseArgs,
  stringFlag,
} from "../lib/args"
import { captureScreens } from "../lib/capture"
import { isServerUp, startCaptureStack } from "../lib/server"
import { selectScreens } from "../screens"
import { isHostedCapture, resolveCaptureProfile } from "../profile"
import { THEMES, type Theme } from "../lib/browser"

/**
 * `pnpm screenshots:shots` — capture a **capture set**: every named screen, light
 * and dark, into one labelled directory.
 *
 * It boots the app itself when nothing is serving the port, and reuses a server
 * that is already up (the `boot` loop), so the same command works as a one-shot in
 * a cold container and as a fast re-shoot while you iterate. A server it started,
 * it stops; a server it found, it leaves alone.
 *
 *   --label <name>      output directory name (default: `capture`; use before/after)
 *   --out <dir>         capture root to write the label into
 *   --screens a,b       only these screens (default: all of them)
 *   --themes light      only these themes (default: light,dark)
 *   --list              print the screen list and exit
 *   --no-seed           capture whatever is in the state dir already
 *   --fresh             re-seed a clean world first (implies a server restart)
 *   --hosted            the hosted build and its screens (comments) instead
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  applyHostedFlag(args)
  if (boolFlag(args, "list")) {
    for (const screen of selectScreens([], { hosted: isHostedCapture() })) {
      console.log(
        `${screen.name.padEnd(22)} ${screen.path.padEnd(42)} ${screen.description}`
      )
    }
    return
  }

  // Applied before the profile resolves, since that is what reads it — this is
  // the same knob as `SCREENSHOTS_CAPTURE_DIR`, spelled as a flag.
  const out = stringFlag(args, "out")
  if (out) process.env.SCREENSHOTS_CAPTURE_DIR = out
  const profile = resolveCaptureProfile()
  const label = stringFlag(args, "label") ?? "capture"
  const screens = selectScreens(listFlag(args, "screens"), {
    hosted: profile.hosted,
  })
  const themes = resolveThemes(listFlag(args, "themes"))
  const fresh = boolFlag(args, "fresh")
  const seed = !boolFlag(args, "no-seed")

  const alreadyUp = await isServerUp(profile)
  if (alreadyUp && fresh) {
    console.error(
      `--fresh needs to re-seed the database, which the running server on ${profile.baseUrl} is holding open. Stop it and re-run.`
    )
    process.exit(1)
  }

  // Seed only when we're the ones about to boot: the data dir has a single
  // opener, so a reused server has already claimed it.
  if (seed && !alreadyUp) {
    console.log(`Seeding the fixture world into ${profile.stateRoot}`)
    await seedFixtureWorld(profile, { fresh })
  }

  const stack = await startCaptureStack(profile, { quiet: true })
  try {
    console.log(
      `Capturing ${screens.length} screens × ${themes.length} themes → ${label}/`
    )
    const result = await captureScreens(profile, { label, screens, themes })
    console.log("")
    console.log(
      `Wrote ${result.files.length} images to ${relative(process.cwd(), result.dir)}`
    )
  } finally {
    await stack.stop()
  }
}

function resolveThemes(names: string[]): Theme[] {
  if (names.length === 0) return [...THEMES]
  const unknown = names.filter((name) => !THEMES.includes(name as Theme))
  if (unknown.length > 0) {
    throw new Error(
      `unknown theme(s): ${unknown.join(", ")} (known: ${THEMES.join(", ")})`
    )
  }
  return names as Theme[]
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
