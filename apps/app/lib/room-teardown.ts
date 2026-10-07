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
import { createCanvasOps } from "@/lib/canvas/ops"
import type { RoomAccess, RoomDoc } from "@/lib/room-access"

// The two ways a resolved Room deletion is carried out — `leave` and full
// teardown — extracted so both the single-Room ⋮ delete (`deleteRoom`) and the
// folder cascade (`deleteFolder`) drive the *identical* per-Room outcome
// (PRD #475, issues #482/#488). Server-only, no `"use server"`: these are
// internal helpers the server actions call, not endpoints of their own.

/**
 * A shared non-owner leaves a Room: drop only their membership (and their
 * per-user folder placement cascades away with it / with the deleted folder)
 * and their saved page views. The Room — its Sandboxes, Y.Doc and rows — is
 * untouched for everyone else, so resync the remaining members on the host.
 * The leaver opens the Room through Room Access first.
 */
export async function leaveRoom(room: RoomAccess): Promise<void> {
  const { roomId, userId } = room
  await removeMember(roomId, userId)
  const remaining = await listMembers(roomId)
  await yjsHost.syncRoomMembers(
    roomId,
    remaining.map((m) => ({ userId: m.userId, role: m.role }))
  )
  await removeMemberViews(room, userId)
}

/**
 * Drop a member's saved page views (#1838) once they've left or been removed.
 * Best-effort: an unreachable doc mustn't fail the removal, and views of
 * someone who can't open the canvas are never read.
 */
export async function removeMemberViews(
  room: RoomDoc,
  userId: string
): Promise<void> {
  try {
    await room.mutateDoc((c) => createCanvasOps(c).removeMemberViews(userId))
  } catch {}
}

/**
 * Tear a Room down completely: its rows, Y.Doc, live terminal sessions, and
 * every Branch's Sandbox. Shared by the sole-member hard delete and the owner's
 * delete-for-all — both destroy the Room for everyone who could see it. The
 * deleter opens the Room through Room Access first.
 */
export async function teardownRoom(room: RoomAccess): Promise<void> {
  const { roomId, userId } = room
  // Capture what the Room owns *before* its Y.Doc and rows are gone: the
  // Branches' Sandbox names from the authoritative doc — enumerated
  // server-side, never accepted from the client, so a forged list can't
  // delete Sandboxes the caller doesn't own — and the caller's terminal tabs
  // (their rows cascade away with the room record). Best-effort: an
  // unreadable doc must not block the delete itself.
  let sandboxNames: string[] = []
  try {
    sandboxNames = await room.readDoc((c) =>
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
