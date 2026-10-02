import { existsSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { CORE_SCREENS } from "./core"
import type { Screen } from "./screen"

export * from "./screen"
export * from "./helpers"

/**
 * The **named screen list**: the core screens (`./core.ts`), then whatever is
 * in `./scratch/`.
 *
 * The core is a short, committed baseline: one or two screens per main
 * surface. A PR's own screens, the exact state its change shows up in, go in
 * a file in `./scratch/` (gitignored), default-exporting an array of screens.
 * Shoot them on the base branch and on yours (the folder survives a branch
 * switch, being untracked), attach the images, and leave the file out of the
 * commit. Nothing about a PR's screens lands on main, so there is nothing for
 * two PRs to conflict on and no list to maintain.
 *
 * A screen is a `name`, a `path`, and (only if the surface needs opening) a
 * `prepare` that clicks it into view; everything else (light and dark, the
 * viewport, settling, the output filename) is the runner's job
 * (`../lib/capture.ts`). Both halves of a before/after pair shoot the same
 * names in the same order at the same size, so the two directories diff
 * file-for-file.
 */
export const SCREENS: Screen[] = [...CORE_SCREENS, ...(await loadScratch())]

async function loadScratch(): Promise<Screen[]> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "scratch")
  if (!existsSync(dir)) return []
  const files = readdirSync(dir)
    .filter(
      (file) => /^[^.].*\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file)
    )
    .sort()
  const screens: Screen[] = []
  for (const file of files) {
    const mod = (await import(pathToFileURL(join(dir, file)).href)) as {
      default?: unknown
    }
    if (!Array.isArray(mod.default)) {
      throw new Error(
        `screenshots/screens/scratch/${file} must default-export an array of screens`
      )
    }
    screens.push(...(mod.default as Screen[]))
  }
  const seen = new Set<string>()
  for (const screen of [...CORE_SCREENS, ...screens]) {
    if (seen.has(screen.name)) {
      throw new Error(`two screens are named "${screen.name}"`)
    }
    seen.add(screen.name)
  }
  return screens
}

/**
 * Look up screens by name, preserving {@link SCREENS} order, from the screens
 * of one build (see {@link Screen.hosted}). Throws on an unknown name.
 */
export function selectScreens(
  names: readonly string[],
  { hosted = false }: { hosted?: boolean } = {}
): Screen[] {
  const pool = SCREENS.filter((screen) => !!screen.hosted === hosted)
  if (names.length === 0) return pool
  const unknown = names.filter((name) => !pool.some((s) => s.name === name))
  if (unknown.length > 0) {
    throw new Error(
      `unknown ${hosted ? "hosted " : ""}screen(s): ${unknown.join(", ")}\nknown screens: ${pool.map((s) => s.name).join(", ")}`
    )
  }
  return pool.filter((screen) => names.includes(screen.name))
}
