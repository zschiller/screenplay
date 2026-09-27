import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Browser } from "playwright-core"

import type { CaptureProfile } from "../profile"
import type { Interaction } from "../interactions"
import { DEFAULT_VIEWPORT, type Screen } from "../screens"
import {
  launchBrowser,
  openThemedContext,
  settle,
  THEMES,
  type Theme,
} from "./browser"
import { sleep } from "./server"

/**
 * Running a **capture set**: every named screen, in both themes, into one
 * labelled directory.
 *
 * The directory layout is the contract the before/after workflow rests on:
 *
 * ```
 * <captureRoot>/<label>/<screen>.<theme>.png
 * <captureRoot>/<label>/manifest.json
 * ```
 *
 * Flat, one file per screen-and-theme, named only from the screen list — so two
 * labels shot from two branches produce directories whose filenames line up
 * exactly, and any image diff tool can pair them without configuration.
 */

export interface CaptureSetOptions {
  /** Directory name under the profile's capture root — typically `before` / `after`. */
  label: string
  screens: Screen[]
  themes?: readonly Theme[]
  log?: (message: string) => void
}

export interface CaptureSetResult {
  dir: string
  /** Relative paths written, in capture order. */
  files: string[]
}

export async function captureScreens(
  profile: CaptureProfile,
  options: CaptureSetOptions
): Promise<CaptureSetResult> {
  const log = options.log ?? ((m: string) => console.log(m))
  const themes = options.themes ?? THEMES
  const dir = join(profile.captureRoot, options.label)

  // Replace the label wholesale rather than merging: a set left half-written by
  // an interrupted run, or holding a screen since removed from the list, would
  // otherwise be silently diffed against a complete one.
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })

  await warmRoutes(profile, options.screens, log)

  const browser = await launchBrowser()
  const files: string[] = []
  try {
    for (const screen of options.screens) {
      for (const theme of themes) {
        const file = `${screen.name}.${theme}.png`
        log(`  → ${file}`)
        const status = await captureOne(
          browser,
          profile,
          screen,
          theme,
          join(dir, file)
        )
        // A screen that answered 4xx/5xx shot Next's error page, which is never
        // a capture anyone wants in a before/after set. The cause is usually a
        // cold route losing a race with a Y.Doc still being bound, which a
        // second request wins, so re-shoot once before accepting it.
        if (status !== null && status >= 400) {
          log(`    ! ${file}: ${status} on first load — re-shooting`)
          await sleep(2000)
          const retried = await captureOne(
            browser,
            profile,
            screen,
            theme,
            join(dir, file)
          )
          if (retried !== null && retried >= 400) {
            log(`    ! ${file}: still ${retried} — captured as-is`)
          }
        }
        files.push(file)
      }
    }
  } finally {
    await browser.close()
  }

  await writeFile(
    join(dir, "manifest.json"),
    `${JSON.stringify(
      {
        label: options.label,
        capturedAt: new Date().toISOString(),
        baseUrl: profile.baseUrl,
        themes,
        screens: options.screens.map((s) => ({
          name: s.name,
          path: s.path,
          description: s.description,
          viewport: s.viewport ?? DEFAULT_VIEWPORT,
        })),
      },
      null,
      2
    )}\n`
  )

  return { dir, files }
}

/**
 * Request every screen's route once before any browser opens.
 *
 * `next dev` compiles a route on its first request, and the compile shows up in
 * the page as a delayed first paint. Paying for it here means every shot is taken
 * against a warm route — so the light and dark halves of a pair are equally warm,
 * and a screen isn't slower in whichever branch's run happened to reach it first.
 * Failures are ignored: warming is an optimisation, and the capture itself is
 * where a broken route should surface.
 */
async function warmRoutes(
  profile: CaptureProfile,
  screens: readonly Screen[],
  log: (message: string) => void
): Promise<void> {
  const paths = [...new Set(screens.map((s) => s.path))]
  log(`• warming ${paths.length} routes`)
  for (const path of paths) {
    await fetch(new URL(path, profile.baseUrl), {
      signal: AbortSignal.timeout(180_000),
    })
      .then((res) => res.arrayBuffer())
      .catch(() => {})
  }
}

/**
 * Shoot one screen in one theme, in its own context.
 *
 * A fresh context per shot is deliberate: it is what makes the theme pin and the
 * viewport hold (both are context-level in Playwright), and it keeps a `prepare`
 * that opened a panel from leaking into the next screen.
 */
async function captureOne(
  browser: Browser,
  profile: CaptureProfile,
  screen: Screen,
  theme: Theme,
  path: string
): Promise<number | null> {
  const viewport = screen.viewport ?? DEFAULT_VIEWPORT
  const context = await openThemedContext(browser, profile, {
    viewport,
    theme,
    cookies: screen.cookies,
  })
  try {
    const page = await context.newPage()
    await screen.routes?.(page)
    // `domcontentloaded`, not `load`: the canvas keeps long-lived connections
    // open, so `load` can outlast the timeout on a perfectly healthy page.
    const response = await page.goto(screen.path, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    })
    // Don't freeze yet when a `prepare` follows: a menu it opens and closes
    // would be pinned mid-exit-animation and never unmount. The settle after
    // `prepare` freezes the page for the shot.
    await settle(page, { freeze: !screen.prepare })
    if (screen.prepare) {
      // A `prepare` that can't find its affordance shouldn't sink the run: the
      // shot it produces (the screen without that step) is still worth having,
      // and the warning says exactly which screen to go fix. A hard failure here
      // would throw away every screen after it.
      try {
        await screen.prepare(page)
      } catch (err) {
        console.warn(
          `    ! ${screen.name}: prepare step failed — capturing without it (${
            err instanceof Error ? err.message.split("\n")[0] : err
          })`
        )
      }
    }
    await settle(page, { extraMs: screen.settleMs ?? 0 })
    await page.screenshot({ path, fullPage: screen.fullPage ?? false })
    return response?.status() ?? null
  } finally {
    await context.close()
  }
}

export interface RecordOptions {
  interaction: Interaction
  /** Directory name under the profile's capture root. Defaults to `videos`. */
  label?: string
  theme?: Theme
  log?: (message: string) => void
}

/**
 * Record one named interaction to `<captureRoot>/<label>/<name>.<theme>.webm`.
 *
 * Playwright names a recording after an internal page id and only finalises it on
 * `context.close()`, so the file is renamed afterwards — the harness's output
 * paths have to be predictable enough for a PR to reference them by name.
 */
export async function recordInteraction(
  profile: CaptureProfile,
  options: RecordOptions
): Promise<{ file: string }> {
  const log = options.log ?? ((m: string) => console.log(m))
  const theme = options.theme ?? "light"
  const label = options.label ?? "videos"
  const dir = join(profile.captureRoot, label)
  await mkdir(dir, { recursive: true })

  const viewport = options.interaction.viewport ?? DEFAULT_VIEWPORT
  const browser = await launchBrowser()
  const target = join(dir, `${options.interaction.name}.${theme}.webm`)
  try {
    const context = await openThemedContext(browser, profile, {
      viewport,
      theme,
      cookies: options.interaction.cookies,
      recordVideoDir: dir,
    })
    const page = await context.newPage()
    await options.interaction.routes?.(page)
    await page.goto(options.interaction.path, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    })
    // Never freeze for a recording — the motion is the artifact.
    await settle(page, { freeze: false })
    log(`  → running ${options.interaction.name}`)
    await options.interaction.run(page)
    const video = page.video()
    // Close the context first: the recording isn't flushed to disk until then.
    await context.close()
    if (video) {
      await rm(target, { force: true })
      await rename(await video.path(), target)
    }
  } finally {
    await browser.close()
  }
  return { file: target }
}
