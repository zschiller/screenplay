import { realpath, stat } from "node:fs/promises"
import path from "node:path"

/** The most files one click may hand a file picker. */
export const MAX_PICKED_FILES = 20

/**
 * The files the agent names for a file picker (#1385), as absolute paths in
 * the Workspace at `root`; null when any isn't a file inside it. Paths are
 * relative to the Workspace root. Links are followed before the check, so
 * one can't lead out of the Workspace.
 */
export async function workspaceFiles(
  root: string,
  paths: readonly string[]
): Promise<string[] | null> {
  if (paths.length === 0 || paths.length > MAX_PICKED_FILES) return null
  let realRoot: string
  try {
    realRoot = await realpath(root)
  } catch {
    return null
  }
  const out: string[] = []
  for (const given of paths) {
    if (typeof given !== "string" || !given || path.isAbsolute(given))
      return null
    let real: string
    try {
      real = await realpath(path.resolve(realRoot, given))
      if (!(await stat(real)).isFile()) return null
    } catch {
      return null
    }
    const rel = path.relative(realRoot, real)
    const outside =
      !rel ||
      rel === ".." ||
      rel.startsWith(`..${path.sep}`) ||
      path.isAbsolute(rel)
    if (outside) return null
    out.push(real)
  }
  return out
}
