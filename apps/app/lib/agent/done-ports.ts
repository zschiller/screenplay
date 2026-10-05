import "server-only"

import type { DonePorts } from "@/lib/agent/done-tools"
import { findActiveRun } from "@/lib/agent/persistence"
import { steerInbox } from "@/lib/agent/steer-inbox"
import type { RoomDoc } from "@/lib/room-access"

/**
 * The live {@link DonePorts} for one Workspace Chat (#1705): the Branch's PRs
 * and Done from the Room doc, and whether a person steered the chat's running
 * turn from the Steer inbox. Marking it done writes the same fields Mark as
 * done does; the sandbox stop waits for the turn to end (Turn Launch's
 * `settleDone`), since the agent is still running in it.
 */
export function liveDonePorts(opts: {
  sandboxName: string
  chatId: string
  room: RoomDoc
}): DonePorts {
  const { sandboxName, chatId, room } = opts

  const findBranchId = () =>
    room.readDoc(
      ({ branches }) =>
        branches.toArray().find((b) => b.sandboxName === sandboxName)?.id
    )

  return {
    async state() {
      const id = await findBranchId()
      if (!id) return null
      const branch = await room.readDoc(({ branches }) => branches.get(id))
      if (!branch) return null
      const run = await findActiveRun(chatId)
      const personMessage = run
        ? await steerInbox.hasPersonSteer(run.id)
        : false
      return {
        done: Boolean(branch.doneAt),
        pr:
          typeof branch.prNumber === "number" && branch.prState
            ? { number: branch.prNumber, state: branch.prState }
            : null,
        openPastPr:
          branch.pastPrs?.find((p) => p.state === "open")?.number ?? null,
        personMessage,
      }
    },
    async markDone() {
      const id = await findBranchId()
      if (!id) return
      await room.mutateDoc(({ branches }) => {
        if (!branches.get(id)) return
        branches.update(id, {
          doneAt: Date.now(),
          status: "stopped",
          statusMessage: "",
          error: "",
        })
      })
    },
  }
}
