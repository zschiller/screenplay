import { parseEnvVars } from "@/lib/env-utils"
import type { RepoData } from "@/lib/types"

/**
 * The client-safe half of a Canvas Repo's env vars (#1416): the room doc keeps
 * their names only, and these helpers work on names and on the text a person
 * types. Values live encrypted on the server (`./store`).
 */

/** The variable names a `KEY=value` text sets, in the order it sets them. */
export function envVarNames(text: string): string[] {
  return Object.keys(parseEnvVars(text))
}

/** A Repo's env var names: the stored list, or (before the migration has
 *  moved them out) the names of its legacy plain-text values. */
export function repoEnvVarNames(
  repo: Pick<RepoData, "envVarNames" | "envVars">
): string[] {
  return repo.envVarNames ?? envVarNames(repo.envVars ?? "")
}

/** One `KEY=value` per line. */
export function serializeEnvVars(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")
}

/**
 * Lines someone typed over a Repo's stored values: each typed variable
 * replaces the stored one of the same name or is added; the rest stay. How a
 * member who can't see the values still sets their own.
 */
export function mergeEnvVars(stored: string, typed: string): string {
  return serializeEnvVars({ ...parseEnvVars(stored), ...parseEnvVars(typed) })
}

/**
 * Whether someone can reveal a Canvas Repo's stored values (#1416): the
 * person who added the Repo; for a Repo from before anyone recorded that, the
 * Canvas's owner; on desktop, the one person there is. Everyone else sees the
 * names, can start Workspaces with the values, and can type their own.
 */
export function canRevealEnv(
  repo: Pick<RepoData, "addedBy">,
  viewer: { userId: string; isOwner: boolean; localBuild: boolean }
): boolean {
  if (viewer.localBuild) return true
  if (repo.addedBy) return repo.addedBy === viewer.userId
  return viewer.isOwner
}
