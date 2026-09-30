"use server"

import { requireUserId } from "@/lib/auth-helpers"
import { requireMember } from "@/lib/rooms"
import {
  killTerminalSession,
  terminalSessionActivity,
} from "@/lib/sandbox/terminal"
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
  harnessKey?: string | null
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
    harnessKey: opts.harnessKey ?? null,
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

/**
 * What a tab's session is running, read before closing it: the process name
 * (`claude`, `node`) when something other than a shell is running, `null` for
 * an idle shell or a session that's gone. Throws when the sandbox can't be
 * read, so the caller can fall back to asking.
 */
export async function terminalSessionActivityAction(opts: {
  roomId: string
  sandboxName: string
  terminalSessionId: string
}): Promise<string | null> {
  const userId = await requireUserId()
  await requireMember(opts.roomId, userId)
  const result = await terminalSessionActivity(
    opts.sandboxName,
    opts.terminalSessionId
  )
  if (!result.success) throw new Error(result.error)
  return result.value
}
