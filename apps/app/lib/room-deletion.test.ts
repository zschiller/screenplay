import { describe, expect, it } from "vitest"
import { decideRoomDeletion, type RoomMembership } from "@/lib/room-deletion"

function membership(over: Partial<RoomMembership> = {}): RoomMembership {
  return {
    deleterId: "u-owner",
    ownerId: "u-owner",
    memberIds: ["u-owner"],
    ...over,
  }
}

describe("decideRoomDeletion", () => {
  describe("sole member (not shared)", () => {
    it("hard-deletes when the owner is the only member", () => {
      const decision = decideRoomDeletion(membership())

      expect(decision.action).toBe("hard-delete")
      expect(decision.isOwner).toBe(true)
      expect(decision.isShared).toBe(false)
      expect(decision.sharedWithCount).toBe(0)
    })

    it("hard-deletes a Room with no recorded members (local build)", () => {
      // The local build has no `room_member` table: the deleter is absent from
      // an empty membership and is still treated as the sole actor.
      const decision = decideRoomDeletion(
        membership({ memberIds: [], deleterId: "local", ownerId: "local" })
      )

      expect(decision.action).toBe("hard-delete")
      expect(decision.sharedWithCount).toBe(0)
    })
  })

  describe("shared, deleter is the owner", () => {
    it("deletes for everyone and counts the other members", () => {
      const decision = decideRoomDeletion(
        membership({ memberIds: ["u-owner", "u-b", "u-c"] })
      )

      expect(decision.action).toBe("delete-for-all")
      expect(decision.isOwner).toBe(true)
      expect(decision.isShared).toBe(true)
      expect(decision.sharedWithCount).toBe(2)
    })

    it("counts a single collaborator as one", () => {
      const decision = decideRoomDeletion(
        membership({ memberIds: ["u-owner", "u-b"] })
      )

      expect(decision.action).toBe("delete-for-all")
      expect(decision.sharedWithCount).toBe(1)
    })
  })

  describe("shared, deleter is a non-owner", () => {
    it("leaves rather than destroying the Room", () => {
      const decision = decideRoomDeletion(
        membership({
          deleterId: "u-b",
          ownerId: "u-owner",
          memberIds: ["u-owner", "u-b", "u-c"],
        })
      )

      expect(decision.action).toBe("leave")
      expect(decision.isOwner).toBe(false)
      expect(decision.isShared).toBe(true)
      // The "others" exclude the leaver themselves.
      expect(decision.sharedWithCount).toBe(2)
    })

    it("leaves even when the owner and one collaborator remain", () => {
      const decision = decideRoomDeletion(
        membership({
          deleterId: "u-b",
          ownerId: "u-owner",
          memberIds: ["u-owner", "u-b"],
        })
      )

      expect(decision.action).toBe("leave")
      expect(decision.sharedWithCount).toBe(1)
    })
  })

  it("ignores duplicate deleter ids when counting others", () => {
    // Defensive: a malformed membership listing the deleter twice must not
    // inflate the shared-with count.
    const decision = decideRoomDeletion(
      membership({ memberIds: ["u-owner", "u-owner"] })
    )

    expect(decision.action).toBe("hard-delete")
    expect(decision.sharedWithCount).toBe(0)
  })
})
