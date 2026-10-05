import "server-only"

import { roomIdOfRoomChat } from "@/lib/chat/room-chat"
import { isSketchChat } from "@/lib/chat/sketch-chat"
import type { RoomDoc } from "@/lib/room-access"
import type { SkillSources } from "@/lib/skills/sources"

import { roomChatTarget } from "./room-chat-target"
import { sketchChatTarget } from "./sketch-chat-target"
import { workspaceChatTarget } from "./workspace-chat-target"

/**
 * The Skill Sources (#1664) of a chat on `room`, by id, as its own Chat
 * Target builds them, for code that holds a chat's id rather than its target:
 * a Mockup page's `skill:` references resolve through the chat that made it.
 * `userId` is whose Account Skills join them (none when `null`). A Workspace
 * chat's Repo Skills come while its sandbox runs; an id that names no chat
 * (a Mockup made by hand) gets a Workspace chat's Skills without a Branch.
 */
export async function chatSkillSources(
  room: RoomDoc,
  chatId: string | undefined,
  userId: string | null
): Promise<SkillSources> {
  const sender = {
    userId: userId ?? "",
    ...(userId ? {} : { senderless: true }),
  }
  if (chatId && roomIdOfRoomChat(chatId)) {
    return roomChatTarget.skills(room, sender)
  }
  const chat = await room
    .readDoc((c) => {
      const session = chatId ? c.chatSessions.get(chatId) : undefined
      const branch = session?.branchId ? c.branches.get(session.branchId) : null
      return {
        sketch: isSketchChat(session),
        sandboxName: branch?.status === "running" ? branch.sandboxName : "",
      }
    })
    .catch(() => ({ sketch: false, sandboxName: "" }))
  if (chat.sketch) {
    return sketchChatTarget.skills(room, { ...sender, chatId: chatId! })
  }
  return workspaceChatTarget.skills(room, {
    ...sender,
    chatId: chatId ?? "",
    sandboxName: chat.sandboxName,
  })
}
