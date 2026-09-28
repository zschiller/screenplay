/**
 * Retiring the player's flat comment feed (#789). Its threads were keyed by the
 * Workspace's git branch name (`thread.branch`), which a rename orphans, and
 * they had no route, element or point. Each one moves onto the one comment
 * model: it keeps no position, but gets the Workspace's id, so it's listed with
 * that Workspace's threads on the canvas and in the player from then on.
 *
 * The branch → Workspace map lives in the room's Y.Doc, not the database, so
 * the move happens as a room's threads are listed rather than in a SQL
 * migration, without writing the rows back. This module is the pure half:
 * which Workspace each row goes to.
 */

export interface BranchThreadRow {
  id: string
  branch: string
}

export interface WorkspaceRef {
  id: string
  /** The Workspace's git branch name. */
  ref: string
}

/** Where one feed thread goes: its Workspace, or none when that's gone. */
export interface BranchThreadMove {
  threadId: string
  workspaceId: string | null
  /** What an orphan is listed with, since it no longer has a Workspace to
   *  say where it was made. Null for a thread that found its Workspace. */
  snapshot: string | null
}

export function planBranchThreadMoves(
  rows: readonly BranchThreadRow[],
  workspaces: readonly WorkspaceRef[]
): BranchThreadMove[] {
  // Oldest Workspace first wins a shared ref, matching how the feed read them.
  const byRef = new Map<string, string>()
  for (const w of workspaces) if (!byRef.has(w.ref)) byRef.set(w.ref, w.id)
  return rows.map((row) => {
    const workspaceId = byRef.get(row.branch) ?? null
    return {
      threadId: row.id,
      workspaceId,
      snapshot: workspaceId ? null : `Play mode on ${row.branch}`,
    }
  })
}
