#!/usr/bin/env tsx
import { existsSync } from "node:fs"
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { join, relative } from "node:path"

import {
  ensureDemoCheckout,
  previewOrigin,
  startDemoPreviews,
} from "../docs/demo-site"
import { frameScreens } from "../docs/frame"
import { resolveDocsProfile } from "../docs/profile"
import {
  DOCS_SCREENS,
  measuredCrops,
  selectDocsScreens,
  setDemoCheckoutPath,
  type DocsScreen,
} from "../docs/screens"
import { photographPreviews } from "../docs/thumbnails"
import { buildDocsWorld } from "../docs/world"
import { seedFixtureWorld } from "../fixtures/seed"
import { worldNow } from "../fixtures/world"
import { boolFlag, listFlag, parseArgs } from "../lib/args"
import { THEMES, type Theme } from "../lib/browser"
import { captureScreens } from "../lib/capture"
import { isServerUp, startCaptureStack } from "../lib/server"
import type { CaptureProfile } from "../profile"

/**
 * `pnpm screenshots:docs` — regenerate the product docs' screenshots
 * (`apps/docs/public/screenshots/<name>.<theme>.webp`).
 *
 * Seeds the docs world (`../docs/world.ts`), serves its demo-site previews and
 * the local build, captures the docs screen list in light and dark, then frames
 * each capture for the docs pages (`../docs/frame.ts`).
 *
 *   --screens a,b   only these screens (default: all of them)
 *   --themes light  only these themes (default: light,dark)
 *   --list          print the screen list and exit
 *   --no-frame      capture only; leave apps/docs untouched
 *   --frame-only    re-frame the last capture without booting anything
 *   --boot          seed and serve the docs world until Ctrl-C, for browsing
 *
 * A run finding a `--boot` already serving shoots against it rather than
 * re-seeding, which is the fast loop while editing a screen.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (boolFlag(args, "list")) {
    for (const screen of DOCS_SCREENS) {
      console.log(`${screen.name.padEnd(26)} ${screen.description}`)
    }
    return
  }

  const { profile, previews } = resolveDocsProfile()
  const screens = selectDocsScreens(listFlag(args, "screens"))
  const themes = resolveThemes(listFlag(args, "themes"))
  const label = "docs"

  if (boolFlag(args, "frame-only")) {
    await frameScreens(profile, { label, screens, themes })
    return
  }

  const checkout = join(profile.env.HOME!, "code", "northwind-web")
  setDemoCheckoutPath(checkout)
  const boot = boolFlag(args, "boot")

  if (await isServerUp(profile)) {
    // A `--boot` left open in another terminal: shoot against it as-is, which
    // is the fast loop while editing a screen.
    if (boot) {
      console.error(`Something is already serving ${profile.baseUrl}.`)
      process.exit(1)
    }
    console.log(`• reusing the docs world already on ${profile.baseUrl}`)
    await capture(profile, screens, themes, label)
  } else {
    await ensureDemoCheckout(checkout)
    console.log("• building the demo site previews")
    const preview = await startDemoPreviews(profile.stateRoot, previews)
    try {
      const world = await buildDocsWorld({
        now: worldNow(),
        previewOrigins: Object.fromEntries(
          previews.map((p) => [p.sandboxName, previewOrigin(p.port)])
        ),
      })
      console.log(`Seeding the docs world into ${profile.stateRoot}`)
      await seedFixtureWorld(profile, {
        fresh: true,
        world,
        renderCaptures: photographPreviews(world),
      })
      const stack = await startCaptureStack(profile, {
        quiet: true,
        // Already serving: hand the stack a handle it won't stop.
        startPreview: async () => ({ ...preview, started: false }),
      })
      try {
        if (boot) {
          console.log(
            `\n  Screenplay (local build, docs world) → ${profile.baseUrl}\n  Shoot against it: pnpm screenshots:docs --screens <names>\n  Stop it: Ctrl-C\n`
          )
          await new Promise<void>((resolve) => {
            process.once("SIGINT", resolve)
            process.once("SIGTERM", resolve)
          })
          return
        }
        await capture(profile, screens, themes, label)
      } finally {
        await stack.stop()
      }
    } finally {
      await preview.stop()
    }
  }

  if (!boolFlag(args, "no-frame")) {
    await frameScreens(profile, { label, screens, themes })
  }
}

/**
 * Capture into a scratch label, then fold it into the docs set: a run narrowed
 * with --screens/--themes refreshes those captures and keeps the rest
 * (`captureScreens` replaces its label wholesale).
 */
async function capture(
  profile: CaptureProfile,
  screens: DocsScreen[],
  themes: Theme[],
  label: string
): Promise<void> {
  console.log(`Capturing ${screens.length} screens × ${themes.length} themes`)
  const result = await captureScreens(profile, {
    label: `${label}-run`,
    screens,
    themes,
  })
  const dir = join(profile.captureRoot, label)
  await mkdir(dir, { recursive: true })
  for (const file of await readdir(result.dir)) {
    if (file.endsWith(".png")) {
      await copyFile(join(result.dir, file), join(dir, file))
    }
  }
  await rm(result.dir, { recursive: true, force: true })
  // The crops measured from each screen's `focus`, for the framing step.
  const cropsFile = join(dir, "crops.json")
  const crops = existsSync(cropsFile)
    ? (JSON.parse(await readFile(cropsFile, "utf8")) as Record<string, unknown>)
    : {}
  for (const [key, crop] of measuredCrops) crops[key] = crop
  await writeFile(cropsFile, `${JSON.stringify(crops, null, 2)}\n`)
  console.log(
    `Wrote ${result.files.length} captures to ${relative(process.cwd(), dir)}`
  )
}

function resolveThemes(names: string[]): Theme[] {
  if (names.length === 0) return [...THEMES]
  const unknown = names.filter((name) => !THEMES.includes(name as Theme))
  if (unknown.length > 0)
    throw new Error(`unknown theme(s): ${unknown.join(", ")}`)
  return names as Theme[]
}

main()
  // Exit explicitly: the browser and servers are closed, but a stray handle
  // (a keep-alive socket, a PGlite worker) shouldn't hold the run open.
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
