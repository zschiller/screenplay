import "server-only"

import { textBlock } from "@/lib/agent/acp/schema"
import { broadcastAcpUpdate } from "@/lib/agent/broadcast"
import { appendAcpMessage } from "@/lib/agent/persistence"
import { userTurnEcho } from "@/lib/agent/user-turn"
import { getGitHubTokenForUser } from "@/lib/auth-helpers"
import { workspaceChatId } from "@/lib/chat/workspace-chat"
import { kv } from "@/lib/kv"
import {
  chatRoomId,
  openRoomForPrWatchTick,
  type RoomDoc,
} from "@/lib/room-access"
import { canAccess, getRoom } from "@/lib/rooms"
import { prEventMessage } from "./events"
import { githubPrReader } from "./github"
import {
  watchRoomPrs,
  type GitHubPrReader,
  type PrEvent,
  type PrWatchResult,
} from "./watch"

/**
 * PR Watch's live wiring (#1702): one look at a Room under a lock, its events
 * added to their Workspace Chats, and the index of Rooms the server tick
 * watches. The browser poll (`listBranchPrs`) and the tick both come through
 * {@link runPrWatch}.
 */

/** Rooms with an open PR, one KV key each, so the tick finds them without
 *  reading every Room's doc. */
const WATCHED_PREFIX = "pr-watch:room:"
/** One look per Room at a time: two pollers seeing the same change would
 *  each add its event. */
const LOCK_PREFIX = "pr-watch:lock:"
const LOCK_TTL_SEC = 60

/**
 * Look at a Room's PRs once and deliver what changed. `null` when another look
 * at the same Room is already running; the doc then gets its result from that
 * one.
 */
export async function runPrWatch(
  room: RoomDoc,
  read: GitHubPrReader,
  opts: { openOnly?: boolean } = {}
): Promise<PrWatchResult | null> {
  const lock = await kv.acquireLock(LOCK_PREFIX + room.roomId, LOCK_TTL_SEC)
  if (!lock) return null
  try {
    const result = await watchRoomPrs(room, read, opts)
    await deliverPrEvents(room, result.events)
    await markWatched(room.roomId, result.hasOpenPr)
    return result
  } finally {
    await lock.release().catch(() => {})
  }
}

/**
 * Add each PR event to its Branch's Workspace Chat: saved to the chat's log
 * and echoed to everyone in the Room, so open chats draw the line at once and
 * a reload draws the same one. A Branch whose chat has never run a turn has
 * no log to add to, and is skipped.
 */
async function deliverPrEvents(room: RoomDoc, events: PrEvent[]) {
  if (events.length === 0) return
  const chatIds = await room.readDoc(({ chatSessions }) => {
    const sessions = chatSessions.toArray()
    return new Map(
      events.map((e) => [e.branchId, workspaceChatId(sessions, e.branchId)])
    )
  })
  for (const event of events) {
    const chatId = chatIds.get(event.branchId)
    if (!chatId) continue
    if ((await chatRoomId(chatId)) !== room.roomId) continue
    const wire = prEventMessage(event)
    try {
      await appendAcpMessage(chatId, {
        role: "user",
        content: [textBlock(wire)],
      })
    } catch (e) {
      console.error("PR event not saved:", e)
      continue
    }
    await broadcastAcpUpdate(room.roomId, chatId, userTurnEcho(wire))
  }
}

async function markWatched(roomId: string, hasOpenPr: boolean) {
  const key = WATCHED_PREFIX + roomId
  if (hasOpenPr) {
    if (!(await kv.get(key))) await kv.set(key, { since: Date.now() })
  } else {
    await kv.del(key)
  }
}

/** How many Rooms one tick looks at side by side. */
const TICK_CONCURRENCY = 4

/**
 * The server tick: look at every Room with an open PR, so PR events arrive
 * with the canvas closed. Each Branch's PR is read with its owner's GitHub
 * account (the member who created it), falling back to the Room's owner for
 * Branches from before owners were recorded or whose owner has left.
 */
export async function runPrWatchTick(): Promise<{ rooms: number }> {
  const roomIds = (await kv.keys(WATCHED_PREFIX)).map((k) =>
    k.slice(WATCHED_PREFIX.length)
  )
  const queue = [...roomIds]
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      await tickRoom(id).catch((e) => {
        console.error(`PR Watch tick failed for ${id}:`, e)
      })
    }
  }
  await Promise.all(Array.from({ length: TICK_CONCURRENCY }, worker))
  return { rooms: roomIds.length }
}

async function tickRoom(roomId: string) {
  const record = await getRoom(roomId)
  if (!record) {
    await kv.del(WATCHED_PREFIX + roomId)
    return
  }
  const owners = new Map<string, Promise<string | null>>()
  const tokenOf = (userId: string) => {
    let token = owners.get(userId)
    if (!token) {
      token = canAccess(roomId, userId).then((member) =>
        member ? getGitHubTokenForUser(userId) : null
      )
      owners.set(userId, token)
    }
    return token
  }
  const read = githubPrReader(async (target) => {
    const own = target.ownerId ? await tokenOf(target.ownerId) : null
    return own ?? tokenOf(record.ownerId)
  })
  await runPrWatch(openRoomForPrWatchTick(roomId), read, { openOnly: true })
}
