#!/usr/bin/env tsx
import { relative } from "node:path"

import { seedFixtureWorld } from "../fixtures/seed"
import { INTERACTIONS, selectInteraction } from "../interactions"
import { boolFlag, parseArgs, stringFlag } from "../lib/args"
import { recordInteraction } from "../lib/capture"
import { THEMES, type Theme } from "../lib/browser"
import { isServerUp, startCaptureStack } from "../lib/server"
import { resolveCaptureProfile } from "../profile"

/**
 * `pnpm screenshots:video <interaction>` — record one named interaction to a webm.
 *
 * Boots and reuses a server exactly like `shots` does. One interaction per run:
 * a recording is something a reviewer scrubs, so it is named and chosen, never a
 * batch.
 *
 *   --theme dark        record in dark mode (default: light)
 *   --label <name>      output directory name (default: `videos`)
 *   --out <dir>         capture root to write the label into
 *   --list              print the interaction list and exit
 *   --no-seed           record against whatever is in the state dir already
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (boolFlag(args, "list") || args.positionals.length === 0) {
    console.log("Interactions:")
    for (const interaction of INTERACTIONS) {
      console.log(`  ${interaction.name.padEnd(18)} ${interaction.description}`)
    }
    if (args.positionals.length === 0 && !boolFlag(args, "list")) {
      console.log(
        "\nUsage: pnpm screenshots:video <interaction> [--theme dark]"
      )
      process.exit(1)
    }
    return
  }

  // Applied before the profile resolves, since that is what reads it — this is
  // the same knob as `SCREENSHOTS_CAPTURE_DIR`, spelled as a flag.
  const out = stringFlag(args, "out")
  if (out) process.env.SCREENSHOTS_CAPTURE_DIR = out
  const profile = resolveCaptureProfile()
  const interaction = selectInteraction(args.positionals[0]!)
  const theme = resolveTheme(stringFlag(args, "theme"))
  const label = stringFlag(args, "label")
  const seed = !boolFlag(args, "no-seed")

  const alreadyUp = await isServerUp(profile)
  if (seed && !alreadyUp) {
    console.log(`Seeding the fixture world into ${profile.stateRoot}`)
    await seedFixtureWorld(profile, { fresh: boolFlag(args, "fresh") })
  }

  const stack = await startCaptureStack(profile, { quiet: true })
  try {
    console.log(`Recording ${interaction.name} (${theme})`)
    const result = await recordInteraction(profile, {
      interaction,
      theme,
      label,
    })
    console.log("")
    console.log(`Wrote ${relative(process.cwd(), result.file)}`)
  } finally {
    await stack.stop()
  }
}

function resolveTheme(value: string | undefined): Theme {
  if (!value) return "light"
  if (!THEMES.includes(value as Theme)) {
    throw new Error(`unknown theme: ${value} (known: ${THEMES.join(", ")})`)
  }
  return value as Theme
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
