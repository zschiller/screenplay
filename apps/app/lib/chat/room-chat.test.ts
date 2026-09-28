import { describe, expect, it } from "vitest"

import {
  isRoomChatId,
  ROOM_CHAT_LABEL,
  roomChatId,
  roomChatSession,
} from "@/lib/chat/room-chat"

describe("room chat identity", () => {
  it("derives one chat id per Room", () => {
    expect(roomChatId("room-a")).toBe(roomChatId("room-a"))
    expect(roomChatId("room-a")).not.toBe(roomChatId("room-b"))
  })

  it("recognizes its own ids and no others", () => {
    expect(isRoomChatId(roomChatId("room-a"))).toBe(true)
    expect(isRoomChatId("V1StGXR8_Z5jdHi6B-myT")).toBe(false)
  })

  it("records a chat that targets the Room, named Coordinator", () => {
    expect(roomChatSession("room-a", 5)).toEqual({
      id: roomChatId("room-a"),
      target: "room",
      label: ROOM_CHAT_LABEL,
      createdAt: 5,
    })
    expect(ROOM_CHAT_LABEL).toBe("Coordinator")
  })
})
