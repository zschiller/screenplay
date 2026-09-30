import { openRoomForRoute, type RoomDoc } from "@/lib/room-access"
import { isEarlierChat } from "@/lib/chat/workspace-chat"
import { isRoomChatId, roomChatId } from "@/lib/chat/room-chat"
import { launchTurn } from "@/lib/agent/turn-launch"
import {
  liveTurnLaunchDeps,
  roomTurn,
  sandboxTurn,
} from "@/lib/agent/turn-launch-live"

export const runtime = "nodejs"
export const maxDuration = 300

interface RequestBody {
  roomId: string
  chatId: string
  /** Required when the chat targets an agent (sandbox-backed flow). */
  sandboxName?: string
  /** `"room"` for the Room's Coordinator chat (no sandbox, whole canvas). */
  target?: "room"
  message: string
  isFirstChat?: boolean
  planMode?: boolean
  model?: string
  /** Comment threads this turn asks the agent to address (#788). */
  commentThreadIds?: string[]
  /** Retry of the chat's failed turn: its ask is already in the transcript. */
  retry?: boolean
}

export async function POST(req: Request) {
  const body: RequestBody = await req.json()
  const { roomId, chatId, sandboxName, message, model } = body
  if (!roomId || !chatId || !message) {
    return new Response("Missing required fields", { status: 400 })
  }
  const isRoomTarget = body.target === "room"
  if (!isRoomTarget && !sandboxName) {
    return new Response("Missing target: sandboxName or target: room", {
      status: 400,
    })
  }
  // The Coordinator chat's id is derived from its Room. Refusing that shape
  // anywhere else means no one can claim a Room's Coordinator chat by naming
  // it first from another Room or another target.
  if (isRoomTarget ? chatId !== roomChatId(roomId) : isRoomChatId(chatId)) {
    return new Response("Invalid chat id for this target", { status: 400 })
  }

  // Room Access before anything is persisted, broadcast or launched.
  const room = await openRoomForRoute(roomId, chatId)
  if (room instanceof Response) return room
  const { userId } = room

  // One chat per Workspace (#1315): an earlier chat on an old canvas stays
  // readable, but only the Workspace's own chat changes its code.
  if (!isRoomTarget && (await isEarlierChatInRoom(room, chatId))) {
    return Response.json({ error: "earlier_chat" }, { status: 409 })
  }

  // Turn Launch owns the ordering (engine first, persist, start, broadcast,
  // drive after the response) and whether a message sent while the chat's
  // agent is working steers it; this route only picks the Chat Target.
  const target = isRoomTarget
    ? roomTurn({ room, chatId, message, model })
    : sandboxTurn({
        room,
        chatId,
        sandboxName: sandboxName!,
        userId,
        message,
        isFirstChat: body.isFirstChat,
        planMode: body.planMode,
        model,
        commentThreadIds: body.commentThreadIds,
      })

  const result = await launchTurn(
    liveTurnLaunchDeps(room),
    {
      roomId,
      chatId,
      message,
      sandboxName,
      model,
      userId,
      retry: body.retry === true,
    },
    target
  )
  if (result.kind === "target-not-found") {
    return new Response("Layer not found", { status: 404 })
  }
  // Only a plan decision can find its plan resolved; this route sends none.
  if (result.kind === "plan-already-resolved") {
    return new Response("Plan already resolved", { status: 409 })
  }
  // The agent is working: the message joined its turn as a Steer (#1190), or,
  // on an Engine that can't take one, waits in the client's queue.
  if (result.kind === "steered") {
    return Response.json({ chatId, steered: true, steerId: result.steerId })
  }
  if (result.kind === "not-steerable") {
    return Response.json({ error: "not_steerable" }, { status: 409 })
  }
  return Response.json({ chatId, runId: result.runId })
}

/** Whether `chatId` is one of its Workspace's earlier chats (#1315). */
async function isEarlierChatInRoom(
  room: RoomDoc,
  chatId: string
): Promise<boolean> {
  return room.readDoc(({ chatSessions }) => {
    // `get` is fresh where the `toArray` snapshot can lag a just-added chat.
    const chat = chatSessions.get(chatId)
    if (!chat) return false
    const others = chatSessions.toArray().filter((c) => c.id !== chatId)
    return isEarlierChat([...others, chat], chat)
  })
}
