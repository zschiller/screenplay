"use server"

import { requireUserId } from "@/lib/auth-helpers"
import { requireMember } from "@/lib/rooms"
import { killTerminalSession } from "@/lib/sandbox/terminal"
import {
  deleteTerminalTab as deleteTerminalTabFn,
  insertTerminalTab,
  listTerminalTabs,
  type TerminalTabRecord,
} from "@/lib/terminal-tabs"

/**
 * List the current User's terminal tabs across every Branch in a room. The tab
 * strip hydrates from this on load and groups by `branch` client-side, so a
 * reload restores tabs and switching Branches shows the right set without a
 * fetch per switch.
 */
export async function listTerminalTabsAction(opts: {
  roomId: string
}): Promise<TerminalTabRecord[]> {
  const userId = await requireUserId()
  await requireMember(opts.roomId, userId)
  return listTerminalTabs({ userId, roomId: opts.roomId })
}

/** Persist a newly-opened terminal tab against a Branch in a room. */
export async function createTerminalTabAction(opts: {
  roomId: string
  branch: string
  id: string
  label: string
  createdAt: number
}): Promise<TerminalTabRecord> {
  const userId = await requireUserId()
  await requireMember(opts.roomId, userId)
  return insertTerminalTab({
    id: opts.id,
    userId,
    roomId: opts.roomId,
    branch: opts.branch,
    label: opts.label,
    createdAt: new Date(opts.createdAt),
  })
}

/** Permanently delete a terminal tab (the user clicked X). */
export async function deleteTerminalTabAction(opts: {
  roomId: string
  id: string
}): Promise<void> {
  const userId = await requireUserId()
  await requireMember(opts.roomId, userId)
  await deleteTerminalTabFn({ id: opts.id, userId })
}

/**
 * Kill a closed tab's `tmux` session, ending its shell and any running process
 * (e.g. a Claude Code harness) — the second half of clicking X (#259), separate
 * from {@link deleteTerminalTabAction}'s row removal so a sandbox that's down
 * never blocks the tab from going away. Gated on room membership; the session
 * name is derived server-side from `terminalSessionId`. A missing session (the
 * sandbox was reclaimed, say) resolves successfully.
 */
export async function killTerminalSessionAction(opts: {
  roomId: string
  sandboxName: string
  terminalSessionId: string
}): Promise<void> {
  const userId = await requireUserId()
  await requireMember(opts.roomId, userId)
  await killTerminalSession(opts.sandboxName, opts.terminalSessionId)
}
