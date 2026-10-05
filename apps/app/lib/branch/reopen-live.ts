import "server-only"

import { reopen, type RecoveryPatch } from "@/lib/branch/recovery"
import { stopWorkspaceSandbox } from "@/lib/sandbox/lifecycle"
import type { RoomDoc } from "@/lib/room-access"

/**
 * Write to reopen (#1705), on the server: a message sent to a Done Workspace
 * Chat reopens its Branch first, with today's Reopen (#976): Done clears and
 * the sandbox starts again through the reconnect path. Resolves once it runs,
 * so the message's turn starts on a live sandbox; `reopened` is false when
 * the Branch wasn't Done. A failed start lands the Branch on error, as the
 * menu's Reopen does, and resolves with the error.
 */
export async function reopenDoneBranch(
  room: Pick<RoomDoc, "readDoc" | "mutateDoc" | "roomId">,
  sandboxName: string
): Promise<{ reopened: boolean; error?: string }> {
  const found = await room.readDoc(({ branches, repos }) => {
    // `toArray` is a cached snapshot: find the id, then read it fresh.
    const id = branches.toArray().find((b) => b.sandboxName === sandboxName)?.id
    const branch = id ? branches.get(id) : undefined
    if (!branch?.doneAt) return null
    return { branch, repo: repos.get(branch.repoId) }
  })
  if (!found) return { reopened: false }
  const { branch, repo } = found

  // The doc writes go out in order, each after the last.
  let writes = Promise.resolve()
  const patchAgent = (id: string, patch: RecoveryPatch) => {
    writes = writes.then(() =>
      room.mutateDoc(({ branches }) => {
        if (branches.get(id)) branches.update(id, patch)
      })
    )
  }
  const outcome = await reopen(
    branch.id,
    {
      roomId: room.roomId,
      findAgent: (id) => (id === branch.id ? branch : undefined),
      findRepo: (repoId) => (repo && repo.id === repoId ? repo : undefined),
      patchAgent,
      // The chat shows the outcome: the reopened Workspace, or its error.
      toast: { success: () => {}, error: () => {} },
    },
    { codeReadyAtStart: true }
  )
  await writes
  return outcome.ok
    ? { reopened: true }
    : { reopened: true, error: outcome.error }
}

/**
 * Once a Workspace Chat's turn is over (#1705): a Branch that turn marked Done
 * stops its sandbox, the stop `mark_done` left for after the turn. When a
 * person's message is about to start the next turn, it reopens instead.
 * Nothing happens to a Branch that isn't Done.
 */
export async function settleDoneBranch(
  room: Pick<RoomDoc, "readDoc" | "mutateDoc" | "roomId">,
  input: { sandboxName: string; continuing: boolean }
): Promise<void> {
  const { sandboxName, continuing } = input
  if (continuing) {
    await reopenDoneBranch(room, sandboxName)
    return
  }
  const done = await room.readDoc(({ branches }) => {
    const id = branches.toArray().find((b) => b.sandboxName === sandboxName)?.id
    return Boolean(id && branches.get(id)?.doneAt)
  })
  if (!done) return
  await stopWorkspaceSandbox(sandboxName).catch(() => undefined)
}
