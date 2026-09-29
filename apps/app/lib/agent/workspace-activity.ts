import type { RoomDoc } from "@/lib/room-access"

/**
 * Record that a chat turn just started on the Workspace running in
 * `sandboxName` (#885), for the sidebar's Recent activity sort. A turn on a
 * sandbox no Workspace owns any more writes nothing.
 */
export async function stampWorkspaceActivity(
  room: Pick<RoomDoc, "mutateDoc">,
  sandboxName: string,
  now: number
): Promise<void> {
  await room.mutateDoc(({ branches }) => {
    // `toArray` is a cached snapshot; it only finds the id, never the state.
    const id = branches.toArray().find((b) => b.sandboxName === sandboxName)?.id
    if (id && branches.get(id)) branches.update(id, { lastActivityAt: now })
  })
}
