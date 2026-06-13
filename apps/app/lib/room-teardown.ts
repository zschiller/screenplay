import "server-only"

import {
  deleteRoom as deleteRoomRecord,
  listMembers,
  removeMember,
} from "@/lib/rooms"
import { deleteSandboxes } from "@/lib/sandbox/lifecycle"
import { killTerminalSessions } from "@/lib/sandbox/terminal"
import { listTerminalTabs } from "@/lib/terminal-tabs"
import { yjsHost } from "@/lib/yjs-host"
import { readRoomDoc } from "@/lib/yjs/server"

// The two ways a resolved Room deletion is carried out — `leave` and full
// teardown — extracted so both the single-Room ⋮ delete (`deleteRoom`) and the
// folder cascade (`deleteFolder`) drive the *identical* per-Room outcome
// (PRD #475, issues #482/#488). Server-only, no `"use server"`: these are
// internal helpers the server actions call, not endpoints of their own.

/**
 * A shared non-owner leaves a Room: drop only their membership (and their
 * per-user folder placement cascades away with it / with the deleted folder).
 * The Room — its Sandboxes, Y.Doc and rows — is untouched for everyone else, so
 * resync the remaining members on the host.
 */
export async function leaveRoom(roomId: string, userId: string): Promise<void> {
  await removeMember(roomId, userId)
  const remaining = await listMembers(roomId)
  await yjsHost.syncRoomMembers(
    roomId,
    remaining.map((m) => ({ userId: m.userId, role: m.role }))
  )
}

/**
 * Tear a Room down completely: its rows, Y.Doc, live terminal sessions, and
 * every Branch's Sandbox. Shared by the sole-member hard delete and the owner's
 * delete-for-all — both destroy the Room for everyone who could see it.
 */
export async function teardownRoom(
  roomId: string,
  userId: string
): Promise<void> {
  // Capture what the Room owns *before* its Y.Doc and rows are gone: the
  // Branches' Sandbox names from the authoritative doc — enumerated
  // server-side, never accepted from the client, so a forged list can't
  // delete Sandboxes the caller doesn't own — and the caller's terminal tabs
  // (their rows cascade away with the room record). Best-effort: an
  // unreadable doc must not block the delete itself.
  let sandboxNames: string[] = []
  try {
    sandboxNames = await readRoomDoc(roomId, (c) =>
      c.branches
        .toArray()
        .map((b) => b.sandboxName)
        .filter(Boolean)
    )
  } catch {}
  let terminalSessionIds: string[] = []
  try {
    terminalSessionIds = (await listTerminalTabs({ userId, roomId })).map(
      (t) => t.id
    )
  } catch {}

  await deleteRoomRecord(roomId)
  await yjsHost.deleteRoom(roomId)

  // With the Room gone, tear down what backed it: live terminal sessions
  // (desktop ptys — hosted tmux dies with its VM) and every Branch's Sandbox,
  // upholding "a Sandbox never outlives its Branch". On desktop this is also
  // what frees each Branch's git ref: a leaked worktree keeps its branch
  // checked out and blocks reopening it anywhere (RefAlreadyOpenError). Both
  // calls are internally best-effort so cleanup can never make the delete
  // appear to fail after the Room is already gone.
  await killTerminalSessions(terminalSessionIds)
  await deleteSandboxes(sandboxNames)
}
