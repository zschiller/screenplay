import { readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import type { Screen } from "./screen"

export * from "./screen"
export * from "./helpers"

/**
 * The **named screen list**: every surface a capture run shoots, in order.
 *
 * The list is the files in `./list`, read in filename order, each default-
 * exporting an array of screens. There is no index to edit: a new file is
 * picked up on the next run, so two PRs that each add screens never touch the
 * same lines. A ticket's new screens go in a new file named `NN-<topic>.ts`,
 * where `NN` is the prefix of the surface they sit beside (`07-chat.ts` for a
 * chat state, so `07-chat-senders.ts`); `99-` runs last, for screens that
 * really change the Fixture World.
 *
 * A screen is a `name`, a `path`, and (only if the surface needs opening) a
 * `prepare` that clicks it into view; everything else (light and dark, the
 * viewport, settling, the output filename) is the runner's job
 * (`../lib/capture.ts`). Keeping the list declarative is what makes a
 * before/after pair comparable: both halves shoot the same names in the same
 * order at the same size, so the two directories diff file-for-file.
 *
 * Paths are built from `FIXTURE_IDS` rather than written out, so a Canvas
 * renamed in the Fixture World can't leave a screen pointing at a 404.
 */
export const SCREENS: Screen[] = await loadScreens()

async function loadScreens(): Promise<Screen[]> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "list")
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
        `screenshots/screens/list/${file} must default-export an array of screens`
      )
    }
    screens.push(...(mod.default as Screen[]))
  }
  const seen = new Set<string>()
  for (const screen of screens) {
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
