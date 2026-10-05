import { mkdir, readdir, rm } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

import type { Files } from "./files"
import { syncFileMirror } from "./mirror"

/**
 * A chat's **context folder** (#1524): what a coding agent (Claude Code,
 * Codex) reads with its own tools, written before each turn to an app-owned
 * folder outside the repository checkout and handed to the harness as an ACP
 * additional directory, so reading it raises no permission prompt.
 *
 * The folder is made of named sections, each a subfolder its own sync owns:
 * `canvas` and `account` hold the saved files, and `.claude` and `.agents`
 * the saved Skills (#1559, `lib/skills/sources.ts`). Every sync rewrites the folder to
 * match, so a section that's gone, and anything else left in the folder, is
 * removed. Agents never write back through it: edits made there are lost on
 * the next turn.
 */

/** Brings one section's subfolder up to date. */
export type ContextSection = (dir: string) => Promise<void>

/** The saved-file sections, by subfolder name. */
export const CANVAS_FILES_SECTION = "canvas"
export const ACCOUNT_FILES_SECTION = "account"

/**
 * The folder that holds every chat's context folder: beside the desktop's
 * private file store (`LOCAL_FILES_DIR`), in the app's data folder.
 */
export function agentContextRoot(
  env: Record<string, string | undefined> = process.env
): string {
  return join(
    dirname(resolve(env.LOCAL_FILES_DIR || ".screenplay/files")),
    "agent-context"
  )
}

/**
 * A chat's context folder. One per chat, since a chat runs one turn at a
 * time, so two turns never sync the same folder at once.
 */
export function agentContextFolder(
  chatId: string,
  env: Record<string, string | undefined> = process.env
): string {
  // Chat ids are generated, but never let one climb out of the root.
  return join(agentContextRoot(env), chatId.replace(/[^A-Za-z0-9_-]/g, "_"))
}

/** A section that mirrors a scope's saved files, by their own paths. */
export function filesSection(files: Files): ContextSection {
  return (dir) => syncFileMirror(files, dir)
}

/**
 * The saved-file sections of a turn's context folder: the canvas's files,
 * and the sender's Account Files, `null` on a turn nobody sent.
 */
export function savedFileSections(
  canvas: Files,
  account: Files | null
): Record<string, ContextSection | null> {
  return {
    [CANVAS_FILES_SECTION]: filesSection(canvas),
    [ACCOUNT_FILES_SECTION]: account ? filesSection(account) : null,
  }
}

/**
 * Bring `folder` up to date with `sections`. A section passed as `null` (the
 * account files on a turn nobody sent) is removed, as is anything in the
 * folder no section owns. A section that fails to sync is removed rather
 * than left stale, and the others still sync: the agent can always open a
 * file through the saved-file tools instead.
 */
export async function syncContextFolder(
  folder: string,
  sections: Record<string, ContextSection | null>
): Promise<void> {
  await mkdir(folder, { recursive: true })
  const live = Object.entries(sections).filter(
    (s): s is [string, ContextSection] => s[1] !== null
  )
  const keep = new Set(live.map(([name]) => name))
  for (const item of await readdir(folder)) {
    if (!keep.has(item)) {
      await rm(join(folder, item), { recursive: true, force: true })
    }
  }
  await Promise.all(
    live.map(async ([name, sync]) => {
      const dir = join(folder, name)
      try {
        await sync(dir)
      } catch (e) {
        console.error(`context folder section ${name} failed:`, e)
        await rm(dir, { recursive: true, force: true }).catch(() => {})
      }
    })
  )
}

/** Whether `path` is `root` or inside it. */
export function isInsideFolder(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path))
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}
