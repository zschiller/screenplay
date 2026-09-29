import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import { getRoomCollections } from "@/lib/yjs/schema"
import type { RoomDoc } from "@/lib/room-access"
import type { BranchData } from "@/lib/types"
import { stampWorkspaceActivity } from "./workspace-activity"

function makeRoom() {
  const c = getRoomCollections(new Y.Doc())
  c.branches.set("branch_1", {
    id: "branch_1",
    sandboxName: "sb_1",
    createdAt: 1,
  } as BranchData)
  const room: Pick<RoomDoc, "mutateDoc"> = { mutateDoc: async (fn) => fn(c) }
  return { c, room }
}

describe("stampWorkspaceActivity", () => {
  it("records when a turn started on the sandbox's Workspace", async () => {
    const { c, room } = makeRoom()
    await stampWorkspaceActivity(room, "sb_1", 5_000)
    expect(c.branches.get("branch_1")?.lastActivityAt).toBe(5_000)
  })

  it("writes nothing for a sandbox no Workspace owns", async () => {
    const { c, room } = makeRoom()
    await stampWorkspaceActivity(room, "sb_gone", 5_000)
    expect(c.branches.get("branch_1")?.lastActivityAt).toBeUndefined()
  })
})
